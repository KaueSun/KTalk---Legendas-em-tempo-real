import { useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  CircleHelp,
  Copy,
  Ear,
  Globe2,
  History,
  Languages,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Mic,
  Monitor,
  MonitorUp,
  Play,
  Radio,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Subtitles,
  Trash2,
  Volume2,
  X,
  Zap,
} from 'lucide-react';
import { clock, initial, languages, reduceEvent, sourceNames } from './state';
import { LibrarySettings, SessionActions } from './LibrarySettings';
import type { Caption, EngineEvent, Preferences, Snapshot, Status } from './types';

type Page = 'live' | 'history' | 'settings';
const statusLabels: Record<Status, string> = {
  idle: 'Pronto para começar',
  preparing: 'Preparando',
  listening: 'Ao vivo',
  monitoring: 'Testando áudio',
  stopping: 'Finalizando',
};

function Toggle({ value, onChange, label }: { value: boolean; onChange: () => void; label: string }) {
  return (
    <button
      className={`toggle ${value ? 'on' : ''}`}
      role="switch"
      aria-checked={value}
      aria-label={label}
      onClick={onChange}
    >
      <span />
    </button>
  );
}

function DeviceSelect({
  state,
  source,
  update,
}: {
  state: Snapshot;
  source: 'system' | 'microphone';
  update: (patch: Partial<Preferences>) => void;
}) {
  const name = state.preferences[`${source}_name`];
  const value = state.preferences[source] ?? (name ? 'missing' : '');
  return (
    <label className="device-field">
      <span>
        {source === 'system' ? <Monitor size={14} /> : <Mic size={14} />}
        {source === 'system' ? 'Saída que você está ouvindo' : 'Microfone de entrada'}
      </span>
      <select
        aria-label={source === 'system' ? 'Dispositivo de saída' : 'Dispositivo do microfone'}
        disabled={state.status !== 'idle'}
        value={value}
        onChange={(event) => {
          const id = event.target.value === '' ? null : Number(event.target.value);
          update({
            [source]: id,
            [`${source}_name`]:
              id === null
                ? null
                : (state.devices.find((device) => device.id === id && device.source === source)?.name ??
                  null),
          });
        }}
      >
        <option value="">Padrão do Windows</option>
        {name && state.preferences[source] == null && (
          <option value="missing" disabled>
            {name} · indisponível
          </option>
        )}
        {state.devices
          .filter((device) => device.source === source)
          .map((device) => (
            <option key={device.id} value={device.id}>
              {device.name.replace(' [Loopback]', '')}
              {device.default ? ' · padrão' : ''}
            </option>
          ))}
      </select>
    </label>
  );
}

function Meter({ state, source }: { state: Snapshot; source: 'system' | 'microphone' }) {
  const metrics = state.levels[source];
  const active = state.status === 'listening' || state.status === 'monitoring';
  const level = metrics?.level || 0;
  const status = !active
    ? 'Em espera'
    : metrics?.clipping
      ? 'Áudio saturado'
      : metrics?.speech
        ? 'Fala detectada'
        : level > 0.08
          ? 'Som detectado'
          : 'Sem sinal';
  const Icon = source === 'system' ? Volume2 : Mic;
  return (
    <div className={`meter ${metrics?.speech ? 'voice' : ''}`}>
      <div className="meter-title">
        <Icon size={16} />
        <b>{sourceNames[source]}</b>
        <span>{status}</span>
      </div>
      <div
        className="meter-track"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
        aria-label={`Nível de áudio do ${sourceNames[source]}`}
      >
        <div style={{ width: `${level * 100}%` }} className={metrics?.clipping ? 'clipping' : ''} />
      </div>
      <div className="meter-device">
        <span title={state.sourceInfo[source]?.name}>
          {state.sourceInfo[source]?.name.replace(' [Loopback]', '') ||
            (state.preferences[source] != null
              ? state.devices.find((device) => device.id === state.preferences[source])?.name
              : 'Dispositivo padrão do Windows')}
        </span>
        <small>{active ? `${Math.round(metrics?.dbfs ?? -120)} dB` : '—'}</small>
      </div>
    </div>
  );
}

