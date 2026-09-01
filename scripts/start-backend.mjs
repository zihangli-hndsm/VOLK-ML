import { spawn } from 'node:child_process';

const command = process.platform === 'win32' ? 'py' : 'python3';
const args = process.platform === 'win32'
  ? ['-3', 'dev/backend/server.py']
  : ['dev/backend/server.py'];
const child = spawn(command, args, { stdio: 'inherit', shell: false });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
