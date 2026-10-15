const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Backend } = require('../electron/backend.cjs');

function fixtureBackend(overrides = {}) {
  return new Backend({
    command: process.execPath,
    args: [path.join(__dirname, 'fixtures/backend.cjs')],
    cwd: __dirname,
    env: process.env,
    onEvent: () => {},
    onExit: () => {},
    ...overrides,
  });
}

test(
  'Malformed protocol lines cannot crash the host or prevent subsequent events',
  { timeout: 10000 },
  async () => {
    const events = [];
    let pong;
    const replied = new Promise((resolve) => {
      pong = resolve;
    });
    const backend = fixtureBackend({
      onEvent: (event) => {
        events.push(event);
        if (event.type === 'pong') pong();
      },
    });
    try {
      await backend.ensure();
      backend.send({ type: 'malformed' });
      await replied;
      assert.deepEqual(
        events.map((event) => event.type),
        ['ready', 'pong'],
      );
    } finally {
      await backend.shutdown(500);
    }
  },
);

test('Concurrent stop requests share one shutdown and only drain once', { timeout: 10000 }, async () => {
  const events = [];
  const backend = fixtureBackend({ onEvent: (event) => events.push(event) });
  try {
    await backend.ensure();
    const first = backend.shutdown();
    assert.equal(backend.shutdown(), first);
    assert.equal(await first, true);
    assert.equal(events.filter((event) => event.type === 'caption').length, 1);
  } finally {
    await backend.shutdown(500);
  }
});

test(
  'A blocked preparation is terminated and reconnect waits for a fresh process',
  { timeout: 10000 },
  async () => {
    const exits = [];
    const backend = fixtureBackend({
      env: { ...process.env, KTALK_TEST_HANG: '1' },
      onExit: (code, expected) => exits.push({ code, expected }),
    });
    try {
      await backend.ensure();
      const previous = backend.child;
      const stopping = backend.shutdown(60);
      const restarting = backend.ensure();
      assert.equal(await stopping, false);
      await restarting;
      assert.notEqual(backend.child, previous);
      assert.equal(exits.length, 1);
      assert.equal(exits[0].expected, true);
    } finally {
      await backend.shutdown(60);
    }
  },
);

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