function CaptionRow({ caption }: { caption: Caption }) {
  return (
    <article className="caption-row">
      <span className={`caption-source ${caption.source}`}>
        {caption.source === 'system' ? <Monitor size={15} /> : <Mic size={15} />}
      </span>
      <div>
        <div className="caption-meta">
          <b>{sourceNames[caption.source]}</b>
          <span>
            {caption.target_language === 'pt-BR'
              ? 'EN → PT-BR'
              : languages[caption.language] || caption.language}
          </span>
          <time>{clock(caption.start)}</time>
        </div>
        <p>{caption.text}</p>
        {caption.original_text && caption.original_text !== caption.text && (
          <p className="original">{caption.original_text}</p>
        )}
      </div>
    </article>
  );
}

function Help({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog className="help-dialog" ref={dialog} onCancel={onClose}>
      <button className="icon-button close-dialog" aria-label="Fechar ajuda" onClick={onClose}>
        <X size={20} />
      </button>
      <div className="brand-symbol">
        <AudioLines size={25} />
      </div>
      <span className="eyebrow">KTALK</span>
      <h2>Entenda a conversa.</h2>
      <p>
        No modo de tradução, a fala em inglês vira uma legenda em português brasileiro, no seu computador.
      </p>
      <ol>
        <li>
          <b>Escolha a fonte.</b> Use Áudio do PC para vídeos, jogos e chamadas. Selecione a saída certa; um
          fone e um monitor podem ter saídas diferentes.
        </li>
        <li>
          <b>Teste o sinal.</b> O botão Testar áudio abre os medidores sem iniciar reconhecimento. Se aparecer
          Sem sinal, troque o dispositivo.
        </li>
        <li>
          <b>Inicie a tradução.</b> A legenda começa provisória e se ajusta durante a fala. O trecho
          confirmado vai para o histórico.
        </li>
      </ol>
      <div className="help-note">
        <Zap size={18} />
        <p>
          As atualizações são solicitadas a cada 600 ms no modo rápido. O atraso real também depende do
          reconhecimento e do computador; não é latência zero.
        </p>
      </div>
      <div className="help-keys">
        <span>
          Iniciar / parar <kbd>Ctrl + Shift + Espaço</kbd>
        </span>
        <span>
          Legenda flutuante <kbd>Ctrl + Shift + O</kbd>
        </span>
      </div>
      <p className="muted">
        Use fones ao captar sistema e microfone juntos. Você pode guardar o histórico nas configurações. Em
        jogos, prefira janela sem bordas.
      </p>
      <button className="primary-button full-width" onClick={onClose}>
        Entendi <Check size={16} />
      </button>
    </dialog>
  );
}

