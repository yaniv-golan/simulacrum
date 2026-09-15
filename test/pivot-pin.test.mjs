import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { CATALOG, MATERIALS } from '../src/model/catalog.mjs';
import { createEmptyBlueprint, createPart, validateBlueprint } from '../src/model/blueprint.mjs';
import { compileAssembly, proposeSurfaceMount, snapConnection } from '../src/model/assembly.mjs';
import { resolveSurfaceEndpoint, validateSurfacePair } from '../src/model/surfaces.mjs';
import { multiplyQuaternion, rotateVector, normalizeQuaternion } from '../src/model/transforms.mjs';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createPassiveSuspensionCart } from '../src/model/fixtures/guided-suspension.mjs';
import { captureAssembly, insertAssembly } from '../src/model/reusable-assemblies.mjs';
import { assertRejectedEditUnchanged } from './contracts/editing.mjs';

const G = 9.81;
const surface = (part, region, u = 0, v = 0, twist = 0) => ({
  part,
  surface: { region, u, v, twist },
});
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const sub = (a, b) => a.map((x, i) => x - b[i]);
const add = (a, b) => a.map((x, i) => x + b[i]);
const norm = (a) => Math.hypot(...a);
const blueprint = (parts) => ({ ...createEmptyBlueprint('pin', 'Pin'), parts });
const mount = (bp, spec) => proposeSurfaceMount(bp, spec).blueprint;
/** World pose of a resolved surface endpoint. */
function worldEndpoint(bp, endpoint) {
  const part = bp.parts.find((p) => p.id === endpoint.part),
    port = resolveSurfaceEndpoint(part, endpoint),
    rotation = normalizeQuaternion(part.rotation);
  return {
    position: add(part.position, rotateVector(rotation, port.position)),
    rotation: multiplyQuaternion(rotation, port.rotation),
    joint: port.joint,
  };
}
const compiledJoint = (compiled, kind) =>
  compiled.configuration.joints.filter((j) => j.kind === kind);
const bodyOf = (bp, id) => bp.parts.findIndex((p) => p.id === id);

/** Beam A carries a pin at u; beam B sits on the pin head at `twist` (pin-first order). */
function pinnedPair({ u = 0.15, twist = 0.5 } = {}) {
  let bp = blueprint([
    createPart('beam', 'beamA', [0, 1, 0]),
    createPart('pivotPin', 'pin', [0, 2, 0]),
    createPart('beam', 'beamB', [0, 3, 0]),
  ]);
  bp = mount(bp, {
    part: 'pin',
    sourceRegion: 'bottom',
    targetPart: 'beamA',
    targetRegion: 'top',
    u,
    v: 0,
    twist: 0,
    id: 'foot',
  });
  bp = mount(bp, {
    part: 'beamB',
    sourceRegion: 'bottom',
    targetPart: 'pin',
    targetRegion: 'top',
    u: 0,
    v: 0,
    twist,
    id: 'head',
  });
  return bp;
}
/** Pin head under link B at `u` (link B is the receiver), foot then placed on link A (link-first order). */
function headFirstPair({ u = 0.15, footU = 0.15, footTwist = 0 } = {}) {
  let bp = blueprint([
    createPart('beam', 'beamA', [0, 1, 0]),
    createPart('pivotPin', 'pin', [0, 2, 0]),
    createPart('beam', 'beamB', [0, 3, 0]),
  ]);
  bp = mount(bp, {
    part: 'pin',
    sourceRegion: 'top',
    targetPart: 'beamB',
    targetRegion: 'bottom',
    u,
    v: 0,
    twist: 0,
    id: 'head',
  });
  bp = mount(bp, {
    part: 'pin',
    sourceRegion: 'bottom',
    targetPart: 'beamA',
    targetRegion: 'top',
    u: footU,
    v: 0,
    twist: footTwist,
    id: 'foot',
  });
  return bp;
}

test('pivot pin is an ordinary catalog part with a declared revolute joint face', () => {
  const pin = CATALOG.pivotPin;
  assert.ok(pin, 'pivotPin exists');
  assert.deepEqual(pin.primitives[0].halfExtents, [0.02, 0.005, 0.02]);
  assert.equal(pin.primitives[0].materialKey, 'steel');
  assert.deepEqual(pin.jointFace, { region: 'top', joint: 'revolute' });
  assert.deepEqual([...pin.mountingFaces].sort(), ['bottom', 'top']);
  assert.equal(pin.milestone, 'M3b');
  assert.deepEqual(pin.parameterDefinitions, {});
  assert.deepEqual(pin.ports, []);
  const part = createPart('pivotPin', 'pin', [0, 1, 0]);
  const head = resolveSurfaceEndpoint(part, surface('pin', 'top'));
  assert.equal(head.kind, 'fixed');
  assert.equal(head.joint, 'revolute');
  assert.equal(head.multiplicity, 'one');
  assert.equal(resolveSurfaceEndpoint(part, surface('pin', 'bottom')).joint, undefined);
  // Mass follows material and volume, never the name: steel 126 g, aluminium 43 g.
  const steel = compileAssembly(blueprint([part])).configuration.bodies[0].mass;
  assert.ok(Math.abs(steel - 8 * 0.02 * 0.005 * 0.02 * MATERIALS.steel.density) < 1e-9);
  const alu = createPart('pivotPin', 'pin', [0, 1, 0]);
  alu.authoredMaterial.body = 'aluminium';
  assert.ok(
    Math.abs(
      compileAssembly(blueprint([alu])).configuration.bodies[0].mass -
        8 * 0.02 * 0.005 * 0.02 * MATERIALS.aluminium.density,
    ) < 1e-9,
  );
});

