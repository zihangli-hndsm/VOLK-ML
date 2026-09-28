"""Loopback-only runner for the pinned VOLK imported-attention profile.

The service accepts model bytes, never a client-supplied path. Uploaded bytes
are kept in memory for the lifetime of this process and are never written to
disk. It is a local execution bridge, not a general ONNX hosting service.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnx
import onnxruntime as ort


API_VERSION = "g2-local-v1"
PROFILE_ID = "bert-tiny-sst2-attention-v25-cpu-v1"
PROFILE_SHA256 = "19b18790c5cc466d086ec473e91566bc3e852a74878fbae68f78d483a45c6cef"
MAX_MODEL_BYTES = 20 * 1024 * 1024
MAX_JSON_BYTES = 16 * 1024
ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
TOKEN_IDS_A = [101, 2023, 3185, 2001, 2204, 102]
TOKEN_IDS_B = [101, 2023, 3185, 2001, 2919, 102]
INPUT_NAMES = ["input_ids", "attention_mask", "token_type_ids"]
OUTPUT_NAMES = ["logits", "attention_layer_0", "attention_layer_1"]


class ProfileError(Exception):
    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


class AttentionRuntime:
    def __init__(self):
        self.session = None
        self.model_hash = None

    def import_model(self, model_bytes: bytes):
        if not model_bytes or len(model_bytes) > MAX_MODEL_BYTES:
            raise ProfileError("MODEL_SIZE_INVALID")
        digest = hashlib.sha256(model_bytes).hexdigest()
        if digest != PROFILE_SHA256:
            raise ProfileError("MODEL_PROFILE_MISMATCH", 422)
        try:
            model = onnx.load_model_from_string(model_bytes)
            validate_profile_graph(model)
            options = ort.SessionOptions()
            options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            next_session = ort.InferenceSession(
                model_bytes,
                sess_options=options,
                providers=["CPUExecutionProvider"],
            )
        except ProfileError:
            raise
        except Exception as error:
            raise ProfileError("MODEL_LOAD_FAILED", 422) from error
        if next_session.get_providers() != ["CPUExecutionProvider"]:
            raise ProfileError("CPU_PROVIDER_REQUIRED", 422)
        if [item.name for item in next_session.get_inputs()] != INPUT_NAMES:
            raise ProfileError("MODEL_INPUT_PROFILE_MISMATCH", 422)
        if [item.name for item in next_session.get_outputs()] != OUTPUT_NAMES:
            raise ProfileError("MODEL_OUTPUT_PROFILE_MISMATCH", 422)
        self.session = next_session
        self.model_hash = "sha256:" + digest
        return {"apiVersion": API_VERSION, "profileId": PROFILE_ID, "modelHash": self.model_hash}

    def compare(self, payload):
        exact_keys(payload, {"apiVersion", "requestId", "modelHash", "inputIdsA", "inputIdsB"})
        if payload["apiVersion"] != API_VERSION:
            raise ProfileError("API_VERSION_UNSUPPORTED", 426)
        validate_request_id(payload["requestId"])
        if self.session is None or payload["modelHash"] != self.model_hash:
            raise ProfileError("MODEL_NOT_BOUND", 409)
        validate_pair(payload["inputIdsA"], payload["inputIdsB"])
        mask_a = np.ones((1, 6), dtype=np.int64)
        mask_b = np.ones((1, 6), dtype=np.int64)
        types_a = np.zeros((1, 6), dtype=np.int64)
        types_b = np.zeros((1, 6), dtype=np.int64)
        output_a = self.session.run(OUTPUT_NAMES, {
            "input_ids": np.asarray([payload["inputIdsA"]], dtype=np.int64),
            "attention_mask": mask_a,
            "token_type_ids": types_a,
        })
        output_b = self.session.run(OUTPUT_NAMES, {
            "input_ids": np.asarray([payload["inputIdsB"]], dtype=np.int64),
            "attention_mask": mask_b,
            "token_type_ids": types_b,
        })
        result_a = normalize_outputs(output_a)
        result_b = normalize_outputs(output_b)
        return {
            "apiVersion": API_VERSION,
            "profileId": PROFILE_ID,
            "modelHash": self.model_hash,
            "requestId": payload["requestId"],
            "inputIdsA": payload["inputIdsA"],
            "inputIdsB": payload["inputIdsB"],
            "sampleA": result_a,
            "sampleB": result_b,
        }


def exact_keys(value, expected):
    if not isinstance(value, dict) or set(value) != expected:
        raise ProfileError("REQUEST_SCHEMA_INVALID")


def validate_request_id(value):
    if not isinstance(value, str) or len(value) < 8 or len(value) > 80:
        raise ProfileError("REQUEST_ID_INVALID")
    if not all(character.isalnum() or character in "-_" for character in value):
        raise ProfileError("REQUEST_ID_INVALID")


def dimension_values(value_info):
    return [dim.dim_value or dim.dim_param for dim in value_info.type.tensor_type.shape.dim]


def validate_profile_graph(model):
    if len(model.opset_import) != 1 or model.opset_import[0].domain != "" or model.opset_import[0].version != 25:
        raise ProfileError("MODEL_OPSET_UNSUPPORTED", 422)
    if len(model.graph.node) != 70:
        raise ProfileError("MODEL_GRAPH_PROFILE_MISMATCH", 422)
    attention_nodes = [node for node in model.graph.node if node.op_type == "Attention" and node.domain == ""]
    if len(attention_nodes) != 2:
        raise ProfileError("MODEL_ATTENTION_PROFILE_MISMATCH", 422)
    for node in attention_nodes:
        attributes = {attribute.name: onnx.helper.get_attribute_value(attribute) for attribute in node.attribute}
        if attributes.get("qk_matmul_output_mode") != 3 or attributes.get("is_causal") != 0:
            raise ProfileError("MODEL_ATTENTION_OUTPUT_UNSUPPORTED", 422)
    inputs = list(model.graph.input)
    outputs = list(model.graph.output)
    if [value.name for value in inputs] != INPUT_NAMES or [value.name for value in outputs] != OUTPUT_NAMES:
        raise ProfileError("MODEL_IO_PROFILE_MISMATCH", 422)
    expected_inputs = [[1, "sequence"], [1, "sequence"], [1, "sequence"]]
    if [dimension_values(value) for value in inputs] != expected_inputs:
        raise ProfileError("MODEL_INPUT_SHAPE_UNSUPPORTED", 422)
    expected_outputs = [[1, 2], [1, 2, "sequence", ""], [1, 2, "sequence", ""]]
    if [dimension_values(value) for value in outputs] != expected_outputs:
        raise ProfileError("MODEL_OUTPUT_SHAPE_UNSUPPORTED", 422)


def validate_pair(input_a, input_b):
    if not isinstance(input_a, list) or not isinstance(input_b, list):
        raise ProfileError("INPUT_PAIR_INVALID")
    if len(input_a) != 6 or len(input_b) != 6:
        raise ProfileError("INPUT_LENGTH_UNSUPPORTED")
    if any(type(token) is not int or token < 0 or token > 30521 for token in input_a + input_b):
        raise ProfileError("INPUT_TOKEN_INVALID")
    if input_a not in (TOKEN_IDS_A, TOKEN_IDS_B) or input_b not in (TOKEN_IDS_A, TOKEN_IDS_B):
        raise ProfileError("INPUT_PAIR_UNSUPPORTED")
    if input_a == input_b:
        raise ProfileError("INPUT_PAIR_MUST_DIFFER")
    if sum(left != right for left, right in zip(input_a, input_b)) != 1:
        raise ProfileError("INPUT_PAIR_MUST_DIFFER_BY_ONE_TOKEN")


def normalize_outputs(outputs):
    if len(outputs) != 3:
        raise ProfileError("MODEL_OUTPUT_INVALID", 500)
    logits, *attention_outputs = outputs
    if logits.shape != (1, 2) or not np.isfinite(logits).all():
        raise ProfileError("MODEL_LOGITS_INVALID", 500)
    attentions = []
    for values in attention_outputs:
        if values.shape != (1, 2, 6, 6) or not np.isfinite(values).all():
            raise ProfileError("MODEL_ATTENTION_INVALID", 500)
        if float(values.min()) < -1e-5 or float(values.max()) > 1.00001:
            raise ProfileError("MODEL_ATTENTION_NOT_PROBABILITIES", 500)
        row_sums = values.sum(axis=-1)
        if float(np.max(np.abs(row_sums - 1.0))) > 1e-3:
            raise ProfileError("MODEL_ATTENTION_NOT_NORMALIZED", 500)
        attentions.append(values[0].astype(np.float32).tolist())
    return {
        "logits": logits[0].astype(np.float32).tolist(),
        "attentionProbabilities": attentions,
    }


runtime = AttentionRuntime()


class Handler(BaseHTTPRequestHandler):
    server_version = "VOLKLocalAttention/1"

    def _cors(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":"), allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):  # noqa: N802 - stdlib handler API
        origin = self.headers.get("Origin")
        if origin not in ALLOWED_ORIGINS:
            self._json(403, {"error": {"code": "ORIGIN_NOT_ALLOWED"}})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type, X-VOLK-API-Version, X-VOLK-Request-Id")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def _read_body(self, maximum):
        length = self.headers.get("Content-Length")
        try:
            size = int(length)
        except (TypeError, ValueError) as error:
            raise ProfileError("CONTENT_LENGTH_REQUIRED") from error
        if size <= 0 or size > maximum:
            raise ProfileError("REQUEST_SIZE_INVALID", 413)
        return self.rfile.read(size)

    def do_GET(self):  # noqa: N802 - stdlib handler API
        if self.path != "/health":
            self._json(404, {"error": {"code": "NOT_FOUND"}})
            return
        self._json(200, {
            "apiVersion": API_VERSION,
            "status": "ok",
            "profileId": PROFILE_ID,
            "provider": "CPUExecutionProvider",
            "modelLoaded": runtime.session is not None,
            "modelHash": runtime.model_hash,
        })

    def do_POST(self):  # noqa: N802 - stdlib handler API
        try:
            if self.path == "/v1/model/import":
                if self.headers.get("Content-Type", "").split(";")[0] != "application/octet-stream":
                    raise ProfileError("CONTENT_TYPE_UNSUPPORTED", 415)
                if self.headers.get("X-VOLK-API-Version") != API_VERSION:
                    raise ProfileError("API_VERSION_UNSUPPORTED", 426)
                request_id = self.headers.get("X-VOLK-Request-Id")
                validate_request_id(request_id)
                payload = runtime.import_model(self._read_body(MAX_MODEL_BYTES))
                payload["requestId"] = request_id
                self._json(200, payload)
                return
            if self.path == "/v1/compare":
                if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                    raise ProfileError("CONTENT_TYPE_UNSUPPORTED", 415)
                raw = self._read_body(MAX_JSON_BYTES)
                try:
                    payload = json.loads(raw)
                except (UnicodeDecodeError, json.JSONDecodeError) as error:
                    raise ProfileError("REQUEST_JSON_INVALID") from error
                self._json(200, runtime.compare(payload))
                return
            self._json(404, {"error": {"code": "NOT_FOUND"}})
        except ProfileError as error:
            self._json(error.status, {"error": {"code": error.code}})
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception:
            self._json(500, {"error": {"code": "LOCAL_RUNTIME_FAILED"}})

    def log_message(self, format_string, *args):
        print("[volk-local-attention] " + format_string % args)


def main():
    parser = argparse.ArgumentParser(description="VOLK G2 imported-attention local CPU runner")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    if args.host != "127.0.0.1":
        parser.error("The G2 runner must bind to 127.0.0.1 only.")
    server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.daemon_threads = True
    print(f"VOLK G2 local CPU runner listening at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
