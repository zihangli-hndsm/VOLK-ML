"""Loopback-only runner for the pinned VOLK imported-attention profile.

The service accepts model bytes, never a client-supplied path. Uploaded bytes
are kept in memory for the lifetime of this process and are never written to
disk. It is a local execution bridge, not a general ONNX hosting service.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import secrets
import socket
import threading
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np
import onnx
import onnxruntime as ort


API_VERSION = "g2-local-v2"
EXECUTION_CONTRACT_VERSION = 1
PROFILE_ID = "bert-tiny-sst2-attention-v25-cpu-v1"
PROFILE_SHA256 = "3ef55e4c13475e2b6cf4aec1f5002130412e9d58659e9e0943aeae863eba9cb1"
LEGACY_PROFILE_SHA256S = frozenset({"19b18790c5cc466d086ec473e91566bc3e852a74878fbae68f78d483a45c6cef"})
ACCEPTED_PROFILE_SHA256S = LEGACY_PROFILE_SHA256S | {PROFILE_SHA256}
MAX_MODEL_BYTES = 20 * 1024 * 1024
MAX_JSON_BYTES = 16 * 1024
MAX_SERVER_THREADS = 4
REQUEST_BODY_DEADLINE_SECONDS = 20
INFERENCE_DEADLINE_SECONDS = 25
ALLOWED_ORIGINS = {"http://localhost:5173", "http://127.0.0.1:5173"}
ALLOWED_HEADERS = {
    "accept", "content-type", "x-volk-api-version", "x-volk-request-id", "x-volk-local-authorization",
}
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
        self.operation_lock = threading.Lock()
        self.inference_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="volk-g2-inference")

    def try_begin_operation(self):
        return self.operation_lock.acquire(blocking=False)

    def end_operation(self):
        self.operation_lock.release()

    def close(self):
        self.inference_executor.shutdown(wait=False, cancel_futures=True)

    def import_model(self, model_bytes: bytes):
        if not model_bytes or len(model_bytes) > MAX_MODEL_BYTES:
            raise ProfileError("MODEL_SIZE_INVALID")
        digest = hashlib.sha256(model_bytes).hexdigest()
        if digest not in ACCEPTED_PROFILE_SHA256S:
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
        exact_keys(payload, {"apiVersion", "providerVersion", "requestId", "modelHash", "inputIdsA", "inputIdsB"})
        if payload["apiVersion"] != API_VERSION:
            raise ProfileError("API_VERSION_UNSUPPORTED", 426)
        if payload["providerVersion"] != ort.__version__:
            raise ProfileError("PROVIDER_VERSION_MISMATCH", 409)
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
            "providerVersion": ort.__version__,
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
generated_connection_token = not os.environ.get("VOLK_G2_RUNNER_TOKEN")
connection_token = os.environ.get("VOLK_G2_RUNNER_TOKEN") or secrets.token_urlsafe(32)
if len(connection_token) < 32 or len(connection_token) > 128:
    raise SystemExit("VOLK_G2_RUNNER_TOKEN must contain 32 to 128 URL-safe characters.")
if not all(character.isalnum() or character in "-_" for character in connection_token):
    raise SystemExit("VOLK_G2_RUNNER_TOKEN must contain only URL-safe characters.")


class BoundedThreadingHTTPServer(ThreadingHTTPServer):
    # Windows SO_REUSEADDR permits another process to bind the same active
    # address. Prefer exclusive ownership there; POSIX keeps normal restart
    # reuse, which does not allow two active listeners without SO_REUSEPORT.
    allow_reuse_address = os.name != "nt"
    allow_reuse_port = False

    def __init__(self, server_address, request_handler, max_threads=MAX_SERVER_THREADS):
        self.request_slots = threading.BoundedSemaphore(max_threads)
        super().__init__(server_address, request_handler)

    def server_bind(self):
        if os.name == "nt":
            exclusive_address = getattr(socket, "SO_EXCLUSIVEADDRUSE", None)
            if exclusive_address is None:
                raise OSError("SO_EXCLUSIVEADDRUSE is required for the Windows loopback runner.")
            self.socket.setsockopt(socket.SOL_SOCKET, exclusive_address, 1)
        super().server_bind()

    def process_request(self, request, client_address):
        if not self.request_slots.acquire(blocking=False):
            try:
                request.sendall(
                    b"HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
                )
            except OSError:
                pass
            request.close()
            return
        try:
            super().process_request(request, client_address)
        except Exception:
            self.request_slots.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.request_slots.release()

    def server_close(self):
        super().server_close()
        runtime.close()


class Handler(BaseHTTPRequestHandler):
    server_version = "VOLKLocalAttention/2"

    def _check_host(self):
        expected = f"127.0.0.1:{self.server.server_port}"
        if self.headers.get("Host", "").lower() != expected:
            raise ProfileError("HOST_NOT_ALLOWED", 403)

    def _authorize(self):
        self._check_host()
        origin = self.headers.get("Origin")
        if origin not in ALLOWED_ORIGINS:
            raise ProfileError("ORIGIN_NOT_ALLOWED", 403)
        supplied = self.headers.get("X-VOLK-Local-Authorization", "")
        if not hmac.compare_digest(supplied, connection_token):
            raise ProfileError("AUTHORIZATION_INVALID", 401)

    def _error(self, error):
        self._json(error.status, {"error": {"code": error.code}})

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
        try:
            self._check_host()
        except ProfileError as error:
            self._error(error)
            return
        requested_headers = {
            header.strip().lower()
            for header in self.headers.get("Access-Control-Request-Headers", "").split(",")
            if header.strip()
        }
        requested_method = self.headers.get("Access-Control-Request-Method", "").upper()
        if origin not in ALLOWED_ORIGINS or requested_method not in {"GET", "POST"} or requested_headers - ALLOWED_HEADERS:
            self._json(403, {"error": {"code": "ORIGIN_NOT_ALLOWED"}})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Accept, Content-Type, X-VOLK-API-Version, X-VOLK-Request-Id, X-VOLK-Local-Authorization")
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
        deadline = time.monotonic() + REQUEST_BODY_DEADLINE_SECONDS
        remaining = size
        chunks = []
        while remaining:
            time_left = deadline - time.monotonic()
            if time_left <= 0:
                raise ProfileError("REQUEST_BODY_TIMEOUT", 408)
            self.connection.settimeout(min(2.0, time_left))
            try:
                chunk = self.rfile.read1(min(64 * 1024, remaining))
            except (socket.timeout, TimeoutError) as error:
                raise ProfileError("REQUEST_BODY_TIMEOUT", 408) from error
            if not chunk:
                raise ProfileError("REQUEST_BODY_INCOMPLETE", 400)
            chunks.append(chunk)
            remaining -= len(chunk)
        self.connection.settimeout(None)
        return b"".join(chunks)

    def do_GET(self):  # noqa: N802 - stdlib handler API
        try:
            self._authorize()
        except ProfileError as error:
            self._error(error)
            return
        if self.path != "/health":
            self._json(404, {"error": {"code": "NOT_FOUND"}})
            return
        self._json(200, {
            "apiVersion": API_VERSION,
            "status": "ok",
            "profileId": PROFILE_ID,
            "provider": "CPUExecutionProvider",
            "providerVersion": ort.__version__,
            "adapterId": "onnxruntime-cpu",
            "executionContractVersion": EXECUTION_CONTRACT_VERSION,
            "maxConcurrentRequests": 1,
            "modelLoaded": runtime.session is not None,
            "modelHash": runtime.model_hash,
        })

    def do_POST(self):  # noqa: N802 - stdlib handler API
        try:
            self._authorize()
            if self.path == "/v1/model/import":
                if self.headers.get("Content-Type", "").split(";")[0] != "application/octet-stream":
                    raise ProfileError("CONTENT_TYPE_UNSUPPORTED", 415)
                if self.headers.get("X-VOLK-API-Version") != API_VERSION:
                    raise ProfileError("API_VERSION_UNSUPPORTED", 426)
                request_id = self.headers.get("X-VOLK-Request-Id")
                validate_request_id(request_id)
                if not runtime.try_begin_operation():
                    raise ProfileError("RUNNER_BUSY", 429)
                try:
                    payload = runtime.import_model(self._read_body(MAX_MODEL_BYTES))
                finally:
                    runtime.end_operation()
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
                if not runtime.try_begin_operation():
                    raise ProfileError("RUNNER_BUSY", 429)
                future = runtime.inference_executor.submit(runtime.compare, payload)
                release_in_handler = True
                try:
                    result = future.result(timeout=INFERENCE_DEADLINE_SECONDS)
                except FutureTimeout as error:
                    release_in_handler = False
                    future.add_done_callback(lambda _future: runtime.end_operation())
                    raise ProfileError("INFERENCE_TIMEOUT", 504) from error
                finally:
                    if release_in_handler:
                        runtime.end_operation()
                self._json(200, result)
                return
            self._json(404, {"error": {"code": "NOT_FOUND"}})
        except ProfileError as error:
            self._error(error)
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
    try:
        server = BoundedThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as error:
        # Windows reports a collision with another SO_EXCLUSIVEADDRUSE
        # listener as WSAEACCES (10013), while other bind conflicts use
        # WSAEADDRINUSE (10048). Both are actionable occupied-port failures.
        port_conflict_errors = {98, 10048}
        if os.name == "nt":
            port_conflict_errors.add(10013)
        if error.errno in port_conflict_errors:
            print(f"VOLK_G2_PORT_IN_USE {args.port}")
            raise SystemExit(2) from error
        raise
    server.daemon_threads = True
    print(f"VOLK G2 local CPU runner listening at http://{args.host}:{args.port}")
    if generated_connection_token:
        print("VOLK G2 connection code: " + connection_token)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