test('admission: pivot needs exactly one revolute joint face, kind-matched, exclusive and centred', () => {
  const parts = () => [
    createPart('beam', 'beamA', [0, 1, 0]),
    createPart('pivotPin', 'pin', [0.15, 1.025, 0]),
    createPart('pivotPin', 'pin2', [-0.15, 1.025, 0]),
    createPart('beam', 'beamB', [0.15, 1.05, 0]),
    createPart('releaseCoupler', 'coupler', [1, 1, 0]),
    createPart('loadCellSensor', 'cell', [2, 1, 0]),
  ];
  const withConnections = (connections) => ({ ...blueprint(parts()), connections });
  const reason = (bp) => {
    const r = validateBlueprint(bp);
    return [r.reasonCode, r.path];
  };
  const pinHead = surface('pin', 'top'),
    beamBBottom = surface('beamB', 'bottom');
  // Positive control: a valid pinned pair admits.
  assert.deepEqual(
    reason(withConnections([{ id: 'p', kind: 'pivot', a: pinHead, b: beamBBottom }])),
    ['OK', undefined],
  );
  // pivot between two ordinary faces.
  assert.deepEqual(
    reason(
      withConnections([{ id: 'p', kind: 'pivot', a: surface('beamA', 'top'), b: beamBBottom }]),
    ),
    ['INVALID_BLUEPRINT', '/connections/0'],
  );
  // two joint faces.
  assert.deepEqual(
    reason(withConnections([{ id: 'p', kind: 'pivot', a: pinHead, b: surface('pin2', 'top') }])),
    ['INVALID_BLUEPRINT', '/connections/0'],
  );
  // fixed on a pin head.
  assert.deepEqual(
    reason(withConnections([{ id: 'f', kind: 'fixed', a: pinHead, b: beamBBottom }])),
    ['INVALID_BLUEPRINT', '/connections/0'],
  );
  // pivot against a latch face or a Load Cell face.
  assert.deepEqual(
    reason(
      withConnections([
        {
          id: 'p',
          kind: 'pivot',
          a: surface('coupler', CATALOG.releaseCoupler.releaseFace),
          b: pinHead,
        },
      ]),
    ),
    ['JOINT_FACE_CONFLICT', '/connections/0'],
  );
  assert.deepEqual(
    reason(withConnections([{ id: 'p', kind: 'pivot', a: surface('cell', 'right'), b: pinHead }])),
    ['JOINT_FACE_CONFLICT', '/connections/0'],
  );
  // a second connection on the same pin head.
  assert.deepEqual(
    reason(
      withConnections([
        { id: 'p', kind: 'pivot', a: pinHead, b: beamBBottom },
        { id: 'q', kind: 'pivot', a: pinHead, b: surface('beamA', 'top') },
      ]),
    ),
    ['PORT_OCCUPIED', '/connections/1/a/port'],
  );
  // joint face off-centre.
  assert.deepEqual(
    reason(
      withConnections([{ id: 'p', kind: 'pivot', a: surface('pin', 'top', 0.01), b: beamBBottom }]),
    ),
    ['SURFACE_OUT_OF_BOUNDS', '/connections/0'],
  );
  // Wrong-implementation control: an admission that only checks the kind string accepts the
  // ordinary-faces case the rule must reject.
  const naive = (bp) =>
    bp.connections.every((c) => ['fixed', 'pivot'].includes(c.kind)) ? 'OK' : 'INVALID_BLUEPRINT';
  assert.equal(
    naive(
      withConnections([{ id: 'p', kind: 'pivot', a: surface('beamA', 'top'), b: beamBBottom }]),
    ),
    'OK',
  );
});

