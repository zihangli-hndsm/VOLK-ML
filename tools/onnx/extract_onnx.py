"""Extract bounded, metadata-only architecture evidence from a local ONNX ModelProto.

The browser accepts only the resulting JSON document. This module never copies
initializer values except for the small int64 shape-control vector of a Reshape.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

import onnx
from onnx import TensorProto, numpy_helper


DOCUMENT_TYPE = "VolkOnnxDocumentV1"
DOCUMENT_VERSION = 1
SUPPORTED_OPSET = 13
MAX_INPUT_BYTES = 25 * 1024 * 1024
MAX_DOCUMENT_CODE_UNITS = 500_000
MAX_NODES = 64
MAX_INITIALIZERS = 128
MAX_RANK = 8
MAX_DIMENSION = 1_000_000
MAX_TENSOR_ELEMENTS = 65_536
MODEL_ID = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
NAME = re.compile(r"^[A-Za-z0-9_.:/-]{1,96}$")
SUPPORTED_DTYPES = {
    TensorProto.FLOAT: "float32",
    TensorProto.FLOAT16: "float16",
    TensorProto.INT64: "int64",
}
SUPPORTED_OPS = {"Gemm", "MatMul", "Add", "Relu", "Sigmoid", "Tanh", "Softmax", "Flatten", "Reshape"}


class OnnxExtractionError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def fail(code: str, message: str) -> None:
    raise OnnxExtractionError(code, message)


def _canonical_json(value: Any) -> str:
    if isinstance(value, float):
        if not math.isfinite(value):
            fail("ONNX_DOCUMENT_INVALID", "Normalized values must be finite.")
        if value.is_integer():
            return str(int(value))
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    if value is None or isinstance(value, (str, bool, int)):
        return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    if isinstance(value, list):
        return "[" + ",".join(_canonical_json(item) for item in value) + "]"
    if isinstance(value, dict):
        return "{" + ",".join(
            json.dumps(key, ensure_ascii=False) + ":" + _canonical_json(value[key])
            for key in sorted(value)
        ) + "}"
    fail("ONNX_DOCUMENT_INVALID", "Normalized values must be JSON data.")


def fingerprint(document: dict[str, Any]) -> str:
    content = {key: value for key, value in document.items() if key != "documentFingerprint"}
    return "sha256:" + hashlib.sha256(_canonical_json(content).encode("utf-8")).hexdigest()


def _shape_from_value_info(value_info: Any, path: str) -> dict[str, Any]:
    if not value_info.type.HasField("tensor_type"):
        fail("ONNX_TENSOR_TYPE_UNSUPPORTED", f"{path} is not a tensor.")
    tensor_type = value_info.type.tensor_type
    dtype = SUPPORTED_DTYPES.get(tensor_type.elem_type)
    if dtype not in {"float16", "float32"}:
        fail("ONNX_DTYPE_UNSUPPORTED", f"{path} must use float16 or float32.")
    dims = []
    if not tensor_type.HasField("shape"):
        fail("ONNX_SHAPE_UNSUPPORTED", f"{path} has no declared shape.")
    if len(tensor_type.shape.dim) < 2 or len(tensor_type.shape.dim) > MAX_RANK:
        fail("ONNX_SHAPE_UNSUPPORTED", f"{path} must have rank 2 through {MAX_RANK}.")
    for index, dim in enumerate(tensor_type.shape.dim):
        if dim.HasField("dim_value"):
            value = int(dim.dim_value)
            if value < 1 or value > MAX_DIMENSION:
                fail("ONNX_SHAPE_UNSUPPORTED", f"{path} has an out-of-range dimension.")
            dims.append({"kind": "static", "value": value})
        elif dim.dim_param:
            if index != 0 or len(dim.dim_param) > 64 or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,63}", dim.dim_param):
                fail("ONNX_SHAPE_UNSUPPORTED", f"{path} has a dynamic non-batch or invalid dimension.")
            dims.append({"kind": "symbol", "name": dim.dim_param})
        else:
            fail("ONNX_SHAPE_UNSUPPORTED", f"{path} contains an unknown or ambiguous dimension.")
    return {"dtype": dtype, "shape": dims}


def _tensor_element_count(shape: list[int], path: str) -> int:
    count = 1
    if len(shape) < 1 or len(shape) > MAX_RANK:
        fail("ONNX_INITIALIZER_UNSUPPORTED", f"{path} has an unsupported rank.")
    for dim in shape:
        if dim < 1 or dim > MAX_DIMENSION:
            fail("ONNX_INITIALIZER_UNSUPPORTED", f"{path} has an out-of-range dimension.")
        count *= dim
        if count > MAX_TENSOR_ELEMENTS:
            fail("ONNX_INITIALIZER_LIMIT", f"{path} exceeds the bounded initializer metadata size.")
    return count


def _attributes(node: Any) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for attribute in node.attribute:
        if attribute.name in values:
            fail("ONNX_ATTRIBUTE_INVALID", "Operator attributes must be unique.")
        if attribute.type == onnx.AttributeProto.FLOAT:
            values[attribute.name] = float(attribute.f)
        elif attribute.type == onnx.AttributeProto.INT:
            values[attribute.name] = int(attribute.i)
        else:
            fail("ONNX_ATTRIBUTE_UNSUPPORTED", "Only scalar float and integer attributes are supported.")
    return values


def extract_model(model: Any, *, model_identifier: str) -> dict[str, Any]:
    """Return a fingerprinted, bounded metadata-only document for a ModelProto."""
    if not MODEL_ID.fullmatch(model_identifier):
        fail("ONNX_MODEL_ID_INVALID", "Model identifier must be a bounded stable identifier.")
    if model.ir_version < 7 or model.ir_version > onnx.IR_VERSION:
        fail("ONNX_IR_VERSION_UNSUPPORTED", f"ONNX IR version {model.ir_version} is outside the supported range 7..{onnx.IR_VERSION}.")
    if model.training_info or model.functions or model.configuration:
        fail("ONNX_MODEL_FEATURE_UNSUPPORTED", "Training metadata, local functions, and model configuration are not imported.")
    if not model.HasField("graph"):
        fail("ONNX_GRAPH_INVALID", "Exactly one ONNX graph is required.")
    graph = model.graph
    if graph.sparse_initializer or graph.quantization_annotation:
        fail("ONNX_MODEL_FEATURE_UNSUPPORTED", "Sparse initializers and quantization annotations are unsupported.")
    if len(graph.node) < 1 or len(graph.node) > MAX_NODES:
        fail("ONNX_GRAPH_LIMIT", f"Graph must contain 1..{MAX_NODES} operators.")
    if len(graph.initializer) > MAX_INITIALIZERS:
        fail("ONNX_GRAPH_LIMIT", f"Graph exceeds {MAX_INITIALIZERS} initializer metadata entries.")
    if len(graph.output) != 1:
        fail("ONNX_OUTPUT_UNSUPPORTED", "Exactly one graph output is supported.")

    imports = [(entry.domain, int(entry.version)) for entry in model.opset_import]
    default_imports = [version for domain, version in imports if domain in ("", "ai.onnx")]
    if len(default_imports) != 1 or len(imports) != 1:
        fail("ONNX_DOMAIN_UNSUPPORTED", "Only the single standard ONNX operator domain is supported.")
    if default_imports[0] != SUPPORTED_OPSET:
        fail("ONNX_OPSET_UNSUPPORTED", f"Only ONNX opset {SUPPORTED_OPSET} is supported; received {default_imports[0]}.")

    initializer_by_name = {}
    shape_control_names = {
        node.input[1]
        for node in graph.node
        if node.op_type == "Reshape" and len(node.input) > 1 and node.input[1]
    }
    for tensor in graph.initializer:
        if not NAME.fullmatch(tensor.name) or tensor.name in initializer_by_name:
            fail("ONNX_INITIALIZER_INVALID", "Initializer names must be unique bounded identifiers.")
        if tensor.data_location == TensorProto.EXTERNAL or tensor.external_data:
            fail("ONNX_EXTERNAL_DATA_UNSUPPORTED", "External tensor data is not imported.")
        shape = [int(value) for value in tensor.dims]
        _tensor_element_count(shape, tensor.name)
        dtype = SUPPORTED_DTYPES.get(tensor.data_type)
        role = "shape" if tensor.name in shape_control_names else "parameter"
        if role == "shape":
            if dtype != "int64" or len(shape) != 1 or shape[0] > MAX_RANK:
                fail("ONNX_RESHAPE_SHAPE_UNSUPPORTED", "Reshape shape controls must be a bounded int64 vector of length 1..8.")
            try:
                shape_values = [int(value) for value in numpy_helper.to_array(tensor).reshape(-1).tolist()]
            except Exception as exc:
                fail("ONNX_RESHAPE_SHAPE_UNSUPPORTED", "Reshape shape-control values could not be read safely.")
            if len(shape_values) != shape[0] or any(abs(value) > MAX_DIMENSION for value in shape_values):
                fail("ONNX_RESHAPE_SHAPE_UNSUPPORTED", "Reshape shape-control values are outside the bound.")
            initializer_by_name[tensor.name] = {"name": tensor.name, "dtype": dtype, "shape": shape, "role": role, "shapeValues": shape_values}
        else:
            if dtype not in {"float16", "float32"} or len(shape) not in (1, 2):
                fail("ONNX_INITIALIZER_UNSUPPORTED", "Learned parameters must be bounded rank-one or rank-two float16 or float32 tensors.")
            initializer_by_name[tensor.name] = {"name": tensor.name, "dtype": dtype, "shape": shape, "role": role}

    if any(value.name in initializer_by_name for value in graph.input):
        fail("ONNX_GRAPH_INVALID", "Initializers cannot also be mutable graph inputs.")
    if len(graph.input) != 1:
        fail("ONNX_INPUT_UNSUPPORTED", "Exactly one non-initializer tensor input is supported.")
    input_value = _shape_from_value_info(graph.input[0], "graph input")
    input_name = graph.input[0].name
    if not NAME.fullmatch(input_name):
        fail("ONNX_GRAPH_INVALID", "Graph input name is invalid.")

    # Reject custom operators and subgraph-valued attributes before invoking
    # shape inference on a model whose unsupported structure must not run.
    for node in graph.node:
        if node.domain not in ("", "ai.onnx"):
            fail("ONNX_DOMAIN_UNSUPPORTED", "Custom operator domains are not supported.")
        if node.op_type not in SUPPORTED_OPS:
            fail("ONNX_OPERATOR_UNSUPPORTED", f"Operator {node.op_type!r} is outside the bounded allowlist.")
        _attributes(node)

    # Shape inference contributes only bounded type/shape metadata; it does not
    # evaluate the model or move initializer values into the normalized document.
    try:
        inferred_model = onnx.shape_inference.infer_shapes(model, check_type=True, strict_mode=True, data_prop=False)
    except Exception as exc:
        fail("ONNX_SHAPE_INFERENCE_FAILED", "ONNX shape inference could not establish deterministic tensor metadata.")
    inferred_values = {}
    for value_info in list(inferred_model.graph.input) + list(inferred_model.graph.value_info) + list(inferred_model.graph.output):
        if value_info.name in inferred_values:
            continue
        inferred_values[value_info.name] = _shape_from_value_info(value_info, value_info.name)
    for tensor in graph.initializer:
        inferred_values[tensor.name] = {"dtype": SUPPORTED_DTYPES.get(tensor.data_type), "shape": [{"kind": "static", "value": int(value)} for value in tensor.dims]}

    normalized_nodes = []
    for index, node in enumerate(graph.node):
        if node.domain not in ("", "ai.onnx"):
            fail("ONNX_DOMAIN_UNSUPPORTED", "Custom operator domains are not supported.")
        if node.op_type not in SUPPORTED_OPS:
            fail("ONNX_OPERATOR_UNSUPPORTED", f"Operator {node.op_type!r} is outside the bounded allowlist.")
        if len(node.output) != 1 or not node.output[0] or not NAME.fullmatch(node.output[0]):
            fail("ONNX_OUTPUT_UNSUPPORTED", "Every operator must have exactly one named output.")
        if len(node.input) > 3 or any(not NAME.fullmatch(value) for value in node.input if value):
            fail("ONNX_NODE_INVALID", "Operator inputs must be bounded names or the optional empty input.")
        if not node.input or not node.input[0]:
            fail("ONNX_NODE_INVALID", "Every supported operator requires a data input.")
        output_name = node.output[0]
        if output_name not in inferred_values:
            fail("ONNX_SHAPE_INFERENCE_FAILED", "Operator output shape metadata is missing.")
        normalized_nodes.append({
            "id": f"n{index}",
            "op": node.op_type,
            "inputs": [value if value else None for value in node.input],
            "output": output_name,
            "attributes": _attributes(node),
            "metadata": inferred_values[output_name],
        })

    output_info = graph.output[0]
    if not NAME.fullmatch(output_info.name):
        fail("ONNX_GRAPH_INVALID", "Graph output name is invalid.")
    output_metadata = _shape_from_value_info(inferred_model.graph.output[0], "graph output")
    document: dict[str, Any] = {
        "type": DOCUMENT_TYPE,
        "version": DOCUMENT_VERSION,
        "model": {"identifier": model_identifier},
        "onnx": {"irVersion": int(model.ir_version), "opsetVersion": default_imports[0]},
        "extractor": {"schemaVersion": 1, "onnxVersion": onnx.__version__},
        "graph": {
            "input": {"name": input_name, **input_value},
            "initializers": list(initializer_by_name.values()),
            "nodes": normalized_nodes,
            "output": {"name": output_info.name, **output_metadata},
        },
        "documentFingerprint": "",
    }
    serialized = json.dumps(document, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
    if len(serialized) > MAX_DOCUMENT_CODE_UNITS:
        fail("ONNX_DOCUMENT_LIMIT", "Normalized ONNX document exceeds the size bound.")
    document["documentFingerprint"] = fingerprint(document)
    return document


def extract_onnx_file(input_path: Path, *, model_identifier: str) -> dict[str, Any]:
    try:
        size = input_path.stat().st_size
    except OSError as exc:
        fail("ONNX_FILE_INVALID", "Input ONNX file could not be accessed.")
    if size < 1 or size > MAX_INPUT_BYTES:
        fail("ONNX_FILE_LIMIT", f"Input ONNX model must be at most {MAX_INPUT_BYTES} bytes.")
    try:
        model = onnx.load(str(input_path), load_external_data=False)
    except Exception as exc:
        fail("ONNX_MODEL_INVALID", "Input is not a readable ONNX ModelProto.")
    return extract_model(model, model_identifier=model_identifier)


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract metadata-only JSON from a local ONNX ModelProto.")
    parser.add_argument("--input", required=True, type=Path, help="Local .onnx ModelProto file")
    parser.add_argument("--output", required=True, type=Path, help="Output normalized JSON document")
    parser.add_argument("--model-id", required=True, help="Stable model identifier (not a path)")
    parser.add_argument("--overwrite", action="store_true", help="Allow replacing the output JSON file")
    args = parser.parse_args()
    if args.output.exists() and not args.overwrite:
        print("ONNX_OUTPUT_EXISTS: refusing to overwrite; pass --overwrite explicitly", file=sys.stderr)
        return 2
    try:
        document = extract_onnx_file(args.input, model_identifier=args.model_id)
        args.output.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except OnnxExtractionError as exc:
        print(f"{exc.code}: {exc}", file=sys.stderr)
        return 2
    print(f"Wrote metadata-only {DOCUMENT_TYPE} ({len(document['graph']['nodes'])} operators).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
