import test from 'node:test';
import assert from 'node:assert/strict';
import { createCameraControls } from '../src/presentation/camera-controls.mjs';
class Element {
  constructor(tag) {
    this.tag = tag;
    this._value = '';
  }
  get value() {
    return this._value;
  }
  set value(v) {
    this._value = this.tag !== 'select' || this.children.some((n) => n.value === v) ? v : '';
  }
  replaceChildren(...nodes) {
    this.children = nodes;
    this._value = nodes[0]?.value ?? '';
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
  removeAttribute() {}
  children = [];
  dataset = {};
  classList = { toggle() {} };
  append(...nodes) {
    this.children.push(...nodes);
  }
  setAttribute(key, value) {
    (this.attributes ??= {})[key] = value;
  }
  querySelectorAll() {
    return [];
  }
  remove() {}
}
test('camera refresh releases orbit only on view transitions and preserves a subsequent drag owner', () => {
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = new EventTarget();
  globalThis.document = { createElement: () => new Element() };
  let active = null,
    orbitEnabled = true;
  const transitions = [];
  const root = new Element(),
    stage = new Element();
  stage.parentElement = root;
  const ui = createCameraControls({
    root,
    stage,
    service: {
      read: () => ({
        active,
        status: 'Ready',
        gallery: { photos: [], status: 'Ready', pending: false },
        canPhoto: false,
      }),
      canvas: () => null,
    },
    clearControls() {},
    onViewing(value) {
      transitions.push(value);
      orbitEnabled = !value;
    },
  });
  try {
    ui.refresh();
    assert.deepEqual(transitions, []);
    active = 'lens';
    ui.refresh();
    ui.refresh();
    assert.deepEqual(transitions, [true]);
    assert.equal(orbitEnabled, false);
    active = null;
    ui.refresh();
    assert.equal(orbitEnabled, true);
    orbitEnabled = false;
    ui.refresh();
    assert.equal(orbitEnabled, false, 'a later drag retains orbit ownership');
    assert.deepEqual(transitions, [true, false]);
  } finally {
    ui.dispose();
    Object.assign(globalThis, previous);
  }
});

test('first photo selection is visible and later refresh preserves the chosen photo', () => {
  const previous = { window: globalThis.window, document: globalThis.document };
  globalThis.window = new EventTarget();
  globalThis.document = { createElement: (tag) => new Element(tag) };
  const root = new Element(),
    stage = new Element();
  stage.parentElement = root;
  const photos = [
    {
      url: 'first',
      metadata: { epoch: 1, captureTick: 12, timeSeconds: 0.1, width: 320, height: 240 },
    },
  ];
  const service = {
    read: () => ({
      active: null,
      status: 'Ready',
      gallery: { photos, status: 'Ready' },
      canPhoto: false,
    }),
    canvas: () => null,
  };
  const ui = createCameraControls({ root, stage, service, clearControls() {}, onViewing() {} });
  try {
    stage.children.find((n) => n.textContent === 'Photos').onclick();
    const dialog = root.children[0];
    const [header] = dialog.children;
    assert.equal(header.className, 'dialog-header', 'the gallery leads with its heading row');
    const [heading, close] = header.children;
    assert.equal(heading.textContent, 'Photos');
    assert.equal(close.attributes['aria-label'], 'Close photos');
    assert.equal(
      dialog.children.find((n) => n.textContent === 'Close photos'),
      undefined,
      'no embedded close button duplicates the ×',
    );
    assert.equal(dialog.open, true);
    close.onclick();
    assert.equal(dialog.open, false, 'closing photos does not clear them');
    assert.equal(photos.length, 1);
    dialog.showModal();
    const list = dialog.children.find((n) => n.tag === 'select');
    assert.equal(list.value, '0', 'first photo has a visible selected option');
    photos.push({ ...photos[0], url: 'second' });
    ui.refresh();
    assert.equal(list.value, '0');
    list.value = '1';
    ui.refresh();
    assert.equal(list.value, '1');
    photos.length = 0;
    ui.refresh();
    assert.equal(list.value, '');
  } finally {
    ui.dispose();
    Object.assign(globalThis, previous);
  }
});
