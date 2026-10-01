const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { HistoryStore, retainedHistory } = require('../electron/storage.cjs');

const session = { id: 'session', started_at: new Date().toISOString(), source: 'system', title: 'Reunião' };
const caption = {
  id: 'caption',
  session_id: session.id,
  final: true,
  source: 'system',
  text: 'Conteúdo privado.',
  start: 0,
  end: 1,
};

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ktalk-test-'));
  const key = crypto.randomBytes(32);
  const cipher = {
    isEncryptionAvailable: () => true,
    encryptString(text) {
      const iv = crypto.randomBytes(12);
      const encryptor = crypto.createCipheriv('aes-256-gcm', key, iv);
      const bytes = Buffer.concat([encryptor.update(text, 'utf8'), encryptor.final()]);
      return Buffer.concat([iv, encryptor.getAuthTag(), bytes]);
    },
    decryptString(bytes) {
      const decryptor = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      decryptor.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decryptor.update(bytes.subarray(28)), decryptor.final()]).toString('utf8');
    },
  };
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('ktalk-test-'));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return new HistoryStore(directory, cipher);
}

test('History survives restart, saves only finals and never writes plaintext', (t) => {
  const store = fixture(t);
  store.write({ sessions: [session], captions: [caption, { ...caption, id: 'partial', final: false }] }, 30);
  assert.equal(fs.readFileSync(store.filename).includes(Buffer.from(caption.text)), false);
  const reopened = new HistoryStore(path.dirname(store.filename), store.crypto);
  assert.deepEqual(reopened.read(30).captions, [caption]);
  assert.equal(reopened.read(30).sessions[0].title, 'Reunião');
  assert.equal(fs.existsSync(`${store.filename}.tmp`), false);
});

test('Retention removes expired sessions, duplicates and orphan captions', () => {
  const old = { ...session, id: 'old', started_at: '2020-01-01T00:00:00Z' };
  const history = retainedHistory(
    {
      sessions: [session, old],
      captions: [
        caption,
        caption,
        { ...caption, id: 'old-text', session_id: 'old' },
        { ...caption, id: 'orphan', session_id: 'missing' },
      ],
    },
    7,
  );
  assert.deepEqual(history.sessions, [session]);
  assert.deepEqual(history.captions, [caption]);
});

test('Corrupt encrypted history fails visibly without overwriting the file', (t) => {
  const store = fixture(t);
  store.write({ sessions: [session], captions: [caption] }, 30);
  const bytes = fs.readFileSync(store.filename);
  bytes[30] ^= 1;
  fs.writeFileSync(store.filename, bytes);
  assert.throws(() => store.read(30));
  assert.deepEqual(fs.readFileSync(store.filename), bytes);
});

test('Unavailable encryption never falls back to plaintext; clearing removes saved history', (t) => {
  const store = fixture(t);
  store.crypto.isEncryptionAvailable = () => false;
  assert.throws(() => store.write({ sessions: [session], captions: [caption] }, 30));
  assert.equal(fs.existsSync(store.filename), false);
  store.crypto.isEncryptionAvailable = () => true;
  store.write({ sessions: [session], captions: [caption] }, 30);
  store.clear();
  assert.equal(fs.existsSync(store.filename), false);
});
