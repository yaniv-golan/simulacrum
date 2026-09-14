import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { mountFeedbackClient } from '../src/application/feedback-client.mjs';
import { openFeedbackStore } from '../src/application/feedback-store.mjs';
import { createFeedbackCaptureGate } from '../src/application/feedback-capture-gate.mjs';

const settle = async () => {
  for (let i = 0; i < 40; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** Minimal DOM: selectors auto-create children; checkbox stubs record every `checked` write. */
function stubDom() {
  const checkboxHistory = { image: [], context: [] };
  const created = new Set();
  class Element {
    constructor(tag) {
      created.add(this);
      this.tag = tag;
      this.children = new Map();
      this.classList = { toggle() {}, add() {}, remove() {} };
      this.style = {};
      this.dataset = {};
      this.open = false;
      this.hidden = false;
      this.textContent = '';
      const kind = /\[data-(image|context)\]/.exec(tag)?.[1];
      if (kind) {
        let value = false;
        Object.defineProperty(this, 'checked', {
          get: () => value,
          set: (next) => {
            value = !!next;
            checkboxHistory[kind].push(value);
          },
        });
      }
    }
    querySelector(key) {
      if (!this.children.has(key)) this.children.set(key, new Element(key));
      return this.children.get(key);
    }
    querySelectorAll() {
      return [];
    }
    append() {}
    prepend() {}
    replaceChildren() {}
    setAttribute(key, value) {
      this[key] = value;
    }
    removeAttribute(key) {
      delete this[key];
    }
    getAttribute(key) {
      return this[key];
    }
    addEventListener() {}
    removeEventListener() {}
    showModal() {
      this.open = true;
    }
    close() {
      this.open = false;
    }
    focus() {}
    blur() {}
    pause() {}
    remove() {}
    checkVisibility() {
      return true;
    }
  }
  return {
    Element,
    checkboxHistory,
    created,
    globals: {
      document: {
        body: new Element('body'),
        createElement: (tag) => new Element(tag),
        querySelector: () => ({ content: 'test-build' }),
        activeElement: null,
      },
      window: { addEventListener() {}, removeEventListener() {}, confirm: () => true },
      navigator: {
        userAgent: 'fixture-browser',
        locks: { request: (name, options, callback) => callback({ name }) },
      },
      indexedDB: new IDBFactory(),
    },
  };
}

/** A durable store whose saveDraft calls wait until the test releases them, in order. */
async function heldStore(options) {
  const store = await openFeedbackStore(options);
  const pending = [];
  return {
    store: {
      ...store,
      saveDraft: (draft) =>
        new Promise((resolve, reject) => {
          pending.push(() => store.saveDraft(draft).then(resolve, reject));
        }),
    },
    release: async () => {
      const next = pending.shift();
      if (!next) throw Error('no pending draft save to release');
      await next();
      await settle();
    },
    pendingCount: () => pending.length,
    inner: store,
  };
}

async function mount(t, { screenshot = () => 'data:image/png;base64,AA==' } = {}) {
  const dom = stubDom();
  const previous = Object.fromEntries(
    Object.keys(dom.globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  for (const [key, value] of Object.entries(dom.globals))
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  const held = { current: null };
  const trigger = new dom.Element('button');
  // A stub channel: a real BroadcastChannel would keep the test process alive.
  const gate = createFeedbackCaptureGate({
    channel: { postMessage() {}, addEventListener() {}, removeEventListener() {}, close() {} },
  });
  const client = await mountFeedbackClient({
    trigger,
    gate,
    snapshot: () => ({ project: { id: 'fixture' }, workshop: { ui: { mode: 'build' } } }),
    screenshot,
    openStore: async (options) => {
      held.current = await heldStore(options);
      return held.current.store;
    },
  });
  t.after(async () => {
    try {
      client.dispose();
      await settle();
      while (held.current?.pendingCount()) await held.current.release();
      await gate.close?.();
    } finally {
      for (const [key, descriptor] of Object.entries(previous))
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else delete globalThis[key];
    }
  });
  client.configure({ enabled: true, feedback: { enabled: true, protocolVersion: 1 } });
  return { client, dom, held: held.current, trigger };
}

/** Collapse consecutive duplicate writes: every render() rewrites `checked`, changed or not. */
const transitions = (history) => history.filter((value, i) => i === 0 || value !== history[i - 1]);
const status = (dom) => {
  for (const node of dom.created) if (node.tag === '[data-attachment-status]') return node;
  throw Error('no attachment status');
};
const box = (dom, kind) => {
  for (const node of dom.created) if (node.tag === `[data-${kind}]`) return node;
  throw Error(`no ${kind} checkbox`);
};
/** A click: the browser flips the box natively, then the app's onchange runs. */
const click = (node, checked) => {
  node.checked = checked;
  node.onchange({ target: { checked } });
};
async function drain(held) {
  await settle();
  while (held.pendingCount()) await held.release();
  await settle();
}
async function mountAndOpen(t, options) {
  const result = await mount(t, options);
  await result.client.open();
  await drain(result.held);
  return result;
}

test('unchecking both attachments never re-checks the second while the first save is pending', async (t) => {
  const { dom, held } = await mountAndOpen(t);
  const image = box(dom, 'image'),
    context = box(dom, 'context');
  // Attach both, letting every save through.
  click(image, true);
  await drain(held);
  click(context, true);
  await drain(held);
  assert.equal(image.checked, true);
  assert.equal(context.checked, true);
  // The race: uncheck image, then context, before the image save lands. Write order in the
  // client's queue is image text → context text → image attachment → context attachment; the
  // first release resolves image's persistText, whose render() is where the box flipped back.
  click(image, false);
  await settle();
  click(context, false);
  await settle();
  const mark = dom.checkboxHistory.context.length;
  await held.release(); // image text save → persistText render()
  await held.release(); // context text save
  await settle();
  assert.deepEqual(
    dom.checkboxHistory.context.slice(mark).filter((v) => v === true),
    [],
    'the context box must not flip back to checked while its own save is pending',
  );
  while (held.pendingCount()) await held.release();
  await settle();
  assert.equal(image.checked, false);
  assert.equal(context.checked, false);
  const draft = await held.inner.draft();
  assert.equal('image' in draft, false);
  assert.equal('context' in draft, false);
});

test('a failed attachment reverts its box to the committed draft once the intent clears', async (t) => {
  const { dom, held } = await mountAndOpen(t, { screenshot: () => null });
  const image = box(dom, 'image');
  const mark = dom.checkboxHistory.image.length;
  click(image, true);
  await drain(held);
  // click → persistText's render() shows the pending choice → the failed attach clears its
  // intent and the closing render() reverts to the committed draft.
  assert.deepEqual(
    transitions(dom.checkboxHistory.image.slice(mark)),
    [true, false],
    'shown as pending while the save runs, then reverted once the failed attach clears',
  );
  assert.ok(
    dom.checkboxHistory.image.slice(mark).filter((v) => v === true).length >= 2,
    'the pending choice survived the text save render before the failure',
  );
  assert.match(status(dom).textContent, /image unavailable/i, 'the failure is shown, not hidden');
  assert.equal(image.checked, false, 'unavailable screenshot leaves the box unchecked');
  assert.equal('image' in (await held.inner.draft()), false);
});
