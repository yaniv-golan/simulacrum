import { createReceiverArbiter } from '../src/simulation/receiver-arbiter.mjs';
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
  [1, 1], // A fresh key deliberately takes ownership even when a pointer holds the same duty.
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
  check(commands, [
    { type: 'control', id: 'r', duty: 1 },
    { type: 'control', id: 'r', duty: -1 },
    ...(reset === 'blur' ? [{ type: 'suspend-controls' }] : []),
    { type: 'control-release', id: 'r', duty: 0 },
  ]);
  window.dispatchEvent(event('pointerup'));
  window.dispatchEvent(event('keyup', { code: 'KeyW', key: 'w' }));
  await flush();
  check(commands, [
    { type: 'control', id: 'r', duty: 1 },
    { type: 'control', id: 'r', duty: -1 },
    ...(reset === 'blur' ? [{ type: 'suspend-controls' }] : []),
    { type: 'control-release', id: 'r', duty: 0 },
  ]);
  keyboard.update(frame);
  tester.update(frame);
}
// Reading help releases held keys and capture must not consume navigation keys.
commands.length = 0;
window.dispatchEvent(event('keydown', { code: 'KeyW', key: 'w' }));
await flush();
document.activeElement = {
  closest: (selector) => (selector.includes('data-part-help-input') ? {} : null),
};
document.dispatchEvent(event('focusin'));
await flush();
check(
  commands.map((c) => c.duty),
  [1, 0],
);
const readingKey = event('keydown', { code: 'KeyW', key: 'w' });
window.dispatchEvent(readingKey);
await flush();
check(readingKey.defaultPrevented, false);
document.activeElement = null;
window.dispatchEvent(event('keydown', { code: 'KeyW', key: 'w', repeat: true }));
await flush();
check(
  commands.map((c) => c.duty),
  [1, 0],
);
window.dispatchEvent(event('keyup', { code: 'KeyW', key: 'w' }));
window.dispatchEvent(event('keydown', { code: 'KeyW', key: 'w' }));
await flush();
check(
  commands.map((c) => c.duty),
  [1, 0, 1],
);
window.dispatchEvent(event('keyup', { code: 'KeyW', key: 'w' }));
await flush();
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
assert(nodes(section).some((n) => n.textContent === 'Hold +'));
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
assert(
  commands.some((c) => c.type === 'control' && c.id === 'r'),
  'keys and hold controls retain explicit manual takeover',
);
assert(!nodes(root).some((n) => n.textContent === 'Controlled by Controller'));
keyboard.dispose();
tester.dispose();

// Regulator wiring permits the same ordinary input route as an unowned receiver.
const regulated = structuredClone(bp);
regulated.parts.push({ id: 'regulator', name: 'Regulator', type: 'positionRegulator' });
regulated.parts[1].controlBinding = {
  mode: 'hold',
  drive: { gain: 1, positiveKeys: ['KeyW'], negativeKeys: [] },
  steer: { gain: -1, positiveKeys: ['KeyW'], negativeKeys: [] },
};
regulated.connections.push({
  kind: 'signal',
  a: { part: 'regulator', port: 'out' },
  b: { part: 'r', port: 'command' },
});
const regulatorFrame = { ...frame, metadata: { ...frame.metadata, blueprint: regulated } };
const received = [];
const automatic = createReceiverArbiter([
  {
    node: 1,
    duty: 0,
    regulator: {
      node: 2,
      sensor: 3,
      target: 0.25,
      minTarget: 0.1,
      maxTarget: 0.4,
      proportionalGain: 4,
      dampingGain: 0,
      polarity: 1,
      neutral: 0,
      maxRate: 120,
      enabled: true,
    },
  },
]);
let tick = 0;
const advance = (events) =>
  automatic.step(
    ++tick,
    { tick: tick - 1, readings: [{ node: 3, valid: true, length: 0.2, speed: 0 }] },
    events,
  )[0];
advance([{ type: 'mode', node: 1, mode: 'automatic' }]);
const localRoot = new Element('root');
const localKeyboard = createVehicleControls({
  container: localRoot,
  select() {},
  send: async (command) => {
    received.push(command);
    return { ok: true };
  },
});
const localTester = createConnectionTest({
  container: localRoot,
  send,
  select() {},
  choosePort() {},
  holdReceiver: (id, duty) => localKeyboard.hold(id, duty),
  releaseReceiver: (id) => localKeyboard.releaseHold(id),
});
localKeyboard.update(regulatorFrame);
const testSection = localTester.render(regulatorFrame, regulated.parts[0], false);
assert(
  nodes(testSection).some((n) => n.textContent === 'Hold +'),
  'regulator allows Connect & test',
);
assert(nodes(localRoot).some((n) => n.textContent.includes('Keys take over in Manual')));
window.dispatchEvent(event('keydown', { code: 'KeyW', key: 'w' }));
await flush();
assert.deepEqual(
  received,
  [{ type: 'control', id: 'r', duty: 0 }],
  'fresh net-zero key is deliberate input',
);
assert.equal(advance([{ type: 'manual', node: 1, duty: received[0].duty }]).mode, 'manual');
window.dispatchEvent(event('keyup', { code: 'KeyW', key: 'w' }));
await flush();
await localKeyboard.hold('r', 1);
advance([{ type: 'manual', node: 1, duty: 1 }]);
advance([{ type: 'mode', node: 1, mode: 'automatic' }]);
received.length = 0;
await localKeyboard.releaseHold('r');
assert.deepEqual(received, [{ type: 'control-release', id: 'r', duty: 0 }]);
assert.equal(advance([{ type: 'release', node: 1, duty: received[0].duty }]).mode, 'automatic');
received.length = 0;
window.dispatchEvent(event('blur'));
await flush();
assert.deepEqual(received, [{ type: 'suspend-controls' }]);
assert.equal(advance([{ type: 'suspend' }]).mode, 'off');
assert.equal(advance([]).mode, 'off');
localKeyboard.dispose();
localTester.dispose();
assert.deepEqual(failures, []);
