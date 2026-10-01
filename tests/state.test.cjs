const { test } = require('node:test');
const assert = require('node:assert/strict');

test('Progressive revisions replace text, confirm once, and reject late partials', async () => {
  const { initial, reduceEvent } = await import('../src/state.ts');
  const caption = {
    type: 'caption',
    id: 'a',
    session_id: 'session',
    source: 'system',
    text: 'Bom',
    original_text: 'Good',
    target_language: 'pt-BR',
    revision: 1,
    final: false,
  };
  let state = reduceEvent(initial, caption);
  assert.equal(state.captions.length, 0);
  state = reduceEvent(state, { ...caption, text: 'Bom dia.', revision: 2 });
  assert.equal(Object.keys(state.partials).length, 1);
  assert.equal(state.lastCaption.text, 'Bom dia.');
  const final = { ...caption, text: 'Bom dia a todos.', revision: 3, final: true };
  state = reduceEvent(state, final);
  state = reduceEvent(state, final);
  state = reduceEvent(state, { ...caption, revision: 4 });
  assert.equal(state.captions.length, 1);
  assert.equal(Object.keys(state.partials).length, 0);
  assert.equal(state.lastCaption.text, 'Bom dia a todos.');
});

test('Retraction clears a rejected provisional caption without removing confirmed history', async () => {
  const { initial, reduceEvent } = await import('../src/state.ts');
  let state = reduceEvent(initial, {
    type: 'caption',
    id: 'done',
    text: 'Confirmada',
    revision: 1,
    final: true,
  });
  state = reduceEvent(state, { type: 'caption', id: 'bad', text: 'Ruído', revision: 1, final: false });
  state = reduceEvent(state, { type: 'caption-retracted', id: 'bad' });
  assert.equal(state.captions.length, 1);
  assert.equal(state.lastCaption, null);
  assert.deepEqual(state.partials, {});
});
