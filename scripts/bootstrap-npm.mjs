// A project-local fallback for a missing/broken global npm. Never edits Program Files.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.join(root, '.tools', 'npm');
const cli = path.join(directory, 'package', 'bin', 'npm-cli.js');
try {
  await access(cli);
} catch {
  const response = await fetch('https://registry.npmjs.org/npm/10.9.4');
  if (!response.ok) throw new Error(`npm metadata: ${response.status}`);
  const { dist } = await response.json();
  const download = await fetch(dist.tarball);
  if (!download.ok) throw new Error(`npm download: ${download.status}`);
  const buffer = Buffer.from(await download.arrayBuffer());
  const checksum = `sha512-${createHash('sha512').update(buffer).digest('base64')}`;
  if (checksum !== dist.integrity) throw new Error('A integridade do npm não confere.');
  await mkdir(directory, { recursive: true });
  const archive = path.join(directory, 'npm.tgz');
  await writeFile(archive, buffer);
  const extract = spawnSync('tar', ['-xzf', archive, '-C', directory], { stdio: 'inherit' });
  if (extract.status !== 0) throw new Error('Não foi possível extrair o npm local.');
}
const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    npm_config_cache: path.join(root, '.cache', 'npm'),
    electron_config_cache: path.join(root, '.cache', 'electron'),
  },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
