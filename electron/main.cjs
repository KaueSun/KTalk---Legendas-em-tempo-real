const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  globalShortcut,
  dialog,
  clipboard,
  safeStorage,
  powerMonitor,
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { defaults, settings, exportTranscript } = require('./shared.cjs');
const { atomicWrite, HistoryStore } = require('./storage.cjs');
const { Backend } = require('./backend.cjs');

const root = path.join(__dirname, '..');
const dataDir =
  process.env.KTALK_DATA_DIR ||
  (app.isPackaged ? app.getPath('userData') : path.join(root, '.runtime', 'data'));
fs.mkdirSync(dataDir, { recursive: true });
app.setPath('userData', dataDir);
const preferencesPath = path.join(dataDir, 'preferences.json');
const history = new HistoryStore(dataDir, safeStorage);
let preferences = { ...defaults };
try {
  const saved = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
  preferences = settings(saved);
  if (!saved.mode)
    preferences = {
      ...preferences,
      mode: 'translate',
      language: 'en',
      model: 'tiny',
      max_seconds: 7.2,
      vad_mode: 1,
    };
  preferences.microphone = preferences.system = null;
} catch {
  /* First run or invalid preferences. */
}

let mainWindow, overlayWindow, expiryTimer, historyTimer, retryTimer;
let closing = false,
  quitReady = false,
  recoveryAttempts = 0,
  shutdownPromise;
let startGeneration = 0;
let cancellingPreparation = false;
const failures = [];
const state = {
  status: 'idle',
  connected: false,
  message: 'Conectando ao motor local…',
  preferences,
  devices: [],
  captions: [],
  partials: {},
  sourceInfo: {},
  sessions: [],
  lastCaption: null,
  error: null,
  warning: null,
  levels: {},
  historyAvailable: false,
  version: app.getVersion(),
  preparationStage: null,
  preparingAudioTest: false,
};
const packagedEngine = app.isPackaged && !process.env.KTALK_PYTHON;
const backend = new Backend({
  command: packagedEngine
    ? path.join(process.resourcesPath, 'engine', 'ktalk-engine.exe')
    : process.env.KTALK_PYTHON || path.join(root, '.venv', 'Scripts', 'python.exe'),
  args: packagedEngine ? [] : ['-u', path.join(root, 'backend', 'main.py')],
  cwd: app.isPackaged ? dataDir : root,
  env: {
    ...process.env,
    PYTHONUTF8: '1',
    KTALK_MODEL_DIR: process.env.KTALK_MODEL_DIR || path.join(dataDir, 'models'),
    HF_HOME: path.join(dataDir, 'huggingface'),
    HF_HUB_DISABLE_TELEMETRY: '1',
  },
  onEvent: receive,
  onExit: (code, expected) => {
    state.connected = false;
    broadcast({ type: 'connection', connected: false });
    if (closing || expected) return;
    recordFailure('backend-exit', code);
    finishInterruptedSession();
    receive({ type: 'status', status: 'idle', message: 'Motor local desconectado' });
    receive({
      type: 'error',
      message:
        'O motor de voz foi interrompido. Suas frases confirmadas continuam no histórico. Aguarde a reconexão ou use Reconectar motor.',
    });
    if (recoveryAttempts < 3) {
      retryTimer = setTimeout(() => {
        recoveryAttempts++;
        connect().catch(() => {});
      }, [1000, 2500, 5000][recoveryAttempts]);
    }
  },
});

function broadcast(event) {
  for (const window of [mainWindow, overlayWindow]) {
    if (window && !window.isDestroyed()) window.webContents.send('ktalk:event', event);
  }
}

function recordFailure(code, detail = null) {
  failures.push({ time: new Date().toISOString(), code, detail: typeof detail === 'number' ? detail : null });
  if (failures.length > 30) failures.shift();
}

function flushHistory() {
  clearTimeout(historyTimer);
  if (!preferences.saveHistory) return true;
  try {
    history.write(state, preferences.retentionDays);
    return true;
  } catch {
    recordFailure('history-write');
    receive({
      type: 'warning',
      message: 'Não foi possível salvar o histórico local. Exporte os trechos antes de fechar.',
    });
    return false;
  }
}

function scheduleHistory() {
  clearTimeout(historyTimer);
  if (preferences.saveHistory) historyTimer = setTimeout(flushHistory, 300);
}

function historyChanged() {
  broadcast({ type: 'history', sessions: state.sessions, captions: state.captions });
  scheduleHistory();
}

function finishInterruptedSession() {
  const current = state.sessions.at(-1);
  if (current && !current.ended_at) {
    current.ended_at = new Date().toISOString();
    current.interrupted = true;
    historyChanged();
  }
}

