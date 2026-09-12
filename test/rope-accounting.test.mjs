import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { rotateVector } from '../src/model/transforms.mjs';
function fixture() {
  const bp = createEmptyBlueprint('account', 'Accounting');
  bp.parts = [createPart('beam', 'a', [0, 2, 0]), createPart('plate', 'b', [1, 2, 0])];
  bp.connections = [
    {
      id: 'rope',
      kind: 'rope',
      a: { part: 'a', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
      rope: { restLength: 1, diameter: 0.02, segments: 8, material: 'nylon' },
    },
  ];
  const { configuration: c } = compileAssembly(bp, { ground: null, gravity: [0, 0, 0] });
  delete c.power;
  return c;
}
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function account(state, c) {
  let energy = 0;
  const momentum = [0, 0, 0],
    angular = [0, 0, 0];
  state.forEach((b, i) => {
    const d = c.bodies[i],
      m = d.mass,
      [x, y, z] = d.halfExtents,
      q = b.rotation,
      w = rotateVector([-q[0], -q[1], -q[2], q[3]], b.angularVelocity),
      inertia =
        d.shape === 'sphere'
          ? [(2 * m * x * x) / 5, (2 * m * x * x) / 5, (2 * m * x * x) / 5]
          : [(m * (y * y + z * z)) / 3, (m * (x * x + z * z)) / 3, (m * (x * x + y * y)) / 3];
    const spin = rotateVector(
        q,
        w.map((v, k) => v * inertia[k]),
      ),
      orbital = cross(
        b.position,
        b.velocity.map((v) => v * m),
      );
    for (let k = 0; k < 3; k++) {
      momentum[k] += m * b.velocity[k];
      angular[k] += spin[k] + orbital[k];
    }
    energy +=
      (m * b.velocity.reduce((s, v) => s + v * v, 0)) / 2 +
      w.reduce((s, v, k) => s + inertia[k] * v * v, 0) / 2;
  });
  for (const j of c.joints.filter((j) => j.kind === 'rope')) {
    const l = Math.hypot(...state[j.a].position.map((v, k) => v - state[j.b].position[k]));
    energy += (j.stiffness * Math.max(0, l - j.restLength) ** 2) / 2;
  }
  return { energy, momentum, angular };
}
const step = (w) => {
  w.prepareConstraints();
  w.applyPreparedConstraints();
  const receipt = w.applyRopes();
  w.step();
  return receipt;
};
test('off-centre taut rope conserves independently computed momentum and does not create energy', async () => {
  const c = fixture(),
    w = await createPhysicsWorld(c);
  try {
    w.applyImpulse(1, [0.2, 0, 0]);
    const initial = account(w.read(), c);
    let maximum = initial.energy;
    for (let t = 0; t < 240; t++) {
      step(w);
      const next = account(w.read(), c);
      maximum = Math.max(maximum, next.energy);
      assert.ok(Math.hypot(...next.momentum.map((v, i) => v - initial.momentum[i])) < 1e-8);
      assert.ok(Math.hypot(...next.angular.map((v, i) => v - initial.angular[i])) < 1e-4);
    }
    assert.ok(maximum < initial.energy * 1.005 + 1e-9);
    assert.ok(w.read()[0].velocity[0] > 0.005, 'rope must tow the other ordinary body');
  } finally {
    w.dispose();
  }
});
