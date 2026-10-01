const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Backend } = require('../electron/backend.cjs');

test(
  'Shutdown reports an interrupted session when the child exits with an error',
  { timeout: 10000 },
  async () => {
    const backend = new Backend({
      command: process.execPath,
      args: [path.join(__dirname, 'fixtures/backend.cjs')],
      cwd: __dirname,
      env: { ...process.env, KTALK_TEST_SHUTDOWN_FAILURE: '1' },
      onEvent: () => {},
      onExit: () => {},
    });
    try {
      await backend.ensure();
      assert.equal(await backend.shutdown(), false);
    } finally {
      await backend.shutdown(500);
    }
  },
);

test(
  'Backend shares startup, parses split messages and drains the last caption on shutdown',
  { timeout: 10000 },
  async () => {
    const events = [];
    const backend = new Backend({
      command: process.execPath,
      args: [path.join(__dirname, 'fixtures/backend.cjs')],
      cwd: __dirname,
      env: process.env,
      onEvent: (event) => events.push(event),
      onExit: () => {},
    });
    try {
      const first = backend.ensure();
      assert.equal(backend.ensure(), first);
      await first;
      assert.equal(events[0].type, 'ready');
      assert.equal(await backend.shutdown(), true);
      assert.equal(events.at(-1).text, 'Finalizada');
      assert.equal(backend.child, null);
    } finally {
      await backend.shutdown(500);
    }
  },
);

test('Unexpected child exit clears startup state and allows reconnection', { timeout: 10000 }, async () => {
  let exited;
  const exit = new Promise((resolve) => {
    exited = resolve;
  });
  const backend = new Backend({
    command: process.execPath,
    args: [path.join(__dirname, 'fixtures/backend.cjs')],
    cwd: __dirname,
    env: process.env,
    onEvent: () => {},
    onExit: (code, expected) => exited({ code, expected }),
  });
  try {
    await backend.ensure();
    backend.send({ type: 'crash' });
    assert.deepEqual(await exit, { code: 7, expected: false });
    await backend.ensure();
    assert.ok(backend.child);
  } finally {
    await backend.shutdown(500);
  }
});
