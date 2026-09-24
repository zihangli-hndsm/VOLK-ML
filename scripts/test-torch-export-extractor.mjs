import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { materializeTorchExportDocument, validateTorchExportDocument } from '../src/core/graph/torchExportAdapter.js';

const python = process.env.PYTHON ?? 'python';
const extractor = path.resolve('tools/torch_export/extract_torch_export.py');
const trustGuard = spawnSync(python, [extractor, '--input', 'not-loaded.pt2', '--output', 'unused.json'], { encoding: 'utf8' });
if (trustGuard.error?.code === 'ENOENT') {
  console.log('SKIP optional Torch Export extractor integration: Python was not found.');
  process.exit(0);
}
assert.equal(trustGuard.status, 2, 'The CLI must refuse .pt2 loading without --trusted-pt2.');
assert.match(trustGuard.stderr, /--trusted-pt2/);

const torchProbe = spawnSync(python, ['-c', 'import torch; print(torch.__version__)'], { encoding: 'utf8' });
if (torchProbe.status !== 0) {
  console.log('SKIP optional Torch Export extractor integration: PyTorch is not installed; dependency installation is intentionally omitted.');
  process.exit(0);
}

const directory = mkdtempSync(path.join(os.tmpdir(), 'volk-torch-export-'));
try {
  const archive = path.join(directory, 'linear_relu.pt2');
  const output = path.join(directory, 'linear_relu.json');
  const exportCode = [
    'import sys, torch',
    'class Tiny(torch.nn.Module):',
    '    def __init__(self):',
    '        super().__init__()',
    '        self.linear = torch.nn.Linear(2, 2)',
    '    def forward(self, x):',
    '        return torch.relu(self.linear(x))',
    'model = Tiny().eval()',
    'batch = torch.export.Dim("batch", min=1, max=128)',
    'program = torch.export.export(model, (torch.zeros(4, 2),), dynamic_shapes={"x": {0: batch}})',
    'torch.export.save(program, sys.argv[1])',
  ].join('\n');
  const exportResult = spawnSync(python, ['-c', exportCode, archive], { encoding: 'utf8' });
  assert.equal(exportResult.status, 0, exportResult.stderr);
  const extractResult = spawnSync(python, [extractor, '--input', archive, '--output', output, '--trusted-pt2'], { encoding: 'utf8' });
  assert.equal(extractResult.status, 0, extractResult.stderr);
  const document = JSON.parse(readFileSync(output, 'utf8'));
  validateTorchExportDocument(document);
  const graph = materializeTorchExportDocument(document);
  assert.equal(graph.nodes.filter((node) => node.data.manifest.id === 'dense_node').length, 1);
  assert.equal(graph.nodes.filter((node) => node.data.manifest.id === 'relu_node').length, 1);
  console.log('PASS optional Torch Export extractor integration: trusted .pt2 → bounded JSON → validated VOLK graph.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
