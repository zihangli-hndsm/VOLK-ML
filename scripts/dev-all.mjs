import { spawn } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [
  spawn(npmCommand, ['run', 'dev'], { stdio: 'inherit', shell: false }),
  spawn(npmCommand, ['run', 'dev:backend'], { stdio: 'inherit', shell: false }),
];
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach((child) => child.kill(signal));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
children.forEach((child) => child.on('exit', (code) => {
  if (!shuttingDown && code && code !== 0) {
    shutdown('SIGTERM');
    process.exitCode = code;
  }
}));
