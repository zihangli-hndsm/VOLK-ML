"""Fixed H2 v1 worker. It executes only coordinator-generated canonical source."""

import base64
import hashlib
import json
import math
import os
import pathlib
import struct
import sys
import time
import uuid


MAX_REQUEST_BYTES = 20 * 1024 * 1024
MAX_SOURCE_BYTES = 600_000
MAX_RESULT_BYTES = 256 * 1024
PROFILE = "h2-tabular-sequential-v1"
COMPILER_VERSION = "volk-ir-v2-h2-local-python-v1"


class WorkerFailure(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code = code


def fail(code):
    raise WorkerFailure(code)


def canonical_json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def error_response(code, cancellation_requested=False, process_terminated=False, result_discarded=False):
    safe_code = code if isinstance(code, str) and code.startswith("H2_") and len(code) <= 51 else "H2_WORKER_FAILED"
    return {
        "schemaVersion": "volk.h2.response.v1",
        "status": "failed",
        "error": {"code": safe_code, "message": safe_code},
        "lifecycle": {
            "cancellationRequested": cancellation_requested,
            "processTerminated": process_terminated,
            "resultDiscarded": result_discarded,
        },
    }


def expected_run_folder(source_path):
    local = os.environ.get("LOCALAPPDATA")
    if not local:
        fail("H2_RUNTIME_UNAVAILABLE")
    root = (pathlib.Path(local) / "VOLK" / "h2-local-python-v1" / "runs").resolve()
    source = pathlib.Path(source_path).resolve()
    if source.parent != root / source.parent.name or source.name != "compiled.py":
        fail("H2_WORKER_SOURCE_PATH_INVALID")
    marker = source.parent / ".volk-h2-owned"
    if not marker.is_file() or marker.read_text(encoding="ascii") != "volk-h2-owned-v1\n":
        fail("H2_WORKER_SOURCE_PATH_INVALID")
    return source


def parse_input():
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        fail("H2_REQUEST_TOO_LARGE")
    try:
        body = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("H2_WORKER_INPUT_INVALID")
    if not isinstance(body, dict) or set(body) != {"request", "runtime"}:
        fail("H2_WORKER_INPUT_INVALID")
    if not isinstance(body["request"], dict) or not isinstance(body["runtime"], dict):
        fail("H2_WORKER_INPUT_INVALID")
    if set(body["runtime"]) != {"configFingerprint", "compiledSourceSha256", "runId"}:
        fail("H2_WORKER_INPUT_INVALID")
    return body["request"], body["runtime"]


def package_parameters(model):
    blocks = []
    tensors = []
    dense_index = 0
    for module in model.modules():
        if not isinstance(module, torch.nn.Linear):
            continue
        weight = module.weight.detach().to(device="cpu", dtype=torch.float32).contiguous()
        weight_bytes = weight.numpy().astype("<f4", copy=False).tobytes(order="C")
        tensors.append({
            "name": f"layers.{dense_index}.weight",
            "dtype": "float32-le",
            "shape": [int(weight.shape[0]), int(weight.shape[1])],
            "offset": sum(len(block) for block in blocks),
            "length": len(weight_bytes),
        })
        blocks.append(weight_bytes)
        if module.bias is not None:
            bias = module.bias.detach().to(device="cpu", dtype=torch.float32).contiguous()
            bias_bytes = bias.numpy().astype("<f4", copy=False).tobytes(order="C")
            tensors.append({
                "name": f"layers.{dense_index}.bias",
                "dtype": "float32-le",
                "shape": [int(bias.shape[0])],
                "offset": sum(len(block) for block in blocks),
                "length": len(bias_bytes),
            })
            blocks.append(bias_bytes)
        dense_index += 1
    payload = b"".join(blocks)
    if not tensors or len(payload) > 32_768:
        fail("H2_RESULT_TENSOR_LIMIT")
    return {
        "encoding": "volk.tensor-manifest.v1",
        "byteOrder": "little-endian",
        "payloadBase64": base64.b64encode(payload).decode("ascii"),
        "tensors": tensors,
    }


def verify_dropout_modes(model):
    original_rng = torch.get_rng_state()
    try:
        for layer in model.modules():
            if not isinstance(layer, torch.nn.Dropout) or layer.p <= 0:
                continue
            was_training = layer.training
            probe = torch.ones((8, 256), dtype=torch.float32)
            try:
                layer.train()
                torch.manual_seed(202601)
                train_first = layer(probe)
                torch.manual_seed(202602)
                train_second = layer(probe)
                if torch.equal(train_first, train_second):
                    fail("H2_DROPOUT_TRAIN_MODE_INVALID")
                layer.eval()
                eval_first = layer(probe)
                eval_second = layer(probe)
                if not torch.equal(eval_first, eval_second) or not torch.equal(eval_first, probe):
                    fail("H2_DROPOUT_EVAL_MODE_INVALID")
            finally:
                layer.train(was_training)
    finally:
        torch.set_rng_state(original_rng)


def train(source_path, request, runtime):
    if request.get("schemaVersion") != "volk.h2.request.v2" or request.get("profile") != PROFILE:
        fail("H2_REQUEST_VERSION_UNSUPPORTED")
    source = expected_run_folder(source_path)
    source_bytes = source.read_bytes()
    if len(source_bytes) > MAX_SOURCE_BYTES:
        fail("H2_COMPILER_OUTPUT_TOO_LARGE")
    source_hash = hashlib.sha256(source_bytes).hexdigest()
    if source_hash != runtime.get("compiledSourceSha256"):
        fail("H2_COMPILER_OUTPUT_IDENTITY_MISMATCH")
    try:
        request_data = request["dataset"]
        x_values = [row["features"] for row in request_data["rows"]]
        y_values = [row["target"] for row in request_data["rows"]]
        train_indices = request["split"]["trainIndices"]
        test_indices = request["split"]["testIndices"]
        training = request["training"]
    except (KeyError, TypeError):
        fail("H2_WORKER_INPUT_INVALID")
    if not x_values or not train_indices or not test_indices:
        fail("H2_WORKER_INPUT_INVALID")

    torch.use_deterministic_algorithms(True)
    torch.set_num_threads(1)
    torch.set_num_interop_threads(1)
    torch.manual_seed(2026)
    x_array = np.asarray(x_values, dtype=np.float32)
    y_array = np.asarray(y_values, dtype=np.float32)
    if not np.isfinite(x_array).all() or not np.isfinite(y_array).all():
        fail("H2_DATASET_NON_FINITE")
    started_at = time.time()
    scope = {
        "__name__": "__volk_h2_compiled__",
        "H2_TRAIN_INDICES": train_indices,
        "load_tabular_data": lambda: (x_array, y_array),
    }
    try:
        code = compile(source_bytes.decode("utf-8"), "<volk-h2-canonical-compiler>", "exec", dont_inherit=True)
        exec(code, scope, scope)
    except WorkerFailure:
        raise
    except BaseException:
        fail("H2_TRAINING_FAILED")
    model = scope.get("model")
    losses = scope.get("loss_history")
    if (not isinstance(model, torch.nn.Module) or not isinstance(losses, list)
            or len(losses) != training["epochs"] or not all(math.isfinite(float(value)) for value in losses)):
        fail("H2_TRAINING_RESULT_INVALID")

    verify_dropout_modes(model)
    model.eval()
    x_tensor = torch.tensor(x_array, dtype=torch.float32)
    test_index_tensor = torch.tensor(test_indices, dtype=torch.long)
    y_tensor = torch.tensor(y_array, dtype=torch.long if request_data["task"] == "classification" else torch.float32)
    with torch.inference_mode():
        predictions = model(x_tensor.index_select(0, test_index_tensor))
        targets = y_tensor.index_select(0, test_index_tensor)
        if request_data["task"] == "classification":
            predicted = predictions.argmax(dim=1)
            accuracy = float((predicted == targets).to(dtype=torch.float64).mean().item())
            class_f1 = []
            for label in request_data["classLabels"]:
                tp = int(((predicted == label) & (targets == label)).sum().item())
                fp = int(((predicted == label) & (targets != label)).sum().item())
                fn = int(((predicted != label) & (targets == label)).sum().item())
                denominator = 2 * tp + fp + fn
                class_f1.append(0.0 if denominator == 0 else 2.0 * tp / denominator)
            metrics = {
                "task": "classification",
                "heldOutRows": len(test_indices),
                "accuracy": accuracy,
                "macroF1": math.fsum(class_f1) / len(class_f1),
            }
        else:
            errors = predictions.reshape(-1).to(dtype=torch.float64) - targets.reshape(-1).to(dtype=torch.float64)
            target_values = targets.reshape(-1).to(dtype=torch.float64)
            sse = float((errors * errors).sum().item())
            target_mean = target_values.mean()
            sst = float(((target_values - target_mean) ** 2).sum().item())
            r2 = {"status": "unavailable", "reason": "zero-total-variance"} if len(test_indices) < 2 or sst == 0 else 1.0 - sse / sst
            metrics = {
                "task": "regression",
                "heldOutRows": len(test_indices),
                "rmse": math.sqrt(sse / len(test_indices)),
                "r2": r2,
            }
    if not all(math.isfinite(value) for value in losses) or not all(
        math.isfinite(value) for value in metrics.values() if isinstance(value, float)
    ):
        fail("H2_TRAINING_NON_FINITE")

    finished_at = time.time()
    result = {
        "schemaVersion": "volk.h2.result.v2",
        "status": "succeeded",
        "runIdentity": {
            "runId": runtime["runId"],
            "sessionId": request["sessionId"],
            "requestFingerprint": request["identity"]["normalizedRequestFingerprint"],
            "graphFingerprint": request["identity"]["graphFingerprint"],
            "datasetFingerprint": request["identity"]["datasetFingerprint"],
            "splitFingerprint": request["identity"]["splitFingerprint"],
            "configFingerprint": runtime["configFingerprint"],
            "targetSemantics": {
                "task": request_data["task"],
                "targetName": request_data["targetName"],
                "classMapping": [
                    {"sourceValue": value, "classIndex": index}
                    for index, value in enumerate(request_data["classVocabulary"])
                ],
            },
        },
        "parameters": package_parameters(model),
        "epochLoss": [float(value) for value in losses],
        "metrics": metrics,
        "provenance": {
            "provider": "local-python",
            "pythonVersion": "3.12.10",
            "pytorchVersion": torch.__version__,
            "numpyVersion": np.__version__,
            "device": "cpu",
            "compilerVersion": COMPILER_VERSION,
            "profile": PROFILE,
            "startedAt": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(started_at)) + ".000Z",
            "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(finished_at)) + ".000Z",
        },
        "lifecycle": {"cancellationRequested": False, "processTerminated": False, "resultDiscarded": False},
    }
    encoded = canonical_json_bytes(result) + b"\n"
    if len(encoded) > MAX_RESULT_BYTES:
        fail("H2_RESULT_TOO_LARGE")
    return encoded


def main():
    lifecycle = {"cancellationRequested": False, "processTerminated": False, "resultDiscarded": True}
    try:
        if len(sys.argv) != 2:
            fail("H2_WORKER_ARGUMENT_INVALID")
        request, runtime = parse_input()
        result = train(sys.argv[1], request, runtime)
        sys.stdout.buffer.write(result)
        sys.stdout.buffer.flush()
        return 0
    except WorkerFailure as error:
        response = error_response(error.code, **lifecycle)
    except BaseException:
        response = error_response("H2_WORKER_FAILED", **lifecycle)
    sys.stdout.buffer.write(canonical_json_bytes(response) + b"\n")
    sys.stdout.buffer.flush()
    return 1


try:
    import numpy as np
    import torch
except BaseException:
    print(canonical_json_bytes(error_response("H2_RUNTIME_UNAVAILABLE", process_terminated=True)).decode("utf-8"))
    raise SystemExit(1)


if __name__ == "__main__":
    raise SystemExit(main())
