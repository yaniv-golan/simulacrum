import { createControllerDispatcher } from '../src/simulation/controllers.mjs';
import assert from 'node:assert/strict';
import { createConnectionTest } from '../src/presentation/connection-test.mjs';
import { createVehicleControls } from '../src/presentation/vehicle-controls.mjs';
class Element extends EventTarget {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.textContent = '';
  }
  append(...items) {
    this.children.push(...items);
  }
  replaceChildren(...items) {
    this.children = items;
  }
  setAttribute(k, v) {
    this.attributes[k] = v;
  }
  remove() {}
  closest() {
    return null;
  }
  setPointerCapture() {}
}
globalThis.window = new EventTarget();
globalThis.document = new EventTarget();
document.createElement = (tag) => new Element(tag);
document.createTextNode = (text) => ({ textContent: text });
document.querySelector = () => null;
const event = (type, props = {}) => Object.assign(new Event(type, { cancelable: true }), props);
const nodes = (root) => [root, ...(root.children ?? []).flatMap(nodes)];
const bp = {
  parts: [
    { id: 'm', name: 'Motor', type: 'poweredMotor' },
    { id: 'r', name: 'Receiver', type: 'commandReceiver' },
  ],
  connections: [
    { kind: 'signal', a: { part: 'r', port: 'signal' }, b: { part: 'm', port: 'signal' } },
  ],
};
const frame = {
  metadata: { mode: 'run', blueprint: bp },
  power: { motors: [], sources: [] },
  physics: [],
};
const failures = [];
const check = (actual, expected) => {
  try {
    assert.deepEqual(actual, expected);
  } catch (error) {
    failures.push(error.message);
  }
};
const commands = [];
const send = async (c) => {
  commands.push(c);
  return { ok: true };
};
const root = new Element('root');
const keyboard = createVehicleControls({ send, select() {}, container: root });
const tester = createConnectionTest({
  send,
  select() {},
  choosePort() {},
  container: root,
  holdReceiver: (id, duty) => keyboard.hold(id, duty),
  releaseReceiver: (id) => keyboard.releaseHold(id),
});
keyboard.update(frame);
tester.render(frame, bp.parts[0], false);
const plus = nodes(root).find((n) => n.textContent === 'Hold +');
const minus = nodes(root).find((n) => n.textContent === 'Hold −');
const flush = () => new Promise((r) => setImmediate(r));
window.dispatchEvent(event('keydown', { code: 'KeyW', key: 'w' }));
await flush();
minus.dispatchEvent(event('pointerdown', { button: 0, pointerId: 1 }));
await flush();
window.dispatchEvent(event('pointerup'));
await flush();
check(
  commands.map((c) => c.duty),
  [1, -1, 1],
);
window.dispatchEvent(event('keyup', { code: 'KeyW', key: 'w' }));
await flush();
commands.length = 0;
plus.dispatchEvent(event('pointerdown', { button: 0, pointerId: 2 }));
await flush();
window.dispatchEvent(event('keydown', { code: 'KeyW', key: 'w' }));
await flush();
window.dispatchEvent(event('keyup', { code: 'KeyW', key: 'w' }));
await flush();
check(
  commands.map((c) => c.duty),
  [1],
);
window.dispatchEvent(event('pointerup'));
await flush();
for (const reset of ['blur', 'pause']) {
  commands.length = 0;
  window.dispatchEvent(event('keydown', { code: 'KeyW', key: 'w' }));
  await flush();
  minus.dispatchEvent(event('pointerdown', { button: 0, pointerId: 3 }));
  await flush();
  if (reset === 'blur') window.dispatchEvent(event('blur'));
  else {
    const paused = { ...frame, metadata: { ...frame.metadata, mode: 'paused' } };
    keyboard.update(paused);
    tester.update(paused);
  }
  await flush();
  check(
    commands.map((c) => c.duty),
    [1, -1, 0],
  );
  window.dispatchEvent(event('pointerup'));
  window.dispatchEvent(event('keyup', { code: 'KeyW', key: 'w' }));
  await flush();
  check(
    commands.map((c) => c.duty),
    [1, -1, 0],
  );
  keyboard.update(frame);
  tester.update(frame);
}
commands.length = 0;
const controlled = structuredClone(bp);
controlled.parts.push({ id: 'logic', name: 'Controller', type: 'logicController' });
controlled.connections.push({
  kind: 'signal',
  a: { part: 'logic', port: 'out' },
  b: { part: 'r', port: 'command' },
});
const owned = { ...frame, metadata: { ...frame.metadata, blueprint: controlled } };
keyboard.update(owned);
const section = tester.render(owned, controlled.parts[0], false);
assert(
  nodes(section).some(
    (n) => n.textContent === 'Test uses the wired controller. Manual override is unavailable.',
  ),
);
window.dispatchEvent(event('keydown', { code: 'KeyW', key: 'w' }));
await flush();
await keyboard.drive('r', -1);
await keyboard.hold('r', 1);
await keyboard.releaseHold('r');
const dispatcher = createControllerDispatcher(
  { controllers: [{ node: 2 }], receivers: [{ node: 1 }], sensors: [], signalWires: [[2, 1]] },
  [{ node: 2, run: () => [] }],
);
assert.deepEqual(
  dispatcher.run({ tick: 0, readings: [] }),
  [],
  'wired controller may legally omit this tick',
);
check(commands, []);
assert(nodes(root).some((n) => n.textContent === 'Controlled by Controller'));
keyboard.dispose();
tester.dispose();

assert.deepEqual(failures, []);
