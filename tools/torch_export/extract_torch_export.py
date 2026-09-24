"""Extract a bounded, non-executable TorchExportDocumentV1 from a trusted .pt2 file.

torch.export.load uses pickle-backed data. Never point this CLI at an artifact
from an untrusted source. The browser accepts only the resulting JSON document.
"""

from __future__ import annotations

import argparse
import base64
import json
import math
import re
import sys
import zipfile
from pathlib import Path
from typing import Any

DOCUMENT_TYPE = "TorchExportDocumentV1"
MAX_DOCUMENT_CODE_UNITS = 500_000
MAX_OPS = 64
MAX_INPUTS_AND_STATE = 128
MAX_TENSOR_ELEMENTS = 65_536
MAX_STATE_BYTES = 196_608
MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_ARCHIVE_UNPACKED_BYTES = 128 * 1024 * 1024
IDENTIFIER = re.compile(r"^[A-Za-z][A-Za-z0-9_-]{0,63}$")
TARGET = re.compile(r"^[A-Za-z][A-Za-z0-9_.]{0,127}$")
SUPPORTED_TARGETS = {
    "aten.linear.default",
    "aten.relu.default",
    "aten.sigmoid.default",
    "aten.tanh.default",
    "aten.softmax.int",
}


class ExtractionError(ValueError):
    """A safe, bounded error suitable for the local CLI."""


def _fnv64_identity(value: dict[str, Any]) -> str:
    serialized = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    if len(serialized) > MAX_DOCUMENT_CODE_UNITS:
        raise ExtractionError("Torch Export document exceeds the JSON size bound.")
    # The emitted schema restricts all strings and keys to ASCII; code-point
    # iteration therefore matches the browser's UTF-16-code-unit fingerprint.
    mask = (1 << 64) - 1
    digest = 14_695_981_039_346_656_037
    for character in serialized:
        digest ^= ord(character)
        digest = (digest * 1_099_511_628_211) & mask
    return f"torch-export-doc-v1-{digest:016x}-{len(serialized):x}"


def _preflight_pt2(path: Path) -> None:
    if path.suffix.lower() != ".pt2":
        raise ExtractionError("Input must be a local .pt2 file.")
    if path.is_symlink() or not path.is_file():
        raise ExtractionError("Input must be a regular local file, not a symlink.")
    if path.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ExtractionError("Input archive exceeds the 64 MiB local extraction bound.")
    try:
        with zipfile.ZipFile(path) as archive:
            members = archive.infolist()
            if not members or sum(member.file_size for member in members) > MAX_ARCHIVE_UNPACKED_BYTES:
                raise ExtractionError("Expanded .pt2 archive exceeds the 128 MiB preflight bound.")
            if any(member.file_size > MAX_ARCHIVE_UNPACKED_BYTES for member in members):
                raise ExtractionError("An archive member exceeds the extraction preflight bound.")
    except zipfile.BadZipFile as error:
        raise ExtractionError("Input is not a valid torch.export .pt2 archive.") from error


def _enum_name(value: Any) -> str:
    return getattr(value, "name", str(value).rsplit(".", 1)[-1])


def _dtype_name(value: Any) -> str:
    result = str(value).removeprefix("torch.")
    if result not in {"float16", "float32"}:
        raise ExtractionError("Only float16 and float32 tensors are supported.")
    return result


def _static_shape(shape: Any, *, allow_vector: bool = False) -> list[dict[str, Any]]:
    result = []
    for dimension in shape:
        if isinstance(dimension, int):
            value = int(dimension)
            if value < 1 or value > 1_000_000:
                raise ExtractionError("Tensor dimension is outside the supported range.")
            result.append({"kind": "static", "value": value})
            continue
        symbol = str(dimension)
        if not IDENTIFIER.fullmatch(symbol):
            raise ExtractionError("Only named symbolic batch dimensions are supported.")
        result.append({"kind": "symbol", "name": symbol})
    if len(result) != 2 and not (allow_vector and len(result) == 1):
        raise ExtractionError("Only rank-two operator and user-input tensors are supported.")
    return result


def _tensor_record(identifier: str, target: str, tensor: Any) -> dict[str, Any]:
    if not TARGET.fullmatch(target):
        raise ExtractionError("Parameter target is not a bounded identifier.")
    cpu_tensor = tensor.detach().to(device="cpu").contiguous()
    dtype = _dtype_name(cpu_tensor.dtype)
    shape = [{"kind": "static", "value": int(value)} for value in cpu_tensor.shape]
    if len(shape) not in (1, 2):
        raise ExtractionError("Only rank-one biases and rank-two weights are supported.")
    count = math.prod(dimension["value"] for dimension in shape)
    if count < 1 or count > MAX_TENSOR_ELEMENTS:
        raise ExtractionError("Parameter tensor exceeds the element bound.")
    try:
        array = cpu_tensor.numpy()
        if sys.byteorder != "little":
            array = array.byteswap().view(array.dtype.newbyteorder("<"))
        payload = array.tobytes(order="C")
    except Exception as error:  # torch/numpy incompatibility is a safe extraction failure
        raise ExtractionError("Could not encode tensor state as little-endian bytes.") from error
    if dtype == "float16":
        import struct

        values = struct.iter_unpack("<e", payload)
    else:
        import struct

        values = struct.iter_unpack("<f", payload)
    if any(not math.isfinite(value[0]) for value in values):
        raise ExtractionError("Parameter tensor contains a non-finite value.")
    return {
        "id": identifier,
        "target": target,
        "dtype": dtype,
        "shape": shape,
        "encoding": "base64-le",
        "data": base64.b64encode(payload).decode("ascii"),
    }