function receive(event) {
  if (!event || typeof event.type !== 'string') return;
  if (
    cancellingPreparation &&
    ['ready', 'status', 'session', 'caption', 'source-ready', 'level', 'error'].includes(event.type)
  )
    return;
  if (event.type === 'ready') {
    state.connected = true;
    broadcast({ type: 'connection', connected: true });
    if (recoveryAttempts > 0) {
      state.error = null;
      broadcast({ type: 'notice-reset' });
      receive({ type: 'status', status: 'idle', message: 'Motor reconectado. Pronto para uma nova sessão.' });
      receive({
        type: 'warning',
        message: state.warning || 'Motor reconectado. Inicie as legendas para continuar.',
      });
    }
    return;
  }
  if (event.type === 'status') {
    if (!['idle', 'preparing', 'listening', 'monitoring', 'stopping'].includes(event.status)) return;
    state.status = event.status;
    state.message = event.message;
    state.preparationStage = event.status === 'preparing' ? event.stage || state.preparationStage : null;
    state.preparingAudioTest =
      event.status === 'preparing' ? (event.audioTest ?? state.preparingAudioTest) : false;
    if (event.status === 'idle') {
      state.levels = {};
      state.partials = {};
      flushHistory();
    }
    if (['listening', 'monitoring'].includes(event.status)) recoveryAttempts = 0;
  } else if (event.type === 'devices') {
    state.devices = event.devices;
    for (const source of ['system', 'microphone']) {
      const name = preferences[`${source}_name`];
      preferences[source] = name
        ? (event.devices.find((device) => device.source === source && device.name === name)?.id ?? null)
        : null;
    }
    broadcast({ type: 'preferences', preferences });
  } else if (event.type === 'session') {
    state.sessions.push({ id: event.id, started_at: event.started_at, source: event.source });
    const retained = new Set(state.captions.map((caption) => caption.session_id));
    state.sessions = state.sessions.filter(
      (session, index) => retained.has(session.id) || index >= state.sessions.length - 200,
    );
    state.lastCaption = null;
    state.partials = {};
  } else if (event.type === 'session-ended') {
    const session = state.sessions.find((session) => session.id === event.id);
    if (session)
      Object.assign(session, { ended_at: event.ended_at, interrupted: Boolean(event.interrupted) });
    scheduleHistory();
  } else if (event.type === 'caption') {
    const previous = state.partials[event.id] || state.captions.find((caption) => caption.id === event.id);
    if (previous && (previous.revision >= event.revision || (previous.final && !event.final))) return;
    if (event.final) {
      delete state.partials[event.id];
      const index = state.captions.findIndex((caption) => caption.id === event.id);
      if (index >= 0) state.captions[index] = event;
      else state.captions.push(event);
      if (state.captions.length > 2000) {
        state.captions.shift();
        if (!state.warning?.includes('2.000'))
          receive({
            type: 'warning',
            message: 'O histórico mantém as últimas 2.000 legendas. Exporte os trechos que quiser guardar.',
          });
      }
      scheduleHistory();
    } else state.partials[event.id] = event;
    state.lastCaption = event;
    showCaption(event);
  } else if (event.type === 'caption-retracted') {
    delete state.partials[event.id];
    if (state.lastCaption?.id === event.id) {
      state.lastCaption = null;
      overlayWindow?.hide();
    }
  } else if (event.type === 'source-ready') state.sourceInfo[event.source] = event;
  else if (event.type === 'level') state.levels[event.source] = event;
  else if (event.type === 'error') {
    state.error = event.message;
    recordFailure('engine-error');
  } else if (event.type === 'warning') state.warning = event.message;
  broadcast(event);
}

async function connect() {
  await backend.ensure();
  if (!closing && state.status === 'idle') backend.send({ type: 'devices' });
}

function savePreferences(value) {
  const next = settings(value);
  if (next.saveHistory && !state.historyAvailable)
    throw new Error(
      'O Windows não disponibilizou a proteção do histórico. Você pode exportar a transcrição manualmente.',
    );
  // Do not let appearance changes silently alter an active capture.
  if (state.status !== 'idle') {
    for (const key of [
      'source',
      'mode',
      'model',
      'language',
      'system',
      'microphone',
      'system_name',
      'microphone_name',
      'vad_mode',
      'max_seconds',
      'partial_interval',
      'mic_gain',
    ])
      next[key] = preferences[key];
  }
  if (preferences.saveHistory && !next.saveHistory) {
    clearTimeout(historyTimer);
    history.clear();
  }
  atomicWrite(preferencesPath, JSON.stringify(next, null, 2));
  preferences = next;
  state.preferences = preferences;
  positionOverlay();
  if (!preferences.overlay) overlayWindow?.hide();
  broadcast({ type: 'preferences', preferences });
  scheduleHistory();
  return preferences;
}