test('compile: a pinned pair is one fixed joint and one passive revolute about the mated normal', () => {
  const bp = pinnedPair({ u: 0.15, twist: 0.5 });
  assert.deepEqual(bp.connections.map((c) => c.kind).sort(), ['fixed', 'pivot']);
  const compiled = compileAssembly(bp);
  assert.ok(
    compiled.connections.every((c) => c.reasonCode === 'OK'),
    JSON.stringify(compiled.connections),
  );
  assert.equal(compiledJoint(compiled, 'fixed').length, 1);
  const [revolute] = compiledJoint(compiled, 'revolute');
  assert.ok(revolute, 'one revolute');
  assert.equal(revolute.limits, undefined, 'no limits');
  const pin = bodyOf(bp, 'pin'),
    beamB = bodyOf(bp, 'beamB');
  assert.deepEqual([revolute.a, revolute.b].sort(), [pin, beamB].sort());
  const head = bp.connections.find((c) => c.kind === 'pivot');
  const endpointA = worldEndpoint(bp, head.a),
    endpointB = worldEndpoint(bp, head.b);
  const bodies = compiled.configuration.bodies;
  const worldAnchor = (index, anchor) =>
    add(bodies[index].position, rotateVector(bodies[index].rotation, anchor));
  assert.ok(norm(sub(worldAnchor(revolute.a, revolute.anchorA), endpointA.position)) < 1e-9);
  assert.ok(norm(sub(worldAnchor(revolute.b, revolute.anchorB), endpointB.position)) < 1e-9);
  // World axes agree (dot = 1), computed independently from the part poses: A's outward normal.
  const axisA = rotateVector(bodies[revolute.a].rotation, revolute.axisA),
    axisB = rotateVector(bodies[revolute.b].rotation, revolute.axisB);
  assert.ok(Math.abs(dot(axisA, axisB) - 1) < 1e-10, `axes agree: ${dot(axisA, axisB)}`);
  const normalA = rotateVector(endpointA.rotation, [1, 0, 0]);
  assert.ok(Math.abs(Math.abs(dot(axisA, normalA)) - 1) < 1e-10, 'axis is the mated face normal');
  // Wrong control: axisB taken as B's own outward normal is antiparallel.
  const wrong = rotateVector(
    bodies[revolute.b].rotation,
    rotateVector(resolveSurfaceEndpoint(bp.parts[beamB], head.b).rotation, [1, 0, 0]),
  );
  assert.ok(Math.abs(dot(axisA, wrong) + 1) < 1e-10, 'B normal alone would flip the joint');
  // The start pose is rotated by the twist about that axis: beam B's long axis is 0.5 rad from beam A's.
  const along = (id) => rotateVector(bp.parts[bodyOf(bp, id)].rotation, [1, 0, 0]);
  assert.ok(
    Math.abs(Math.acos(Math.min(1, Math.abs(dot(along('beamA'), along('beamB'))))) - 0.5) < 1e-9,
  );
});

test('a pin head admits its partner at any start angle; the pad-projection rule stays for ordinary faces', async () => {
  // Beam on a pin head at 45°: the mate is a point and an axis.
  assert.doesNotThrow(() => pinnedPair({ twist: Math.PI / 4 }));
  // Same beam pad at 45° on an ordinary receiver of the same half-size rejects.
  const bp = blueprint([
    createPart('spacerBlock', 'block', [0, 1, 0]),
    createPart('beam', 'beam', [0, 2, 0]),
  ]);
  assert.throws(
    () =>
      mount(bp, {
        part: 'beam',
        sourceRegion: 'bottom',
        targetPart: 'block',
        targetRegion: 'top',
        u: 0,
        v: 0,
        twist: Math.PI / 4,
        id: 'm',
      }),
    /SURFACE_OUT_OF_BOUNDS/,
  );
  // The shared validator agrees with the mount path in both cases.
  const pinned = pinnedPair({ twist: Math.PI / 4 }),
    head = pinned.connections.find((c) => c.kind === 'pivot');
  assert.doesNotThrow(() =>
    validateSurfacePair(
      pinned.parts[bodyOf(pinned, 'pin')],
      head.a,
      pinned.parts[bodyOf(pinned, 'beamB')],
      head.b,
    ),
  );
  const plain = { ...bp, parts: bp.parts.map((p) => ({ ...p })) };
  assert.throws(
    () =>
      validateSurfacePair(
        plain.parts[0],
        surface('block', 'top', 0, 0, Math.PI / 4),
        plain.parts[1],
        surface('beam', 'bottom'),
      ),
    /SURFACE_OUT_OF_BOUNDS/,
  );
  // The hoisted footprint rule reports no pad limits for a joint-face pair and the ordinary
  // limits otherwise, so the placement panel and both admission paths share one answer.
  const { mountFootprintLimits } = await import('../src/model/surfaces.mjs');
  const pinnedParts = pinnedPair({ twist: 0 }).parts;
  assert.equal(
    mountFootprintLimits(
      pinnedParts.find((p) => p.id === 'pin'),
      'top',
      pinnedParts.find((p) => p.id === 'beamB'),
      'bottom',
      Math.PI / 4,
    ),
    null,
  );
  const limits = mountFootprintLimits(plain.parts[0], 'top', plain.parts[1], 'bottom', 0);
  assert.deepEqual(limits, { u: 0, v: 0 }, 'a 40 mm pad on a 40 mm face has no room to slide');
});

