import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartPlacement } from '../src/presentation/part-placement.mjs';
import { createEmptyBlueprint } from '../src/model/blueprint.mjs';
// Direct production-controller test with real geometry and lifecycle, no renderer.
class Element extends EventTarget {
  children = [];
  dataset = {};
  attributes = {};
  listeners = {};
  value = '';
  append(...children) {
    this.children.push(...children);
  }
  setAttribute(name, value) {
    this.attributes[name] = value;
  }
  getAttribute(name) {
    return this.attributes[name];
  }
  addEventListener(type, listener) {
    (this.listeners[type] ??= []).push(listener);
  }
  /** Deliver a key to the real handler and report whether it took the default away. */
  fire(type, event) {
    const delivered = {
      defaultPrevented: false,
      preventDefault() {
        delivered.defaultPrevented = true;
      },
      stopPropagation() {},
      ...event,
    };
    for (const listener of this.listeners[type] ?? []) listener(delivered);
    return delivered;
  }
  focus() {}
  remove() {}
}
test('pending catalog placement cannot be replaced, cancelled or submitted twice', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  const frame = {
    metadata: { mode: 'build', blueprint: createEmptyBlueprint('pending', 'Pending') },
  };
  const cursor = { sessionId: 'pending', epoch: 0, revision: 0, tick: 0 };
  let resolve;
  const pending = new Promise((done) => {
    resolve = done;
  });
  const commands = [],
    accepted = [],
    cancelled = [];
  let placement;
  try {
    placement = createPartPlacement({
      getFrame: () => frame,
      getCursor: () => cursor,
      preview() {},
      clear() {},
      before() {},
      finished() {},
      cancelled: (type) => cancelled.push(type),
      placed: (type) => accepted.push(type),
      send: (command) => {
        commands.push(command);
        return pending;
      },
    });
    placement.start('powerCell');
    const completion = placement.commit();
    placement.cancel();
    placement.start('poweredMotor');
    const duplicate = placement.commit();
    assert.equal(placement.type(), 'powerCell');
    assert.equal(commands.length, 1);
    assert.deepEqual(cancelled, []);
    assert.deepEqual(frame.metadata.blueprint.parts, []);
    resolve({ ok: true });
    await completion;
    await duplicate;
    assert.deepEqual(accepted, ['powerCell']);
    frame.metadata.mode = 'run';
    placement.refresh();
    assert.equal(
      placement.panel.children.find((node) => node.textContent === 'Place another').disabled,
      true,
    );
    placement.start('poweredMotor');
    assert.equal(placement.type(), 'powerCell');
    frame.metadata.mode = 'build';
    placement.refresh();
    placement.start('poweredMotor');
    assert.equal(placement.type(), 'poweredMotor');
    placement.cancel();
    assert.deepEqual(cancelled, ['poweredMotor']);
  } finally {
    placement?.dispose();
    globalThis.document = previous;
  }
});
test('the placement strip keeps every accessible name and leaves Enter to the focused control', async () => {
  const previous = globalThis.document;
  globalThis.document = { createElement: () => new Element() };
  const frame = {
    metadata: { mode: 'build', blueprint: createEmptyBlueprint('strip', 'Strip') },
  };
  const cursor = { sessionId: 'strip', epoch: 0, revision: 0, tick: 0 };
  const commands = [],
    cancels = [];
  let placement;
  try {
    placement = createPartPlacement({
      getFrame: () => frame,
      getCursor: () => cursor,
      preview() {},
      clear() {},
      before() {},
      finished() {},
      cancelled: (type) => cancels.push(type),
      placed() {},
      send: (command) => {
        commands.push(command);
        return Promise.resolve({ ok: true });
      },
    });
    placement.start('powerCell');
    const [name, state, precise, confirm, another, end] = placement.panel.children;
    const summary = precise.children[0];
    // One row: the part, its state word from the shared vocabulary, the coordinates chip
    // and the two actions. Every relabelled control still carries its own name.
    assert.equal(name.textContent, 'Power Cell');
    assert.equal(state.textContent, 'Preview · not placed');
    assert.equal(summary.textContent, 'Precise position');
    assert.equal(summary.title, 'Precise position · type exact X, Y and Z');
    assert.equal(confirm.textContent, 'Place part');
    assert.equal(confirm.getAttribute('aria-label'), 'Place part');
    assert.equal(confirm.title, 'Place part · Enter');
    assert.equal(another.textContent, 'Place another');
    assert.equal(another.getAttribute('aria-label'), 'Place another');
    assert.equal(end.textContent, 'Cancel');
    assert.equal(end.getAttribute('aria-label'), 'Cancel placement');
    assert.equal(end.title, 'Cancel placement · Esc');
    // Enter keeps the default of whatever holds focus: it opens the coordinates on the
    // summary, cancels on Cancel and repeats on Place another. None of them commits.
    for (const target of [summary, end, another, placement.panel]) {
      const pressed = placement.panel.fire('keydown', { key: 'Enter', target });
      assert.equal(pressed.defaultPrevented, false);
    }
    assert.deepEqual(commands, []);
    // That default reaches cancellation, not the commit path.
    end.onclick();
    assert.equal(placement.active(), false);
    assert.deepEqual([commands, cancels], [[], ['powerCell']]);
    placement.start('powerCell');
    assert.equal(end.textContent, 'Cancel');
    // Positive control: a typed coordinate does commit on Enter.
    const typed = placement.panel.fire('keydown', {
      key: 'Enter',
      target: { tagName: 'INPUT' },
    });
    assert.equal(typed.defaultPrevented, true);
    assert.equal(commands.length, 1);
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(another.hidden, false);
    assert.equal(end.textContent, 'Done');
    assert.equal(end.getAttribute('aria-label'), 'Done');
  } finally {
    placement?.dispose();
    globalThis.document = previous;
  }
});
