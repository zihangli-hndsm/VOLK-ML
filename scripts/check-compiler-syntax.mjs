import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--check', 'src/core/compiler.js'], {
  encoding: 'utf-8',
});
assert.equal(result.status, 0, `src/core/compiler.js must remain parseable:\n${result.stderr}`);
console.log('Compiler syntax check passed.');
