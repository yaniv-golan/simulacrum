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
