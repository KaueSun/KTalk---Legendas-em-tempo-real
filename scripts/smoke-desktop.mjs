// Integration test against real Electron, its preload bridge and the Python process.
// Capture is only started with --audio; it plays a known WAV through Windows.
import { _electron as electron } from 'playwright-core';
import { mkdir, writeFile, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(path.join(root, 'artifacts'), { recursive: true });
const errors = [];
await mkdir(path.join(root, '.runtime'), { recursive: true });
const testData = await mkdtemp(path.join(root, '.runtime', 'smoke-'));
const env = { ...process.env, KTALK_DATA_DIR: testData };
if (process.argv.includes('--audio')) env.KTALK_MODEL_DIR = path.join(root, '.runtime', 'data', 'models');
let server;
if (process.argv.includes('--dev')) {
  server = await createServer();
  await server.listen();
  env.KTALK_DEV_URL = 'http://127.0.0.1:5173';
}
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes('--packaged');
const launch = async () => {
  const instance = await electron.launch({
    args: packaged ? [] : [root],
    cwd: root,
    env,
    ...(packaged ? { executablePath: path.join(root, 'release', 'win-unpacked', 'KTalk.exe') } : {}),
  });
  instance.process().stderr.on('data', (chunk) => {
    if (process.env.KTALK_DEBUG) process.stderr.write(chunk);
  });
  return instance;
};
const mainPage = async (instance) => {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const candidate = instance
      .windows()
      .find(
        (window) =>
          (window.url().includes('index.html') || window.url().startsWith('http://127.0.0.1:5173/')) &&
          !window.url().includes('#overlay'),
      );
    if (candidate) return candidate;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Main window did not load');
};
const closeApp = async (instance) => {
  const process = instance.process();
  const exited =
    process.exitCode === null && process.signalCode === null ? once(process, 'exit') : Promise.resolve();
  await instance.close();
  await exited;
};
let app = await launch();
try {
  const page = await mainPage(app);
  assert.ok(page, 'Main window was not created');
  const waitForState = async (predicate, timeout = 30000) => {
    const deadline = Date.now() + timeout;
    let previous = '';
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => window.ktalk.snapshot());
      const current = JSON.stringify({
        status: state.status,
        error: state.error,
        message: state.message,
        captions: state.captions.length,
      });
      if (process.env.KTALK_DEBUG && current !== previous) {
        console.log(current);
        previous = current;
      }
      if (predicate(state)) return state;
      await page.waitForTimeout(100);
    }
    throw new Error('Timed out waiting for backend state');
  };
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: 'Acompanhe em português.' }).waitFor();
  await page.getByText('Motor local conectado', { exact: true }).waitFor({ timeout: 30000 });
  await waitForState((state) => state.devices.length > 0);
  await page.getByRole('button', { name: 'Áudio do PC', exact: true }).click();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.screenshot({ path: path.join(root, 'artifacts', 'desktop-live.png'), fullPage: true });
  const assertFits = async () => {
    const result = await page.evaluate(() => {
      const live = document.querySelector('.live-page');
      const toolbar = document.querySelector('.capture-toolbar');
      const stage = document.querySelector('.caption-stage');
      return {
        fits: live.scrollHeight <= live.clientHeight + 1 && toolbar.scrollWidth <= toolbar.clientWidth + 1,
        stageHeight: stage.getBoundingClientRect().height,
      };
    });
    assert.ok(result.fits, 'Live workspace must fit without overflow');
    assert.ok(result.stageHeight >= 190, 'Caption stage must remain readable');
  };
  await assertFits();
  await page.getByRole('button', { name: 'Ambos', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => !window.webContents.getURL().includes('#overlay'))
      .setSize(1000, 700),
  );
  await page.waitForTimeout(250);
  await assertFits();
  await page.screenshot({ path: path.join(root, 'artifacts', 'desktop-compact.png'), fullPage: true });
  await page.getByRole('button', { name: 'Áudio do PC', exact: true }).click();
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()
      .find((window) => !window.webContents.getURL().includes('#overlay'))
      .setSize(1220, 820),
  );
  await page.getByRole('button', { name: 'Histórico', exact: true }).click();
  await page.getByRole('heading', { name: 'Palavras que ficam.' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Exportar TXT' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Configurações', exact: true }).click();
  await page.getByLabel('Posição na tela').selectOption('top');
  await page.getByLabel('Tempo visível').selectOption('5');
  await page.getByRole('button', { name: 'Testar legenda flutuante' }).click();
  const overlay = app.windows().find((window) => window.url().includes('#overlay'));
  assert.ok(overlay, 'Overlay window was not created');
  await overlay.getByText('Toda voz merece ser compreendida.').waitFor();
  const properties = await app.evaluate(({ BrowserWindow }) => {
    const target = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('#overlay'),
    );
    return {
      visible: target.isVisible(),
      alwaysOnTop: target.isAlwaysOnTop(),
      focusable: target.isFocusable(),
    };
  });
  assert.deepEqual(properties, { visible: true, alwaysOnTop: true, focusable: false });
  await page.screenshot({ path: path.join(root, 'artifacts', 'desktop-settings.png'), fullPage: true });
  await overlay.screenshot({
    path: path.join(root, 'artifacts', 'desktop-overlay.png'),
    omitBackground: true,
  });
  await page.getByLabel('Posição na tela').selectOption('bottom');
  await page.getByLabel('Tempo visível').selectOption('8');
  const invalid = await page.evaluate(async () => {
    try {
      await window.ktalk.preferences({ model: '../../invalid' });
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(invalid, true, 'IPC must reject invalid model names');
  await page.getByRole('button', { name: 'Como funciona' }).click();
  await page.getByRole('dialog').waitFor();
  await page.getByRole('button', { name: 'Entendi' }).click();
  await page.getByRole('button', { name: 'Legendas', exact: true }).click();
  // These events are fixtures sent only to the isolated renderer, not real recognition.
  const send = (event) =>
    app.evaluate(({ BrowserWindow }, data) => {
      BrowserWindow.getAllWindows()
        .find((window) => !window.webContents.getURL().includes('#overlay'))
        .webContents.send('ktalk:event', data);
    }, event);
  await send({ type: 'session', id: 'visual-test', source: 'system', started_at: new Date().toISOString() });
  const fixture = {
    type: 'caption',
    id: 'phrase-1',
    session_id: 'visual-test',
    source: 'system',
    text: 'Bom dia.',
    original_text: 'Good morning.',
    language: 'en',
    target_language: 'pt-BR',
    start: 0,
    end: 1.2,
    revision: 1,
    final: false,
    latency_ms: 350,
    created_at: new Date().toISOString(),
  };
  await send(fixture);
  await page.getByText('Atualizando durante a fala').waitFor();
  await send({ ...fixture, revision: 2, text: 'Bom dia a todos.', original_text: 'Good morning everyone.' });
  await page.locator('.live-caption > p').filter({ hasText: 'Bom dia a todos.' }).waitFor();
  assert.equal(await page.locator('.live-caption > p').innerText(), 'Bom dia a todos.');
  assert.equal(await page.locator('.recent .caption-row').count(), 0);
  await send({
    ...fixture,
    revision: 3,
    text: 'Bom dia a todos.',
    original_text: 'Good morning everyone.',
    final: true,
  });
  await page.locator('.recent .caption-row').waitFor();
  assert.equal(await page.locator('.recent .caption-row').count(), 1);
  await page.screenshot({
    path: path.join(root, 'artifacts', 'desktop-caption-fixture.png'),
    fullPage: true,
  });
  if (process.argv.includes('--audio')) {
    await send({ type: 'cleared' });
    await page.getByRole('button', { name: 'Testar áudio', exact: true }).click();
    await waitForState((state) => state.status === 'monitoring');
    await page.getByRole('button', { name: 'Encerrar teste', exact: true }).click();
    await waitForState((state) => state.status === 'idle');
    assert.equal((await page.evaluate(() => window.ktalk.snapshot())).sessions.length, 0);
    await page.getByRole('button', { name: 'Iniciar tradução', exact: true }).click();
    await waitForState((state) => state.status === 'listening', 60000);
    const playback = spawn(
      path.join(root, '.venv', 'Scripts', 'python.exe'),
      [
        '-c',
        'import sys, winsound; winsound.PlaySound(sys.argv[1], winsound.SND_FILENAME)',
        path.join(root, 'artifacts', 'speech-test.wav'),
      ],
      { windowsHide: true, stdio: 'ignore' },
    );
    const played = new Promise((resolve, reject) => {
      playback.once('error', reject);
      playback.once('exit', (code) => (code === 0 ? resolve() : reject(new Error('Playback failed'))));
    });
    await waitForState((state) => Object.keys(state.partials).length > 0);
    await page.getByText('Atualizando durante a fala').waitFor();
    await played;
    const spoken = await waitForState((state) =>
      state.captions.some((caption) => /computador/i.test(caption.text)),
    );
    console.log(
      'Recognized test playback:',
      spoken.captions.map((caption) => ({ text: caption.text, original: caption.original_text })),
    );
    await overlay.getByText(spoken.captions.at(-1).text, { exact: true }).waitFor();
    await page.screenshot({
      path: path.join(root, 'artifacts', 'desktop-real-translation.png'),
      fullPage: true,
    });
    await overlay.screenshot({
      path: path.join(root, 'artifacts', 'desktop-real-overlay.png'),
      omitBackground: true,
    });
    await page.getByRole('button', { name: 'Parar', exact: true }).click();
    await waitForState((state) => state.status === 'idle');
    const state = await page.evaluate(() => window.ktalk.snapshot());
    await writeFile(
      path.join(root, 'artifacts', 'desktop-audio-report.json'),
      JSON.stringify(
        { sessions: state.sessions, captions: state.captions, error: state.error, warning: state.warning },
        null,
        2,
      ),
    );
    assert.ok(state.captions.every((caption) => caption.final && caption.target_language === 'pt-BR'));
    assert.ok(
      state.captions.some((caption) => /bom dia/i.test(caption.text)),
      JSON.stringify(state.captions),
    );
    assert.ok(
      state.captions.some(
        (caption) => /computador/i.test(caption.text) && /computer/i.test(caption.original_text),
      ),
    );
    console.log(
      'PASS: real Windows playback → WASAPI → recognition → PT-BR translation → desktop + overlay.',
    );
    const sessionId = state.sessions.at(-1).id;
    await page.getByRole('button', { name: 'Configurações', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Guardar histórico neste computador' }).check();
    await waitForState((value) => value.preferences.saveHistory);
    await page.getByRole('button', { name: /^Histórico/ }).click();
    await page.getByLabel('Filtrar sessão').selectOption(sessionId);
    await page.getByLabel('Nome da sessão').fill('Conversa de teste');
    await page.getByRole('button', { name: 'Salvar nome', exact: true }).click();
    await waitForState((value) => value.sessions.some((session) => session.title === 'Conversa de teste'));
    // Crash only the child owned by this isolated test instance.
    await app.evaluate(() => {
      const child = process
        ._getActiveHandles()
        .find(
          (handle) =>
            handle.constructor.name === 'ChildProcess' &&
            (handle.spawnargs?.some((arg) => arg.endsWith('main.py')) ||
              handle.spawnfile?.endsWith('ktalk-engine.exe')),
        );
      if (!child) throw new Error('Owned backend process was not found');
      child.kill();
    });
    await waitForState((value) => !value.connected);
    await waitForState((value) => value.connected);
    const recovered = await page.evaluate(() => window.ktalk.snapshot());
    assert.equal(recovered.status, 'idle', 'Recovery must not restart capture');
    assert.equal(recovered.captions.length, state.captions.length);
    await closeApp(app);
    const saved = await readFile(path.join(testData, 'history.encrypted'));
    assert.equal(saved.includes(Buffer.from('Bom dia')), false);
    app = await launch();
    const reopened = await mainPage(app);
    await reopened.getByRole('heading', { name: 'Acompanhe em português.' }).waitFor();
    const restored = await reopened.evaluate(() => window.ktalk.snapshot());
    assert.equal(restored.captions.length, state.captions.length);
    assert.equal(restored.sessions.at(-1).title, 'Conversa de teste');
    assert.equal(restored.status, 'idle');
    await reopened.getByRole('button', { name: /^Histórico/ }).click();
    await reopened.getByLabel('Filtrar sessão').selectOption(sessionId);
    await reopened.getByText(state.captions[0].text, { exact: true }).waitFor();
    await reopened.screenshot({
      path: path.join(root, 'artifacts', 'desktop-saved-history.png'),
      fullPage: true,
    });
    console.log(
      'PASS: encrypted history, session naming, child crash recovery, restart and restored captions.',
    );
    const diagnosticsPath = path.join(testData, 'diagnostics.json');
    await app.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, diagnosticsPath);
    assert.equal(await reopened.evaluate(() => window.ktalk.diagnostics()), true);
    const diagnostics = JSON.parse(await readFile(diagnosticsPath, 'utf8'));
    assert.deepEqual(
      Object.keys(diagnostics).sort(),
      [
        'version',
        'electron',
        'platform',
        'arch',
        'packaged',
        'connected',
        'status',
        'model',
        'mode',
        'deviceCount',
        'recentLatencyMs',
        'failures',
      ].sort(),
    );
    assert.equal(JSON.stringify(diagnostics).includes(state.captions[0].text), false);
    await app.evaluate(({ dialog }) => {
      dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    });
    assert.equal(await reopened.evaluate((id) => window.ktalk.deleteSession(id), sessionId), true);
    const deleted = await reopened.evaluate(() => window.ktalk.snapshot());
    assert.equal(deleted.sessions.length, 0);
    assert.equal(deleted.captions.length, 0);
    await reopened.evaluate(async () => {
      const snapshot = await window.ktalk.snapshot();
      await window.ktalk.preferences({ ...snapshot.preferences, saveHistory: false });
    });
    await assert.rejects(readFile(path.join(testData, 'history.encrypted')), { code: 'ENOENT' });
    console.log(
      'PASS: diagnostics omit conversation data; deleting sessions and disabling storage remove saved history.',
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    'PASS: Electron + Python, devices, responsive workspace, navigation, progressive captions, settings, overlay, sandbox and IPC validation.',
  );
} finally {
  await closeApp(app);
  await server?.close();
}
