import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateD3PythonRuntimeAttestation } from './agent-application-d3-contract.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const exporterPath = path.join(repositoryRoot, 'fixtures', 'graph-infrastructure-d3', 'pytorch-repo', 'export_document.py');
const defaultPython = 'C:/Users/Administrator/AppData/Local/VOLK/venvs/torch-export-b2/Scripts/python.exe';
const explicitlyConfiguredPython = process.env.VOLK_D3_PYTHON;
const pythonPath = explicitlyConfiguredPython ?? defaultPython;

if (!fs.existsSync(pythonPath)) {
  if (explicitlyConfiguredPython) throw new Error('Configured VOLK_D3_PYTHON does not exist.');
  console.log('D3 Python attestation test skipped: the optional D3 PyTorch interpreter is not installed on this host.');
} else {
  const probe = spawnSync(pythonPath, [
    '-c',
    'import json, platform, os, sys, torch; print(json.dumps({"pythonVersion": platform.python_version(), "torchVersion": str(torch.__version__), "pythonExecutable": os.path.realpath(sys.executable)}))',
  ], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (probe.error || probe.status !== 0) {
    if (explicitlyConfiguredPython) throw new Error('Configured VOLK_D3_PYTHON could not import PyTorch.');
    console.log('D3 Python attestation test skipped: the optional D3 PyTorch interpreter is unavailable.');
  } else {
    const runtime = JSON.parse(String(probe.stdout ?? '').trim().split(/\r?\n/).at(-1) ?? '');
    const resolvedPythonPath = fs.realpathSync(pythonPath);
    assert.equal(path.resolve(runtime.pythonExecutable).toLowerCase(), path.resolve(resolvedPythonPath).toLowerCase());
    const configuredPythonSha256 = createHash('sha256').update(fs.readFileSync(resolvedPythonPath)).digest('hex');
    const tempRoot = path.resolve(process.env.VOLK_D3_TEMP_ROOT ?? os.tmpdir());
    fs.mkdirSync(tempRoot, { recursive: true });
    const scratchDirectory = fs.mkdtempSync(path.join(tempRoot, 'd3-python-attestation-' + process.pid + '-'));
    try {
      const outputPath = path.join(scratchDirectory, 'torch-export-document.json');
      const nonce = randomBytes(32).toString('hex');
      const exporterEnvironment = {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: '1',
        TEMP: scratchDirectory,
        TMP: scratchDirectory,
        VOLK_D3_PYTHON: resolvedPythonPath,
        VOLK_D3_PYTHON_SHA256: configuredPythonSha256,
        VOLK_D3_ATTESTATION_NONCE: nonce,
      };
      const exported = spawnSync(pythonPath, [exporterPath, '--output', outputPath], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 90_000,
        env: exporterEnvironment,
      });
      assert.equal(exported.error, undefined, 'The actual configured Python executable starts the exporter.');
      assert.equal(exported.status, 0, 'The fixture exports through actual torch.export.');
      const document = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
      assert.equal(document.type, 'TorchExportDocumentV1');
      const attestationPath = outputPath + '.runtime.json';
      const attestationStat = fs.statSync(attestationPath);
      assert.ok(attestationStat.isFile() && attestationStat.size > 0 && attestationStat.size <= 4_096);
      const attestation = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
      const validation = validateD3PythonRuntimeAttestation({
        attestation,
        expectedNonce: nonce,
        configuredPythonPath: resolvedPythonPath,
        configuredPythonSha256,
        expectedPythonVersion: runtime.pythonVersion,
        expectedTorchVersion: runtime.torchVersion,
      });
      assert.equal(validation.valid, true, validation.reason);
      assert.equal(validation.configuredPathMatched, true);
      assert.equal(validation.executableHashMatched, true);

      const mismatchedOutputPath = path.join(scratchDirectory, 'mismatched-export.json');
      const mismatchedEnvironment = {
        ...exporterEnvironment,
        VOLK_D3_PYTHON_SHA256: '0'.repeat(64),
        VOLK_D3_ATTESTATION_NONCE: randomBytes(32).toString('hex'),
      };
      const mismatched = spawnSync(pythonPath, [exporterPath, '--output', mismatchedOutputPath], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
        env: mismatchedEnvironment,
      });
      assert.notEqual(mismatched.status, 0, 'A mismatched executable hash is rejected by the real exporter.');
      assert.equal(fs.existsSync(mismatchedOutputPath + '.runtime.json'), false);
      assert.equal(fs.existsSync(mismatchedOutputPath), false);
      console.log('D3 Python attestation test passed: Python ' + runtime.pythonVersion + ', PyTorch ' + runtime.torchVersion + '; mismatched binary proof rejected.');
    } finally {
      const resolvedTempRoot = path.resolve(tempRoot) + path.sep;
      const resolvedScratch = path.resolve(scratchDirectory);
      assert.ok(resolvedScratch.startsWith(resolvedTempRoot));
      assert.ok(path.basename(resolvedScratch).startsWith('d3-python-attestation-' + process.pid + '-'));
      fs.rmSync(resolvedScratch, { recursive: true, force: true });
    }
  }
}
