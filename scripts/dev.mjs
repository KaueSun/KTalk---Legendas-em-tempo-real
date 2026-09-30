import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer();
await server.listen();
server.printUrls();
const child = spawn(electron, ['.'], {
  stdio: 'inherit', env: { ...process.env, KTALK_DEV_URL: 'http://127.0.0.1:5173' },
});
const close = async () => { child.kill(); await server.close(); };
child.on('error', async (error) => { console.error(error); await close(); process.exit(1); });
child.on('exit', async (code) => { await server.close(); process.exit(code ?? 0); });
process.on('SIGINT', close);
process.on('SIGTERM', close);