export function App() {
  const [state, setState] = useState(initial);
  const [page, setPage] = useState<Page>('live');
  const [help, setHelp] = useState(false);
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [exporting, setExporting] = useState(false);
  const desktop = Boolean(window.ktalk);
  const busy = state.status !== 'idle';
  const listening = state.status === 'listening';
  const monitoring = state.status === 'monitoring';
  const translate = state.preferences.mode === 'translate';
  const sources: ('system' | 'microphone')[] =
    state.preferences.source === 'both' ? ['system', 'microphone'] : [state.preferences.source];
  const lastSession = state.sessions.at(-1);
  const current = state.captions.filter((caption) => caption.session_id === lastSession?.id);
  const latest =
    state.lastCaption &&
    now - Date.parse(state.lastCaption.created_at) < state.preferences.captionSeconds * 1000
      ? state.lastCaption
      : null;
  const speaking = Object.values(state.levels).some((level) => level.speech);
  const hasSignal = Object.values(state.levels).some((level) => level.level > 0.08);
  const elapsed =
    listening && lastSession ? (now - Date.parse(lastSession.started_at)) / 1000 : current.at(-1)?.end || 0;

  useEffect(() => {
    if (!window.ktalk) return;
    let disposed = false;
    let hydrated = false;
    const pending: EngineEvent[] = [];
    const off = window.ktalk.onEvent((event) =>
      hydrated ? setState((previous) => reduceEvent(previous, event)) : pending.push(event),
    );
    window.ktalk
      .snapshot()
      .then((snapshot) => {
        if (disposed) return;
        setState(
          pending
            .filter(
              (event) =>
                event.type !== 'session' || !snapshot.sessions.some((session) => session.id === event.id),
            )
            .reduce(reduceEvent, snapshot),
        );
        hydrated = true;
      })
      .catch((error) => setToast(String(error)));
    return () => {
      disposed = true;
      off();
    };
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = window.setTimeout(() => setToast(''), 5500);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  async function attempt(action: () => Promise<unknown> | undefined, message?: string) {
    try {
      const result = await action();
      if (message && result !== false) setToast(message);
      return result;
    } catch (error) {
      setToast(
        error instanceof Error
          ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(error),
      );
      return false;
    }
  }
  function update(patch: Partial<Preferences>) {
    const preferences = { ...state.preferences, ...patch };
    setState((previous) => ({ ...previous, preferences }));
    if (desktop)
      void attempt(async () => {
        try {
          await window.ktalk?.preferences(preferences);
        } catch (error) {
          const snapshot = await window.ktalk?.snapshot();
          if (snapshot) setState((previous) => ({ ...previous, preferences: snapshot.preferences }));
          throw error;
        }
      });
  }
  async function exportFile(format: 'txt' | 'srt') {
    setExporting(true);
    await attempt(() => window.ktalk?.export(format, sessionId), 'Transcrição salva.');
    setExporting(false);
  }
  const selected = state.captions.filter((caption) => !sessionId || caption.session_id === sessionId);
  const filtered = selected.filter((caption) =>
    `${caption.text} ${caption.original_text || ''}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const selectedSession = state.sessions.find((session) => session.id === sessionId);
  const srtAvailable = new Set(selected.map((caption) => caption.session_id)).size === 1;

  return (
    <div className="app-shell">
      <header className="app-header">
        <a
          className="brand"
          href="#"
          onClick={(event) => {
            event.preventDefault();
            setPage('live');
          }}
        >
          <span className="brand-symbol">
            <AudioLines size={24} />
          </span>
          KTalk<span className="version-tag">{state.version}</span>
        </a>
        <nav aria-label="Navegação principal">
          {(
            [
              { id: 'live', name: 'Legendas', icon: Subtitles },
              { id: 'history', name: 'Histórico', icon: History },
              { id: 'settings', name: 'Configurações', icon: SlidersHorizontal },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              onClick={() => setPage(item.id)}
              aria-current={page === item.id ? 'page' : undefined}
              className={page === item.id ? 'active' : ''}
            >
              <item.icon size={17} />
              {item.name}
              {item.id === 'history' && state.captions.length > 0 && (
                <span className="count">{state.captions.length}</span>
              )}
            </button>
          ))}
        </nav>
        <span className="privacy">
          <LockKeyhole size={13} />
          Local e privado
        </span>
        <button
          className="icon-button"
          title="Como funciona"
          aria-label="Como funciona"
          onClick={() => setHelp(true)}
        >
          <CircleHelp size={20} />
        </button>
      </header>
      <main className={`page ${page === 'live' ? 'live-page' : ''}`}>
        {!desktop && (
          <div className="notice">
            <Monitor size={17} />
            <span>Prévia visual. Abra KTalk.cmd para captar áudio e traduzir.</span>
          </div>
        )}
        {(state.error || state.warning) && (
          <div
            role={state.error ? 'alert' : 'status'}
            className={`notice ${state.error ? 'error' : 'warning'}`}
          >
            <Activity size={17} />
            <span>{state.error || state.warning}</span>
            {state.error && !busy && (
              <button
                className="text-button"
                onClick={() => void attempt(() => window.ktalk?.reconnect(), 'Motor reconectado.')}
              >
                Reconectar motor
              </button>
            )}
            <button
              className="icon-button"
              aria-label="Dispensar aviso"
              onClick={() => setState((previous) => ({ ...previous, error: null, warning: null }))}
            >
              <X size={16} />
            </button>
          </div>
        )}
        {page === 'live' && (
          <>
            <div className="page-heading">
              <div>
                <h1>{translate ? 'Acompanhe em português.' : 'Acompanhe cada palavra.'}</h1>
                <p>
                  {translate
                    ? 'Do áudio em inglês à legenda em PT-BR. Tudo no seu computador.'
                    : 'Legendas progressivas no idioma original da conversa.'}
                </p>
              </div>
              <div className="mode-switch" aria-label="Modo de legenda">
                <button
                  disabled={busy}
                  className={translate ? 'selected' : ''}
                  onClick={() => update({ mode: 'translate', language: 'en' })}
                >
                  <Languages size={16} />
                  Traduzir EN → PT-BR
                </button>
                <button
                  disabled={busy}
                  className={!translate ? 'selected' : ''}
                  onClick={() => update({ mode: 'caption' })}
                >
                  Só transcrever
                </button>
              </div>
            </div>
            <section className="capture-toolbar" aria-label="Controles de áudio">
              <div className="source-picker">
                <span className="field-title">O QUE VAMOS OUVIR?</span>
                <div className="source-options">
                  {(
                    [
                      { value: 'system', label: 'Áudio do PC', icon: Monitor },
                      { value: 'microphone', label: 'Microfone', icon: Mic },
                      { value: 'both', label: 'Ambos', icon: Layers3 },
                    ] as const
                  ).map((item) => (
                    <button
                      disabled={busy}
                      key={item.value}
                      aria-pressed={state.preferences.source === item.value}
                      className={state.preferences.source === item.value ? 'selected' : ''}
                      onClick={() => update({ source: item.value })}
                    >
                      <item.icon size={16} />
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="device-selectors">
                {sources.map((source) => (
                  <DeviceSelect key={source} source={source} state={state} update={update} />
                ))}
              </div>
              <div className="capture-actions">
                <button
                  className="secondary-button test-audio"
                  disabled={!desktop || (busy && !monitoring)}
                  onClick={() =>
                    void attempt(() =>
                      monitoring ? window.ktalk?.stop() : window.ktalk?.monitor(state.preferences),
                    )
                  }
                >
                  {monitoring ? <Square size={14} /> : <Activity size={16} />}
                  {monitoring ? 'Encerrar teste' : 'Testar áudio'}
                </button>
                <button
                  className={`primary-button ${busy ? 'stop' : ''}`}
                  disabled={!desktop || monitoring || state.status === 'stopping'}
                  onClick={() =>
                    void attempt(() => (busy ? window.ktalk?.stop() : window.ktalk?.start(state.preferences)))
                  }
                >
                  {state.status === 'preparing' || state.status === 'stopping' ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : busy ? (
                    <Square size={14} fill="currentColor" />
                  ) : (
                    <Play size={16} fill="currentColor" />
                  )}
                  {state.status === 'preparing'
                    ? 'Cancelar'
                    : state.status === 'stopping'
                      ? 'Finalizando'
                      : busy
                        ? 'Parar'
                        : translate
                          ? 'Iniciar tradução'
                          : 'Iniciar legendas'}
                </button>
              </div>
            </section>
            <div className="live-layout">
              <section className="caption-workspace">
                <div className="caption-stage">
                  <div className="stage-header">
                    <span className={`live-status ${listening || monitoring ? 'on' : ''}`}>
                      <i />
                      {statusLabels[state.status]}
                    </span>
                    <span className="language-route">
                      {translate ? (
                        <>
                          <b>EN</b>
                          <ArrowRight size={13} />
                          <b>PT-BR</b>
                        </>
                      ) : (
                        <>
                          <Globe2 size={13} />
                          {languages[state.preferences.language]}
                        </>
                      )}
                    </span>
                    <time>{clock(elapsed)}</time>
                  </div>
                  <span className="sr-only" aria-live="polite" aria-atomic="true">
                    {state.captions.at(-1)?.text || ''}
                  </span>
                  <div className="stage-content">
                    {latest && !monitoring ? (
                      <div className="live-caption">
                        <span className="caption-state">
                          {latest.final ? <CheckCheck size={15} /> : <span className="updating-dot" />}
                          {latest.final ? 'Confirmada' : 'Atualizando durante a fala'}
                          <span>· {sourceNames[latest.source]}</span>
                        </span>
                        <p>{latest.text}</p>
                        {latest.original_text && latest.original_text !== latest.text && (
                          <div className="live-original">{latest.original_text}</div>
                        )}
                      </div>
                    ) : (
                      <div className="stage-empty">
                        <div className={`listening-symbol ${speaking ? 'speaking' : ''}`}>
                          {state.status === 'preparing' ? (
                            <LoaderCircle className="spin" size={33} />
                          ) : (
                            <Ear size={35} strokeWidth={1.4} />
                          )}
                        </div>
                        <h2>
                          {state.status === 'preparing'
                            ? 'Preparando a escuta…'
                            : monitoring
                              ? 'Vamos conferir seu áudio.'
                              : listening
                                ? speaking
                                  ? 'Reconhecendo a fala…'
                                  : hasSignal
                                    ? 'Áudio chegando. Aguardando fala.'
                                    : 'Aguardando sinal de áudio.'
                                : translate
                                  ? 'Sua próxima legenda será em português.'
                                  : 'Sua conversa aparece aqui.'}
                        </h2>
                        <p>
                          {state.status === 'preparing'
                            ? state.message
                            : monitoring
                              ? 'Fale ou reproduza um vídeo. Veja o sinal e a detecção ao lado.'
                              : listening && !hasSignal
                                ? 'Reproduza um áudio ou confira o dispositivo selecionado.'
                                : listening
                                  ? 'O texto aparece e se ajusta enquanto a pessoa fala.'
                                  : 'Escolha uma fonte, teste o áudio e comece.'}
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="stage-footer">
                    <span>
                      <ShieldCheck size={13} />
                      {translate ? 'Tradução local · português brasileiro' : 'Reconhecimento local'}
                    </span>
                    <span>
                      {latest?.latency_ms != null ? (
                        <>
                          <Zap size={12} />
                          {(latest.latency_ms / 1000).toFixed(1)} s de processamento e fila
                        </>
                      ) : (
                        'Legendas progressivas'
                      )}
                    </span>
                  </div>
                </div>
                <div className="overlay-bar">
                  <MonitorUp size={19} />
                  <div>
                    <b>Legenda sobre seus aplicativos</b>
                    <span>Continue no vídeo, jogo ou chamada.</span>
                  </div>
                  <button
                    className="text-button"
                    disabled={!desktop}
                    onClick={() => void attempt(() => window.ktalk?.preview(), 'Prévia exibida na sua tela.')}
                  >
                    Testar legenda
                  </button>
                  <Toggle
                    label="Ativar legenda flutuante"
                    value={state.preferences.overlay}
                    onChange={() => update({ overlay: !state.preferences.overlay })}
                  />
                </div>
                <div className="recent">
                  <div className="section-title">
                    <h2>Último trecho confirmado</h2>
                    <button className="text-button" onClick={() => setPage('history')}>
                      Ver histórico <ArrowRight size={14} />
                    </button>
                  </div>
                  {current.length ? (
                    <CaptionRow caption={current[current.length - 1]} />
                  ) : (
                    <div className="recent-empty">
                      <Subtitles size={20} />
                      <span>
                        O histórico guarda a versão final de cada fala, sem duplicar as atualizações.
                      </span>
                    </div>
                  )}
                </div>
              </section>
              <aside className="audio-panel">
                <div className="section-title">
                  <h2>
                    <Radio size={16} />
                    Sinal de áudio
                  </h2>
                  <button
                    className="icon-button"
                    title="Atualizar dispositivos"
                    aria-label="Atualizar dispositivos"
                    disabled={!desktop || busy}
                    onClick={() => void attempt(() => window.ktalk?.devices())}
                  >
                    <RefreshCw size={14} />
                  </button>
                </div>
                {sources.map((source) => (
                  <Meter key={source} source={source} state={state} />
                ))}
                <div className={`signal-note ${speaking ? 'detected' : ''}`}>
                  <span className="signal-icon">
                    {speaking ? <AudioLines size={20} /> : <Activity size={20} />}
                  </span>
                  <div>
                    <b>
                      {speaking
                        ? 'Voz humana detectada'
                        : monitoring || listening
                          ? hasSignal
                            ? 'Há som na fonte'
                            : 'Confira o sinal'
                          : 'Antes de começar'}
                    </b>
                    <p>
                      {speaking
                        ? 'O reconhecimento está recebendo a fala.'
                        : monitoring || listening
                          ? hasSignal
                            ? 'Aguardando uma fala identificável.'
                            : 'Se o medidor não se mover, escolha outro dispositivo.'
                          : 'Use Testar áudio para conferir a entrada sem gerar legendas.'}
                    </p>
                  </div>
                </div>
                <label className="field">
                  <span>
                    <Zap size={14} />
                    Velocidade e precisão
                  </span>
                  <select
                    aria-label="Modelo de reconhecimento"
                    disabled={busy}
                    value={state.preferences.model}
                    onChange={(event) => update({ model: event.target.value as Preferences['model'] })}
                  >
                    <option value="tiny">Veloz · Tiny</option>
                    <option value="base">Equilibrado · Base</option>
                    <option value="small">Mais preciso · Small</option>
                  </select>
                </label>
                {!translate && (
                  <label className="field">
                    <span>Idioma da fala</span>
                    <select
                      aria-label="Idioma da fala"
                      disabled={busy}
                      value={state.preferences.language}
                      onChange={(event) => update({ language: event.target.value })}
                    >
                      {Object.entries(languages).map(([value, label]) => (
                        <option value={value} key={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {state.preferences.source !== 'system' && (
                  <label className="field">
                    <span>Volume de entrada do microfone</span>
                    <select
                      aria-label="Ganho do microfone"
                      disabled={busy}
                      value={state.preferences.mic_gain}
                      onChange={(event) => update({ mic_gain: Number(event.target.value) })}
                    >
                      {[1, 1.5, 2, 3, 4].map((gain) => (
                        <option key={gain} value={gain}>
                          {gain === 1 ? 'Normal' : 'Amplificar'} · {gain}×
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="latency-note">
                  <b>
                    <Zap size={13} />
                    Atualização progressiva
                  </b>
                  <p>
                    A cada {Math.round(state.preferences.partial_interval * 1000)} ms, a fala disponível entra
                    no reconhecimento. A latência real varia com o modelo.
                  </p>
                  <button className="text-button" onClick={() => setPage('settings')}>
                    Ajustar legendas <ArrowRight size={13} />
                  </button>
                </div>
              </aside>
            </div>
          </>
        )}
        {page === 'history' && (
          <>
            <div className="page-heading">
              <div>
                <h1>Palavras que ficam.</h1>
                <p>Tradução e fala original, organizadas por sessão.</p>
              </div>
              <button
                className="secondary-button danger"
                disabled={busy || !state.captions.length}
                onClick={() =>
                  void attempt(() => window.ktalk?.clear(), 'Histórico limpo.').then((result) => {
                    if (result) setSessionId(null);
                  })
                }
              >
                <Trash2 size={16} />
                Limpar histórico
              </button>
            </div>
            <section className="history-card">
              <div className="history-toolbar">
                <div className="search-field">
                  <Search size={17} />
                  <input
                    aria-label="Buscar na transcrição"
                    placeholder="Buscar no português ou no texto original…"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
                <select
                  aria-label="Filtrar sessão"
                  value={sessionId || ''}
                  onChange={(event) => setSessionId(event.target.value || null)}
                >
                  <option value="">Todas as sessões</option>
                  {state.sessions.map((session, index) => (
                    <option key={session.id} value={session.id}>
                      {session.title || `Sessão ${index + 1}`} ·{' '}
                      {new Date(session.started_at).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </option>
                  ))}
                </select>
              </div>
              <SessionActions
                session={selectedSession}
                busy={busy}
                attempt={attempt}
                onDeleted={() => setSessionId(null)}
              />
              <div className="history-list">
                {filtered.length ? (
                  filtered.map((caption) => <CaptionRow key={caption.id} caption={caption} />)
                ) : (
                  <div className="large-empty">
                    <History size={35} />
                    <h2>{query ? 'Nenhum trecho encontrado.' : 'O histórico começa com a primeira fala.'}</h2>
                    <p>
                      {query
                        ? 'Tente outra palavra ou sessão.'
                        : 'Inicie as legendas para ver as frases confirmadas aqui.'}
                    </p>
                  </div>
                )}
              </div>
              <div className="export-bar">
                <span>
                  {selected.length} trechos confirmados{query ? ` · ${filtered.length} encontrados` : ''}
                </span>
                <button
                  className="secondary-button"
                  disabled={!desktop || !selected.length}
                  onClick={() => void attempt(() => window.ktalk?.copy(sessionId), 'Transcrição copiada.')}
                >
                  <Copy size={15} />
                  Copiar
                </button>
                <button
                  className="secondary-button"
                  disabled={!desktop || !srtAvailable || exporting}
                  title="Selecione uma única sessão para exportar SRT"
                  onClick={() => void exportFile('srt')}
                >
                  <Subtitles size={15} />
                  SRT
                </button>
                <button
                  className="primary-button"
                  disabled={!desktop || !selected.length || exporting}
                  onClick={() => void exportFile('txt')}
                >
                  <ArrowDownToLine size={15} />
                  Exportar TXT
                </button>
              </div>
            </section>
            <p className="history-note">
              <LockKeyhole size={14} />
              {state.preferences.saveHistory
                ? `Histórico local ativado · até ${state.preferences.retentionDays} dias. `
                : 'Histórico apenas nesta execução. Ative o salvamento nas configurações para guardar suas sessões. '}
              A exportação inclui todos os trechos da sessão escolhida.
            </p>
          </>
        )}
        {page === 'settings' && (
          <>
            <div className="page-heading">
              <div>
                <h1>Legendas do seu jeito.</h1>
                <p>Ajuste a leitura, a detecção de voz e o ritmo das atualizações.</p>
              </div>
            </div>
            <div className="settings-grid">
              <section className="settings-card">
                <div className="section-title">
                  <h2>
                    <MonitorUp size={19} />
                    Legenda flutuante
                  </h2>
                  <Toggle
                    label="Ativar janela flutuante"
                    value={state.preferences.overlay}
                    onChange={() => update({ overlay: !state.preferences.overlay })}
                  />
                </div>
                <div className="mini-preview">
                  <div style={{ background: `rgba(15, 28, 27, ${state.preferences.opacity / 100})` }}>
                    <span>EN → PT-BR</span>
                    <p style={{ fontSize: state.preferences.fontSize * 0.7 }}>
                      Toda voz merece ser compreendida.
                    </p>
                  </div>
                </div>
                <label className="range-field">
                  <span>
                    Tamanho do texto <b>{state.preferences.fontSize} px</b>
                  </span>
                  <input
                    aria-label="Tamanho do texto"
                    type="range"
                    min="22"
                    max="44"
                    value={state.preferences.fontSize}
                    onChange={(event) => update({ fontSize: Number(event.target.value) })}
                  />
                </label>
                <label className="range-field">
                  <span>
                    Opacidade do fundo <b>{state.preferences.opacity}%</b>
                  </span>
                  <input
                    aria-label="Opacidade do fundo"
                    type="range"
                    min="40"
                    max="95"
                    value={state.preferences.opacity}
                    onChange={(event) => update({ opacity: Number(event.target.value) })}
                  />
                </label>
                <div className="two-fields">
                  <label className="field">
                    <span>Posição na tela</span>
                    <select
                      aria-label="Posição na tela"
                      value={state.preferences.position}
                      onChange={(event) =>
                        update({ position: event.target.value as Preferences['position'] })
                      }
                    >
                      <option value="bottom">Inferior</option>
                      <option value="center">Centro</option>
                      <option value="top">Superior</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Tempo visível após a fala</span>
                    <select
                      aria-label="Tempo visível"
                      value={state.preferences.captionSeconds}
                      onChange={(event) => update({ captionSeconds: Number(event.target.value) })}
                    >
                      <option value="5">5 segundos</option>
                      <option value="8">8 segundos</option>
                      <option value="12">12 segundos</option>
                    </select>
                  </label>
                </div>
                <button
                  className="secondary-button full-width"
                  disabled={!desktop}
                  onClick={() => void attempt(() => window.ktalk?.preview())}
                >
                  <MonitorUp size={16} />
                  Testar legenda flutuante
                </button>
                <p className="muted">Usa o monitor da janela do KTalk. Não bloqueia cliques.</p>
              </section>
              <section className="settings-card">
                <div className="section-title">
                  <h2>
                    <Settings2 size={19} />
                    Detecção e resposta
                  </h2>
                </div>
                {busy && <p className="muted">Pare a sessão para alterar estes ajustes.</p>}
                <label className="field">
                  <span>Filtro de voz neural</span>
                  <select
                    aria-label="Filtro de voz neural"
                    disabled={busy}
                    value={state.preferences.vad_mode}
                    onChange={(event) => update({ vad_mode: Number(event.target.value) })}
                  >
                    <option value="0">Sensível · fala baixa</option>
                    <option value="1">Equilibrado · recomendado</option>
                    <option value="2">Seletivo · ruído moderado</option>
                    <option value="3">Rigoroso · pode omitir voz baixa</option>
                  </select>
                </label>
                <label className="field">
                  <span>Intervalo das atualizações</span>
                  <select
                    aria-label="Intervalo das atualizações"
                    disabled={busy}
                    value={state.preferences.partial_interval}
                    onChange={(event) => update({ partial_interval: Number(event.target.value) })}
                  >
                    <option value="0.6">600 ms · resposta rápida</option>
                    <option value="0.9">900 ms · menos uso de CPU</option>
                    <option value="1.2">1,2 s · computador ocupado</option>
                  </select>
                </label>
                <label className="field">
                  <span>Contexto máximo por frase</span>
                  <select
                    aria-label="Contexto máximo"
                    disabled={busy}
                    value={state.preferences.max_seconds}
                    onChange={(event) => update({ max_seconds: Number(event.target.value) })}
                  >
                    <option value="2.4">2,4 s · frases curtas</option>
                    <option value="4.8">4,8 s · contexto médio</option>
                    <option value="7.2">7,2 s · mais contexto</option>
                  </select>
                </label>
                <div className="setting-info">
                  <Zap size={18} />
                  <p>
                    O contexto não é um tempo de espera. Você vê versões parciais durante a fala; após cerca
                    de 300 ms de pausa, o trecho é confirmado.
                  </p>
                </div>
                <div className="setting-info">
                  <ShieldCheck size={18} />
                  <p>
                    Detecção neural, limites de geração e filtro de repetição reduzem legendas inventadas.
                    Ruído, música com vocais e falas sobrepostas ainda podem causar erros.
                  </p>
                </div>
                <p className="muted">
                  A tradução aceita fala em inglês e usa o destino PT-BR do modelo local. Para outros idiomas,
                  use Só transcrever.
                </p>
              </section>
              <LibrarySettings state={state} update={update} attempt={attempt} />
            </div>
          </>
        )}
      </main>
      <footer className="app-footer">
        <span>
          <i className={state.connected ? 'connected' : ''} />
          {desktop
            ? state.connected
              ? 'Motor local conectado'
              : 'Motor local desconectado'
            : 'Prévia no navegador'}
        </span>
        <span>Silero VAD · {translate ? 'EN → PT-BR · ' : ''}Áudio não enviado à nuvem</span>
        <span>
          <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Espaço</kbd>
          <span className="shortcut-label"> iniciar / parar</span>
        </span>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button aria-label="Fechar aviso" onClick={() => setToast('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {help && <Help onClose={() => setHelp(false)} />}
    </div>
  );
}
