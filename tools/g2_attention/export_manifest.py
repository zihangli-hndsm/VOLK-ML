"""Emit the deterministic, local G2 operator/tensor correspondence manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch
import transformers
from transformers import AutoConfig, AutoTokenizer


PROFILE_ID = "bert-tiny-sst2-attention-v25-cpu-v1"
PROFILE_SHA256 = "3ef55e4c13475e2b6cf4aec1f5002130412e9d58659e9e0943aeae863eba9cb1"
MANIFEST_ID = "g2-bert-tiny-attention-operator-correspondence-v1"
MODEL_ID = "gokulsrinivasagan/bert_uncased_L-2_H-128_A-2_sst2"
MODEL_REVISION = "e454ff624bde2785ee174112f0bcc7e99da8344d"
WEIGHTS_SHA256 = "8c3fd725aad8a2719edef9ef67a71996f5ffe53f24279c28e29fd2b7ae748dc2"
INPUT_IDS_A = [101, 2023, 3185, 2001, 2204, 102]
INPUT_IDS_B = [101, 2023, 3185, 2001, 2919, 102]
TOKENIZER_FILES = ("tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "vocab.txt")
INPUT_NAMES = ["input_ids", "attention_mask", "token_type_ids"]
OUTPUT_NAMES = ["logits", "attention_layer_0", "attention_layer_1"]
EXPECTED_VERSIONS = {
    "torch": "2.14.0+cpu",
    "transformers": "5.17.0",
    "onnx": "1.23.0",
    "onnxruntime": "1.30.0",
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def canonical_json_bytes(value) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def metadata_shape(value_info):
    return [dimension.dim_value if dimension.dim_value > 0 else dimension.dim_param or None
            for dimension in value_info.type.tensor_type.shape.dim]


def resolve_attention_operator(model: onnx.ModelProto, layer_index: int):
    tensor_name = f"attention_layer_{layer_index}"
    matches = [node for node in model.graph.node
               if node.op_type == "Attention" and node.domain == "" and tensor_name in node.output]
    if len(matches) != 1:
        raise SystemExit(f"Expected one exporter-declared Attention operator for {tensor_name}.")
    node = matches[0]
    attributes = {attribute.name: onnx.helper.get_attribute_value(attribute) for attribute in node.attribute}
    if attributes.get("qk_matmul_output_mode") != 3 or attributes.get("is_causal") != 0:
        raise SystemExit(f"{tensor_name} is not the registered non-causal post-softmax probability output.")
    return node, attributes


def create_manifest(artifact_path: Path, model_dir: Path) -> dict:
    actual_versions = {
        "torch": torch.__version__,
        "transformers": transformers.__version__,
        "onnx": onnx.__version__,
        "onnxruntime": ort.__version__,
    }
    if actual_versions != EXPECTED_VERSIONS:
        raise SystemExit(f"Exporter manifest toolchain is outside the pinned contract: {actual_versions}")
    artifact_sha256 = sha256_file(artifact_path)
    if artifact_sha256 != PROFILE_SHA256:
        raise SystemExit(f"Artifact hash is not the exact registered profile: {artifact_sha256}")
    weights = model_dir / "model.safetensors"
    if not weights.is_file() or sha256_file(weights) != WEIGHTS_SHA256:
        raise SystemExit("Pinned source checkpoint weights are missing or do not match their registered digest.")

    tokenizer_file_hashes = {}
    for filename in TOKENIZER_FILES:
        tokenizer_file = model_dir / filename
        if not tokenizer_file.is_file():
            raise SystemExit(f"Pinned tokenizer file is missing: {filename}")
        tokenizer_file_hashes[filename] = sha256_file(tokenizer_file)
    tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
    if tokenizer("this movie was good", add_special_tokens=True)["input_ids"] != INPUT_IDS_A:
        raise SystemExit("Pinned tokenizer does not produce the registered A token sequence.")
    if tokenizer("this movie was bad", add_special_tokens=True)["input_ids"] != INPUT_IDS_B:
        raise SystemExit("Pinned tokenizer does not produce the registered B token sequence.")
    differing_positions = [index for index, (left, right) in enumerate(zip(INPUT_IDS_A, INPUT_IDS_B)) if left != right]
    if differing_positions != [4] or len(INPUT_IDS_A) != 6 or len(INPUT_IDS_B) != 6:
        raise SystemExit("The pinned comparison pair must differ at exactly content-token position 4.")

    config = AutoConfig.from_pretrained(model_dir, local_files_only=True)
    if (config.num_hidden_layers, config.hidden_size, config.num_attention_heads, config.intermediate_size, config.vocab_size) != (2, 128, 2, 512, 30522):
        raise SystemExit("Pinned source configuration is outside the registered BERT-Tiny profile.")
    model = onnx.load(artifact_path, load_external_data=False)
    if len(model.opset_import) != 1 or model.opset_import[0].domain != "" or model.opset_import[0].version != 25:
        raise SystemExit("Artifact is outside the standard-domain opset 25 contract.")
    if len(model.graph.node) != 70:
        raise SystemExit("Artifact node count is outside the registered profile.")
    if [value.name for value in model.graph.input] != INPUT_NAMES or [value.name for value in model.graph.output] != OUTPUT_NAMES:
        raise SystemExit("Artifact input/output names are outside the registered profile.")

    runtime = ort.InferenceSession(str(artifact_path), providers=["CPUExecutionProvider"])
    if runtime.get_providers() != ["CPUExecutionProvider"]:
        raise SystemExit("Manifest observation must use CPUExecutionProvider only.")
    if [value.name for value in runtime.get_inputs()] != INPUT_NAMES or [value.name for value in runtime.get_outputs()] != OUTPUT_NAMES:
        raise SystemExit("Runtime signature differs from the exporter-authored manifest contract.")
    attention_shapes = []
    for input_ids in (INPUT_IDS_A, INPUT_IDS_B):
        ids = np.asarray([input_ids], dtype=np.int64)
        outputs = runtime.run(OUTPUT_NAMES, {
            "input_ids": ids,
            "attention_mask": np.ones((1, 6), dtype=np.int64),
            "token_type_ids": np.zeros((1, 6), dtype=np.int64),
        })
        if outputs[0].shape != (1, 2) or not np.isfinite(outputs[0]).all():
            raise SystemExit("Actual local logits do not match the registered runtime shape.")
        current_shapes = []
        for value in outputs[1:]:
            if value.shape != (1, 2, 6, 6) or not np.isfinite(value).all():
                raise SystemExit("Actual local attention tensors do not match the registered runtime shape.")
            if float(np.max(np.abs(value.sum(axis=-1) - 1))) > 1e-3:
                raise SystemExit("Actual local attention tensor is not row-normalized.")
            current_shapes.append(list(value.shape))
        attention_shapes.append(current_shapes)
    if attention_shapes[0] != attention_shapes[1]:
        raise SystemExit("A/B actual attention tensor shapes differ.")

    output_values = {value.name: value for value in model.graph.output}
    attention_tensors = []
    for layer_index in range(2):
        node, attributes = resolve_attention_operator(model, layer_index)
        tensor_name = f"attention_layer_{layer_index}"
        attention_tensors.append({
            "layerIndex": layer_index,
            "operator": {
                "domain": node.domain,
                "opType": node.op_type,
                "nodeName": node.name,
                "outputIndex": list(node.output).index(tensor_name),
                "qkMatmulOutputMode": int(attributes["qk_matmul_output_mode"]),
                "isCausal": bool(attributes["is_causal"]),
            },
            "tensor": {
                "name": tensor_name,
                "semantic": "post-softmax-attention-probabilities",
                "onnxMetadataShape": metadata_shape(output_values[tensor_name]),
                "runtimeShape": [1, 2, 6, 6],
                "heads": 2,
            },
        })

    manifest = {
        "schema": "ModelArtifactBindingManifestV1",
        "manifestId": MANIFEST_ID,
        "bindingKind": "operator-correspondence",
        "fullModelRepresented": False,
        "artifact": {
            "profileId": PROFILE_ID,
            "sha256": artifact_sha256,
            "byteLength": artifact_path.stat().st_size,
            "sourceModelId": MODEL_ID,
            "sourceRevision": MODEL_REVISION,
            "sourceWeightsSha256": WEIGHTS_SHA256,
            "sourceConfigSha256": sha256_file(model_dir / "config.json"),
            "license": "apache-2.0",
            "opset": {"domain": "", "version": 25},
            "onnxNodeCount": len(model.graph.node),
            "attentionOperatorCount": 2,
        },
        "exporter": {
            "id": "volk-g2-attention-export-reference",
            "manifestContractVersion": 1,
            **actual_versions,
        },
        "anchorContract": {
            "componentId": "multihead_attention_node",
            "op": "multihead_attention",
            "parameters": {"embed_dim": 128, "num_heads": 2, "dropout": 0},
            "mappingConfidence": "exporter-declared-profile-operator-correspondence",
            "buildOutputTensor": "context-only",
        },
        "inputContract": {
            "onnxInputs": [
                {"name": value.name, "metadataShape": metadata_shape(value)}
                for value in model.graph.input
            ],
            "runtimeInputShape": [1, 6],
            "runtimeSequenceLength": 6,
            "exportSequenceRange": {"minimum": 6, "maximum": 512},
            "tokenizer": {
                "modelId": MODEL_ID,
                "revision": MODEL_REVISION,
                "class": tokenizer.__class__.__name__,
                "algorithm": "bert-wordpiece-uncased",
                "filesSha256": tokenizer_file_hashes,
            },
            "preprocessing": {
                "specialTokens": "pinned-tokenizer-defaults",
                "attentionMask": "all-ones",
                "tokenTypeIds": "all-zeros",
                "changedContentTokenPosition": differing_positions[0],
                "changedContentTokenCount": len(differing_positions),
                "fixedInputPairSha256": hashlib.sha256(canonical_json_bytes({"a": INPUT_IDS_A, "b": INPUT_IDS_B})).hexdigest(),
            },
        },
        "outputContract": {
            "logits": {
                "name": "logits",
                "onnxMetadataShape": metadata_shape(output_values["logits"]),
                "runtimeShape": [1, 2],
                "semantic": "classifier-logits",
            },
            "attentionTensors": attention_tensors,
            "missingSemantics": {
                "onnxMetadataUnknownDimension": None,
                "runtimeObservationRequiresExactShape": [1, 2, 6, 6],
                "buildNodeDoesNotProduceArtifactTensor": True,
                "fullClassifierGraphNotRepresented": True,
            },
        },
    }
    manifest["manifestSha256"] = hashlib.sha256(canonical_json_bytes(manifest)).hexdigest()
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    if args.output.exists() and not args.overwrite:
        parser.error(f"Refusing to overwrite {args.output}; pass --overwrite explicitly.")
    manifest = create_manifest(args.artifact, args.model_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(manifest, sort_keys=True, indent=2, ensure_ascii=True) + "\n", encoding="utf-8", newline="\n")
    print(f"Manifest ID: {manifest['manifestId']}")
    print(f"Manifest SHA-256: {manifest['manifestSha256']}")
    print(f"Manifest bytes: {args.output.stat().st_size}")


if __name__ == "__main__":
    main()