def _tensor_spec(tensor: Any, *, allow_vector: bool = False) -> dict[str, Any]:
    if not hasattr(tensor, "shape") or not hasattr(tensor, "dtype"):
        raise ExtractionError("Operator metadata does not describe one tensor.")
    return {"dtype": _dtype_name(tensor.dtype), "shape": _static_shape(tensor.shape, allow_vector=allow_vector)}


def _ref_for_fx_value(value: Any, torch: Any, input_ids: dict[str, str], node_ids: dict[str, str]) -> Any:
    if isinstance(value, torch.fx.Node):
        if value.op == "placeholder" and value.name in input_ids:
            return {"kind": "input", "id": input_ids[value.name]}
        if value.name in node_ids:
            return {"kind": "node", "id": node_ids[value.name]}
        raise ExtractionError("Operator references an unsupported or forward graph value.")
    if value is None:
        return None
    if isinstance(value, int) and not isinstance(value, bool) and -(2**53) < value < 2**53:
        return {"kind": "scalar", "dtype": "int64", "value": value}
    raise ExtractionError("Operator argument is outside the bounded typed operand set.")


def _shape_metadata_for_node(node: Any) -> dict[str, Any]:
    value = node.meta.get("val")
    spec = _tensor_spec(value)
    return {**spec, "layout": "strided"}


def _range_constraints(program: Any) -> list[dict[str, Any]]:
    constraints = []
    for symbol, value_range in program.range_constraints.items():
        name = str(symbol)
        if not IDENTIFIER.fullmatch(name):
            raise ExtractionError("Symbolic range name is not a bounded identifier.")
        try:
            minimum = int(value_range.lower)
            maximum = int(value_range.upper)
        except (TypeError, ValueError, OverflowError) as error:
            raise ExtractionError("Unbounded or non-integer symbolic ranges are unsupported.") from error
        if minimum < 1 or maximum < minimum or maximum > 1_000_000:
            raise ExtractionError("Symbolic batch range must be finite and within 1..1,000,000.")
        constraints.append({"symbol": name, "min": minimum, "max": maximum})
    constraints.sort(key=lambda item: item["symbol"])
    return constraints


