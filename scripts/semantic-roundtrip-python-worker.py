"""Bounded test worker for freshly recompiled VOLK E3 fixtures.

This worker is not a sandbox or a public execution API. Its only source-execution
caller is the local E3 test runner, after canonical compiler output passes the
E1 source-manifest re-materialization check. Never pass edited or arbitrary code.
"""

from __future__ import annotations

import hashlib
import json
import platform
import re
import sys
from pathlib import Path
from typing import Any

MAX_STDIN_BYTES = 1_200_000
MAX_SOURCE_BYTES = 600_000
MAX_INPUTS = 2
MAX_FEATURE_RANK = 3
MAX_FEATURE_DIMENSION = 256
MAX_EXAMPLE_BATCH = 2
MAX_EXAMPLE_ELEMENTS = 32_768
CASE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
SHA256 = re.compile(r"^[a-f0-9]{64}$")


class WorkerError(ValueError):
    """Bounded protocol failure; details are intentionally not echoed."""


def _exact_object(value: Any, keys: set[str]) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise WorkerError("E3_WORKER_REQUEST_INVALID")
    return value


def _validate_features(value: Any) -> list[list[int]]:
    if not isinstance(value, list) or not 1 <= len(value) <= MAX_INPUTS:
        raise WorkerError("E3_WORKER_INPUT_ARITY_INVALID")
    result = []
    for shape in value:
        if not isinstance(shape, list) or not 1 <= len(shape) <= MAX_FEATURE_RANK:
            raise WorkerError("E3_WORKER_FEATURE_RANK_INVALID")
        if any(type(dimension) is not int or not 1 <= dimension <= MAX_FEATURE_DIMENSION for dimension in shape):
            raise WorkerError("E3_WORKER_FEATURE_DIMENSION_INVALID")
        result.append(shape)
    elements = MAX_EXAMPLE_BATCH * sum(_product(shape) for shape in result)
    if elements > MAX_EXAMPLE_ELEMENTS:
        raise WorkerError("E3_WORKER_EXAMPLE_BOUND")
    return result


def _product(values: list[int]) -> int:
    total = 1
    for value in values:
        total *= value
    return total


def _request() -> dict[str, Any]:
    raw = sys.stdin.buffer.read(MAX_STDIN_BYTES + 1)
    if len(raw) > MAX_STDIN_BYTES:
        raise WorkerError("E3_WORKER_STDIN_BOUND")
    try:
        request = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise WorkerError("E3_WORKER_REQUEST_INVALID") from None
    if not isinstance(request, dict) or request.get("type") != "VolkSemanticRoundTripWorkerRequestV1":
        raise WorkerError("E3_WORKER_REQUEST_INVALID")
    mode = request.get("mode")
    common = {"type", "mode", "caseId", "inputFeatureShapes", "inputDtype", "dynamicBatch"}
    if mode == "canonical-source":
        _exact_object(request, common | {"source", "sourceSha256"})
        source = request["source"]
        source_digest = request["sourceSha256"]
        if not isinstance(source, str) or not source:
            raise WorkerError("E3_WORKER_SOURCE_INVALID")
        source_bytes = source.encode("utf-8")
        if len(source_bytes) > MAX_SOURCE_BYTES:
            raise WorkerError("E3_WORKER_SOURCE_BOUND")
        if not isinstance(source_digest, str) or not SHA256.fullmatch(source_digest):
            raise WorkerError("E3_WORKER_SOURCE_DIGEST_INVALID")
        if hashlib.sha256(source_bytes).hexdigest() != source_digest:
            raise WorkerError("E3_WORKER_SOURCE_DIGEST_MISMATCH")
    elif mode == "trusted-shared-parameter-test-model":
        _exact_object(request, common)
        if request["inputFeatureShapes"] != [[4]] or request["inputDtype"] != "float32":
            raise WorkerError("E3_WORKER_TEST_MODEL_PROFILE_INVALID")
    elif mode == "trusted-view-test-model":
        _exact_object(request, common)
        if request["inputFeatureShapes"] != [[4]] or request["inputDtype"] != "float32":
            raise WorkerError("E3_WORKER_TEST_MODEL_PROFILE_INVALID")
    else:
        raise WorkerError("E3_WORKER_MODE_UNSUPPORTED")
    if not isinstance(request.get("caseId"), str) or not CASE_ID.fullmatch(request["caseId"]):
        raise WorkerError("E3_WORKER_CASE_ID_INVALID")
    _validate_features(request["inputFeatureShapes"])
    if request["inputDtype"] not in {"float16", "float32"}:
        raise WorkerError("E3_WORKER_DTYPE_UNSUPPORTED")
    dynamic = request["dynamicBatch"]
    if not isinstance(dynamic, dict) or set(dynamic) != {"enabled", "min", "max"}:
        raise WorkerError("E3_WORKER_BATCH_INVALID")
    if type(dynamic["enabled"]) is not bool:
        raise WorkerError("E3_WORKER_BATCH_INVALID")
    if type(dynamic["min"]) is not int or type(dynamic["max"]) is not int:
        raise WorkerError("E3_WORKER_BATCH_INVALID")
    if not 1 <= dynamic["min"] <= MAX_FEATURE_DIMENSION or not dynamic["min"] <= dynamic["max"] <= MAX_FEATURE_DIMENSION:
        raise WorkerError("E3_WORKER_BATCH_INVALID")
    if mode == "trusted-view-test-model" and dynamic["enabled"]:
        raise WorkerError("E3_WORKER_TEST_MODEL_PROFILE_INVALID")
    return request