async function start(value = preferences, monitorOnly = false) {
  if (state.status !== 'idle' || closing) return;
  const generation = ++startGeneration;
  clearTimeout(retryTimer);
  recoveryAttempts = 0;
  savePreferences(value);
  state.error = state.warning = null;
  state.lastCaption = null;
  state.partials = {};
  state.sourceInfo = {};
  state.levels = {};
  overlayWindow?.hide();
  broadcast({ type: 'notice-reset' });
  receive({
    type: 'status',
    status: 'preparing',
    audioTest: monitorOnly,
    message: 'Preparando o motor local…',
  });
  try {
    await backend.ensure();
    if (generation !== startGeneration) return;
    if (closing || state.status === 'stopping') {
      receive({ type: 'status', status: 'idle', message: 'Preparação cancelada' });
      return;
    }
    backend.send({ type: monitorOnly ? 'monitor' : 'start', settings: preferences });
  } catch (error) {
    if (generation !== startGeneration || closing) return;
    receive({ type: 'status', status: 'idle', message: 'Não foi possível iniciar' });
    receive({ type: 'error', message: error.message });
  }
}

async function stop() {
  if (!['preparing', 'listening', 'monitoring'].includes(state.status)) return;
  const preparing = state.status === 'preparing';
  receive({
    type: 'status',
    status: 'stopping',
    message: preparing ? 'Cancelando a preparação…' : 'Finalizando os trechos pendentes…',
  });
  if (preparing) {
    ++startGeneration;
    cancellingPreparation = true;
    try {
      // A model download or native conversion can block Python's cooperative stop.
      await backend.shutdown(1500);
    } finally {
      cancellingPreparation = false;
    }
    if (!closing) {
      receive({ type: 'status', status: 'idle', message: 'Preparação cancelada' });
      connect().catch((error) => receive({ type: 'error', message: error.message }));
    }
    return;
  }
  if (state.connected) {
    try {
      backend.send({ type: 'stop' });
    } catch (error) {
      receive({ type: 'error', message: error.message });
    }
  }
}

function positionOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const display = mainWindow ? screen.getDisplayMatching(mainWindow.getBounds()) : screen.getPrimaryDisplay();
  const area = display.workArea;
  const width = Math.max(300, Math.min(1000, area.width - 64)),
    height = Math.min(300, area.height - 64);
  const y =
    preferences.position === 'top'
      ? area.y + 36
      : preferences.position === 'center'
        ? area.y + Math.round((area.height - height) / 2)
        : area.y + area.height - height - 32;
  overlayWindow.setBounds({ x: area.x + Math.round((area.width - width) / 2), y, width, height });
}

function showCaption(caption, preview = false) {
  if (!overlayWindow || !preferences.overlay || closing) return;
  clearTimeout(expiryTimer);
  positionOverlay();
  overlayWindow.showInactive();
  overlayWindow.webContents.send('ktalk:event', { type: 'overlay-caption', caption, preview });
  expiryTimer = setTimeout(() => {
    overlayWindow?.hide();
  }, preferences.captionSeconds * 1000);
}

const devUrl = process.env.KTALK_DEV_URL;
if (devUrl && devUrl !== 'http://127.0.0.1:5173') throw new Error('Origem de desenvolvimento inválida.');
const pageUrl = pathToFileURL(path.join(root, 'dist', 'index.html')).href;

function secureWindow(window) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.on('render-process-gone', () => {
    recordFailure('renderer-exit');
    if (!closing && !window.isDestroyed()) window.reload();
  });
}

function trusted(event, overlayAllowed = false) {
  const expected =
    event.sender === mainWindow?.webContents ||
    (overlayAllowed && event.sender === overlayWindow?.webContents);
  const url = event.senderFrame?.url?.split('#')[0];
  if (
    !expected ||
    !(devUrl ? url === `${devUrl}/` : url === pageUrl) ||
    event.senderFrame !== event.sender.mainFrame
  )
    throw new Error('Solicitação não autorizada.');
}

function sessionById(id) {
  if (state.status !== 'idle') throw new Error('Pare a sessão antes de alterar o histórico.');
  if (typeof id !== 'string') throw new Error('Sessão inválida.');
  const session = state.sessions.find((session) => session.id === id);
  if (!session) throw new Error('Sessão não encontrada.');
  return session;
}