def _build_document(program: Any, torch: Any) -> dict[str, Any]:
    graph = program.graph_module.graph
    signature_by_name = {spec.arg.name: spec for spec in program.graph_signature.input_specs}
    placeholders = [node for node in graph.nodes if node.op == "placeholder"]
    graph_inputs = []
    parameters = []
    state_bytes = 0
    input_ids: dict[str, str] = {}
    parameter_index = 0
    user_index = 0
    for placeholder in placeholders:
        signature = signature_by_name.get(placeholder.name)
        if signature is None:
            raise ExtractionError("Graph placeholder is missing from the exported graph signature.")
        kind = _enum_name(signature.kind)
        if kind == "USER_INPUT":
            tensor = placeholder.meta.get("val")
            spec = _tensor_spec(tensor)
            identifier = f"i{user_index}"
            user_index += 1
            entry_kind = "USER_INPUT"
            target = None
            name = f"input{user_index - 1}"
        elif kind == "PARAMETER":
            tensor = placeholder.meta.get("val")
            spec = _tensor_spec(tensor, allow_vector=True)
            identifier = f"p{parameter_index}"
            parameter_index += 1
            entry_kind = "PARAMETER"
            target = str(signature.target)
            if not TARGET.fullmatch(target):
                raise ExtractionError("Parameter target is not a bounded identifier.")
            name = f"parameter{parameter_index - 1}"
            state_tensor = program.state_dict.get(target)
            if state_tensor is None:
                raise ExtractionError("Exported parameter state is missing from the document.")
            parameter = _tensor_record(identifier, target, state_tensor)
            state_bytes += len(base64.b64decode(parameter["data"]))
            if state_bytes > MAX_STATE_BYTES:
                raise ExtractionError("Exported parameter state exceeds the aggregate byte bound.")
            if parameter["dtype"] != spec["dtype"] or parameter["shape"] != spec["shape"]:
                raise ExtractionError("Parameter fake-tensor metadata does not match its state.")
            parameters.append(parameter)
        else:
            raise ExtractionError("Only USER_INPUT and PARAMETER graph-signature entries are supported.")
        input_ids[placeholder.name] = identifier
        graph_inputs.append({
            "id": identifier,
            "name": name,
            "kind": entry_kind,
            "target": target,
            "spec": spec,
        })

    node_ids: dict[str, str] = {}
    exported_nodes = []
    for node in graph.nodes:
        if node.op in {"placeholder", "output"}:
            continue
        if node.op != "call_function":
            raise ExtractionError("Only direct call_function ATen nodes are supported.")
        target = str(node.target)
        if target not in SUPPORTED_TARGETS:
            raise ExtractionError(f"Unsupported ATen target: {target[:96]}")
        identifier = f"n{len(exported_nodes)}"
        node_ids[node.name] = identifier
        exported_nodes.append({
            "id": identifier,
            "target": target,
            "args": [_ref_for_fx_value(value, torch, input_ids, node_ids) for value in node.args],
            "kwargs": {},
            "metadata": _shape_metadata_for_node(node),
        })
    output_node = next((node for node in graph.nodes if node.op == "output"), None)
    if output_node is None or len(program.graph_signature.output_specs) != 1:
        raise ExtractionError("Exactly one exported user output is required.")
    if _enum_name(program.graph_signature.output_specs[0].kind) != "USER_OUTPUT":
        raise ExtractionError("Only a USER_OUTPUT graph signature is supported.")
    raw_output = output_node.args[0]
    if isinstance(raw_output, (tuple, list)):
        if len(raw_output) != 1:
            raise ExtractionError("Tuple and multiple graph outputs are unsupported.")
        raw_output = raw_output[0]
    output_value = _ref_for_fx_value(raw_output, torch, input_ids, node_ids)
    output_tensor = output_node.meta.get("val")
    if isinstance(output_tensor, (tuple, list)):
        if len(output_tensor) != 1:
            raise ExtractionError("Tuple and multiple output tensors are unsupported.")
        output_tensor = output_tensor[0]
    document = {
        "type": DOCUMENT_TYPE,
        "version": 1,
        "exporter": {"name": "torch.export", "torchVersion": str(torch.__version__)[:32]},
        "graph": {
            "inputs": graph_inputs,
            "nodes": exported_nodes,
            "outputs": [{"kind": "USER_OUTPUT", "value": output_value, "spec": _tensor_spec(output_tensor)}],
            "rangeConstraints": _range_constraints(program),
        },
        "state": {"parameters": parameters, "buffers": [], "constants": []},
    }
    if len(exported_nodes) > MAX_OPS or len(graph_inputs) + len(parameters) > MAX_INPUTS_AND_STATE:
        raise ExtractionError("Exported graph exceeds the operation or state-entry bound.")
    document["documentFingerprint"] = _fnv64_identity(document)
    if len(json.dumps(document, ensure_ascii=False)) > MAX_DOCUMENT_CODE_UNITS:
        raise ExtractionError("Torch Export document exceeds the JSON size bound.")
    return document


def extract_torch_export_document(path: str | Path, *, trusted: bool = False) -> dict[str, Any]:
    """Load a local .pt2 only after explicit caller trust acknowledgement."""
    if trusted is not True:
        raise ExtractionError("Refusing to load pickle-backed .pt2 without explicit trusted=True acknowledgement.")
    source = Path(path).expanduser()
    if source.is_symlink():
        raise ExtractionError("Input must be a regular local file, not a symlink.")
    source = source.resolve(strict=True)
    _preflight_pt2(source)
    try:
        import torch
    except ImportError as error:
        raise ExtractionError("PyTorch must already be installed locally; this tool does not install it.") from error
    try:
        program = torch.export.load(source)
    except Exception as error:
        raise ExtractionError("Trusted .pt2 could not be loaded by the installed torch.export version.") from error
    return _build_document(program, torch)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Extract a bounded JSON graph document from a trusted local .pt2 file.")
    parser.add_argument("--input", required=True, help="Local .pt2 path produced by a trusted source.")
    parser.add_argument("--output", required=True, help="New JSON output path; existing files are not overwritten by default.")
    parser.add_argument("--trusted-pt2", action="store_true", help="Acknowledge that torch.export.load uses pickle and the input is trusted.")
    parser.add_argument("--overwrite", action="store_true", help="Allow replacing the selected output JSON file.")
    args = parser.parse_args(argv)
    if not args.trusted_pt2:
        parser.error("Refusing to load .pt2 without --trusted-pt2.")
    source = Path(args.input).expanduser()
    output = Path(args.output).expanduser()
    if source.resolve() == output.resolve():
        parser.error("Input and output paths must be different.")
    try:
        document = extract_torch_export_document(source, trusted=True)
        output.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(document, ensure_ascii=True, indent=2) + "\n"
        if args.overwrite:
            output.write_text(payload, encoding="utf-8")
        else:
            with output.open("x", encoding="utf-8", newline="\n") as stream:
                stream.write(payload)
    except (ExtractionError, OSError) as error:
        print(f"TORCH_EXPORT_EXTRACTION_FAILED: {error}", file=sys.stderr)
        return 2
    print(f"Created {output} ({len(payload)} JSON characters; document {document['documentFingerprint']}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
