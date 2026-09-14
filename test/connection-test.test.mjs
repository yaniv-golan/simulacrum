import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionTest } from '../src/presentation/connection-test.mjs';
class Element extends EventTarget {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.children = [];
    this.hidden = false;
    this.open = false;
  }
  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }
  setAttribute() {}
  get firstElementChild() {
    return this.children[0];
  }
  contains(node) {
    return this === node || this.children.some((child) => child.contains?.(node));
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = null;
  }
}
test('diagnostic rows highlight exact edges and clear on close, graph change, removal and disposal', (t) => {
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = Object.assign(new EventTarget(), {
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => Object.assign(new Element('#text'), { textContent: text }),
  });
  globalThis.window = new EventTarget();
  t.after(() => {
    for (const key of ['document', 'window'])
      if (previous[key] === undefined) delete globalThis[key];
      else globalThis[key] = previous[key];
  });
  const parts = [
    { id: 'm', name: 'motor', type: 'poweredMotor' },
    { id: 'cell', name: 'cell', type: 'powerCell' },
    { id: 'r', name: 'receiver', type: 'commandReceiver' },
    { id: 'wheel', name: 'wheel', type: 'gripWheel' },
  ];
  const edge = (id, kind, a, ap, b, bp) => ({
    id,
    kind,
    a: { part: a, port: ap },
    b: { part: b, port: bp },
  });
  const blueprint = {
    parts,
    connections: [
      edge('power', 'power', 'cell', 'power', 'm', 'power'),
      edge('signal', 'signal', 'r', 'signal', 'm', 'signal'),
      edge('shaft', 'shaft', 'wheel', 'axle', 'm', 'shaft'),
    ],
  };
  const frame = { metadata: { mode: 'build', blueprint } },
    seen = [],
    revealed = [],
    container = new Element('main');
  const view = createConnectionTest({
    send: async () => ({ ok: true }),
    select: () => {},
    choosePort: () => {},
    container,
    reveal: (ids) => revealed.push([...ids]),
    highlight: (ids) => seen.push([...ids]),
  });
  const section = view.render(frame, parts[0], true),
    details = section.firstElementChild;
  details.open = true;
  details.dispatchEvent(new Event('toggle'));
  assert.deepEqual(revealed.at(-1), ['power', 'signal', 'shaft']);
  const rows = details.children.filter((node) => node.className === 'connection-test-path');
  for (const [row, id] of rows.map((row, i) => [row, ['power', 'signal', 'shaft'][i]])) {
    row.dispatchEvent(new Event('pointerenter'));
    assert.deepEqual(seen.at(-1), [id]);
    row.dispatchEvent(new Event('pointerleave'));
    assert.deepEqual(seen.at(-1), []);
    assert.deepEqual(revealed.at(-1), ['power', 'signal', 'shaft']);
  }
  rows[0].dispatchEvent(new Event('focusin'));
  details.open = false;
  details.dispatchEvent(new Event('toggle'));
  assert.deepEqual(seen.at(-1), []);
  assert.deepEqual(revealed.at(-1), []);
  details.open = true;
  rows[0].dispatchEvent(new Event('focusin'));
  view.update({ metadata: { mode: 'build', blueprint: { ...blueprint, connections: [] } } });
  assert.deepEqual(seen.at(-1), []);
  rows[0].dispatchEvent(new Event('pointerenter'));
  assert.deepEqual(seen.at(-1), [], 'row uses updated edge IDs');
  view.render(frame, parts[0], true);
  const current = container.children[0].firstElementChild;
  current.open = true;
  current.children[1].dispatchEvent(new Event('focusin'));
  view.update({ metadata: { mode: 'build', blueprint: { parts: [], connections: [] } } });
  assert.deepEqual(seen.at(-1), []);
  const final = view.render(frame, parts[0], true).firstElementChild;
  final.open = true;
  final.children[1].dispatchEvent(new Event('focusin'));
  view.dispose();
  assert.deepEqual(revealed.at(-1), []);
  assert.deepEqual(seen.at(-1), []);
});
test('an actuator missing power or shaft opens Connect & test until the player closes it', (t) => {
  const previous = { document: globalThis.document, window: globalThis.window };
  globalThis.document = Object.assign(new EventTarget(), {
    createElement: (tag) => new Element(tag),
    createTextNode: (text) => Object.assign(new Element('#text'), { textContent: text }),
  });
  globalThis.window = new EventTarget();
  t.after(() => {
    for (const key of ['document', 'window'])
      if (previous[key] === undefined) delete globalThis[key];
      else globalThis[key] = previous[key];
  });
  const motor = { id: 'm', name: 'motor', type: 'poweredMotor' },
    other = { id: 'm2', name: 'motor 2', type: 'poweredMotor' },
    cell = { id: 'cell', name: 'cell', type: 'powerCell' },
    wheel = { id: 'w', name: 'wheel', type: 'gripWheel' };
  const parts = [motor, other, cell, wheel];
  const powerEdge = {
      id: 'power',
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: 'm', port: 'power' },
    },
    shaftEdge = {
      id: 'shaft',
      kind: 'shaft',
      a: { part: 'w', port: 'axle' },
      b: { part: 'm', port: 'shaft' },
    };
  const bare = { id: 'bp', parts, connections: [] },
    powerOnly = { id: 'bp', parts, connections: [powerEdge] },
    shaftOnly = { id: 'bp', parts, connections: [shaftEdge] },
    wired = { id: 'bp', parts, connections: [powerEdge, shaftEdge] };
  const frameOf = (blueprint) => ({ metadata: { mode: 'build', blueprint } });
  const view = createConnectionTest({
    send: async () => ({ ok: true }),
    select: () => {},
    choosePort: () => {},
    container: new Element('main'),
  });
  // Power and shaft connected first: today's rule (closed until the player opens it).
  assert.equal(view.render(frameOf(wired), motor, true).firstElementChild.open, false);
  // Nothing connected: open without a click.
  assert.equal(view.render(frameOf(bare), motor, true).firstElementChild.open, true);
  // Completing the wiring while it is open keeps it open: the player's own state still rules.
  assert.equal(view.render(frameOf(wired), motor, true).firstElementChild.open, true);
  // Selected again from another part, the complete motor is closed as before...
  assert.equal(view.render(frameOf(bare), other, true).firstElementChild.open, true);
  assert.equal(view.render(frameOf(wired), motor, true).firstElementChild.open, false);
  // ...while one with only a wheel, or only power, still shows the missing row.
  view.render(frameOf(bare), other, true);
  assert.equal(view.render(frameOf(shaftOnly), motor, true).firstElementChild.open, true);
  view.render(frameOf(bare), other, true);
  assert.equal(view.render(frameOf(powerOnly), motor, true).firstElementChild.open, true);
  // The player closes it on the bare motor; a later render of the same part stays closed.
  const details = view.render(frameOf(bare), motor, true).firstElementChild;
  assert.equal(details.open, true);
  details.open = false;
  details.dispatchEvent(new Event('toggle'));
  assert.equal(view.render(frameOf({ ...bare }), motor, true).firstElementChild.open, false);
  // That memory is per part: a different unconnected actuator still opens.
  assert.equal(view.render(frameOf(bare), other, true).firstElementChild.open, true);
  // Reopening it by hand clears the memory, so it opens again after another selection.
  const reopened = view.render(frameOf(bare), motor, true).firstElementChild;
  assert.equal(reopened.open, false);
  reopened.open = true;
  reopened.dispatchEvent(new Event('toggle'));
  view.render(frameOf(bare), other, true);
  assert.equal(view.render(frameOf({ ...bare }), motor, true).firstElementChild.open, true);
  // Wrong controls: a rule that ignored connections would open the complete motor
  // too, and one keyed on "nothing connected" would close the wheel-only motor.
  view.render(frameOf(bare), other, true);
  assert.equal(view.render(frameOf(wired), motor, true).firstElementChild.open, false);
  view.render(frameOf(bare), other, true);
  const wheelOnly = view.render(frameOf(shaftOnly), motor, true).firstElementChild;
  assert.equal(wheelOnly.open, true);
  // A bare powered hinge is incomplete too: its moving output is a shaft peer.
  const hinge = { id: 'h', name: 'hinge', type: 'poweredHinge' };
  const bareHinge = { id: 'bp', parts: [...parts, hinge], connections: [] };
  assert.equal(view.render(frameOf(bareHinge), hinge, true).firstElementChild.open, true);
  // The player's closure memory also holds for a wheel-only motor.
  view.render(frameOf(bare), other, true);
  const wheelAgain = view.render(frameOf(shaftOnly), motor, true).firstElementChild;
  assert.equal(wheelAgain.open, true);
  wheelAgain.open = false;
  wheelAgain.dispatchEvent(new Event('toggle'));
  view.render(frameOf(bare), other, true);
  assert.equal(view.render(frameOf(shaftOnly), motor, true).firstElementChild.open, false);
  view.dispose?.();
});
