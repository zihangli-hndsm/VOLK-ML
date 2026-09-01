import { spawn } from 'node:child_process';

const backendArgs = ['dev/backend/server.py'];

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: false, windowsHide: true });
    child.once('error', (error) => {
      if (error.code === 'ENOENT') resolve({ missing: true });
      else reject(error);
    });
    child.once('exit', (code, signal) => resolve({ child, code, signal }));
  });
}

async function main() {
  const candidates = process.platform === 'win32'
    ? [['py', ['-3', ...backendArgs]], ['python', backendArgs]]
    : [['python3', backendArgs]];
  for (const [command, args] of candidates) {
    const result = await run(command, args);
    if (result.missing) continue;
    if (result.signal) process.kill(process.pid, result.signal);
    else process.exit(result.code ?? 0);
    return;
  }
  console.error('Unable to start the VOLK development backend: no Python interpreter was found.');
  process.exit(1);
}

main().catch((error) => {
  console.error(`Unable to start the VOLK development backend: ${error.message}`);
  process.exit(1);
});