/** Door-level pendulum: link A fixed, its top normal horizontal, pin axis along world Z. */
function pendulumConfiguration(startAngleRad, { fixedJoint = false } = {}) {
  // Beam A rotated so its local +Y (top normal) points along world +Z.
  let bp = blueprint([
    createPart('beam', 'beamA', [0, 1, 0]),
    createPart('pivotPin', 'pin', [0, 2, 0]),
    createPart('beam', 'beamB', [0, 3, 0]),
  ]);
  bp.parts[0].rotation = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  const build = (twist) => {
    let next = mount(bp, {
      part: 'pin',
      sourceRegion: 'top',
      targetPart: 'beamB',
      targetRegion: 'bottom',
      u: 0.15,
      v: 0,
      twist: 0,
      id: 'head',
    });
    return mount(next, {
      part: 'pin',
      sourceRegion: 'bottom',
      targetPart: 'beamA',
      targetRegion: 'top',
      u: 0,
      v: 0,
      twist,
      id: 'foot',
    });
  };
  // Find the foot twist that hangs beam B straight down, then add the release angle.
  const axisOf = (b) => rotateVector(b.parts[bodyOf(b, 'beamB')].rotation, [1, 0, 0]);
  const d0 = axisOf(build(0));
  // Down is [0,-1,0] and the pin axis is world ±Z: the twist that hangs beam B is the signed
  // angle from d0 to down about Z, tried in both senses because the axis sign is the mate's.
  const t0 = Math.atan2(d0[0] * -1 - d0[1] * 0, d0[0] * 0 + d0[1] * -1);
  const hangs = (t) => Math.abs(dot(axisOf(build(t)), [0, -1, 0]) - 1) < 1e-6;
  assert.ok(hangs(t0) || hangs(-t0), 'beam B can hang straight down');
  const chosen = hangs(t0) ? t0 : -t0;
  const released = build(chosen + startAngleRad);
  const compiled = compileAssembly(released, { ground: null });
  const config = compiled.configuration;
  config.bodies[bodyOf(released, 'beamA')].fixed = true;
  delete config.power;
  if (fixedJoint) {
    const i = config.joints.findIndex((j) => j.kind === 'revolute');
    const head = released.connections.find((c) => c.kind === 'pivot');
    const A = resolveSurfaceEndpoint(released.parts[bodyOf(released, head.a.part)], head.a),
      B = resolveSurfaceEndpoint(released.parts[bodyOf(released, head.b.part)], head.b);
    config.joints[i] = {
      kind: 'fixed',
      a: config.joints[i].a,
      b: config.joints[i].b,
      anchorA: config.joints[i].anchorA,
      anchorB: config.joints[i].anchorB,
      rotationA: [...A.rotation],
      rotationB: normalizeQuaternion(multiplyQuaternion(B.rotation, [0, 1, 0, 0])),
    };
  }
  return {
    config,
    beamB: bodyOf(released, 'beamB'),
    pin: bodyOf(released, 'pin'),
    blueprint: released,
  };
}
function swingAngle(read, index) {
  const axis = rotateVector(read[index].rotation, [1, 0, 0]);
  return Math.atan2(axis[0], -axis[1]); // 0 when hanging straight down, positive toward +X
}

test('a pinned link swings as a compound pendulum; a fixed joint does not; the pin transmits no torque', async () => {
  const { config, beamB, pin } = pendulumConfiguration((5 * Math.PI) / 180);
  const w = await createPhysicsWorld(config);
  try {
    const m = config.bodies[beamB].mass,
      [hx, hy, hz] = config.bodies[beamB].halfExtents,
      icm = (m / 12) * ((2 * hx) ** 2 + (2 * hz) ** 2), // about the local Y axis (pin axis)
      d = 0.15,
      expected = 2 * Math.PI * Math.sqrt((icm + m * d * d) / (m * G * d));
    const dt = 1 / 120;
    let previous = swingAngle(w.read(), beamB),
      previousT = 0,
      crossings = [];
    for (let tick = 1; tick <= 1200; tick++) {
      w.prepareConstraints();
      w.applyPreparedConstraints();
      w.step();
      const t = tick * dt,
        angle = swingAngle(w.read(), beamB);
      if (previous > 0 && angle <= 0)
        crossings.push(previousT + (dt * previous) / (previous - angle));
      previous = angle;
      previousT = t;
    }
    assert.ok(crossings.length >= 3, `enough swings: ${crossings.length}`);
    const periods = crossings.slice(1).map((c, i) => c - crossings[i]);
    for (const period of periods)
      assert.ok(Math.abs(period - expected) / expected < 0.002, `period ${period} vs ${expected}`);
    const pinState = w.read()[pin];
    assert.ok(
      norm(sub(pinState.position, config.bodies[pin].position)) < 1e-6,
      'the pin body stays with link A',
    );
  } finally {
    w.dispose();
  }
  // Wrong control: the same fixture with a fixed joint holds its release angle.
  const held = pendulumConfiguration((5 * Math.PI) / 180, { fixedJoint: true });
  const h = await createPhysicsWorld(held.config);
  try {
    const start = swingAngle(h.read(), held.beamB);
    for (let tick = 1; tick <= 240; tick++) {
      h.prepareConstraints();
      h.applyPreparedConstraints();
      h.step();
    }
    assert.ok(
      Math.abs(swingAngle(h.read(), held.beamB) - start) < 1e-3,
      'fixed joint does not swing',
    );
  } finally {
    h.dispose();
  }
  // Negative control: a spinning partner does not spin the pin about the axis (no torque transmission).
  const free = pinnedPair({ u: 0, twist: 0 });
  const spinning = compileAssembly(free, { ground: null, gravity: [0, 0, 0] }).configuration;
  delete spinning.power;
  spinning.bodies[bodyOf(free, 'beamA')].fixed = true;
  spinning.bodies[bodyOf(free, 'beamB')].angularVelocity = [0, 3, 0];
  const s = await createPhysicsWorld(spinning);
  try {
    for (let tick = 1; tick <= 120; tick++) {
      s.prepareConstraints();
      s.applyPreparedConstraints();
      s.step();
    }
    const state = s.read();
    assert.ok(
      Math.abs(state[bodyOf(free, 'beamB')].angularVelocity[1] - 3) < 0.05,
      'partner keeps spinning',
    );
    assert.ok(Math.abs(state[bodyOf(free, 'pin')].angularVelocity[1]) < 1e-6, 'pin does not turn');
  } finally {
    s.dispose();
  }
});

