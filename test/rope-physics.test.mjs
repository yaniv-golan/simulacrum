import test from 'node:test';
import assert from 'node:assert/strict';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
const DT = 1 / 120;
function configuration({ fixed = false, gravity = [0, -9.81, 0] } = {}) {
  const bp = createEmptyBlueprint('rope-physics', 'Rope');
  bp.parts = [createPart('beam', 'a', [0, 3, 0]), createPart('plate', 'b', [0, 1, 0])];
  bp.connections = [
    {
      id: 'r',
      kind: 'rope',
      a: { part: 'a', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
      rope: { restLength: 1.97, diameter: 0.02, segments: 8, material: 'nylon' },
    },
  ];
  const compiled = compileAssembly(bp, { ground: null, gravity });
  compiled.configuration.bodies[0].fixed = fixed;
  delete compiled.configuration.power;
  return compiled.configuration;
}
function step(w) {
  w.prepareConstraints();
  w.applyPreparedConstraints();
  w.applyRopes();
  return w.step();
}
test('massive rope free fall and absence of unadvertised collisions', async () => {
  const c = configuration(),
    w = await createPhysicsWorld(c);
  try {
    const initial = w.read();
    for (let i = 0; i < 60; i++) step(w);
    const end = w.read();
    for (let i = 0; i < end.length; i++) {
      assert.ok(Math.abs(end[i].velocity[1] + 9.81 * 0.5) < 1e-7);
      assert.ok(
        Math.abs(
          end[i].position[1] -
            initial[i].position[1] +
            9.81 * DT ** 2 * ((60 * 59) / 2 + (60 * 5) / 8),
        ) < 1e-7,
      );
    }
    assert.ok(w.ropes().every((r) => r.appliedTension < 1e-6));
    assert.equal(w.contacts().rows.length, 0);
  } finally {
    w.dispose();
  }
});
test('supported hanging load has finite tensile extension and settled load', async () => {
  const c = configuration({ fixed: true }),
    w = await createPhysicsWorld(c);
  try {
    for (let i = 0; i < 2400; i++) step(w);
    const state = w.read(),
      readings = w.ropes(),
      EA = c.joints.find((j) => j.kind === 'rope').stiffness * (1.97 / 8);
    const lineMass = c.bodies.slice(2).reduce((s, b) => s + b.mass, 0),
      expected = ((c.bodies[1].mass + lineMass / 2) * 9.81 * 1.97) / EA;
    const extension = readings.reduce((s, r) => s + r.length - r.restLength, 0);
    assert.ok(extension > expected * 0.5);
    assert.ok(Math.abs(extension - expected) < 2 * 9.81 * DT ** 2, `${extension} vs ${expected}`);
    assert.ok(Math.abs(state[1].velocity[1]) < 0.01);
    assert.ok(readings[0].appliedTension > c.bodies[1].mass * 9.81);
  } finally {
    w.dispose();
  }
});
test('slack and taut native snapshots continue exactly and reject corrupt restore atomically', async () => {
  for (const fixed of [false, true]) {
    const c = configuration({ fixed }),
      w = await createPhysicsWorld(c);
    try {
      for (let i = 0; i < 60; i++) step(w);
      const bytes = w.snapshot(),
        energy = w.mechanicalEnergy();
      const expected = step(w);
      w.restore(bytes, energy);
      assert.deepEqual(step(w), expected);
      const before = w.snapshot(),
        bad = before.slice();
      bad[bad.length - 1] ^= 1;
      assert.throws(() => w.restore(bad));
      assert.deepEqual(w.snapshot(), before);
    } finally {
      w.dispose();
    }
  }
});
test('declared length and subdivision extremes retain independently predicted hanging extension', async () => {
  for (const length of [0.25, 4])
    for (const n of [4, 5, 8, 16]) {
      const c = configuration({ fixed: true });
      const ordinary = c.bodies.slice(0, 2);
      const bp = createEmptyBlueprint('limits', 'Limits');
      bp.parts = [
        createPart('beam', 'a', [0, 5, 0]),
        createPart('plate', 'b', [0, 5 - length - 0.03, 0]),
      ];
      bp.connections = [
        {
          id: 'r',
          kind: 'rope',
          a: { part: 'a', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
          b: { part: 'b', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
          rope: { restLength: length, diameter: 0.02, segments: n, material: 'nylon' },
        },
      ];
      const d = compileAssembly(bp, { ground: null }).configuration;
      delete d.power;
      d.bodies[0].fixed = true;
      const w = await createPhysicsWorld(d);
      try {
        for (let i = 0; i < 1200; i++) step(w);
        const rows = w.ropes(),
          mass = d.bodies.slice(2).reduce((s, b) => s + b.mass, 0),
          EA = (1e8 * 0.62 * Math.PI * 0.02 ** 2) / 4,
          expected = ((d.bodies[1].mass + mass / 2) * 9.81 * length) / EA,
          actual = rows.reduce((s, r) => s + r.length - r.restLength, 0);
        assert.ok(Math.abs(actual - expected) < 2 * 9.81 * DT ** 2);
        assert.ok(w.read().every((b) => b.position.every(Number.isFinite)));
      } finally {
        w.dispose();
      }
    }
});

test('rope collider exclusion suppresses actual floor and node pairs with unfiltered controls', async () => {
  for (const excluded of [false, true]) {
    const node = (x) => ({
      shape: 'sphere',
      position: [x, 0.005, 0],
      rotation: [0, 0, 0, 1],
      velocity: [0, 0, 0],
      mass: 0.001,
      halfExtents: [0.01, 0.01, 0.01],
      fixed: false,
      friction: 0,
      restitution: 0,
      ...(excluded ? { collision: false } : {}),
    });
    const c = {
      gravity: [0, -9.81, 0],
      bodies: [
        node(0),
        node(0.009),
        {
          shape: 'box',
          position: [0, -0.05, 0],
          rotation: [0, 0, 0, 1],
          velocity: [0, 0, 0],
          mass: 1,
          halfExtents: [1, 0.05, 1],
          fixed: true,
          friction: 0,
          restitution: 0,
        },
      ],
      joints: [],
    };
    const w = await createPhysicsWorld(c);
    try {
      step(w);
      const rows = w.contacts().rows;
      if (excluded) assert.equal(rows.length, 0);
      else {
        assert.ok(rows.some((r) => r.a === 0 && r.b === 1));
        assert.ok(rows.some((r) => r.b === 2));
      }
    } finally {
      w.dispose();
    }
  }
});
