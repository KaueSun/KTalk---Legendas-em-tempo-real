const fs = require('node:fs');
const path = require('node:path');

function atomicWrite(filename, value) {
  const temporary = `${filename}.tmp`;
  const fd = fs.openSync(temporary, 'w', 0o600);
  try {
    fs.writeFileSync(fd, value);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(temporary, filename);
}

function retainedHistory(value, days, now = Date.now()) {
  if (!value || !Array.isArray(value.sessions) || !Array.isArray(value.captions))
    throw new Error('Histórico inválido.');
  const cutoff = now - days * 86400000;
  const sessions = value.sessions
    .filter(
      (session) =>
        typeof session.id === 'string' &&
        typeof session.started_at === 'string' &&
        Date.parse(session.started_at) >= cutoff &&
        ['system', 'microphone', 'both'].includes(session.source),
    )
    .slice(-2000);
  const ids = new Set(sessions.map((session) => session.id));
  const seen = new Set();
  const captions = value.captions
    .filter((caption) => {
      if (
        !caption ||
        caption.final !== true ||
        typeof caption.id !== 'string' ||
        seen.has(caption.id) ||
        !ids.has(caption.session_id) ||
        !['system', 'microphone'].includes(caption.source) ||
        typeof caption.text !== 'string' ||
        caption.text.length > 10000 ||
        !Number.isFinite(caption.start) ||
        !Number.isFinite(caption.end)
      )
        return false;
      seen.add(caption.id);
      return true;
    })
    .slice(-2000);
  const used = new Set(captions.map((caption) => caption.session_id));
  return { version: 1, sessions: sessions.filter((session) => used.has(session.id)), captions };
}

class HistoryStore {
  constructor(directory, crypto) {
    this.filename = path.join(directory, 'history.encrypted');
    this.crypto = crypto;
  }

  read(days) {
    if (!fs.existsSync(this.filename)) return { sessions: [], captions: [] };
    if (fs.statSync(this.filename).size > 32 * 1024 * 1024)
      throw new Error('O histórico excede o limite de leitura.');
    if (!this.crypto.isEncryptionAvailable())
      throw new Error('A proteção do histórico não está disponível nesta conta do Windows.');
    const value = JSON.parse(this.crypto.decryptString(fs.readFileSync(this.filename)));
    if (value.version !== 1) throw new Error('O histórico pertence a uma versão incompatível.');
    return retainedHistory(value, days);
  }

  write(state, days) {
    if (!this.crypto.isEncryptionAvailable())
      throw new Error('Não foi possível proteger o histórico. Nenhuma transcrição foi gravada.');
    atomicWrite(this.filename, this.crypto.encryptString(JSON.stringify(retainedHistory(state, days))));
  }

  clear() {
    // Only application-owned history files; never recursively remove user data.
    for (const filename of [this.filename, `${this.filename}.tmp`]) {
      try {
        fs.unlinkSync(filename);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
}

module.exports = { atomicWrite, retainedHistory, HistoryStore };