test('renaming and rig placement never change a pinned pair; material changes mass only', () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 1000000 }),
      fc.constantFrom(...Object.keys(MATERIALS)),
      fc.tuple(
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
        fc.double({ min: -20, max: 20, noNaN: true }),
      ),
      (seed, material, offset) => {
        const reference = pinnedPair({ u: 0.1, twist: 0.3 });
        const perturbed = structuredClone(reference);
        perturbed.id = `machine-${seed}`;
        perturbed.name = `Renamed ${seed}`;
        perturbed.parts.forEach((p, i) => {
          p.name = `Part ${seed}-${i}`;
          p.position = p.position.map((x, k) => x + offset[k]);
        });
        perturbed.parts[bodyOf(perturbed, 'pin')].authoredMaterial.body = material;
        const before = compileAssembly(reference).configuration,
          after = compileAssembly(perturbed).configuration;
        assert.deepEqual(
          after.joints.map((j) => j.kind),
          before.joints.map((j) => j.kind),
        );
        after.joints.forEach((j, i) => {
          assert.deepEqual(j.anchorA, before.joints[i].anchorA);
          assert.deepEqual(j.anchorB, before.joints[i].anchorB);
          if (j.kind === 'revolute') {
            assert.deepEqual(j.axisA, before.joints[i].axisA);
            assert.deepEqual(j.axisB, before.joints[i].axisB);
          }
        });
        const pin = bodyOf(reference, 'pin');
        assert.ok(
          Math.abs(
            after.bodies[pin].mass / before.bodies[pin].mass -
              MATERIALS[material].density / MATERIALS.steel.density,
          ) < 1e-9,
        );
        after.bodies.forEach((b, i) => i !== pin && assert.equal(b.mass, before.bodies[i].mass));
      },
    ),
    { numRuns: 40 },
  );
  // Counterexample: choosing the joint kind by part name violates the property.
  const byName = (bp) => {
    const c = compileAssembly(bp);
    if (!bp.parts.some((p) => /pin/i.test(p.name)))
      c.configuration.joints = c.configuration.joints.map((j) =>
        j.kind === 'revolute' ? { ...j, kind: 'fixed' } : j,
      );
    return c;
  };
  const named = pinnedPair();
  const renamed = structuredClone(named);
  renamed.parts.forEach((p) => (p.name = 'Part'));
  assert.notDeepEqual(
    byName(renamed).configuration.joints.map((j) => j.kind),
    byName(named).configuration.joints.map((j) => j.kind),
  );
});