def _bounded_extractor_code(error: Exception) -> str:
    message = str(error)
    if "Only rank-two operator and user-input tensors" in message:
        return "E3_EXTRACTOR_RANK_UNSUPPORTED"
    if "Exactly one exported user output" in message or "Tuple and multiple output tensors" in message:
        return "E3_EXTRACTOR_OUTPUT_ARITY_UNSUPPORTED"
    if "direct call_function ATen nodes" in message:
        return "E3_EXTRACTOR_NODE_KIND_UNSUPPORTED"
    if "outside the bounded typed operand set" in message:
        return "E3_EXTRACTOR_ARGUMENT_UNSUPPORTED"
    if "Buffer and constant" in message:
        return "E3_EXTRACTOR_STATE_UNSUPPORTED"
    return "E3_EXTRACTOR_REJECTED"


def _shared_parameter_fixture(torch: Any) -> Any:
    class SharedParameterFixture(torch.nn.Module):
        def __init__(self) -> None:
            super().__init__()
            self.shared = torch.nn.Linear(4, 4)

        def forward(self, inputs: Any) -> Any:
            return self.shared(torch.relu(self.shared(inputs)))

    return SharedParameterFixture().eval()


def _view_test_fixture(torch: Any) -> Any:
    class ViewFixture(torch.nn.Module):
        def forward(self, inputs: Any) -> Any:
            return inputs.view(inputs.shape[0], 4)

    return ViewFixture().eval()


def _output_specs(value: Any) -> list[dict[str, Any]]:
    outputs = value if isinstance(value, (tuple, list)) else (value,)
    result = []
    for output in outputs:
        if not hasattr(output, "shape") or not hasattr(output, "dtype"):
            return []
        result.append({"rank": len(output.shape), "shape": [int(dim) for dim in output.shape], "dtype": str(output.dtype).removeprefix("torch.")})
    return result


