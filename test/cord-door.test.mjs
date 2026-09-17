import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
/** Hand-built rows, bypassing the compiler, so the physics door's own cord domain
 * is the only thing under test. Node mass and row values are deliberately
 * unreachable through authoring: the door must refuse them on its own. */
const body = (y, mass) => ({
  shape: 'box',
  position: [0, y, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  mass,
  halfExtents: [0.05, 0.05, 0.05],
  fixed: false,
  friction: 0.5,
  restitution: 0.1,
});
const row = (overrides = {}) => ({
  kind: 'cord',
  a: 0,
  b: 1,
  anchorA: [0, 0, 0],
  anchorB: [0, 0, 0],
  restLength: 0.05,
  stiffness: 1200,
  damping: 32,
  maxStrain: 1,
  ...overrides,
});
const configuration = (joint) => ({
  gravity: [0, -9.81, 0],
  bodies: [body(1, 0.4), body(0.95, 0.4)],
  joints: [joint],
});
test('the physics door admits an ordinary cord row and refuses every value outside its domain', async () => {
  const ordinary = await createPhysicsWorld(configuration(row()));
  try {
    const admitted = ordinary.configuration?.joints?.[0] ?? null;
    assert.ok(ordinary.ropes().length === 1, 'one distributed elastic row');
    assert.equal(ordinary.ropes()[0].restLength, 0.05);
    if (admitted) assert.equal(admitted.kind, 'cord');
  } finally {
    ordinary.dispose();
  }
  for (const [name, joint] of [
    // A per-row rest length above 0.20 m cannot come from the authored domain
    // (0.40 m over at least two segments); the door must not take it on trust.
    ['rest length above the per-row bound', row({ restLength: 0.3 })],
    ['zero rest length', row({ restLength: 0 })],
    // Beyond twice the rest length the linear elastic model was never measured.
    ['strain limit above the linear domain', row({ maxStrain: 1.5 })],
    ['zero strain limit', row({ maxStrain: 0 })],
    ['zero stiffness', row({ stiffness: 0 })],
    ['negative stiffness', row({ stiffness: -1200 })],
    ['stiffness above the row ceiling', row({ stiffness: 20001 })],
    ['negative damping', row({ damping: -1 })],
    ['damping above the row ceiling', row({ damping: 2001 })],
    ['non-finite stiffness', row({ stiffness: Number.NaN })],
    // A cord row is a central-force element between point nodes; a lever arm
    // would silently apply force without its torque.
    ['a non-zero anchor', row({ anchorA: [0, 0.01, 0] })],
    ['a non-zero far anchor', row({ anchorB: [0.01, 0, 0] })],
    // A cord has no material rating, so a breaking load is not its to declare.
    ['an extra strength rating', { ...row(), strength: 500 }],
    ['a missing strain limit', (({ maxStrain, ...rest }) => rest)(row())],
    ['a prismatic axis', { ...row(), axisA: [1, 0, 0], axisB: [1, 0, 0] }],
  ]) {
    await assert.rejects(
      () => createPhysicsWorld(configuration(joint)),
      (error) => error instanceof TypeError,
      `${name} must refuse`,
    );
  }
});