test('links on a pin swing over each other with 10 mm clearance and never touch', async () => {
  const bp = headFirstPair({ u: 0.15, footU: 0.15 });
  const config = compileAssembly(bp, { ground: null }).configuration;
  delete config.power;
  config.bodies[bodyOf(bp, 'beamA')].fixed = true;
  config.bodies[bodyOf(bp, 'beamB')].angularVelocity = [0, 2, 0];
  const w = await createPhysicsWorld(config);
  try {
    let contacts = 0;
    for (let tick = 1; tick <= 480; tick++) {
      w.prepareConstraints();
      w.applyPreparedConstraints();
      w.step();
      contacts += w
        .contacts()
        .rows.filter(
          (c) =>
            [c.a, c.b].includes(bodyOf(bp, 'beamA')) && [c.a, c.b].includes(bodyOf(bp, 'beamB')),
        ).length;
    }
    assert.equal(contacts, 0, 'links never touch');
    const gap =
      config.bodies[bodyOf(bp, 'beamB')].position[1] -
      config.bodies[bodyOf(bp, 'beamA')].position[1] -
      0.04;
    assert.ok(Math.abs(gap - 0.01) < 1e-9, 'the pin body is the 10 mm washer');
  } finally {
    w.dispose();
  }
  // Wrong control: a zero-thickness revolute puts the links in contact.
  const flat = compileAssembly(bp, { ground: null }).configuration;
  delete flat.power;
  flat.bodies[bodyOf(bp, 'beamA')].fixed = true;
  const revolute = flat.joints.findIndex((j) => j.kind === 'revolute');
  flat.joints = flat.joints.filter((_, i) => i !== revolute).filter((j) => j.kind !== 'fixed');
  flat.bodies[bodyOf(bp, 'beamB')].position[1] =
    flat.bodies[bodyOf(bp, 'beamA')].position[1] + 0.04 - 1e-4;
  flat.joints.push({
    kind: 'revolute',
    a: bodyOf(bp, 'beamA'),
    b: bodyOf(bp, 'beamB'),
    anchorA: [0.15, 0.02, 0],
    anchorB: [0.15, -0.02, 0],
    axisA: [0, 1, 0],
    axisB: [0, 1, 0],
  });
  flat.bodies[bodyOf(bp, 'beamB')].angularVelocity = [0, 2, 0];
  const f = await createPhysicsWorld(flat);
  try {
    let contacts = 0;
    for (let tick = 1; tick <= 120; tick++) {
      f.prepareConstraints();
      f.applyPreparedConstraints();
      f.step();
      contacts += f
        .contacts()
        .rows.filter(
          (c) =>
            [c.a, c.b].includes(bodyOf(bp, 'beamA')) && [c.a, c.b].includes(bodyOf(bp, 'beamB')),
        ).length;
    }
    assert.ok(contacts > 0, 'a washer-less revolute drags its links across each other');
  } finally {
    f.dispose();
  }
});

/** Parallelogram four-bar on a chassis: two hinge ground pivots, two pins, an asymmetric coupler. */
function parallelogram({ closeOffset = 0 } = {}) {
  let bp = blueprint([
    createPart('chassis', 'ground', [0, 0.02, 0]),
    createPart('poweredHinge', 'hingeA', [2, 1, 0]),
    createPart('poweredHinge', 'hingeB', [3, 1, 0]),
    createPart('shaftMount', 'mountA', [4, 1, 0]),
    createPart('shaftMount', 'mountB', [5, 1, 0]),
    createPart('beam', 'crank', [6, 1, 0]),
    createPart('beam', 'rocker', [7, 1, 0]),
    createPart('pivotPin', 'pinA', [8, 1, 0]),
    createPart('pivotPin', 'pinB', [9, 1, 0]),
    createPart('beam', 'coupler', [10, 1, 0]),
    createPart('powerCell', 'cell', [-2, 1, 0]),
    createPart('commandReceiver', 'receiver', [-3, 1, 0]),
  ]);
  const p = (id) => bp.parts.find((x) => x.id === id);
  p('crank').parameters.length = 0.2;
  p('rocker').parameters.length = 0.2;
  p('coupler').parameters.length = 0.8;
  p('hingeA').parameters.lowerLimit = -1.5;
  p('hingeA').parameters.upperLimit = 1.5;
  p('hingeB').parameters.lowerLimit = -3;
  p('hingeB').parameters.upperLimit = 3;
  // Ground pivots 0.34 m apart along Z on the chassis top.
  bp = mount(bp, {
    part: 'hingeA',
    sourceRegion: 'bottom',
    targetPart: 'ground',
    targetRegion: 'top',
    u: 0,
    v: -0.17,
    twist: 0,
    id: 'hA',
  });
  bp = mount(bp, {
    part: 'hingeB',
    sourceRegion: 'bottom',
    targetPart: 'ground',
    targetRegion: 'top',
    u: 0,
    v: 0.17,
    twist: 0,
    id: 'hB',
  });
  // Crank and rocker each carry an axle adapter at u = -0.08 (the adapter's pad on the link's underside).
  bp = mount(bp, {
    part: 'mountA',
    sourceRegion: 'right',
    targetPart: 'crank',
    targetRegion: 'bottom',
    u: -0.08,
    v: 0,
    twist: 0,
    id: 'mA',
  });
  bp = mount(bp, {
    part: 'mountB',
    sourceRegion: 'right',
    targetPart: 'rocker',
    targetRegion: 'bottom',
    u: -0.08,
    v: 0,
    twist: 0,
    id: 'mB',
  });
  const shaft = (id, a, b) => {
    bp = snapConnection(bp, a, b);
    bp.connections.push({ id, kind: 'shaft', a, b });
  };
  shaft('sA', { part: 'hingeA', port: 'shaft' }, { part: 'mountA', port: 'shaft' });
  shaft('sB', { part: 'hingeB', port: 'shaft' }, { part: 'mountB', port: 'shaft' });
  // Pins stand on the far ends of crank and rocker.
  bp = mount(bp, {
    part: 'pinA',
    sourceRegion: 'bottom',
    targetPart: 'crank',
    targetRegion: 'top',
    u: 0.08,
    v: 0,
    twist: 0,
    id: 'fA',
  });
  bp = mount(bp, {
    part: 'pinB',
    sourceRegion: 'bottom',
    targetPart: 'rocker',
    targetRegion: 'top',
    u: 0.08,
    v: 0,
    twist: 0,
    id: 'fB',
  });
  // The coupler sits centred on pin A's head; pin B's head must coincide with the coupler at u = 0.34.
  bp = mount(bp, {
    part: 'coupler',
    sourceRegion: 'bottom',
    targetPart: 'pinA',
    targetRegion: 'top',
    u: 0,
    v: 0,
    twist: 0,
    id: 'cA',
  });
  const closing = {
    part: 'pinB',
    sourceRegion: 'top',
    targetPart: 'coupler',
    targetRegion: 'bottom',
    u: 0.34 + closeOffset,
    v: 0,
    twist: 0,
    id: 'cB',
  };
  // Power and command for the driven variant.
  bp.connections.push({
    id: 'pw',
    kind: 'power',
    a: { part: 'cell', port: 'power' },
    b: { part: 'hingeA', port: 'power' },
  });
  bp.connections.push({
    id: 'sg',
    kind: 'signal',
    a: { part: 'receiver', port: 'signal' },
    b: { part: 'hingeA', port: 'signal' },
  });
  return { blueprint: bp, closing };
}

