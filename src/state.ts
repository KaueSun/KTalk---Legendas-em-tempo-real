import type { EngineEvent, Snapshot } from './types';

export const initial: Snapshot = {
  status: 'idle', connected: false, message: 'Conectando ao motor local…', devices: [],
  preferences: { source: 'system', language: 'en', model: 'tiny', mode: 'translate', partial_interval: 0.6, mic_gain: 1, microphone: null, system: null,
    vad_mode: 1, max_seconds: 7.2, overlay: true, fontSize: 30, opacity: 82, position: 'bottom', captionSeconds: 8 },
  captions: [], partials: {}, sourceInfo: {}, sessions: [], lastCaption: null, error: null, warning: null, levels: {},
};

export function reduceEvent(state: Snapshot, event: EngineEvent): Snapshot {
  switch (event.type) {
    case 'status': return { ...state, status: event.status, message: event.message, levels: event.status === 'idle' ? {} : state.levels, partials: event.status === 'idle' ? {} : state.partials };
    case 'connection': return { ...state, connected: event.connected };
    case 'devices': return { ...state, devices: event.devices };
    case 'session': {
      const retained = new Set(state.captions.map(caption => caption.session_id));
      const sessions = [...state.sessions, event];
      return { ...state, sessions: sessions.filter((session, index) => retained.has(session.id) || index >= sessions.length - 200), partials: {}, lastCaption: null };
    }
    case 'caption': {
      const previous = state.partials[event.id] || state.captions.find(caption => caption.id === event.id);
      if (previous && (previous.revision >= event.revision || (previous.final && !event.final))) return state;
      const partials = { ...state.partials };
      if (event.final) delete partials[event.id]; else partials[event.id] = event;
      const captions = event.final ? [...state.captions.filter(caption => caption.id !== event.id), event].slice(-2000) : state.captions;
      return { ...state, partials, captions, lastCaption: event };
    }
    case 'caption-retracted': {
      const partials = { ...state.partials };
      delete partials[event.id];
      return { ...state, partials, lastCaption: state.lastCaption?.id === event.id ? null : state.lastCaption };
    }
    case 'source-ready': return { ...state, sourceInfo: { ...state.sourceInfo, [event.source]: event } };
    case 'level': return { ...state, levels: { ...state.levels, [event.source]: event } };
    case 'error': return { ...state, error: event.message };
    case 'warning': return { ...state, warning: event.message };
    case 'preferences': return { ...state, preferences: event.preferences };
    case 'cleared': return { ...state, captions: [], partials: {}, sessions: [], lastCaption: null };
    case 'notice-reset': return { ...state, error: null, warning: null, partials: {}, sourceInfo: {}, levels: {}, lastCaption: null };
    default: return state;
  }
}

export const sourceNames = { system: 'Sistema', microphone: 'Microfone', both: 'Sistema + microfone' };
export const languages: Record<string, string> = { auto: 'Detectar automaticamente', pt: 'Português', en: 'Inglês', es: 'Espanhol', fr: 'Francês', de: 'Alemão', it: 'Italiano', ja: 'Japonês', ko: 'Coreano', zh: 'Chinês' };
export function clock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}
