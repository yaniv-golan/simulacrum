import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, machine } from './fixtures/linear-machine.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { compileAssembly, snapConnection } from '../src/model/assembly.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
const frame = (s) => s.observe().frames[0];
function coupled(separate = false, reverse = false) {
  const c = configuration({ fixed: false, gravity: 0 });
  c.bodies.length = 4;
  c.bodies[0].mass = 1;
  c.bodies[1].mass = 1;
  c.joints[0].anchorA = [0.1, 0.01, 0];
  c.joints[0].anchorB = [-0.1, -0.01, 0];
  c.bodies[1].position[0] = 0.2;
  const body = (position) => ({
    ...structuredClone(c.bodies[0]),
    position,
    halfExtents: [0.01, 0.01, 0.01],
  });
  c.bodies.push(body([0, 1, 0.3]), body([0.2, 1.2, 0.4]));
  c.joints.push(
    {
      kind: 'fixed',
      a: 0,
      b: 4,
      anchorA: [0, 0, 0.3],
      anchorB: [0, 0, 0],
      rotationA: [0, 0, 0, 1],
      rotationB: [0, 0, 0, 1],
    },
    {
      kind: 'revolute',
      a: 4,
      b: 5,
      anchorA: [0, 0, 0.1],
      anchorB: [-0.2, -0.2, 0],
      axisA: [0, 0, 1],
      axisB: [0, 0, 1],
    },
  );
  c.power.motors.push({
    node: 4,
    body: 4,
    rotor: 5,
    joint: 2,
    axis: [0, 0, 1],
    torqueConstant: 0.1,
    resistance: 2,
    currentLimit: 1,
    defaultDuty: 0.4,
  });
  if (separate) {
    c.bodies.push(body([4, 1, 0]));
    c.power.cells.push({ ...c.power.cells[0], node: 6 });
    c.power.wires.push([6, 4]);
  } else c.power.wires.push([2, 4]);
  if (reverse) c.power.motors.reverse();
  // A parallel passive damped slide exercises predicted spring damping before funding.
  c.joints.push({ ...structuredClone(c.joints[0]), damping: 10 });
  c.bodies[1].velocity = [0, 0.1, 0];
  return c;
}
test('mixed linear rotary kicks include anchor moments and prepared damping in either allocation order', async () => {
  for (const separate of [false, true])
    for (const reverse of [false, true]) {
      const c = coupled(separate, reverse),
        w = await createPhysicsWorld({ gravity: c.gravity, bodies: c.bodies, joints: c.joints });
      try {
        w.prepareConstraints();
        w.prepareSprings();
        assert.ok(Math.abs(w.driveResponse(0, 2)) > 0.001, 'fixture must couple coordinates');
        assert.ok(Math.abs(w.driveResponse(0, 2) - w.driveResponse(2, 0)) < 1e-8);
      } finally {
        w.dispose();
      }
      const s = await createSession(c);
      try {
        s.step(20);
        assert.equal(frame(s).status, 'ready');
        assert.ok(frame(s).power.motors.every((m) => m.heatJ > 0));
        const cp = s.checkpoint();
        s.step(20);
        const expected = deterministicProjection(frame(s));
        s.restore(cp);
        s.step(20);
        assert.deepEqual(deterministicProjection(frame(s)), expected);
        assert.ok(Math.abs(frame(s).energy.balanceResidualJ) < 0.001);
      } finally {
        s.dispose();
      }
    }
});
test('release, reversal, cell-only, depleted and rigidly blocked controls cannot invent a holding clutch', async () => {
  for (const mode of ['release', 'reverse', 'cell-only', 'depleted', 'locked']) {
    const c = configuration();
    if (mode === 'cell-only') c.power.signalWires = [];
    if (mode === 'depleted') c.power.cells[0].initialJ = 0;
    if (mode === 'locked')
      c.joints.push({
        kind: 'fixed',
        a: 0,
        b: 1,
        anchorA: [0, 0.22, 0],
        anchorB: [0, 0, 0],
        rotationA: [0, 0, 0, 1],
        rotationB: [0, 0, 0, 1],
      });
    const s = await createSession(c);
    try {
      s.step(30);
      const start = frame(s).springs[0].length;
      if (mode === 'release' || mode === 'reverse')
        s.act({ type: 'receiver', node: 3, duty: mode === 'release' ? 0 : -1 });
      s.step(30);
      assert.equal(frame(s).status, 'ready');
      if (mode === 'release' || mode === 'reverse')
        assert.ok(frame(s).springs[0].length < start - 0.005);
      if (mode === 'locked') {
        assert.ok(Math.abs(frame(s).springs[0].length - 0.2) < 1e-6);
        assert.equal(frame(s).power.motors[0].shaftWorkJ, 0);
        assert.ok(frame(s).power.motors[0].heatJ > 0);
      }
      if (['release', 'cell-only', 'depleted'].includes(mode))
        assert.equal(frame(s).power.motors[0].torque, 0);
    } finally {
      s.dispose();
    }
  }
});
test('reversed authored endpoints preserve the same powered slide and snap direction', () => {
  const b = machine(),
    flipped = structuredClone(b);
  const e = flipped.connections[0];
  [e.a, e.b] = [e.b, e.a];
  assert.deepEqual(compileAssembly(b).configuration, compileAssembly(flipped).configuration);
  const empty = structuredClone(b);
  empty.connections = [];
  const normal = snapConnection(empty, b.connections[0].a, b.connections[0].b),
    reverse = snapConnection(empty, b.connections[0].b, b.connections[0].a);
  for (const x of [normal, reverse]) {
    x.connections = [structuredClone(b.connections[0])];
    assert.ok(compileAssembly(x).configuration.joints[0].limits[1] === 0.4);
  }
});

