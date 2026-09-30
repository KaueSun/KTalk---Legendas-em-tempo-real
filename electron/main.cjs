const { app, BrowserWindow, ipcMain, screen, globalShortcut, dialog, clipboard } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { pathToFileURL } = require('node:url');
const { defaults, settings, exportTranscript } = require('./shared.cjs');

const root = path.join(__dirname, '..');
// A portable development build keeps its runtime data alongside the project.
const dataDir = process.env.KTALK_DATA_DIR || (app.isPackaged ? app.getPath('userData') : path.join(root, '.runtime', 'data'));
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const preferencesPath = path.join(dataDir, 'preferences.json');
let preferences = { ...defaults };
try {
  const saved = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
  preferences = settings(saved);
  if (!saved.mode) {
    preferences = { ...preferences, mode: 'translate', language: 'en', model: 'tiny', max_seconds: 7.2, vad_mode: 1 };
  }
  // PortAudio indices are ephemeral and may identify different hardware after reboot.
  preferences.microphone = preferences.system = null;
} catch { /* First run or invalid settings. */ }
let mainWindow, overlayWindow, backend, backendPromise, expiryTimer, closing = false;
let state = { status: 'idle', connected: false, message: 'Conectando ao motor local…', preferences, devices: [],
  captions: [], partials: {}, sourceInfo: {}, sessions: [], lastCaption: null, error: null, warning: null, levels: {} };

function broadcast(event) {
  for (const window of [mainWindow, overlayWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('ktalk:event', event);
  }
}

function receive(event) {
  if (!event || typeof event.type !== 'string') return;
  if (event.type === 'status') {
    if (!['idle', 'preparing', 'listening', 'monitoring', 'stopping'].includes(event.status)) return;
    state.status = event.status;
    state.message = event.message;
    if (event.status === 'idle') { state.levels = {}; state.partials = {}; }
  } else if (event.type === 'devices') state.devices = event.devices;
  else if (event.type === 'session') {
    state.sessions.push({ id: event.id, started_at: event.started_at, source: event.source });
    const retained = new Set(state.captions.map(caption => caption.session_id));
    state.sessions = state.sessions.filter((session, index) => retained.has(session.id) || index >= state.sessions.length - 200);
    state.lastCaption = null;
    state.partials = {};
  } else if (event.type === 'caption') {
    const previous = state.partials[event.id] || state.captions.find(caption => caption.id === event.id);
    if (previous && (previous.revision >= event.revision || (previous.final && !event.final))) return;
    if (event.final) {
      delete state.partials[event.id];
      const index = state.captions.findIndex(caption => caption.id === event.id);
      if (index >= 0) state.captions[index] = event;
      else state.captions.push(event);
    } else state.partials[event.id] = event;
    if (state.captions.length > 2000) {
      state.captions.shift();
      if (!state.warning?.includes('2.000')) receive({ type: 'warning', message: 'O histórico mantém as últimas 2.000 legendas. Exporte os trechos que quiser guardar.' });
    }
    state.lastCaption = event;
    showCaption(event);
  } else if (event.type === 'caption-retracted') {
    delete state.partials[event.id];
    if (state.lastCaption?.id === event.id) { state.lastCaption = null; overlayWindow?.hide(); }
  } else if (event.type === 'source-ready') state.sourceInfo[event.source] = event;
  else if (event.type === 'level') state.levels[event.source] = event;
  else if (event.type === 'error') state.error = event.message;
  else if (event.type === 'warning') state.warning = event.message;
  broadcast(event);
}

function sendCommand(command) {
  if (!backend?.stdin.writable) throw new Error('O motor local não está conectado. Tente iniciar novamente.');
  backend.stdin.write(`${JSON.stringify(command)}\n`);
}

function ensureBackend() {
  if (backendPromise) return backendPromise;
  backendPromise = new Promise((resolve, reject) => {
    const python = process.env.KTALK_PYTHON || path.join(root, '.venv', 'Scripts', 'python.exe');
    if (!fs.existsSync(python)) {
      reject(new Error('Prepare o motor de voz: node scripts/setup-python.mjs'));
      return;
    }
    const child = spawn(python, ['-u', path.join(root, 'backend', 'main.py')], {
      cwd: root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', KTALK_MODEL_DIR: process.env.KTALK_MODEL_DIR || path.join(dataDir, 'models'),
        HF_HOME: path.join(dataDir, 'huggingface'), HF_HUB_DISABLE_TELEMETRY: '1' },
    });
    backend = child;
    let ready = false;
    const timer = setTimeout(() => {
      if (!ready) { reject(new Error('O motor de voz demorou para iniciar. Verifique a instalação do Python.')); child.kill(); }
    }, 20000);
    const reader = readline.createInterface({ input: child.stdout });
    reader.on('line', line => {
      if (backend !== child || line.length > 262144) return;
      try {
        const event = JSON.parse(line);
        if (event.type === 'ready') {
          ready = true;
          clearTimeout(timer);
          state.connected = true;
          state.message = 'Motor local pronto';
          broadcast({ type: 'connection', connected: true });
          resolve();
        } else receive(event);
      } catch { /* Native libraries may write non-protocol diagnostic lines. */ }
    });
    // Never persist audio, captions or dependency logs automatically.
    child.stderr.on('data', data => { if (process.env.KTALK_DEBUG) process.stderr.write(data); });
    child.stdin.on('error', () => {});
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => {
      clearTimeout(timer);
      reader.close();
      if (backend !== child) return;
      backend = null;
      backendPromise = null;
      state.connected = false;
      broadcast({ type: 'connection', connected: false });
      if (!closing) {
        receive({ type: 'status', status: 'idle', message: 'Motor local desconectado' });
        receive({ type: 'error', message: `O motor local foi encerrado (${code ?? 'interrompido'}). Inicie novamente ou verifique a instalação.` });
      }
      if (!ready) reject(new Error('Não foi possível iniciar o motor Python.'));
    });
  }).catch(error => { backendPromise = null; throw error; });
  return backendPromise;
}

