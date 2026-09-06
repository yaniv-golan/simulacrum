import test from 'node:test';
import assert from 'node:assert/strict';
import { mountRemotePlaytest } from '../src/application/remote-playtest.mjs';

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
async function fixture(t, options = {}) {
  const names = ['document', 'window', 'location', 'navigator', 'indexedDB', 'MediaRecorder', 'Blob', 'setInterval', 'clearInterval'];
  const originals = new Map(names.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const originalError = console.error;
  const nodes = [], intervals = new Map(), listeners = new Map(), rows = [], tracks = [], recorders = [], uploads = [];
  let intervalId = 0, nextId = 1, dbClosed = false, contextCalls = 0, huge = false, mount;
  const mode = { ...options };
  class Element {
    constructor(tag) { this.tag = tag; this.children = new Map(); this.open = false; this.removed = false; nodes.push(this); }
    querySelector(key) { if (!this.children.has(key)) this.children.set(key, new Element(key)); return this.children.get(key); }
    append() {} showModal() { this.open = true; } close() { this.open = false; } remove() { this.removed = true; }
    addEventListener() {} removeEventListener() {} pause() {}
    async play() { if (mode.failure === 'play') throw Error('video play failed'); }
  }
  const track = () => { const t = { readyState: 'live', getSettings: () => ({ displaySurface: 'browser' }), stop() { this.readyState = 'ended'; this.stops = (this.stops ?? 0) + 1; } }; tracks.push(t); return t; };
  const stream = () => { const t = track(); return { getVideoTracks: () => [t], getTracks: () => [t] }; };
  const db = { close() { dbClosed = true; }, transaction() {
    assert.equal(dbClosed, false, 'no transaction after database close');
    const tx = {}; let pending = 0, aborted = false;
    const request = operation => {
      pending++;
      const r = {};
      setImmediate(() => { if (aborted) return; try { r.result = operation(); r.onsuccess?.(); } catch (error) { tx.error = error; tx.onerror?.(); return; } finally { pending--; } setImmediate(() => { if (!pending && !aborted) tx.oncomplete?.(); }); });
      return r;
    };
    tx.abort = () => { aborted = true; setImmediate(() => tx.onabort?.()); };
    tx.objectStore = () => ({ getAll: () => request(() => [...rows]), add: value => request(() => { const id = nextId++; rows.push({ ...value, id }); return id; }), delete: id => request(() => { const index = rows.findIndex(r => r.id === id); if (index >= 0) rows.splice(index, 1); }) });
    return tx;
  } };
  const values = {
    document: { body: new Element('body'), createElement: tag => new Element(tag), querySelector: () => ({ content: 'test-build' }) },
    window: { addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(fn); }, removeEventListener(type, fn) { listeners.get(type)?.delete(fn); } },
    location: { origin: 'http://localhost' },
    navigator: { mediaDevices: { async getDisplayMedia() { const result = stream(); if (mode.waitForDisplay) await mode.waitForDisplay; return result; } } },
    indexedDB: { open() { const request = { result: db }; setImmediate(() => request.onsuccess()); return request; } },
    setInterval(fn) { intervals.set(++intervalId, fn); return intervalId; }, clearInterval(id) { intervals.delete(id); },
    MediaRecorder: class {
      static isTypeSupported() { return true; }
      constructor(stream) { if (mode.failure === 'constructor') throw Error('recorder constructor failed'); this.stream = stream; this.state = 'inactive'; recorders.push(this); }
      start() { if (mode.failure === 'recorder-start') throw Error('recorder start failed'); this.state = 'recording'; }
      stop() { this.state = 'inactive'; if (!mode.delayFlush) setImmediate(() => this.flush()); }
      flush() { this.ondataavailable?.({ data: new Blob(['final-media'], { type: 'video/webm' }) }); this.onstop?.(); }
    },
    Blob: class extends Blob { constructor(...args) { super(...args); if (huge) Object.defineProperty(this, 'size', { value: 101 * 1024 * 1024 }); } },
  };
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (url.endsWith('/config')) return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ enabled: true }) };
    if (url.endsWith('/session')) {
      if (mode.failure === 'network') throw new TypeError('Failed to fetch');
      if (mode.waitForSession) await mode.waitForSession;
      return { ok: mode.failure !== 'http', json: async () => { if (mode.failure === 'json') throw SyntaxError('bad JSON'); return { sessionId: 'a'.repeat(32) }; } };
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
    for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  });
  mount = await mountRemotePlaytest({ context: () => { if (++contextCalls > 30) throw Error('recursive finalization guard'); return {}; }, checkpoint: () => ({}) });
  await settle();
  return { mount, mode, rows, tracks, recorders, uploads, nodes, intervals, listeners, originalError,
    start: () => nodes.find(n => n.tag === '[data-start]').onclick(),
    finish: () => nodes.find(n => n.tag === '[data-end]').onclick(),
    huge: value => { huge = value; }, calls: () => contextCalls, closed: () => dbClosed,
  };
}

