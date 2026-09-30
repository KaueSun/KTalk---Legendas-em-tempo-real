const SOURCE_NAMES = { system: 'Sistema', microphone: 'Microfone', both: 'Sistema + microfone' };
const defaults = Object.freeze({
  source: 'system', language: 'en', model: 'tiny', mode: 'translate', microphone: null, system: null,
  vad_mode: 1, max_seconds: 7.2, partial_interval: 0.6, mic_gain: 1,
  overlay: true, fontSize: 30, opacity: 82, position: 'bottom', captionSeconds: 8,
});

function settings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Configuração inválida.');
  const result = { ...defaults };
  const choices = {
    source: ['system', 'microphone', 'both'],
    language: ['auto', 'pt', 'en', 'es', 'fr', 'de', 'it', 'ja', 'ko', 'zh'],
    model: ['tiny', 'base', 'small'], vad_mode: [0, 1, 2, 3], max_seconds: [2.4, 4.8, 7.2],
    mode: ['translate', 'caption'], partial_interval: [0.6, 0.9, 1.2], mic_gain: [1, 1.5, 2, 3, 4],
    position: ['top', 'center', 'bottom'], captionSeconds: [5, 8, 12],
  };
  for (const [key, values] of Object.entries(choices)) {
    if (input[key] !== undefined) {
      if (!values.includes(input[key])) throw new Error(`Valor inválido: ${key}`);
      result[key] = input[key];
    }
  }
  for (const key of ['microphone', 'system']) {
    if (input[key] !== undefined) {
      if (input[key] !== null && (!Number.isInteger(input[key]) || input[key] < 0 || input[key] > 10000)) throw new Error('Dispositivo inválido.');
      result[key] = input[key];
    }
  }
  for (const [key, min, max] of [['fontSize', 22, 44], ['opacity', 40, 95]]) {
    if (input[key] !== undefined) {
      if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new Error(`Valor inválido: ${key}`);
      result[key] = input[key];
    }
  }
  if (input.overlay !== undefined) {
    if (typeof input.overlay !== 'boolean') throw new Error('Overlay inválida.');
    result.overlay = input.overlay;
  }
  return result;
}

function timecode(seconds, srt = false) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  const value = [h, m, s].map(value => String(value).padStart(2, '0')).join(':');
  return srt ? `${value},${String(ms % 1000).padStart(3, '0')}` : value;
}

function exportTranscript(captions, sessions, format, sessionId = null) {
  if (!['txt', 'srt'].includes(format)) throw new Error('Formato inválido.');
  const selected = captions.filter(item => item.final !== false && (!sessionId || item.session_id === sessionId));
  if (!selected.length) throw new Error('Não há legendas para exportar.');
  if (format === 'srt') {
    if (new Set(selected.map(item => item.session_id)).size !== 1) throw new Error('Selecione uma única sessão para exportar SRT.');
    return [...selected].sort((a, b) => a.start - b.start).map((item, index) =>
      `${index + 1}\n${timecode(item.start, true)} --> ${timecode(Math.max(item.end, item.start + 0.1), true)}\n[${SOURCE_NAMES[item.source]}] ${item.text}\n`
    ).join('\n');
  }
  const blocks = ['KTalk — Transcrição local', ''];
  for (const session of sessions) {
    const rows = selected.filter(item => item.session_id === session.id).sort((a, b) => a.start - b.start);
    if (!rows.length) continue;
    blocks.push(`Sessão: ${session.started_at} | ${SOURCE_NAMES[session.source]}`, ...rows.map(item =>
      `[${timecode(item.start)}] ${SOURCE_NAMES[item.source]} (${item.target_language || item.language}): ${item.text}${item.original_text && item.original_text !== item.text ? `\n  Original (${item.language}): ${item.original_text}` : ''}`), '');
  }
  return blocks.join('\n');
}

module.exports = { defaults, settings, timecode, exportTranscript };
