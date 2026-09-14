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
      // Uploads are not under test: every submission stays queued locally.
      fetch: async () => {
        throw new TypeError('offline fixture');
      },
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

async function mount(t, { screenshot = () => 'data:image/png;base64,AA==', durable = true } = {}) {
  const dom = stubDom();
  const shots = { count: 0 };
  const countedScreenshot = () => {
    shots.count++;
    return screenshot();
  };
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
    screenshot: countedScreenshot,
    // `durable: false` forces the text-only store while Web Locks stay available for the gate.
    openStore: async (options) => {
      held.current = await heldStore({ ...options, durable: durable && options.durable });
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
  return { client, dom, held: held.current, trigger, shots };
}
const node = (dom, tag) => {
  for (const n of dom.created) if (n.tag === tag) return n;
  throw Error(`no ${tag}`);
};
/** Close through the dialog's own guarded close (the Back/× handlers share it). */
const closeDialog = async (dom) => {
  await node(dom, '[data-back]').onclick();
  await settle();
};
const type = (dom, value) => {
  const textarea = node(dom, 'textarea');
  textarea.value = value;
  textarea.oninput();
};

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

test('a fresh draft attaches the workshop image and project by default', async (t) => {
  const { dom, held, shots } = await mountAndOpen(t);
  assert.equal(box(dom, 'image').checked, true);
  assert.equal(box(dom, 'context').checked, true);
  assert.equal(node(dom, '[data-attachments]').open, true, 'the disclosure is open');
  assert.match(node(dom, '[data-attachments-summary]').textContent, /image and project attached/);
  assert.equal(shots.count, 1, 'one capture at open');
  const draft = await held.inner.draft();
  assert.equal(draft.image.dataUrl, 'data:image/png;base64,AA==');
  assert.equal(draft.context.value.project.id, 'fixture');
});

test('an untick on a draft with text is kept across close and reopen', async (t) => {
  const { dom, held, client, shots } = await mountAndOpen(t);
  type(dom, 'The wire did not connect.');
  await drain(held);
  click(box(dom, 'image'), false);
  await drain(held);
  await closeDialog(dom);
  await drain(held);
  await client.open();
  await drain(held);
  assert.equal(box(dom, 'image').checked, false, 'the untick is remembered');
  assert.equal(box(dom, 'context').checked, true, 'the default context stays');
  assert.equal(shots.count, 1, 'no recapture on reopen of an authored draft');
  assert.equal(
    node(dom, '[data-attachments]').open,
    true,
    'an attached draft shows its disclosure',
  );
});

test('a draft holding only default captures is discarded on close and recaptured on reopen', async (t) => {
  const { dom, held, client, shots } = await mountAndOpen(t);
  await closeDialog(dom);
  await drain(held);
  assert.equal(await held.inner.draft(), null, 'nothing the player wrote, nothing kept');
  assert.equal(await client.hasDraft(), false);
  await client.open();
  await drain(held);
  assert.equal(shots.count, 2, 'a fresh open captures again');
  assert.equal(box(dom, 'image').checked, true);
});

test('text-only stores attach nothing by default and keep the controls hidden', async (t) => {
  const { dom, held, shots } = await mountAndOpen(t, { durable: false });
  assert.equal(held.inner.mode, 'memory');
  assert.equal(node(dom, '[data-attachments]').hidden, true);
  assert.equal(shots.count, 0, 'no capture without a place to show it');
  const draft = await held.inner.draft();
  assert.equal('image' in draft, false);
  assert.equal('context' in draft, false);
});

test('a failed default image capture stays visible after the project capture succeeds', async (t) => {
  const { dom, held } = await mountAndOpen(t, { screenshot: () => null });
  assert.equal(box(dom, 'image').checked, false);
  assert.equal(box(dom, 'context').checked, true);
  assert.match(status(dom).textContent, /image unavailable/i, 'the image failure is not wiped');
  assert.match(node(dom, '[data-attachments-summary]').textContent, /project attached/);
  assert.equal('image' in (await held.inner.draft()), false);
});

test('Send stays disabled while an attachment save is pending', async (t) => {
  const { dom, held } = await mountAndOpen(t);
  type(dom, 'Ready to send.');
  await drain(held);
  const send = node(dom, '[data-send]');
  assert.equal(send.disabled, false, 'text present, nothing pending');
  click(box(dom, 'image'), false);
  await settle();
  assert.equal(send.disabled, true, 'a pending untick must land before the draft can freeze');
  // Plausible wrong trace: a click on Send while the untick is still saving must not freeze.
  await send.onclick();
  await settle();
  assert.equal(
    (await held.inner.items()).length,
    0,
    'nothing froze while an attachment was pending',
  );
  await drain(held);
  assert.equal(send.disabled, false);
  assert.equal('image' in (await held.inner.draft()), false);
  await send.onclick();
  await drain(held);
  const [item] = await held.inner.items();
  assert.ok(item, 'the settled draft froze into a submission');
  assert.equal('image' in item.envelope, false, 'the untick reached the envelope');
  assert.equal(item.envelope.context.value.project.id, 'fixture', 'the default context was sent');
});
