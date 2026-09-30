import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, UV_CACHE_DIR: path.join(root, '.cache', 'uv'), UV_PYTHON_INSTALL_DIR: path.join(root, '.runtime', 'python') };
const run = (args) => {
  const result = spawnSync('uv', args, { cwd: root, stdio: 'inherit', env });
  if (result.error) throw new Error('Instale o uv para preparar o Python: https://docs.astral.sh/uv/');
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(['venv', '--python', '3.12', '--managed-python', '--allow-existing', '.venv']);
run(['pip', 'sync', '--python', '.venv/Scripts/python.exe', 'backend/requirements.txt']);
