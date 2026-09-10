import assert from 'node:assert/strict';
import {
  createArticulatedSuspensionBench,
  createManualActiveSuspensionBench,
  createActiveSuspensionBench,
  createPinEndedStrut,
} from '../../src/model/fixtures/articulated-suspension.mjs';
import { compileAssembly } from '../../src/model/assembly.mjs';
import { createPhysicsWorld } from '../../src/simulation/physics/world.mjs';
import { createSession } from '../../src/simulation/session.mjs';
import { createWorkshop } from '../../src/core/workshop.mjs';
import { createEmptyBlueprint, createPart, loadSave } from '../../src/model/blueprint.mjs';
import { captureAssembly, insertAssembly } from '../../src/model/reusable-assemblies.mjs';
import { CATALOG } from '../../src/model/catalog.mjs';
import { rotateVector, solidsOverlap, placementEnvelopes } from '../../src/model/surfaces.mjs';

export function configuration(bp) {
  const result = compileAssembly(bp);
  assert.ok(result.connections.every((c) => c.reasonCode === 'OK'));
  assert.ok(result.configuration.bodies.slice(0, bp.parts.length).every((b) => !b.fixed));
  return result.configuration;
}

export function sample(session, bp, target) {
  const o = session.observe().frames[0];
  assert.equal(o.status, 'ready');
  assert.equal(o.contacts.available, true);
  assert.equal(o.contacts.sampleTick, o.tick, 'support uses current completed contacts');
  assert.equal(o.contacts.intervalSeconds, 1 / 120);
  assert.ok(Number.isFinite(o.springs[0].length));
  return {
    tick: o.tick,
    length: o.springs[0].length,
    support: supportFor(o.contacts.rows, bp.parts.length, bp),
    target,
    cell: o.power.cells[0]?.energyJ,
  };
}

// One gram of supported weight, independently calibrated against a1kg rest/touch control.
const SUPPORT_FLOOR_N = 0.01;

export function supportFor(contacts, ground, bp) {
  const support = {};
  for (const c of contacts) {
    if (c.a !== ground && c.b !== ground) continue;
    if (c.normalImpulse === null) continue; // Touching/speculative contacts carry no measured impulse.
    assert.ok(c.normalImpulse?.every(Number.isFinite), 'finite contact impulse required');
    const body = c.a === ground ? c.b : c.a;
    const force = (c.a === ground ? 1 : -1) * c.normalImpulse[1] * 120;
    if (force > SUPPORT_FLOOR_N) {
      const id = bp.parts[body].id;
      support[id] = (support[id] ?? 0) + force;
    }
  }
  return support;
}

export function supported(rows) {
  assert.ok(rows.length > 0);
  for (let i = 1; i < rows.length; i++)
    assert.equal(rows[i].tick, rows[i - 1].tick + 1, 'support history must be consecutive');
  for (const row of rows)
    for (const id of Object.keys(row.support))
      assert.ok(['wheel', 'foot'].includes(id), `unexpected support ${id}`);
  for (const id of ['wheel', 'foot']) {
    assert.ok(
      rows.some((r) => (r.support[id] ?? 0) > SUPPORT_FLOOR_N),
      `${id} carries load`,
    );
    // Every rolling100ms window must carry positive load; single-tick contact
    // chatter is not mistaken for continuous support or a complete loss of it.
    for (let end = 12; end <= rows.length; end++)
      assert.ok(
        rows.slice(end - 12, end).reduce((sum, r) => sum + (r.support[id] ?? 0), 0) / 12 >
          SUPPORT_FLOOR_N,
        `${id} sustained support`,
      );
  }
}

export function tracking(rows) {
  assert.equal(rows.length, 100);
  assert.ok(rows.every((r) => Number.isFinite(r.length) && Number.isFinite(r.target)));
  supported(rows);
  assert.ok(
    Math.max(...rows.map((r) => Math.abs(r.length - r.target))) <= 0.005,
    'tracking error exceeds 5 mm',
  );
  assert.ok(
    Math.max(...rows.map((r) => r.length)) - Math.min(...rows.map((r) => r.length)) <= 0.005,
    'oscillation exceeds 5 mm',
  );
}

export async function automatic(material, disabled = false) {
  const bp = createActiveSuspensionBench();
  bp.parts.find((p) => p.id === 'arm').authoredMaterial.body = material;
  if (disabled) bp.parts.find((p) => p.type === 'positionRegulator').parameters.enabled = 0;
  const node = bp.parts.findIndex((p) => p.id === 'rocker-receiver'),
    s = await createSession(configuration(bp)),
    windows = [];
  try {
    assert.ok(s.act({ type: 'receiver-mode', node, mode: 'automatic' }).ok);
    for (const target of [0.26, 0.3, 0.33]) {
      assert.ok(s.act({ type: 'regulator-target', node, target }).ok);
      const rows = [];
      for (let t = 0; t < 400; t++) {
        s.step();
        const r = sample(s, bp, target);
        assert.ok(r.length > 0.08 && r.length < 0.4, 'no travel stop');
        if (t >= 300) rows.push(r);
      }
      windows.push(rows);
    }
    return windows;
  } finally {
    s.dispose();
  }
}

