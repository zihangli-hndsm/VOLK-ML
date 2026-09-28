"""Download the pinned checkpoint and export the G2 BERT-Tiny reference ONNX."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path

import onnx
import torch
import torch.nn.functional as F
import onnxruntime as ort
import numpy as np
from huggingface_hub import snapshot_download
from torch import nn
from torch.export import Dim
from transformers import AutoModelForSequenceClassification, AutoTokenizer


MODEL_ID = "gokulsrinivasagan/bert_uncased_L-2_H-128_A-2_sst2"
MODEL_REVISION = "e454ff624bde2785ee174112f0bcc7e99da8344d"
WEIGHTS_SHA256 = "8c3fd725aad8a2719edef9ef67a71996f5ffe53f24279c28e29fd2b7ae748dc2"
INPUT_IDS_A = [101, 2023, 3185, 2001, 2204, 102]
INPUT_IDS_B = [101, 2023, 3185, 2001, 2919, 102]


class BERTinyWithAttentionOutputs(nn.Module):
    def __init__(self, source):
        super().__init__()
        self.bert = source.bert
        self.classifier = source.classifier
        self.dropout = source.dropout
        self.layers = nn.ModuleList(list(source.bert.encoder.layer))
        self.num_heads = source.config.num_attention_heads
        self.head_dim = source.config.hidden_size // source.config.num_attention_heads
        self.hidden_size = source.config.hidden_size

    def forward(self, input_ids, attention_mask, token_type_ids):
        hidden = self.bert.embeddings(input_ids=input_ids, token_type_ids=token_type_ids)
        batch, sequence, _ = hidden.shape
        additive_mask = (1.0 - attention_mask.to(hidden.dtype)).view(batch, 1, 1, sequence)
        additive_mask = additive_mask.expand(batch, 1, sequence, sequence) * -10000.0
        attentions = []
        for layer in self.layers:
            attention = layer.attention.self
            query = attention.query(hidden).view(batch, sequence, self.num_heads, self.head_dim).transpose(1, 2)
            key = attention.key(hidden).view(batch, sequence, self.num_heads, self.head_dim).transpose(1, 2)
            value = attention.value(hidden).view(batch, sequence, self.num_heads, self.head_dim).transpose(1, 2)
            if torch.onnx.is_in_onnx_export():
                context, present_key, present_value, probabilities = torch.onnx.ops.symbolic_multi_out(
                    "Attention",
                    (query, key, value, additive_mask),
                    attrs={"is_causal": 0, "scale": 0.125, "softcap": 0.0, "qk_matmul_output_mode": 3},
                    dtypes=(query.dtype, key.dtype, value.dtype, query.dtype),
                    shapes=(query.shape, key.shape, value.shape, (batch, self.num_heads, sequence, sequence)),
                    version=25,
                )
            else:
                context = F.scaled_dot_product_attention(query, key, value, additive_mask, dropout_p=0.0, is_causal=False, scale=0.125)
                scores = torch.matmul(query, key.transpose(-2, -1)) * 0.125 + additive_mask
                probabilities = torch.softmax(scores, dim=-1)
            del present_key, present_value
            context = context.transpose(1, 2).contiguous().view(batch, sequence, self.hidden_size)
            attention_output = layer.attention.output(context, hidden)
            intermediate = layer.intermediate(attention_output)
            hidden = layer.output(intermediate, attention_output)
            attentions.append(probabilities)
        pooled = self.bert.pooler(hidden)
        logits = self.classifier(self.dropout(pooled))
        return (logits, *attentions)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", type=Path, help="Local snapshot directory; downloads the pinned revision when omitted.")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    if args.output.exists() and not args.overwrite:
        parser.error(f"Refusing to overwrite {args.output}; pass --overwrite explicitly.")
    model_dir = args.model_dir or Path(snapshot_download(
        repo_id=MODEL_ID,
        revision=MODEL_REVISION,
        allow_patterns=["config.json", "model.safetensors", "tokenizer.json", "tokenizer_config.json", "special_tokens_map.json", "vocab.txt"],
    ))
    weights = model_dir / "model.safetensors"
    if not weights.is_file() or sha256(weights) != WEIGHTS_SHA256:
        raise SystemExit("Pinned checkpoint weights are missing or have an unexpected SHA-256.")
    tokenizer = AutoTokenizer.from_pretrained(model_dir, local_files_only=True)
    tokens_a = tokenizer("this movie was good", add_special_tokens=True)["input_ids"]
    tokens_b = tokenizer("this movie was bad", add_special_tokens=True)["input_ids"]
    if tokens_a != INPUT_IDS_A or tokens_b != INPUT_IDS_B:
        raise SystemExit("Pinned tokenizer did not produce the registered six-token comparison pair.")
    source = AutoModelForSequenceClassification.from_pretrained(model_dir, local_files_only=True).eval()
    config = source.config
    if (config.num_hidden_layers, config.hidden_size, config.num_attention_heads, config.intermediate_size, config.vocab_size) != (2, 128, 2, 512, 30522):
        raise SystemExit("Checkpoint architecture is outside the registered BERT-Tiny profile.")
    model = BERTinyWithAttentionOutputs(source).eval()
    ids_a = torch.tensor([INPUT_IDS_A], dtype=torch.int64)
    mask = torch.ones_like(ids_a)
    types = torch.zeros_like(ids_a)
    with torch.inference_mode():
        torch.onnx.export(
            model,
            (ids_a, mask, types),
            args.output,
            input_names=["input_ids", "attention_mask", "token_type_ids"],
            output_names=["logits", "attention_layer_0", "attention_layer_1"],
            opset_version=25,
            dynamo=True,
            external_data=False,
            dynamic_shapes=(
                {1: Dim("sequence", min=6, max=512)},
                {1: Dim("sequence", min=6, max=512)},
                {1: Dim("sequence", min=6, max=512)},
            ),
            optimize=True,
            verify=False,
            report=False,
        )
    exported = onnx.load(args.output, load_external_data=False)
    onnx.checker.check_model(exported, full_check=False)
    attention_nodes = [node for node in exported.graph.node if node.op_type == "Attention" and node.domain == ""]
    if len(attention_nodes) != 2:
        raise SystemExit("Export did not produce the two standard-domain Attention operators required by this profile.")
    if any(onnx.helper.get_attribute_value(next(attribute for attribute in node.attribute if attribute.name == "qk_matmul_output_mode")) != 3 for node in attention_nodes):
        raise SystemExit("Exported Attention nodes do not expose post-softmax probabilities.")
    onnx.checker.check_model(exported, full_check=False)
    onnx.save(exported, args.output)
    source_model = source.eval()
    session = ort.InferenceSession(str(args.output), providers=["CPUExecutionProvider"])
    for ids in (INPUT_IDS_A, INPUT_IDS_B):
        input_ids = torch.tensor([ids], dtype=torch.int64)
        attention_mask = torch.ones_like(input_ids)
        token_type_ids = torch.zeros_like(input_ids)
        with torch.inference_mode():
            expected = source_model(input_ids=input_ids, attention_mask=attention_mask, token_type_ids=token_type_ids, output_attentions=True)
        actual = session.run(None, {
            "input_ids": input_ids.numpy(),
            "attention_mask": attention_mask.numpy(),
            "token_type_ids": token_type_ids.numpy(),
        })
        source_attentions = list(expected.attentions)
        candidates = [expected.logits.detach().cpu().numpy(), *[tensor.detach().cpu().numpy() for tensor in source_attentions]]
        for output_index, source_value in enumerate(candidates):
            error = float(np.max(np.abs(actual[output_index] - source_value)))
            if error > 2e-4:
                raise SystemExit(f"CPU ONNX output {output_index} differs from the source framework by {error:.8g}.")
        for attention in actual[1:]:
            if attention.shape != (1, 2, 6, 6) or float(np.max(np.abs(attention.sum(axis=-1) - 1))) > 1e-3:
                raise SystemExit("ONNX Attention output is not a normalized probability matrix.")
    print(f"ONNX SHA-256: {sha256(args.output)}")
    print(f"ONNX bytes: {args.output.stat().st_size}")


if __name__ == "__main__":
    main()