test('offset axial forces conserve independent linear and angular momentum with both anchor moments', async () => {
  const c = configuration({ fixed: false, gravity: 0 });
  c.bodies.length = 2;
  c.bodies[0].mass = 1;
  c.bodies[1].mass = 1;
  c.joints[0].anchorA = [0.1, 0.01, 0];
  c.joints[0].anchorB = [-0.1, -0.01, 0];
  c.bodies[1].position[0] = 0.2;
  const w = await createPhysicsWorld({ gravity: c.gravity, bodies: c.bodies, joints: c.joints });
  try {
    w.prepareConstraints();
    w.prepareSprings();
    w.applyPreparedConstraints();
    w.applySprings();
    const receipt = w.applyLinearDrive(0, 40),
      readings = w.read();
    const cross = (a, b) => [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const check = (rows) => {
      const p = [0, 0, 0],
        l = [0, 0, 0];
      let ke = 0;
      rows.forEach((b, i) => {
        const h = c.bodies[i].halfExtents,
          m = b.mass,
          orbital = cross(
            b.position,
            b.velocity.map((v) => m * v),
          );
        for (let k = 0; k < 3; k++) {
          const inertia = (m * (h[(k + 1) % 3] ** 2 + h[(k + 2) % 3] ** 2)) / 3;
          p[k] += m * b.velocity[k];
          l[k] += orbital[k] + inertia * b.angularVelocity[k];
          ke += (m * b.velocity[k] ** 2 + inertia * b.angularVelocity[k] ** 2) / 2;
        }
      });
      assert.ok(Math.hypot(...p) < 1e-8, 'linear reaction');
      assert.ok(Math.hypot(...l) < 1e-8, 'angular reaction');
      assert.ok(
        Math.abs(ke - receipt.workJ - receipt.constraintWorkJ) < 1e-8,
        'independent full inertia work',
      );
    };
    assert.ok(Math.abs(readings[0].angularVelocity[2]) > 0.01, 'offset fixture must rotate');
    check(readings);
    const wrong = structuredClone(readings);
    wrong[0].velocity = [0, 0, 0];
    assert.throws(() => check(wrong), /reaction/);
  } finally {
    w.dispose();
  }
});