def _main() -> dict[str, Any]:
    request = _request()
    try:
        import torch
    except ImportError:
        return {"type": "VolkSemanticRoundTripWorkerResultV1", "caseId": request["caseId"], "stage": "runtime", "status": "unverified", "reasonCode": "E3_TORCH_UNAVAILABLE"}

    try:
        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
        torch.manual_seed(7101)
    except RuntimeError:
        pass

    if request["mode"] == "trusted-shared-parameter-test-model":
        model = _shared_parameter_fixture(torch)
        source_digest = None
        origin = "trusted-test-model-variant-not-Graph-A"
    elif request["mode"] == "trusted-view-test-model":
        model = _view_test_fixture(torch)
        source_digest = None
        origin = "trusted-test-model-variant-not-Graph-A"
    else:
        namespace: dict[str, Any] = {"__name__": "__volk_e3_generated_fixture__"}
        try:
            compiled = compile(request["source"], "<E1-validated-canonical-VOLK-source>", "exec")
            exec(compiled, namespace, namespace)
        except Exception as error:
            return {
                "type": "VolkSemanticRoundTripWorkerResultV1",
                "caseId": request["caseId"],
                "stage": "canonical-source-execution",
                "status": "failed",
                "reasonCode": "E3_CANONICAL_SOURCE_EXECUTION_FAILED",
                "errorType": type(error).__name__[:80],
                "sourceSha256": request["sourceSha256"],
            }
        model = namespace.get("model")
        if not isinstance(model, torch.nn.Module):
            return {
                "type": "VolkSemanticRoundTripWorkerResultV1",
                "caseId": request["caseId"],
                "stage": "canonical-source-validation",
                "status": "failed",
                "reasonCode": "E3_GENERATED_MODEL_UNAVAILABLE",
                "sourceSha256": request["sourceSha256"],
            }
        model = model.eval()
        source_digest = request["sourceSha256"]
        origin = "fresh-canonical-compiler-output"

    dtype = {"float16": torch.float16, "float32": torch.float32}[request["inputDtype"]]
    examples = tuple(
        torch.zeros((MAX_EXAMPLE_BATCH, *shape), dtype=dtype, device="cpu")
        for shape in request["inputFeatureShapes"]
    )
    forward_status = "passed"
    output_descriptors: list[dict[str, Any]] = []
    try:
        with torch.no_grad():
            output_descriptors = _output_specs(model(*examples))
        if not output_descriptors:
            forward_status = "unsupported-output"
    except Exception as error:
        forward_status = "failed"
        forward_error_type = type(error).__name__[:80]
    else:
        forward_error_type = None

    try:
        dynamic = request["dynamicBatch"]
        if dynamic["enabled"]:
            batch = torch.export.Dim("volk_batch", min=dynamic["min"], max=dynamic["max"])
            dynamic_shapes = tuple({0: batch} for _ in examples)
            exported = torch.export.export(model, examples, dynamic_shapes=dynamic_shapes)
        else:
            exported = torch.export.export(model, examples)
    except Exception as error:
        return {
            "type": "VolkSemanticRoundTripWorkerResultV1",
            "caseId": request["caseId"],
            "origin": origin,
            "stage": "torch-export",
            "status": "unsupported",
            "reasonCode": "E3_TORCH_EXPORT_REJECTED",
            "errorType": type(error).__name__[:80],
            "sourceSha256": source_digest,
            "runtime": {"pythonVersion": platform.python_version(), "torchVersion": str(torch.__version__), "device": "cpu"},
            "forwardStatus": forward_status,
            "forwardErrorType": forward_error_type,
            "outputSpecs": output_descriptors,
            "parameterDtypes": sorted({str(parameter.dtype).removeprefix("torch.") for parameter in model.parameters()}),
        }

    exported_operator_targets = [
        str(node.target)[:128]
        for node in exported.graph_module.graph.nodes
        if node.op == "call_function"
    ][:64]

    worker_result: dict[str, Any] = {
        "type": "VolkSemanticRoundTripWorkerResultV1",
        "caseId": request["caseId"],
        "origin": origin,
        "stage": "torch-export",
        "status": "exported",
        "sourceSha256": source_digest,
        "exportedOperatorTargets": exported_operator_targets,
        "runtime": {"pythonVersion": platform.python_version(), "torchVersion": str(torch.__version__), "device": "cpu"},
        "forwardStatus": forward_status,
        "outputSpecs": output_descriptors,
        "parameterDtypes": sorted({str(parameter.dtype).removeprefix("torch.") for parameter in model.parameters()}),
    }
    if forward_error_type is not None:
        worker_result["forwardErrorType"] = forward_error_type

    try:
        repository_root = Path(__file__).resolve().parents[1]
        sys.path.insert(0, str(repository_root / "tools" / "torch_export"))
        from extract_torch_export import ExtractionError, extract_exported_program

        document = extract_exported_program(exported, model_identifier=request["caseId"])
        serialized_document = json.dumps(document, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
        if len(serialized_document.encode("utf-8")) > 600_000:
            raise WorkerError("E3_WORKER_DOCUMENT_BOUND")
        worker_result["document"] = document
        worker_result["stage"] = "extraction"
    except WorkerError as error:
        worker_result.update({"stage": "worker", "status": "failed", "reasonCode": str(error)})
    except Exception as error:
        reason = _bounded_extractor_code(error) if error.__class__.__name__ == "ExtractionError" else "E3_EXTRACTOR_INTERNAL_ERROR"
        worker_result.update({"stage": "extractor", "status": "unsupported", "reasonCode": reason, "errorType": type(error).__name__[:80]})
    return worker_result


def main() -> int:
    try:
        result = _main()
    except WorkerError as error:
        result = {"type": "VolkSemanticRoundTripWorkerResultV1", "stage": "request", "status": "failed", "reasonCode": str(error)}
    try:
        output = json.dumps(result, separators=(",", ":"), ensure_ascii=True, allow_nan=False)
    except (TypeError, ValueError):
        output = json.dumps({"type": "VolkSemanticRoundTripWorkerResultV1", "stage": "worker", "status": "failed", "reasonCode": "E3_WORKER_RESULT_INVALID"}, separators=(",", ":"))
    if len(output.encode("utf-8")) > 700_000:
        output = json.dumps({"type": "VolkSemanticRoundTripWorkerResultV1", "stage": "worker", "status": "failed", "reasonCode": "E3_WORKER_OUTPUT_BOUND"}, separators=(",", ":"))
    sys.stdout.write(output + "\n")
    return 0 if result.get("status") in {"exported", "unsupported", "unverified"} else 2


if __name__ == "__main__":
    raise SystemExit(main())
