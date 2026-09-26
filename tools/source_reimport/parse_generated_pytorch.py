#!/usr/bin/env python3
"""Bounded metadata-only Python AST parser for generated VOLK source.

This worker deliberately never imports, evaluates, compiles, or executes the
source strings it receives. Its only input is one bounded JSON document on
stdin; its only output is bounded JSON on stdout.
"""

import ast
import json
import math
import sys


PROTOCOL_VERSION = 1
MAX_SOURCE_BYTES = 600_000
MAX_TOTAL_INPUT_BYTES = 2_500_000
MAX_AST_NODES = 25_000
MAX_AST_DEPTH = 128
MAX_OUTPUT_BYTES = 4_000_000
MAX_LITERAL_BYTES = 100_000


class WorkerError(Exception):
    def __init__(self, code):
        self.code = code


def encode_value(value, depth, budget):
    if depth > MAX_AST_DEPTH:
        raise WorkerError("SOURCE_REIMPORT_AST_DEPTH")
    if isinstance(value, ast.AST):
        budget["nodes"] += 1
        if budget["nodes"] > MAX_AST_NODES:
            raise WorkerError("SOURCE_REIMPORT_AST_NODE_BOUND")
        encoded = {"type": value.__class__.__name__}
        for field in value._fields:
            encoded[field] = encode_value(getattr(value, field), depth + 1, budget)
        if hasattr(value, "lineno"):
            encoded["location"] = {
                "startLine": value.lineno,
                "startColumnByte": value.col_offset,
                "endLine": value.end_lineno,
                "endColumnByte": value.end_col_offset,
            }
        return encoded
    if isinstance(value, list):
        if len(value) > MAX_AST_NODES:
            raise WorkerError("SOURCE_REIMPORT_AST_NODE_BOUND")
        return [encode_value(item, depth + 1, budget) for item in value]
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        if abs(value) > 9_007_199_254_740_991:
            raise WorkerError("SOURCE_REIMPORT_AST_LITERAL_BOUND")
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise WorkerError("SOURCE_REIMPORT_AST_LITERAL_INVALID")
        return value
    if isinstance(value, str):
        if len(value.encode("utf-8")) > MAX_LITERAL_BYTES:
            raise WorkerError("SOURCE_REIMPORT_AST_LITERAL_BOUND")
        return value
    if isinstance(value, bytes):
        if len(value) > MAX_LITERAL_BYTES:
            raise WorkerError("SOURCE_REIMPORT_AST_LITERAL_BOUND")
        return {"type": "UnsupportedBytesLiteral"}
    if isinstance(value, (complex, Ellipsis.__class__)):
        return {"type": "UnsupportedLiteral"}
    raise WorkerError("SOURCE_REIMPORT_AST_VALUE_UNSUPPORTED")


def parse_source(source, label):
    if not isinstance(source, str):
        raise WorkerError("SOURCE_REIMPORT_INPUT_INVALID")
    try:
        encoded = source.encode("utf-8", "strict")
    except UnicodeError:
        raise WorkerError("SOURCE_REIMPORT_UTF8_INVALID")
    if len(encoded) > MAX_SOURCE_BYTES:
        raise WorkerError("SOURCE_REIMPORT_SOURCE_BOUND")
    try:
        tree = ast.parse(source, filename="<bounded-source>", mode="exec", type_comments=True)
    except (SyntaxError, ValueError, MemoryError, RecursionError):
        raise WorkerError("SOURCE_REIMPORT_SYNTAX_INVALID")
    budget = {"nodes": 0}
    return encode_value(tree, 0, budget)


def main():
    raw = sys.stdin.buffer.read(MAX_TOTAL_INPUT_BYTES + 1)
    if len(raw) > MAX_TOTAL_INPUT_BYTES:
        raise WorkerError("SOURCE_REIMPORT_INPUT_BOUND")
    try:
        request = json.loads(raw.decode("utf-8", "strict"))
    except (UnicodeError, json.JSONDecodeError):
        raise WorkerError("SOURCE_REIMPORT_INPUT_INVALID")
    if not isinstance(request, dict) or set(request) != {"protocol", "sources"}:
        raise WorkerError("SOURCE_REIMPORT_INPUT_INVALID")
    if request["protocol"] != PROTOCOL_VERSION:
        raise WorkerError("SOURCE_REIMPORT_PROTOCOL_UNSUPPORTED")
    sources = request["sources"]
    if not isinstance(sources, dict) or set(sources) != {"original", "edited"}:
        raise WorkerError("SOURCE_REIMPORT_INPUT_INVALID")
    result = {
        "protocol": PROTOCOL_VERSION,
        "asts": {
            "original": parse_source(sources["original"], "original"),
            "edited": parse_source(sources["edited"], "edited"),
        },
    }
    output = json.dumps(result, ensure_ascii=True, separators=(",", ":"))
    if len(output.encode("utf-8")) > MAX_OUTPUT_BYTES:
        raise WorkerError("SOURCE_REIMPORT_AST_OUTPUT_BOUND")
    sys.stdout.write(output)


if __name__ == "__main__":
    try:
        main()
    except WorkerError as error:
        sys.stdout.write(json.dumps({"protocol": PROTOCOL_VERSION, "error": error.code}, separators=(",", ":")))
        sys.exit(2)
    except BaseException:
        sys.stdout.write(json.dumps({"protocol": PROTOCOL_VERSION, "error": "SOURCE_REIMPORT_WORKER_FAILED"}, separators=(",", ":")))
        sys.exit(3)