export function worldPoint(frame, index, local) {
  return rotateVector(frame.physics[index].rotation, local).map(
    (x, k) => x + frame.physics[index].position[k],
  );
}

export function checkPinFrames(frame, joints) {
  for (const j of joints.filter((j) => j.kind === 'revolute')) {
    const a = worldPoint(frame, j.a, j.anchorA),
      b = worldPoint(frame, j.b, j.anchorB);
    assert.ok(Math.hypot(...a.map((v, k) => v - b[k])) < 1e-6, 'pin anchors coincide');
    const aa = rotateVector(frame.physics[j.a].rotation, j.axisA),
      bb = rotateVector(frame.physics[j.b].rotation, j.axisB);
    assert.ok(
      Math.hypot(...aa.map((v, k) => v - bb[k])) < 1e-6,
      'pin axes preserve their forbidden angular DOFs',
    );
  }
  const spring = joints.find((j) => j.kind === 'spring'),
    observed = frame.springs[0];
  for (const [body, anchor, point] of [
    [spring.a, spring.anchorA, observed.pointA],
    [spring.b, spring.anchorB, observed.pointB],
  ])
    assert.ok(
      Math.hypot(...worldPoint(frame, body, anchor).map((v, k) => v - point[k])) < 1e-12,
      'completed spring endpoint follows actual body',
    );
}

export function swivelled(start, end) {
  const initial = rotateVector(start.physics[0].rotation, [0, 1, 0]),
    final = rotateVector(end.physics[0].rotation, [0, 1, 0]);
  assert.ok(
    Math.hypot(...initial.map((v, k) => v - final[k])) > 1e-4,
    'strut must swivel above geometric precision',
  );
}

export function pinRotation(start, frame, joint) {
  const initialA = start.physics[joint.a].rotation,
    initialB = start.physics[joint.b].rotation;
  const inverseB = [-initialB[0], -initialB[1], -initialB[2], initialB[3]];
  const localB = rotateVector(inverseB, rotateVector(initialA, [0, 1, 0]));
  const a = rotateVector(frame.physics[joint.a].rotation, [0, 1, 0]);
  const b = rotateVector(frame.physics[joint.b].rotation, localB);
  return Math.hypot(...a.map((v, k) => v - b[k]));
}

export function bothPinsMove(values) {
  assert.ok(
    values.every((v) => v > 1e-4),
    'both spring-end pins must rotate',
  );
}

export async function loadRejection(variant = 'automatic') {
  const bp = createActiveSuspensionBench();
  if (variant === 'reversed')
    bp.parts.find((p) => p.type === 'positionRegulator').parameters.polarity = 1;
  if (variant === 'disconnected')
    bp.connections = bp.connections.filter((c) => c.id !== 'automatic-command');
  if (variant === 'depleted') bp.parts.find((p) => p.type === 'powerCell').parameters.capacityJ = 1;
  // 8 N m/A ×0.01 A =0.08 N m, below the 10 N load's ordinary rocker moment.
  if (variant === 'saturated')
    bp.parts.find((p) => p.type === 'poweredHinge').parameters.currentLimit = 0.01;
  const s = await createSession(configuration(bp)),
    node = bp.parts.findIndex((p) => p.id === 'rocker-receiver'),
    arm = bp.parts.findIndex((p) => p.id === 'arm');
  const windows = [];
  try {
    assert.ok(s.act({ type: 'receiver-mode', node, mode: 'automatic' }).ok);
    const targetReceipt = s.act({ type: 'regulator-target', node, target: 0.3 });
    assert.equal(targetReceipt.ok, variant !== 'disconnected');
    let maximumCurrent = 0;
    for (let tick = 0; tick < 600; tick++) {
      s.step();
      if (variant === 'saturated') {
        const current = Math.abs(s.observe().frames[0].power.motors[0].current);
        assert.ok(current <= 0.01 + 1e-12, 'authored current ceiling must be enforced');
        maximumCurrent = Math.max(maximumCurrent, current);
      }
    }
    if (variant === 'saturated')
      assert.ok(maximumCurrent >= 0.01 - 1e-12, 'under-rated motor must actually saturate');
    let heldDuty = null;
    if (variant === 'manual-held') {
      heldDuty = s.observe().frames[0].receiverControl.receivers.find((r) => r.node === node).duty;
      assert.ok(s.act({ type: 'receiver', node, duty: heldDuty }).ok);
    }
    for (const load of [10, 0]) {
      const rows = [];
      let absoluteExternalWork = 0;
      for (let tick = 0; tick < 600; tick++) {
        if (load) assert.ok(s.act({ type: 'impulse', body: arm, value: [0, -load / 120, 0] }).ok);
        s.step();
        const f = s.observe().frames[0],
          r = sample(s, bp, 0.3);
        r.control = f.receiverControl.receivers.find((r) => r.node === node);
        if (heldDuty !== null) {
          const control = f.receiverControl.receivers.find((r) => r.node === node);
          assert.equal(control.mode, 'manual');
          assert.equal(control.duty, heldDuty, 'open-loop output stays at the pre-load value');
        }
        assert.ok(r.length > 0.08 && r.length < 0.4, 'no travel stop under applied load');
        assert.ok(Number.isFinite(f.energy.externalWorkJ), 'applied work is recorded');
        absoluteExternalWork += Math.abs(f.energy.externalWorkJ);
        assert.ok(
          Math.abs(f.physics[arm].velocity[1]) < 1,
          'applied-load apparatus stays below 1 m/s',
        );
        assert.ok(Math.abs(f.energy.balanceResidualJ) < 1e-5, 'external work stays in the ledger');
        if (tick >= 240) rows.push(r);
      }
      if (load)
        assert.ok(
          absoluteExternalWork > 0 && absoluteExternalWork < 50,
          '10 N applied load work fits the 1 m/s, 5 s laboratory envelope',
        );
      else assert.equal(absoluteExternalWork, 0, 'removing applied load leaves no external work');
      windows.push(rows);
    }
    return windows;
  } finally {
    s.dispose();
  }
}

