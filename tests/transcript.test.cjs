const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settings, defaults, timecode, exportTranscript } = require('../electron/shared.cjs');

const sessions = [{ id: 'a', started_at: '2026-09-29T12:00:00Z', source: 'both' }, { id: 'b', started_at: '2026-09-29T13:00:00Z', source: 'system' }];
const captions = [
  { session_id: 'a', source: 'microphone', start: 3, end: 4.51, language: 'pt', text: 'Olá, reunião.' },
  { session_id: 'a', source: 'system', start: 1.01, end: 2.6, language: 'en', text: 'Good morning.' },
  { session_id: 'b', source: 'system', start: 0, end: 2, language: 'pt', text: 'Outra sessão.' },
];

test('Settings reject unexpected device IDs, paths, invalid enum and numeric values', () => {
  assert.deepEqual(settings({}), defaults);
  for (const value of [{ model: '../../other' }, { system: -2 }, { microphone: '1' }, { opacity: NaN }, { fontSize: 100 }, { overlay: 'true' }, { max_seconds: 60 }]) {
    assert.throws(() => settings(value));
  }
  assert.deepEqual(settings({ unknown: 'ignored' }), defaults);
});

test('SRT sorts independent sources by captured time and preserves milliseconds', () => {
  const text = exportTranscript(captions, sessions, 'srt', 'a');
  assert.match(text, /^1\n00:00:01,010 --> 00:00:02,600\n\[Sistema\] Good morning\./);
  assert.match(text, /2\n00:00:03,000 --> 00:00:04,510\n\[Microfone\] Olá, reunião\./);
  assert.doesNotMatch(text, /Outra sessão/);
});

test('SRT cannot silently combine timelines from different sessions', () => {
  assert.throws(() => exportTranscript(captions, sessions, 'srt'), /única sessão/);
  assert.throws(() => exportTranscript([], sessions, 'txt'), /Não há/);
});

test('TXT keeps session headers, accents and source labels', () => {
  const text = exportTranscript(captions, sessions, 'txt');
  assert.match(text, /Sessão: 2026-09-29T12:00:00Z \| Sistema \+ microfone/);
  assert.match(text, /\[00:00:03\] Microfone \(pt\): Olá, reunião\./);
  assert.ok(text.indexOf('Good morning.') < text.indexOf('Olá, reunião.'));
  assert.match(text, /Outra sessão/);
});

test('Timecode rounds and carries milliseconds correctly', () => {
  assert.equal(timecode(59.9996, true), '00:01:00,000');
  assert.equal(timecode(3661.075, true), '01:01:01,075');
  assert.equal(timecode(-1, true), '00:00:00,000');
});

test('Exports use confirmed PT-BR text and TXT retains its English original', () => {
  const translated = [
    { ...captions[0], text: 'Bom', final: false },
    { ...captions[0], text: 'Bom dia.', original_text: 'Good morning.', language: 'en', target_language: 'pt-BR', final: true },
  ];
  const txt = exportTranscript(translated, sessions, 'txt', 'a');
  assert.match(txt, /\(pt-BR\): Bom dia\./);
  assert.match(txt, /Original \(en\): Good morning\./);
  const srt = exportTranscript(translated, sessions, 'srt', 'a');
  assert.match(srt, /Bom dia\./);
  assert.doesNotMatch(srt, /Good morning|\n2\n/);
});
