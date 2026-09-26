# D3 reference PyTorch repository

This bounded fixture is a small, inspectable PyTorch model source used by the
VOLK-ML D3 external-Agent workflow. It contains no dataset, uploaded content,
trained weights, credentials, or generated exports.

`model.py` defines a two-layer MLP with a 32-unit first hidden layer.
`export_document.py` runs real `torch.export` in the existing isolated B2
Python environment and passes only the exported program's supported metadata
through VOLK-ML's existing metadata-only extractor.

When invoked with `--output`, the exporter also writes a bounded
`.runtime.json` sidecar in the per-run scratch directory. It reports the
interpreter that actually executed the export. The local runner verifies its
one-run nonce, canonical path, executable SHA-256, Python version, and PyTorch
version against preflight values before treating the configured interpreter
as proven. PATH ordering or command text is not used as runtime proof. Do not
create or edit the sidecar manually.
