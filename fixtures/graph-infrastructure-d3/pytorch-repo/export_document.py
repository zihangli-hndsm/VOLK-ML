import json
import hashlib
import argparse
import os
import platform
import sys
from pathlib import Path

import torch


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
FIXTURE_ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(REPOSITORY_ROOT / "tools" / "torch_export"))
sys.path.insert(0, str(FIXTURE_ROOT))

from extract_torch_export import extract_exported_program
from model import ReferenceMLP


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    arguments = parser.parse_args()
    runtime_attestation = None
    if arguments.output:
        configured_python = os.environ.get("VOLK_D3_PYTHON")
        configured_python_sha256 = os.environ.get("VOLK_D3_PYTHON_SHA256")
        nonce = os.environ.get("VOLK_D3_ATTESTATION_NONCE")
        if not configured_python or not configured_python_sha256 or not nonce:
            raise RuntimeError("D3 Python runtime attestation is not configured.")
        actual_python = os.path.realpath(sys.executable)
        configured_python = os.path.realpath(configured_python)
        if os.path.normcase(actual_python) != os.path.normcase(configured_python):
            raise RuntimeError("The exporter is running under a different Python executable.")
        actual_python_sha256 = hashlib.sha256(Path(actual_python).read_bytes()).hexdigest()
        if actual_python_sha256.lower() != configured_python_sha256.lower():
            raise RuntimeError("The exporter Python executable identity does not match the configured file.")
        runtime_attestation = {
            "type": "D3PythonRuntimeAttestationV1",
            "nonce": nonce,
            "pythonExecutable": actual_python,
            "pythonExecutableSha256": actual_python_sha256,
            "pythonVersion": platform.python_version(),
            "torchVersion": str(torch.__version__),
        }
    torch.manual_seed(7101)
    model = ReferenceMLP().eval()
    exported = torch.export.export(model, (torch.zeros(2, 4),))
    document = extract_exported_program(exported, model_identifier="d3-reference-mlp-v1")
    if document.get("type") != "TorchExportDocumentV1" or document.get("version") != 1:
        raise RuntimeError("The existing extractor did not return TorchExportDocumentV1.")
    serialized = json.dumps(document, separators=(",", ":"))
    if arguments.output:
        output_path = Path(arguments.output)
        output_path.write_text(serialized + "\n", encoding="utf-8")
        attestation_path = Path(str(output_path) + ".runtime.json")
        attestation_path.write_text(
            json.dumps(runtime_attestation, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
    else:
        print(serialized)


if __name__ == "__main__":
    main()
