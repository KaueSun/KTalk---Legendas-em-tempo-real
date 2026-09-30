export type Source = 'system' | 'microphone' | 'both';
export type Status = 'idle' | 'preparing' | 'listening' | 'monitoring' | 'stopping';
export interface Preferences {
  source: Source; language: string; model: 'tiny' | 'base' | 'small';
  mode: 'translate' | 'caption'; partial_interval: number; mic_gain: number;
  microphone: number | null; system: number | null; vad_mode: number; max_seconds: number;
  overlay: boolean; fontSize: number; opacity: number; position: 'top' | 'center' | 'bottom'; captionSeconds: number;
}
export interface Device { id: number; name: string; source: Exclude<Source, 'both'>; default: boolean }
export interface Caption {
  id: string; session_id: string; source: Exclude<Source, 'both'>; text: string; language: string;
  start: number; end: number; created_at: string; processing_ms: number;
  original_text?: string; target_language?: string; final: boolean; revision: number;
  translation_ms?: number; latency_ms?: number;
}
export interface Session { id: string; started_at: string; source: Source }
export interface Level { source: string; level: number; speech: boolean; dbfs?: number; probability?: number; clipping?: boolean }
export interface SourceInfo { source: string; name: string; sample_rate: number }
export interface Snapshot {
  status: Status; connected: boolean; message: string; preferences: Preferences;
  devices: Device[]; captions: Caption[]; sessions: Session[]; lastCaption: Caption | null;
  error: string | null; warning: string | null; levels: Record<string, Level>;
  partials: Record<string, Caption>; sourceInfo: Record<string, SourceInfo>;
}
export type EngineEvent =
  | { type: 'status'; status: Status; message: string }
  | { type: 'connection'; connected: boolean }
  | { type: 'devices'; devices: Device[] }
  | ({ type: 'session' } & Session)
  | ({ type: 'caption' } & Caption)
  | ({ type: 'level' } & Level)
  | ({ type: 'source-ready' } & SourceInfo)
  | { type: 'caption-retracted'; id: string }
  | { type: 'error' | 'warning'; message: string }
  | { type: 'preferences'; preferences: Preferences }
  | { type: 'cleared' | 'notice-reset' }
  | { type: 'overlay-caption'; caption: Pick<Caption, 'text' | 'source'> & Partial<Caption>; preview: boolean };
export interface KTalkApi {
  snapshot(): Promise<Snapshot>;
  start(settings: Preferences): Promise<void>;
  monitor(settings: Preferences): Promise<void>;
  stop(): Promise<void>;
  devices(): Promise<void>;
  preferences(settings: Preferences): Promise<Preferences>;
  export(format: 'txt' | 'srt', sessionId: string | null): Promise<boolean>;
  copy(sessionId: string | null): Promise<void>;
  clear(): Promise<boolean>;
  preview(): Promise<void>;
  onEvent(callback: (event: EngineEvent) => void): () => void;
}
declare global { interface Window { ktalk?: KTalkApi } }