function savePreferences(value) {
  preferences = settings(value);
  state.preferences = preferences;
  const temporary = `${preferencesPath}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(preferences, null, 2), 'utf8');
  fs.renameSync(temporary, preferencesPath);
  positionOverlay();
  if (!preferences.overlay) overlayWindow?.hide();
  broadcast({ type: 'preferences', preferences });
  return preferences;
}

async function start(value = preferences, monitorOnly = false) {
  if (state.status !== 'idle') return;
  savePreferences(value);
  state.error = state.warning = null;
  state.lastCaption = null; state.partials = {}; state.sourceInfo = {}; state.levels = {};
  broadcast({ type: 'notice-reset' });
  receive({ type: 'status', status: 'preparing', message: 'Conectando ao reconhecimento local…' });
  try {
    await ensureBackend();
    sendCommand({ type: monitorOnly ? 'monitor' : 'start', settings: preferences });
  } catch (error) {
    receive({ type: 'status', status: 'idle', message: 'Não foi possível iniciar' });
    receive({ type: 'error', message: error.message });
    throw error;
  }
}

function stop() {
  if (!['preparing', 'listening', 'monitoring'].includes(state.status)) return;
  receive({ type: 'status', status: 'stopping', message: 'Finalizando os trechos pendentes…' });
  // If startup is still in progress, deliver stop after the queued start.
  ensureBackend().then(() => sendCommand({ type: 'stop' })).catch(error => {
    receive({ type: 'error', message: error.message });
    receive({ type: 'status', status: 'idle', message: 'Motor local desconectado' });
  });
}

function positionOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const display = mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.min(1000, area.width - 64), height = Math.min(300, area.height - 64);
  const y = preferences.position === 'top' ? area.y + 36 : preferences.position === 'center'
    ? area.y + Math.round((area.height - height) / 2) : area.y + area.height - height - 32;
  overlayWindow.setBounds({ x: area.x + Math.round((area.width - width) / 2), y, width, height });
}

function showCaption(caption, preview = false) {
  if (!overlayWindow || !preferences.overlay) return;
  clearTimeout(expiryTimer);
  positionOverlay();
  overlayWindow.showInactive();
  overlayWindow.webContents.send('ktalk:event', { type: 'overlay-caption', caption, preview });
  expiryTimer = setTimeout(() => { overlayWindow?.hide(); }, preferences.captionSeconds * 1000);
}

const devUrl = process.env.KTALK_DEV_URL;
if (devUrl && devUrl !== 'http://127.0.0.1:5173') throw new Error('Origem de desenvolvimento inválida.');
const pageUrl = pathToFileURL(path.join(root, 'dist', 'index.html')).href;

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

function trusted(event, overlayAllowed = false) {
  const expected = event.sender === mainWindow?.webContents || (overlayAllowed && event.sender === overlayWindow?.webContents);
  const url = event.senderFrame?.url?.split('#')[0];
  const validUrl = devUrl ? url === `${devUrl}/` : url === pageUrl;
  if (!expected || !validUrl || event.senderFrame !== event.sender.mainFrame) throw new Error('Solicitação não autorizada.');
}

function registerIpc() {
  ipcMain.handle('ktalk:snapshot', event => { trusted(event, true); return state; });
  ipcMain.handle('ktalk:start', (event, value) => { trusted(event); return start(value); });
  ipcMain.handle('ktalk:monitor', (event, value) => { trusted(event); return start(value, true); });
  ipcMain.handle('ktalk:stop', event => { trusted(event); stop(); });
  ipcMain.handle('ktalk:devices', async event => {
    trusted(event);
    if (state.status !== 'idle') return;
    await ensureBackend();
    sendCommand({ type: 'devices' });
  });
  ipcMain.handle('ktalk:preferences', (event, value) => { trusted(event); return savePreferences(value); });
  ipcMain.handle('ktalk:preview', event => {
    trusted(event);
    if (!preferences.overlay) savePreferences({ ...preferences, overlay: true });
    showCaption({ text: 'Toda voz merece ser compreendida.', source: 'system' }, true);
  });
  ipcMain.handle('ktalk:export', async (event, { format, sessionId }) => {
    trusted(event);
    if (sessionId != null && typeof sessionId !== 'string') throw new Error('Sessão inválida.');
    const text = exportTranscript(state.captions, state.sessions, format, sessionId);
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Salvar transcrição',
      defaultPath: `KTalk-${new Date().toISOString().slice(0, 10)}.${format}`,
      filters: [{ name: format === 'srt' ? 'Legendas SubRip' : 'Texto UTF-8', extensions: [format] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.promises.writeFile(result.filePath, text, 'utf8');
    return true;
  });
  ipcMain.handle('ktalk:copy', (event, sessionId) => {
    trusted(event);
    clipboard.writeText(exportTranscript(state.captions, state.sessions, 'txt', sessionId));
  });
  ipcMain.handle('ktalk:clear', async event => {
    trusted(event);
    if (state.status !== 'idle') throw new Error('Pare a sessão antes de limpar o histórico.');
    const result = await dialog.showMessageBox(mainWindow, { type: 'question', title: 'Limpar histórico?',
      message: 'Apagar o histórico desta execução?', detail: 'As transcrições exportadas continuarão salvas.',
      buttons: ['Cancelar', 'Limpar histórico'], defaultId: 0, cancelId: 0 });
    if (result.response !== 1) return false;
    state.captions = []; state.partials = {}; state.sessions = []; state.lastCaption = null;
    overlayWindow?.hide(); broadcast({ type: 'cleared' });
    return true;
  });
}

async function createWindows() {
  const webPreferences = { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
    nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false };
  mainWindow = new BrowserWindow({ width: 1220, height: 820, minWidth: 1000, minHeight: 700,
    title: 'KTalk', backgroundColor: '#f7f9f8', autoHideMenuBar: true, webPreferences });
  overlayWindow = new BrowserWindow({ width: 1000, height: 300, frame: false, transparent: true,
    alwaysOnTop: true, skipTaskbar: true, focusable: false, resizable: false, show: false, hasShadow: false,
    webPreferences });
  for (const window of [mainWindow, overlayWindow]) secureWindow(window);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.on('move', positionOverlay);
  mainWindow.on('close', () => { closing = true; app.quit(); });
  screen.on('display-metrics-changed', positionOverlay);
  await Promise.all([mainWindow.loadURL(devUrl || pageUrl), overlayWindow.loadURL(`${devUrl || pageUrl}#overlay`)]);
  ensureBackend().then(() => sendCommand({ type: 'devices' })).catch(error => receive({ type: 'error', message: error.message }));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow?.isMinimized()) mainWindow.restore(); mainWindow?.focus(); });
  app.whenReady().then(async () => {
    registerIpc();
    await createWindows();
    const captureShortcut = globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (state.status === 'idle') start().catch(() => {}); else stop();
    });
    const overlayShortcut = globalShortcut.register('CommandOrControl+Shift+O', () => savePreferences({ ...preferences, overlay: !preferences.overlay }));
    if (!captureShortcut || !overlayShortcut) receive({ type: 'warning', message: 'Um atalho está em uso por outro aplicativo. Use os controles do KTalk.' });
  }).catch(error => { dialog.showErrorBox('KTalk', error.message); app.quit(); });
  app.on('before-quit', () => {
    closing = true;
    globalShortcut.unregisterAll();
    clearTimeout(expiryTimer);
    if (backend) {
      const child = backend;
      try { child.stdin.end('{"type":"shutdown"}\n'); } catch { /* Already closed. */ }
      setTimeout(() => child.kill(), 2000).unref();
      // Killing the owned child guarantees capture stops when the window closes.
      child.kill();
    }
  });
  app.on('window-all-closed', () => app.quit());
}
