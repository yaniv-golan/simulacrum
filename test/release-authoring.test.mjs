import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { compileAssembly, snapConnection } from '../src/model/assembly.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { assertEditRoundTrip, assertRejectedEditUnchanged } from './contracts/editing.mjs';
import { couplerFixture } from './contracts/release.mjs';
test('catalog coupler designates exactly one ordinary latch and preserves physical material selection', () => {
  const b = couplerFixture();
  const c = compileAssembly(b, { ground: null }).configuration;
  assert.equal(c.power.couplers.length, 1);
  assert.equal(c.joints[c.power.couplers[0].joint].kind, 'fixed');
  const renamed = structuredClone(b);
  renamed.name = 'Nothing';
  renamed.parts.forEach((p) => (p.name = 'Other'));
  assert.deepEqual(compileAssembly(renamed, { ground: null }).configuration, c);
  b.parts[0].authoredMaterial.body = 'aluminium';
  assert.ok(compileAssembly(b, { ground: null }).configuration.bodies[0].mass < c.bodies[0].mass);
});
test('coupler authoring has ordinary atomic edits, history and save/load', async () => {
  const w = await createWorkshop(couplerFixture());
  try {
    await assertRejectedEditUnchanged(w, {
      type: 'connect',
      id: 'bad',
      a: { part: 'latch', port: 'latch' },
      b: { part: 'cell', port: 'power' },
    });
    await assertEditRoundTrip(w, { type: 'disconnect', id: 'load' });
  } finally {
    w.dispose();
  }
});
import { validateBlueprint } from '../src/model/blueprint.mjs';
test('two latch faces cannot claim the same physical attachment', () => {
  let b = createEmptyBlueprint('double', 'Double latch');
  b.parts.push(
    createPart('releaseCoupler', 'a', [0, 1, 0]),
    createPart('releaseCoupler', 'b', [1, 1, 0]),
  );
  const a = { part: 'a', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
    other = { part: 'b', surface: { region: 'right', u: 0, v: 0, twist: 0 } };
  b = snapConnection(b, a, other);
  b.connections.push({ id: 'double', kind: 'fixed', a, b: other });
  assert.equal(validateBlueprint(b).reasonCode, 'RELEASE_LATCH_CONFLICT');
});
