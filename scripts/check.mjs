import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checks = [
  ...['electron/main.cjs', 'electron/backend.cjs', 'electron/storage.cjs', 'electron/preload.cjs'].map(
    (file) => [process.execPath, ['--check', file]],
  ),
  [process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit']],
  [process.execPath, ['node_modules/vite/bin/vite.js', 'build']],
  [process.execPath, ['--test', 'tests/*.test.cjs']],
  [
    path.join(root, '.venv', 'Scripts', 'python.exe'),
    ['-m', 'unittest', 'discover', '-s', 'backend/tests', '-v'],
  ],
];
for (const [command, args] of checks) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
