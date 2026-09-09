import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssemblyPlacement } from '../src/presentation/assembly-placement.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { captureAssembly } from '../src/model/reusable-assemblies.mjs';
function setup(send) {
  const bp = structuredClone(createEmptyBlueprint('test', 'Test'));
  bp.parts.push(createPart('poweredMotor', 'motor', [0, 0.5, 0]));
  const { definition } = captureAssembly(bp, { name: 'Motor', ids: ['motor'], ports: [] });
  let frame = { metadata: { blueprint: bp, mode: 'build' }, cursor: { tick: 0 } };
  const commands = [];
  const placement = createAssemblyPlacement({
    getFrame: () => frame,
    send: async (c) => {
      commands.push(c);
      return send ? send(c) : { ok: true };
    },
  });
  placement.start(definition);
  return {
    placement,
    commands,
    change() {
      frame = structuredClone(frame);
      frame.metadata.blueprint.name = 'Changed';
      frame.cursor.tick++;
      placement.refresh();
    },
  };
}
test('assembly preview rejects stale source until explicitly revalidated', async () => {
  const x = setup();
  assert.equal(x.placement.read().valid, true);
  x.change();
  assert.equal(x.placement.read().stale, true);
  await x.placement.commit();
  assert.equal(x.commands.length, 0);
  x.placement.revalidate();
  assert.equal(x.placement.read().stale, false);
  await x.placement.commit();
  assert.equal(x.commands.length, 1);
});
test('assembly placement has a dispatch cutoff and cannot submit twice', async () => {
  let resolve;
  const x = setup(() => new Promise((r) => (resolve = r)));
  const pending = x.placement.commit();
  assert.equal(x.placement.read().phase, 'committing');
  assert.equal(x.placement.cancel(), false);
  await x.placement.commit();
  assert.equal(x.commands.length, 1);
  resolve({ ok: true });
  await pending;
  assert.equal(x.placement.read().phase, 'accepted');
  assert.equal(x.placement.cancel(), true);
});
test('rejection retains pose and cancellation before dispatch sends nothing', async () => {
  const x = setup(() => ({ ok: false, reasonCode: 'INVALID_COMMAND' }));
  const position = x.placement.read().position;
  await x.placement.commit();
  assert.equal(x.placement.read().phase, 'preview');
  assert.deepEqual(x.placement.read().position, position);
  assert.equal(x.placement.cancel(), true);
  assert.equal(x.commands.length, 1);
  const y = setup();
  assert.equal(y.placement.cancel(), true);
  assert.equal(y.commands.length, 0);
});
test('collision remains an inspectable invalid ghost rather than a machine edit', async () => {
  const x = setup();
  x.placement.pose([0, 0.5, 0]);
  assert.equal(x.placement.read().valid, false);
  assert.equal(x.placement.read().parts.length, 1);
  await x.placement.commit();
  assert.equal(x.commands.length, 0);
});

test('an applied placement with a missing or failed reply reconciles against authored state', async () => {
  for (const outcome of ['missing', 'session-error', 'thrown']) {
    const bp = structuredClone(createEmptyBlueprint('receipt', 'Receipt'));
    bp.parts.push(createPart('poweredMotor', 'motor', [0, 0.5, 0]));
    const { definition } = captureAssembly(bp, { name: 'Motor', ids: ['motor'], ports: [] });
    const frame = { metadata: { blueprint: bp, mode: 'build' }, cursor: { tick: 0 } };
    let count = 0;
    const placement = createAssemblyPlacement({
      getFrame: () => frame,
      send: async (command) => {
        count++;
        const { insertAssembly } = await import('../src/model/reusable-assemblies.mjs');
        frame.metadata.blueprint = insertAssembly(
          frame.metadata.blueprint,
          definition,
          command.position,
          command.rotation,
        ).blueprint;
        frame.cursor.tick++;
        if (outcome === 'thrown') throw new Error('Reply lost after publication');
        return outcome === 'session-error'
          ? { ok: false, reasonCode: 'SESSION_FAILED' }
          : undefined;
      },
    });
    placement.start(definition);
    const reply = await placement.commit();
    assert.equal(reply?.ok, true, outcome);
    assert.equal(placement.read().phase, 'accepted', outcome);
    await placement.commit();
    assert.equal(count, 1, outcome);
  }
});

test('an uncertain placement remains blocked until the exact result is observed', async () => {
  for (const outcome of ['missing', 'session-error', 'thrown']) {
    const x = setup(() => {
      if (outcome === 'thrown') throw new Error('Unknown outcome');
      return outcome === 'session-error' ? { ok: false, reasonCode: 'SESSION_FAILED' } : undefined;
    });
    await x.placement.commit();
    assert.equal(x.placement.read().phase, 'committing', outcome);
    x.change();
    x.placement.revalidate();
    await x.placement.commit();
    assert.equal(x.placement.cancel(), false, outcome);
    assert.equal(x.commands.length, 1, outcome);
  }
});

test('later session observation resolves a lost reply without another dispatch', async () => {
  const bp = structuredClone(createEmptyBlueprint('late', 'Late'));
  bp.parts.push(createPart('poweredMotor', 'motor', [0, 0.5, 0]));
  const { definition } = captureAssembly(bp, { name: 'Motor', ids: ['motor'], ports: [] });
  const frame = { metadata: { blueprint: bp, mode: 'build' }, cursor: { tick: 0 } };
  let command;
  const placement = createAssemblyPlacement({
    getFrame: () => frame,
    send: async (c) => {
      command = c;
    },
  });
  placement.start(definition);
  await placement.commit();
  const { insertAssembly } = await import('../src/model/reusable-assemblies.mjs');
  frame.metadata.blueprint = insertAssembly(
    bp,
    definition,
    command.position,
    command.rotation,
  ).blueprint;
  frame.cursor.tick++;
  assert.equal(placement.refresh()?.ok, true);
  assert.equal(placement.read().phase, 'accepted');
});

test('placement admission preserves the previous proposal outside Build', () => {
  const bp = structuredClone(createEmptyBlueprint('mode', 'Mode'));
  bp.parts.push(createPart('poweredMotor', 'motor', [0, 0.5, 0]));
  const { definition } = captureAssembly(bp, { name: 'Motor', ids: ['motor'], ports: [] });
  const frame = { metadata: { blueprint: bp, mode: 'run' }, cursor: { tick: 0 } };
  const placement = createAssemblyPlacement({
    getFrame: () => frame,
    send: () => {
      throw Error('unexpected command');
    },
  });
  assert.equal(placement.start(definition), false);
  assert.equal(placement.read(), null);
  frame.metadata.mode = 'build';
  assert.equal(placement.start(definition), true);
  const previous = placement.read();
  frame.metadata.mode = 'paused';
  assert.equal(placement.start(definition), false);
  assert.equal(placement.read(), previous);
});