test('failed screen startup releases every acquired track and stays inactive', async t => {
  for (const failure of ['http', 'network', 'json', 'play', 'constructor', 'recorder-start']) await t.test(failure, async t => {
    const f = await fixture(t, { failure }); await f.start(); await settle();
    assert.equal(f.tracks.length, 1);
    assert.equal(f.tracks[0].readyState, 'ended');
    assert.equal(f.mount.active(), false);
    assert.equal(f.recorders.filter(r => r.state === 'recording').length, 0);
  });
});

test('outbox limit stops once even when the final event cannot fit', async t => {
  const f = await fixture(t); await f.start(); await settle();
  assert.equal(f.mount.active(), true); assert.equal(f.calls(), 1);
  f.huge(true); f.mount.emit('over-limit', {}); await settle(); f.huge(false);
  assert.equal(f.mount.active(), false);
  assert.ok(f.calls() <= 3, 'one rejected event and at most one terminal event');
  assert.equal(f.tracks.every(track => track.readyState === 'ended'), true);
  assert.match(f.nodes.find(n => n.tag === '[data-completion-status]').textContent, /not fully saved/i);
});

test('dispose removes mount resources and closes storage after final media is persisted', async t => {
  const f = await fixture(t, { delayFlush: true }); await f.start(); await settle();
  f.mount.dispose();
  assert.equal(f.mount.active(), false);
  assert.equal(f.intervals.size, 0);
  assert.equal([...f.listeners.values()].reduce((n, set) => n + set.size, 0), 0);
  assert.equal(console.error, f.originalError);
  assert.ok(f.nodes.filter(n => ['section', 'dialog'].includes(n.tag)).every(n => n.removed));
  assert.equal(f.closed(), false, 'final recorder data may still need a transaction');
  f.recorders[0].flush(); await settle();
  assert.ok(f.rows.some(row => row.url.includes('/media?')));
  assert.equal(f.closed(), true);
});

test('dispose during startup prevents a late session from starting', async t => {
  for (const stage of ['waitForDisplay', 'waitForSession']) await t.test(stage, async t => {
    let release; const deferred = new Promise(resolve => { release = resolve; });
    const f = await fixture(t, { [stage]: deferred });
    const started = f.start(); await settle(); f.mount.dispose(); release(); await started; await settle();
    assert.equal(f.mount.active(), false);
    assert.equal(f.tracks[0].readyState, 'ended');
    assert.equal(f.recorders.length, 0);
  });
});

test('finish keeps durable uploads available for retry while disposal releases the mount', async t => {
  const f = await fixture(t); await f.start(); await settle();
  f.finish(); await settle();
  assert.equal(f.mount.active(), false);
  assert.equal(f.intervals.size, 1, 'upload retry remains after Finish');
  assert.equal(f.closed(), false);
  assert.ok(f.rows.some(row => row.url.includes('/media?')));
  assert.ok(f.nodes.find(n => n.tag === '[data-completion-status]').textContent.includes('Keep this tab open'));
});
