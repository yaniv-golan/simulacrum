import { waitUntil } from '../scripts/wait-until.mjs';
import { IDBFactory } from 'fake-indexeddb';
import { mountRemotePlaytest as mountLegacyCapture } from './fixtures/legacy-capture-client.mjs';
import { openCaptureOutbox } from '../src/application/capture-outbox.mjs';
import { captureDigest } from '../src/application/capture-outbox.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mountRemotePlaytest } from '../src/application/remote-playtest.mjs';

const settle = async () => {
  for (let i = 0; i < 60; i++) await new Promise((resolve) => setImmediate(resolve));
};
async function fixture(t, options = {}) {
  const names = [
    'document',
    'window',
    'location',
    'navigator',
    'indexedDB',
    'MediaRecorder',
    'Blob',
    'setInterval',
    'clearInterval',
    'setTimeout',
  ];
  const originals = new Map(
    names.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const originalError = console.error;
  const originalTimeout = setTimeout;
  const nodes = [],
    intervals = new Map(),
    listeners = new Map(),
    rows = [],
    tracks = [],
    recorders = [],
    uploads = [];
  let intervalId = 0,
    nextId = 1,
    dbClosed = false,
    contextCalls = 0,
    huge = false,
    mount;
  const mode = { ...options };
  class Element {
    constructor(tag) {
      this.tag = tag;
      this.children = new Map();
      const classes = new Set();
      this.classList = {
        toggle(name, force) {
          const present = force ?? !classes.has(name);
          if (present) classes.add(name);
          else classes.delete(name);
          return present;
        },
      };
      this.open = false;
      this.removed = false;
      nodes.push(this);
    }
    querySelector(key) {
      if (!this.children.has(key)) this.children.set(key, new Element(key));
      return this.children.get(key);
    }
    append(...items) {
      (this.appended ??= []).push(...items);
    }
    replaceChildren(...children) {
      this.options = children;
      this.value = children[0]?.value || '';
    }
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
    }
    remove() {
      this.removed = true;
    }
    setAttribute(key, value) {
      this[key] = value;
    }
    removeAttribute(key) {
      delete this[key];
    }
    focus() {}
    click() {
      return this.onclick?.();
    }
    addEventListener() {}
    removeEventListener() {}
    pause() {}
    async play() {
      if (mode.failure === 'play') throw Error('video play failed');
    }
  }
  const track = () => {
    const t = {
      readyState: 'live',
      getSettings: () => ({ displaySurface: 'browser' }),
      stop() {
        this.readyState = 'ended';
        this.stops = (this.stops ?? 0) + 1;
      },
    };
    tracks.push(t);
    return t;
  };
  const stream = () => {
    const t = track();
    return { getVideoTracks: () => [t], getTracks: () => [t] };
  };
  const factory = new IDBFactory();
  const originalOpen = factory.open.bind(factory);
  factory.open = (...args) => {
    const r = originalOpen(...args);
    r.addEventListener('success', () => {
      const db = r.result,
        close = db.close.bind(db),
        transaction = db.transaction.bind(db);
      db.close = () => {
        if (args[0] === 'simulacrum-playtest-outbox-v2') dbClosed = true;
        close();
      };
      db.transaction = (...args) => {
        const tx = transaction(...args),
          objectStore = tx.objectStore.bind(tx);
        tx.objectStore = (name) => {
          const store = objectStore(name);
          if (name === 'items' && args[1] === 'readwrite') {
            for (const method of ['put', 'clear']) {
              const original = store[method].bind(store);
              store[method] = (...values) => {
                const request = original(...values);
                request.addEventListener('success', () => {
                  const all = store.getAll();
                  all.addEventListener('success', () => {
                    rows.splice(0, rows.length, ...all.result);
                  });
                });
                return request;
              };
            }
          }
          return store;
        };
        return tx;
      };
    });
    return r;
  };
  const values = {
    document: {
      body: new Element('body'),
      createElement: (tag) => new Element(tag),
      querySelector: () => ({ content: 'test-build' }),
    },
    window: {
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
    },
    location: { origin: 'http://localhost' },
    navigator: {
      userAgent: 'fixture-browser',
      locks: {
        async request(name, options, callback) {
          return callback({ name });
        },
      },
      mediaDevices: {
        async getDisplayMedia() {
          const result = stream();
          if (mode.waitForDisplay) await mode.waitForDisplay;
          return result;
        },
      },
    },
    indexedDB: factory,
    setTimeout(fn, delay, ...args) {
      return originalTimeout(fn, delay === 1000 ? 0 : delay, ...args);
    },
    setInterval(fn) {
      intervals.set(++intervalId, fn);
      return intervalId;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    MediaRecorder: class {
      static isTypeSupported() {
        return true;
      }
      constructor(stream) {
        if (mode.failure === 'constructor') throw Error('recorder constructor failed');
        this.stream = stream;
        this.state = 'inactive';
        recorders.push(this);
      }
      start() {
        if (mode.failure === 'recorder-start') throw Error('recorder start failed');
        this.state = 'recording';
      }
      stop() {
        this.state = 'inactive';
        if (!mode.delayFlush) setImmediate(() => this.flush());
      }
      flush() {
        this.ondataavailable?.({ data: new Blob(['final-media'], { type: 'video/webm' }) });
        this.onstop?.();
      }
    },
    Blob: class extends Blob {
      constructor(...args) {
        super(...args);
        if (huge) Object.defineProperty(this, 'size', { value: 101 * 1024 * 1024 });
      }
    },
  };
  for (const [key, value] of Object.entries(values))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/config')) {
      if (mode.configUnavailable) throw TypeError('offline');
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ enabled: true, protocolVersion: 2, optionalVideo: true }),
      };
    }
    if (url.endsWith('/session')) {
      if (mode.failure === 'network') throw new TypeError('Failed to fetch');
      if (mode.waitForSession) await mode.waitForSession;
      return {
        ok: mode.failure !== 'http',
        json: async () => {
          if (mode.failure === 'json') throw SyntaxError('bad JSON');
          const start = JSON.parse(init.body);
          return {
            sessionId: 'a'.repeat(32),
            protocolVersion: 2,
            requestId: start.requestId,
            requestHash: await captureDigest(new TextEncoder().encode(init.body)),
          };
        },
      };
    }
    uploads.push({ url, body: init.body });
    return { ok: false, status: 503 };
  });
  t.after(async () => {
    huge = false;
    mount?.dispose();
    for (const recorder of recorders) if (recorder.state !== 'inactive') recorder.stop();
    for (const recorder of recorders) recorder.flush();
    await settle();
    console.error = originalError;
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const toolbarHost = options.toolbarHost ? new Element('workshop') : undefined;
  mount = await (options.mount || mountRemotePlaytest)({
    ...(toolbarHost ? { toolbarHost } : {}),
    feedbackSnapshot: () => ({ project: {}, workshop: {} }),
    context: () => {
      if (++contextCalls > 30) throw Error('recursive finalization guard');
      return {};
    },
    checkpoint: () => ({}),
    measureVideoDuration: async () => null,
  });
  await settle();
  return {
    mount,
    toolbarHost,
    mode,
    rows,
    tracks,
    recorders,
    uploads,
    nodes,
    intervals,
    listeners,
    originalError,
    start: () => {
      const video = nodes
        .find((n) => n.children.has('[data-start]'))
        ?.querySelector('[data-video]');
      if (video) video.checked = true;
      return nodes.find((n) => n.tag === '[data-start]').onclick();
    },
    finish: () => nodes.find((n) => n.tag === '[data-end]').onclick(),
    huge: (value) => {
      huge = value;
    },
    calls: () => contextCalls,
    closed: () => dbClosed,
  };
}

test('failed screen startup releases every acquired track and stays inactive', async (t) => {
  for (const failure of ['http', 'network', 'json', 'play', 'constructor', 'recorder-start'])
    await t.test(failure, async (t) => {
      const f = await fixture(t, { failure });
      await f.start();
      await settle();
      assert.equal(f.tracks.length, 1);
      assert.equal(f.tracks[0].readyState, 'ended');
      assert.equal(f.mount.active(), false);
      assert.equal(f.recorders.filter((r) => r.state === 'recording').length, 0);
    });
});

test('outbox limit stops once even when the final event cannot fit', async (t) => {
  const f = await fixture(t);
  await f.start();
  await settle();
  assert.equal(f.mount.active(), true);
  assert.equal(f.calls(), 3, 'admission, session and initial screen segment sample context');
  const initialCalls = f.calls();
  f.huge(true);
  f.mount.emit('over-limit', {});
  // IndexedDB and the packet timer may need more than a fixed number of turns.
  await waitUntil(() => !f.mount.active(), 'recording stop after outbox limit');
  f.huge(false);
  assert.equal(f.mount.active(), false);
  assert.ok(
    f.calls() <= initialCalls + 2,
    'one rejected event and at most one segment-finalization sample',
  );
  assert.equal(
    f.tracks.every((track) => track.readyState === 'ended'),
    true,
  );
  assert.match(
    f.nodes.find((n) => n.tag === '[data-completion-status]').textContent,
    /not fully saved/i,
  );
});

test('dispose removes mount resources and closes storage after final media is persisted', async (t) => {
  const f = await fixture(t, { delayFlush: true });
  await f.start();
  await settle();
  f.mount.dispose();
  assert.equal(f.mount.active(), false);
  assert.equal(f.intervals.size, 0);
  assert.equal(
    [...f.listeners.values()].reduce((n, set) => n + set.size, 0),
    0,
  );
  assert.equal(console.error, f.originalError);
  assert.ok(f.nodes.filter((n) => ['section', 'dialog'].includes(n.tag)).every((n) => n.removed));
  assert.equal(f.closed(), false, 'final recorder data may still need a transaction');
  f.recorders[0].flush();
  await waitUntil(() => f.closed(), 'storage close after final recorder flush');
  assert.ok(f.rows.some((row) => row.url.includes('/media?')));
  assert.equal(f.closed(), true);
});

test('dispose during startup prevents a late session from starting', async (t) => {
  for (const stage of ['waitForDisplay', 'waitForSession'])
    await t.test(stage, async (t) => {
      let release;
      const deferred = new Promise((resolve) => {
        release = resolve;
      });
      const f = await fixture(t, { [stage]: deferred });
      const started = f.start();
      await settle();
      f.mount.dispose();
      release();
      await started;
      await settle();
      assert.equal(f.mount.active(), false);
      assert.equal(f.tracks[0].readyState, 'ended');
      assert.equal(f.recorders.length, 0);
    });
});

test('finish keeps durable uploads available for retry while disposal releases the mount', async (t) => {
  const f = await fixture(t);
  await f.start();
  await settle();
  f.finish();
  await waitUntil(
    () => !f.mount.active() && f.rows.some((row) => row.url.includes('/media?')),
    'finish and final media persistence',
  );
  assert.equal(f.mount.active(), false);
  assert.equal(f.intervals.size, 2, 'recording and feedback retries remain after Finish');
  assert.equal(f.closed(), false);
  assert.ok(f.rows.some((row) => row.url.includes('/media?')));
  assert.ok(
    f.nodes
      .find((n) => n.tag === '[data-completion-status]')
      .textContent.includes('Keep this tab open'),
  );
});

// Frozen pre-v2 client from a4d93f455cf499f2335f674af27027fd203128d3.
test('frozen legacy client cannot upload or acknowledge the live v2 outbox', async (t) => {
  const f = await fixture(t, { mount: mountLegacyCapture });
  const v2 = await openCaptureOutbox();
  t.after(() => v2.close());
  await v2.enqueue({
    url: `/api/playtest/v2/${'a'.repeat(32)}/event`,
    type: 'application/json',
    body: new Blob(['{"id":"isolated"}']),
  });
  for (const tick of f.intervals.values()) tick();
  await settle();
  assert.equal(f.uploads.length, 0);
  assert.equal((await v2.items())[0].outcome, 'pending');
  const legacy = await new Promise((resolve) => {
    const r = indexedDB.open('simulacrum-playtest-outbox', 1);
    r.onsuccess = () => resolve(r.result);
  });
  await new Promise((resolve, reject) => {
    const tx = legacy.transaction('items', 'readwrite');
    tx.objectStore('items').add({
      url: '/api/playtest/legacy/event',
      type: 'application/json',
      body: new Blob(['{}']),
    });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  for (const tick of f.intervals.values()) tick();
  await settle();
  assert.ok(f.uploads.some((row) => row.url === '/api/playtest/legacy/event'));
  legacy.close();
  f.mount.dispose();
  await settle();
  assert.equal((await v2.items()).length, 1);
});

test('feedback recovery occupies the supplied toolbar region without unavailable recording chrome', async (t) => {
  const f = await fixture(t, { toolbarHost: true, configUnavailable: true });
  const panel = f.nodes.find((n) => n.className === 'playtest-panel');
  assert.ok(
    f.toolbarHost.appended?.includes(panel),
    'feedback belongs to the application toolbar host',
  );
  assert.ok(!document.body.appended?.includes(panel), 'toolbar must not overlay the document body');
  assert.equal(panel.querySelector('[data-setup]').hidden, true);
  assert.equal(panel.querySelector('[data-project]').hidden, true);
  assert.equal(panel.querySelector('[data-status]').hidden, true);
  assert.equal(panel.querySelector('[data-feedback]').hidden, undefined);
  await panel.querySelector('[data-feedback]').click();
  await settle();
  assert.equal(
    f.nodes.find((n) => n.className === 'playtest-dialog feedback-dialog').open,
    true,
    'offline feedback draft remains reachable',
  );
  assert.equal(f.mount.active(), false);
});