test('a coincident pin-head closure admits through the surface-mount path without moving a part', async () => {
  const { blueprint: open, closing } = parallelogram();
  const w = await createWorkshop(open);
  try {
    const before = w.observe().frames[0].metadata.blueprint;
    const closed = await w.act({ type: 'surface-mount', ...closing });
    assert.equal(closed.ok, true, JSON.stringify(closed));
    const after = w.observe().frames[0].metadata.blueprint;
    assert.deepEqual(after.parts, before.parts, 'closure moves nothing');
    assert.equal(after.connections.at(-1).kind, 'pivot');
    const compiled = compileAssembly(after);
    assert.ok(
      compiled.connections.every((c) => c.reasonCode === 'OK'),
      JSON.stringify(compiled.connections),
    );
    assert.equal(compiledJoint(compiled, 'revolute').length, 4, 'two hinges and two pins');
    // Two millimetres off is not a closure.
    const off = parallelogram({ closeOffset: 0.002 });
    const v = await createWorkshop(off.blueprint);
    try {
      assert.equal(
        (await v.act({ type: 'surface-mount', ...off.closing })).reasonCode,
        'INCOMPATIBLE_CONNECTION_LOOP',
      );
      await assertRejectedEditUnchanged(v, { type: 'surface-mount', ...off.closing });
    } finally {
      v.dispose();
    }
  } finally {
    w.dispose();
  }
  // The editor-assembly-only case keeps its rejection: a receiver held through the editor group only.
  const bp = blueprint([
    createPart('chassis', 'base', [0, 1, 0]),
    createPart('beam', 'arm', [0, 2, 0]),
    createPart('spacerBlock', 'block', [1, 2, 0]),
  ]);
  bp.assemblies = [{ id: 'g', name: 'Group', ids: ['arm', 'block'], ports: [] }];
  assert.throws(
    () =>
      mount(bp, {
        part: 'block',
        sourceRegion: 'bottom',
        targetPart: 'arm',
        targetRegion: 'top',
        u: 0,
        v: 0,
        twist: 0,
        id: 'x',
        assemblyId: 'g',
      }),
    /MOUNT_HELD_BY_ANOTHER_CONNECTION/,
  );
  // Positive control: the bridge that closes a fixed loop through connect still loads and compiles.
  const bridge = createPassiveSuspensionCart();
  assert.ok(compileAssembly(bridge).connections.every((c) => c.reasonCode === 'OK'));
});