function registerIpc() {
  ipcMain.handle('ktalk:snapshot', (event) => {
    trusted(event, true);
    return state;
  });
  ipcMain.handle('ktalk:start', (event, value) => {
    trusted(event);
    return start(value);
  });
  ipcMain.handle('ktalk:monitor', (event, value) => {
    trusted(event);
    return start(value, true);
  });
  ipcMain.handle('ktalk:stop', (event) => {
    trusted(event);
    return stop();
  });
  ipcMain.handle('ktalk:devices', async (event) => {
    trusted(event);
    if (state.status === 'idle') await connect();
  });
  ipcMain.handle('ktalk:reconnect', async (event) => {
    trusted(event);
    if (state.status !== 'idle') throw new Error('Pare a sessão antes de reconectar.');
    clearTimeout(retryTimer);
    recoveryAttempts = 0;
    await backend.shutdown(1000);
    state.error = state.warning = null;
    broadcast({ type: 'notice-reset' });
    await connect();
  });
  ipcMain.handle('ktalk:preferences', (event, value) => {
    trusted(event);
    return savePreferences(value);
  });
  ipcMain.handle('ktalk:preview', (event) => {
    trusted(event);
    if (!preferences.overlay) savePreferences({ ...preferences, overlay: true });
    showCaption({ text: 'Toda voz merece ser compreendida.', source: 'system' }, true);
  });
  ipcMain.handle('ktalk:rename-session', (event, { id, title }) => {
    trusted(event);
    const session = sessionById(id);
    if (typeof title !== 'string' || title.trim().length < 1 || title.length > 80)
      throw new Error('Use um nome com até 80 caracteres.');
    session.title = title.trim();
    historyChanged();
  });
  ipcMain.handle('ktalk:delete-session', async (event, id) => {
    trusted(event);
    const session = sessionById(id);
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Excluir sessão',
      message: `Excluir ${session.title || 'esta sessão'}?`,
      detail: 'Os arquivos exportados serão mantidos.',
      buttons: ['Cancelar', 'Excluir'],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return false;
    sessionById(id);
    state.sessions = state.sessions.filter((session) => session.id !== id);
    state.captions = state.captions.filter((caption) => caption.session_id !== id);
    if (state.lastCaption?.session_id === id) {
      state.lastCaption = null;
      overlayWindow?.hide();
    }
    historyChanged();
    flushHistory();
    return true;
  });
  ipcMain.handle('ktalk:export', async (event, { format, sessionId }) => {
    trusted(event);
    if (sessionId != null && typeof sessionId !== 'string') throw new Error('Sessão inválida.');
    const text = exportTranscript(state.captions, state.sessions, format, sessionId);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar transcrição',
      defaultPath: `KTalk-${new Date().toISOString().slice(0, 10)}.${format}`,
      filters: [{ name: format === 'srt' ? 'Legendas SubRip' : 'Texto UTF-8', extensions: [format] }],
    });
    if (result.canceled || !result.filePath) return false;
    await fs.promises.writeFile(result.filePath, text, 'utf8');
    return true;
  });
  ipcMain.handle('ktalk:copy', (event, id) => {
    trusted(event);
    clipboard.writeText(exportTranscript(state.captions, state.sessions, 'txt', id));
  });
  ipcMain.handle('ktalk:clear', async (event) => {
    trusted(event);
    if (state.status !== 'idle') throw new Error('Pare a sessão antes de limpar o histórico.');
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      title: 'Limpar histórico?',
      message: 'Apagar todas as sessões?',
      detail: 'Remove também a cópia local salva. Arquivos exportados serão mantidos.',
      buttons: ['Cancelar', 'Limpar histórico'],
      defaultId: 0,
      cancelId: 0,
    });
    if (result.response !== 1) return false;
    if (state.status !== 'idle') throw new Error('Pare a sessão antes de limpar o histórico.');
    clearTimeout(historyTimer);
    history.clear();
    state.captions = [];
    state.partials = {};
    state.sessions = [];
    state.lastCaption = null;
    overlayWindow?.hide();
    broadcast({ type: 'cleared' });
    return true;
  });
  ipcMain.handle('ktalk:diagnostics', async (event) => {
    trusted(event);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar diagnóstico sem transcrições',
      defaultPath: 'KTalk-diagnostico.json',
      filters: [{ name: 'Diagnóstico JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return false;
    const report = {
      version: app.getVersion(),
      electron: process.versions.electron,
      platform: process.platform,
      arch: process.arch,
      packaged: app.isPackaged,
      connected: state.connected,
      status: state.status,
      model: preferences.model,
      mode: preferences.mode,
      deviceCount: state.devices.length,
      recentLatencyMs: state.captions.slice(-20).map((caption) => caption.latency_ms),
      failures,
    };
    await fs.promises.writeFile(result.filePath, JSON.stringify(report, null, 2), 'utf8');
    return true;
  });
}

async function quit() {
  if (shutdownPromise) return shutdownPromise;
  closing = true;
  clearTimeout(retryTimer);
  clearTimeout(expiryTimer);
  overlayWindow?.hide();
  if (state.status !== 'idle')
    receive({ type: 'status', status: 'stopping', message: 'Salvando os últimos trechos…' });
  shutdownPromise = (async () => {
    const graceful = await backend.shutdown();
    if (!graceful) finishInterruptedSession();
    while (!flushHistory()) {
      const choice = await dialog
        .showMessageBox(mainWindow, {
          type: 'warning',
          title: 'Histórico não salvo',
          message: 'Não foi possível guardar os últimos trechos.',
          detail:
            'Mantenha o KTalk aberto para exportar a transcrição ou tente salvar novamente. Fechar sem salvar pode perder os trechos que ainda não foram gravados.',
          buttons: ['Manter aberto', 'Tentar salvar novamente', 'Fechar sem salvar'],
          defaultId: 0,
          cancelId: 0,
        })
        .catch(() => ({ response: 0 }));
      if (choice.response === 1) continue;
      if (choice.response === 2) break;
      closing = false;
      shutdownPromise = null;
      receive({ type: 'status', status: 'idle', message: 'Exporte o histórico ou tente salvar novamente.' });
      mainWindow?.show();
      connect().catch((error) => receive({ type: 'error', message: error.message }));
      return;
    }
    globalShortcut.unregisterAll();
    quitReady = true;
    app.quit();
  })();
  return shutdownPromise;
}

async function createWindows() {
  const webPreferences = {
    preload: path.join(__dirname, 'preload.cjs'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    spellcheck: false,
    backgroundThrottling: false,
  };
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 1000,
    minHeight: 700,
    title: 'KTalk',
    icon: path.join(root, 'assets', 'icon.png'),
    backgroundColor: '#f4f7f5',
    autoHideMenuBar: true,
    webPreferences,
  });
  overlayWindow = new BrowserWindow({
    width: 1000,
    height: 300,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    show: false,
    hasShadow: false,
    webPreferences,
  });
  for (const window of [mainWindow, overlayWindow]) secureWindow(window);
  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.on('move', positionOverlay);
  mainWindow.on('close', (event) => {
    if (!quitReady) {
      event.preventDefault();
      void quit();
    }
  });
  screen.on('display-metrics-changed', positionOverlay);
  await Promise.all([
    mainWindow.loadURL(devUrl || pageUrl),
    overlayWindow.loadURL(`${devUrl || pageUrl}#overlay`),
  ]);
  mainWindow.show();
  connect().catch((error) => receive({ type: 'error', message: error.message }));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.show();
    mainWindow?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      state.historyAvailable = safeStorage.isEncryptionAvailable();
      if (preferences.saveHistory) {
        try {
          const saved = history.read(preferences.retentionDays);
          state.sessions = saved.sessions.map((session) =>
            session.ended_at ? session : { ...session, ended_at: session.started_at, interrupted: true },
          );
          state.captions = saved.captions;
        } catch {
          preferences.saveHistory = false;
          state.warning =
            'Não foi possível abrir o histórico salvo. O arquivo foi preservado. Exporte novas sessões antes de fechar.';
        }
      }
      registerIpc();
      await createWindows();
      const captureShortcut = globalShortcut.register('CommandOrControl+Shift+Space', () => {
        if (state.status === 'idle') void start();
        else stop();
      });
      const overlayShortcut = globalShortcut.register('CommandOrControl+Shift+O', () => {
        try {
          savePreferences({ ...preferences, overlay: !preferences.overlay });
        } catch (error) {
          receive({ type: 'error', message: error.message });
        }
      });
      if (!captureShortcut || !overlayShortcut)
        receive({
          type: 'warning',
          message: 'Um atalho está em uso por outro aplicativo. Use os controles do KTalk.',
        });
      powerMonitor.on('suspend', () => {
        stop();
        flushHistory();
      });
    })
    .catch((error) => {
      dialog.showErrorBox('KTalk', error.message);
      void quit();
    });
  app.on('before-quit', (event) => {
    if (!quitReady) {
      event.preventDefault();
      void quit();
    }
  });
  app.on('window-all-closed', () => {
    void quit();
  });
}
