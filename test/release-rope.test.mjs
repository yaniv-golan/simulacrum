import test from 'node:test';
import assert from 'node:assert/strict';
import { couplerFixture } from './contracts/release.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createPart } from '../src/model/blueprint.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection, DT } from '../src/model/tick.mjs';
import { releasedAttachment } from '../src/presentation/release-state.mjs';

const frame = (s) => s.observe().frames.at(-1);
function blueprint() {
  const bp = couplerFixture();
  bp.connections.push({
    id: 'tether',
    kind: 'rope',
    a: structuredClone(bp.connections[0].a),
    b: { part: 'cargo', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
    rope: { restLength: 0.25, diameter: 0.01, segments: 4, material: 'nylon' },
  });
  return bp;
}
function configuration(tether = true, fixed = true) {
  const bp = couplerFixture();
  if (tether) {
    const cargo = bp.parts[1];
    bp.parts.push(
      createPart('spacerBlock', 'post', [cargo.position[0], cargo.position[1] + 0.53, 0]),
    );
    bp.connections.push({
      id: 'tether',
      kind: 'rope',
      a: { part: 'post', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
      b: { part: 'cargo', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
      rope: { restLength: 0.5, diameter: 0.01, segments: 4, material: 'nylon' },
    });
  }
  const c = compileAssembly(bp, {
    gravity: fixed ? [0, -9.81, 0] : [0, 0, 0],
    ground: null,
  }).configuration;
  c.bodies[0].fixed = fixed;
  if (tether) c.bodies[4].fixed = fixed;
  return c;
}
function metadata(physics) {
  const bytes = Uint8Array.from(physics),
    size = new DataView(bytes.buffer).getUint32(4);
  return JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + size)));
}
function rewrite(physics, edit) {
  const bytes = Uint8Array.from(physics),
    size = new DataView(bytes.buffer).getUint32(4);
  const meta = metadata(physics);
  edit(meta);
  const header = new TextEncoder().encode(JSON.stringify(meta));
  const out = new Uint8Array(12 + header.length + bytes.length - 12 - size);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x53494d31);
  view.setUint32(4, header.length);
  out.set(header, 12);
  out.set(bytes.slice(12 + size), 12 + header.length);
  let hash = 2166136261;
  for (const byte of out.subarray(12)) hash = Math.imul(hash ^ byte, 16777619);
  view.setUint32(8, hash >>> 0);
  return [...out];
}

test('release labels distinguish the fixed latch from a retained rope on the same face', () => {
  const bp = blueprint(),
    open = [{ node: 0, opened: true }];
  assert.equal(releasedAttachment(bp.connections[0], bp.parts, open), true);
  assert.equal(releasedAttachment(bp.connections.at(-1), bp.parts, open), false);
  assert.equal(
    releasedAttachment(bp.connections[0], bp.parts, [{ node: 0, opened: false }]),
    false,
  );
});

test('released rope checkpoints retain both families and continue exactly across both clocks', async () => {
  for (const at of [0, 2, 6, 12, 45]) {
    const c = configuration(),
      a = await createSession(c),
      b = await createSession(c);
    try {
      assert.equal(a.act({ type: 'receiver', node: 3, duty: 1 }).ok, true);
      a.step(at);
      const cp = a.checkpoint(),
        header = metadata(cp.physics);
      assert.equal(header.version, cp.power.couplers[0].opened ? 8 : 7);
      if (at === 0) {
        const legacy = structuredClone(cp);
        legacy.physics = rewrite(legacy.physics, (m) => {
          m.version = 6;
          delete m.ropeWork;
        });
        const beforeLegacy = b.checkpoint();
        assert.throws(() => b.restore(legacy), /rope work snapshot/);
        assert.deepEqual(b.checkpoint(), beforeLegacy);
      }
      b.restore(cp);
      assert.deepEqual(b.checkpoint(), cp);
      for (let tick = 0; tick < 20; tick++) {
        a.step(1);
        b.advanceTime(DT * 1000);
        assert.deepEqual(deterministicProjection(frame(b)), deterministicProjection(frame(a)));
      }
      assert.equal(frame(a).power.couplers[0].opened, true);
      const before = a.checkpoint(),
        cursor = a.observe().cursor;
      for (const edit of [
        (p) => {
          p.energy.ropeWorkJ += 1;
        },
        (p) => {
          p.physics = rewrite(p.physics, (m) => {
            m.opened = [];
          });
        },
        (p) => {
          p.physics = rewrite(p.physics, (m) => {
            m.ropeState = [];
          });
        },
        (p) => {
          p.physics = rewrite(p.physics, (m) => {
            delete m.gearState;
          });
        },
        (p) => {
          p.physics = rewrite(p.physics, (m) => {
            m.version = 6;
          });
        },
      ]) {
        const bad = structuredClone(before);
        edit(bad);
        assert.throws(() => a.restore(bad));
        assert.deepEqual(a.checkpoint(), before);
        assert.deepEqual(a.observe().cursor, cursor);
      }
    } finally {
      a.dispose();
      b.dispose();
    }
  }
});

test('release retains an ordinary tensile tether with powered and absent-rope controls', async () => {
  const outcomes = {};
  for (const mode of ['tethered', 'unpowered', 'untethered']) {
    const s = await createSession(configuration(mode !== 'untethered'));
    try {
      const y0 = frame(s).physics[1].position[1];
      if (mode !== 'unpowered') s.act({ type: 'receiver', node: 3, duty: 1 });
      let peakTension = 0;
      for (let tick = 0; tick < 60; tick++) {
        s.step(1);
        peakTension = Math.max(peakTension, ...(frame(s).ropes ?? []).map((r) => r.appliedTension));
      }
      outcomes[mode] = {
        opened: frame(s).power.couplers[0].opened,
        drop: y0 - frame(s).physics[1].position[1],
        peakTension,
      };
    } finally {
      s.dispose();
    }
  }
  assert.equal(outcomes.tethered.opened, true);
  // Axial extension under cargo plus half the distributed rope weight: FL/(EA).
  const area = (0.62 * Math.PI * 0.01 ** 2) / 4;
  const cargoMass = 2700 * 0.04 * 0.03 * 0.04,
    ropeMass = 1140 * area * 0.5;
  const extension = ((cargoMass + ropeMass / 2) * 9.81 * 0.5) / (1e8 * area);
  assert.ok(outcomes.tethered.drop > 0.1 * extension && outcomes.tethered.drop < 4 * extension);
  assert.ok(outcomes.tethered.peakTension > 0.01);
  assert.equal(outcomes.unpowered.opened, false);
  assert.ok(Math.abs(outcomes.unpowered.drop) < 1e-5);
  assert.ok(outcomes.untethered.drop > 0.4);
});

test('moving released rope assembly preserves independent momentum without external forces', async () => {
  const c = configuration(true, false);
  for (const body of c.bodies) body.velocity = [0.1, 0, 0];
  const s = await createSession(c);
  try {
    const momentum = (f) =>
      f.physics.reduce((sum, body, i) => sum + c.bodies[i].mass * body.velocity[0], 0);
    const p0 = momentum(frame(s));
    s.act({ type: 'receiver', node: 3, duty: 1 });
    s.step(12);
    assert.equal(frame(s).power.couplers[0].opened, true);
    assert.ok(Math.abs(momentum(frame(s)) - p0) < 1e-9);
    for (const body of frame(s).physics) assert.ok(Math.abs(body.velocity[0] - 0.1) < 1e-8);
  } finally {
    s.dispose();
  }
});
