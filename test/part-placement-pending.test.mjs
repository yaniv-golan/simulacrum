import test from 'node:test';
import assert from 'node:assert/strict';
import { createPartPlacement } from '../src/presentation/part-placement.mjs';
import { createEmptyBlueprint } from '../src/model/blueprint.mjs';
// Direct production-controller test with real geometry and lifecycle, no renderer.
class Element extends EventTarget {
  children = [];
  dataset = {};
  value = '';
  append(...children) {
    this.children.push(...children);
  }
  setAttribute() {}
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