test('a joint angle sensor bound to a pivot edge reads the swing, and unbinds when the pin goes', async () => {
  const bp = pinnedPair({ u: 0.15, twist: 0 });
  bp.parts.push(
    createPart('jointAngleSensor', 'sensor', [1, 1, 0]),
    createPart('powerCell', 'cell', [2, 1, 0]),
  );
  bp.connections.push({
    id: 'pw',
    kind: 'power',
    a: { part: 'cell', port: 'power' },
    b: { part: 'sensor', port: 'power' },
  });
  const w = await createWorkshop(bp);
  try {
    assert.equal(
      (await w.act({ type: 'bind-joint-sensor', id: 'sensor', connection: 'head' })).ok,
      true,
    );
    assert.equal((await w.act({ type: 'run' })).ok, true);
    const angleOf = () => {
      const f = w.observe().frames[0];
      const a = rotateVector(f.physics[bodyOf(bp, 'beamA')].rotation, [1, 0, 0]),
        b = rotateVector(f.physics[bodyOf(bp, 'beamB')].rotation, [1, 0, 0]);
      return Math.atan2(a[0] * b[2] - a[2] * b[0], dot(a, b));
    };
    const reading = () =>
      w.observe().frames[0].power.sensors.find((s) => s.kind === 'jointAngle').channels.angle;
    w.step(2);
    const r0 = reading(),
      a0 = angleOf();
    assert.equal(r0.status, 'valid');
    w.step(240);
    const swing = angleOf() - a0,
      delta = reading().value - r0.value;
    assert.ok(
      Math.abs(Math.abs(delta) - Math.abs(swing)) < 0.02,
      `sensor change ${delta} vs swing ${swing}`,
    );
    assert.equal((await w.act({ type: 'build' })).ok, true);
    assert.equal((await w.act({ type: 'delete', id: 'pin' })).ok, true);
    assert.equal(
      w.observe().frames[0].metadata.blueprint.parts.find((p) => p.id === 'sensor').jointBinding,
      undefined,
    );
  } finally {
    w.dispose();
  }
});

test('a driven parallelogram keeps the rocker parallel to the crank with millimetre joint drift and no link contact', async () => {
  const { blueprint: open, closing } = parallelogram();
  const w = await createWorkshop(open);
  try {
    assert.equal((await w.act({ type: 'surface-mount', ...closing })).ok, true);
    const bp = w.observe().frames[0].metadata.blueprint,
      compiled = compileAssembly(bp),
      revolutes = compiledJoint(compiled, 'revolute');
    assert.equal((await w.act({ type: 'run' })).ok, true);
    const yaw = (index) => {
      const a = rotateVector(w.observe().frames[0].physics[index].rotation, [1, 0, 0]);
      return Math.atan2(a[2], a[0]);
    };
    const drift = () => {
      const f = w.observe().frames[0];
      return Math.max(
        ...revolutes.map((j) => {
          const wa = add(f.physics[j.a].position, rotateVector(f.physics[j.a].rotation, j.anchorA)),
            wb = add(f.physics[j.b].position, rotateVector(f.physics[j.b].rotation, j.anchorB));
          return norm(sub(wa, wb));
        }),
      );
    };
    const crank = bodyOf(bp, 'crank'),
      rocker = bodyOf(bp, 'rocker');
    const start = yaw(rocker) - yaw(crank);
    let contacts = 0;
    for (const duty of [0.667, -0.667]) {
      assert.equal((await w.act({ type: 'control', id: 'receiver', duty })).ok, true);
      for (let i = 0; i < 20; i++) {
        w.step(30);
        assert.ok(Math.abs(yaw(rocker) - yaw(crank) - start) < 0.02, 'rocker tracks the crank');
        assert.ok(drift() < 1e-3, `joint drift ${drift()}`);
        contacts += (w.observe().frames[0].contacts?.rows ?? []).filter((c) =>
          [c.a, c.b].every((i) => [crank, rocker, bodyOf(bp, 'coupler')].includes(i)),
        ).length;
      }
    }
    assert.equal(contacts, 0, 'no contact among links');
  } finally {
    w.dispose();
  }
});

test('mirroring and reusable-assembly instantiation keep the pivot kind and its endpoints', async () => {
  const bp = pinnedPair({ u: 0.1, twist: 0.3 });
  bp.parts.push(createPart('chassis', 'reference', [-3, 1, 0]));
  const w = await createWorkshop(bp);
  try {
    const mirrored = await w.act({
      type: 'mirror-assembly',
      ids: ['beamA', 'pin', 'beamB'],
      referenceId: 'reference',
      axis: 'x',
    });
    assert.equal(mirrored.ok, true, JSON.stringify(mirrored));
    const after = w.observe().frames[0].metadata.blueprint;
    const pivots = after.connections.filter((c) => c.kind === 'pivot');
    assert.equal(pivots.length, 2, 'the copy keeps its pivot');
    for (const c of pivots)
      assert.ok(c.a.surface && c.b.surface, 'both endpoints stay surface bindings');
    const compiled = compileAssembly(after);
    assert.ok(
      compiled.connections.every((c) => c.reasonCode === 'OK'),
      JSON.stringify(compiled.connections),
    );
    assert.equal(compiledJoint(compiled, 'revolute').length, 2);
  } finally {
    w.dispose();
  }
  // A reusable assembly exposing a pin head as a port alias instantiates its attachment as a pivot.
  const source = pinnedPair({ u: 0.1, twist: 0 });
  const { definition } = captureAssembly(source, {
    name: 'Pinned arm',
    ids: ['beamA', 'pin', 'beamB'],
    ports: [{ name: 'Foot', endpoint: surface('beamA', 'bottom') }],
  });
  const inserted = insertAssembly(source, definition, [0, 3, 0], [0, 0, 0, 1]).blueprint;
  assert.equal(inserted.connections.filter((c) => c.kind === 'pivot').length, 2);
});
