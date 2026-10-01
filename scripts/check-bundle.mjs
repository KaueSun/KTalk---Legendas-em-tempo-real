// Exercises first-time model conversion inside the frozen engine, without Python on PATH.
import { cp, mkdir, mkdtemp, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Backend } = require('../electron/backend.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const models = path.join(root, '.runtime', 'data', 'models');
const directory = await mkdtemp(path.join(root, '.runtime', 'bundle-check-'));
await mkdir(path.join(directory, 'translation-download'));
await cp(
  path.join(models, 'models--Systran--faster-whisper-tiny'),
  path.join(directory, 'models--Systran--faster-whisper-tiny'),
  { recursive: true, dereference: true },
);
await cp(
  path.join(models, 'translation-download', 'opus-2020-04-21.zip'),
  path.join(directory, 'translation-download', 'opus-2020-04-21.zip'),
);
let status, failure;
const backend = new Backend({
  command: path.join(root, 'release', 'win-unpacked', 'resources', 'engine', 'ktalk-engine.exe'),
  args: [],
  cwd: directory,
  env: {
    ...process.env,
    PATH: process.env.SystemRoot,
    KTALK_MODEL_DIR: directory,
    HF_HUB_OFFLINE: '1',
    HF_HUB_DISABLE_TELEMETRY: '1',
    PYTHONUTF8: '1',
  },
  onEvent(event) {
    if (event.type === 'error') failure = new Error(event.message);
    if (event.type === 'status') {
      status = event.status;
      console.log(event.message);
    }
  },
  onExit(code, expected) {
    if (!expected) failure = new Error(`Engine exited: ${code}`);
  },
});
async function waitFor(expected) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    if (failure) throw failure;
    if (status === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Engine did not reach ${expected}`);
}
try {
  await backend.ensure();
  backend.send({ type: 'start', settings: { model: 'tiny', source: 'system', mode: 'translate' } });
  await waitFor('listening');
  await access(path.join(directory, 'opus-en-pt-br-int8', 'ktalk.json'));
  backend.send({ type: 'stop' });
  await waitFor('idle');
  console.log('PASS: frozen engine converts and loads models offline without an external Python runtime.');
} finally {
  await backend.shutdown();
}