export function recovered(rows) {
  assert.equal(rows.length, 360, 'three-second recovery hold');
  supported(rows);
  assert.ok(
    rows.every((r) => Number.isFinite(r.length) && Math.abs(r.length - 0.3) <= 0.005),
    'load recovery error exceeds 5 mm',
  );
  assert.ok(
    Math.max(...rows.map((r) => r.length)) - Math.min(...rows.map((r) => r.length)) <= 0.005,
    'load recovery oscillation exceeds 5 mm',
  );
}

export function clearanceChecker(bp, config) {
  const parent = bp.parts.map((_, i) => i),
    root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  for (const joint of config.joints)
    if (joint.kind === 'fixed') parent[root(joint.a)] = root(joint.b);
  const mated = (a, b) =>
    root(a) === root(b) ||
    config.joints.some(
      (j) => j.kind === 'revolute' && ((j.a === a && j.b === b) || (j.a === b && j.b === a)),
    );
  return (frame) => {
    const parts = bp.parts.map((p, i) => ({
      ...p,
      position: frame.physics[i].position,
      rotation: frame.physics[i].rotation,
    }));
    const spring = frame.springs[0],
      axis = spring.pointB.map((v, i) => (v - spring.pointA[i]) / spring.length);
    const angle = Math.acos(Math.max(-1, Math.min(1, -axis[1])));
    for (const joint of config.joints.filter(
      (j) => j.kind === 'revolute' && ['upper-pin', 'lower-pin'].includes(bp.parts[j.a].id),
    ))
      assert.ok(
        pinRotation({ physics: config.bodies }, frame, joint) < 2 * Math.sin(0.35 / 2),
        'spring-end pin stays within declared0.35 rad excursion',
      );
    assert.ok(angle < 0.05, 'bench strut tilt stays within the declared 0.05 rad envelope');
    const q = [0, -axis[2], axis[1], 1 + axis[0]],
      norm = Math.hypot(...q);
    // Circumscribe the whole decorative coil, including wire thickness. Inflating
    // the radius compensates for the64-sided collision approximation.
    const radius = 0.0445 / Math.cos(Math.PI / 64),
      coil = {
        position: spring.pointA.map((v, i) => (v + spring.pointB[i]) / 2),
        rotation: q.map((v) => v / norm),
        envelopeHalf: [spring.length / 2 - 0.0025, radius, radius],
        envelopeKind: 'cylinder',
      };
    const envelopes = parts.map(placementEnvelopes);
    for (let a = 0; a < parts.length; a++) {
      if (a !== spring.bodyA && a !== spring.bodyB)
        assert.ok(
          !envelopes[a].some((p) => solidsOverlap(p, coil)),
          `coil clearance at ${parts[a].id}`,
        );
      for (let b = a + 1; b < parts.length; b++)
        if (!mated(a, b))
          assert.ok(
            !envelopes[a].some((x) => envelopes[b].some((y) => solidsOverlap(x, y))),
            `moving hardware clearance ${parts[a].id}/${parts[b].id}`,
          );
    }
    return angle;
  };
}
