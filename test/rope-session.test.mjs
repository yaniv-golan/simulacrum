import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../src/simulation/session.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { deterministicProjection, DT } from '../src/model/tick.mjs';
import { replayBundle } from '../scripts/replay.mjs';
function configuration(taut) {
  const bp = createEmptyBlueprint('rope-session', 'Rope session');
  bp.parts = [createPart('beam', 'a', [0, 3, 0]), createPart('plate', 'b', [0, 1, 0])];
  bp.connections = [
    {
      id: 'r',
      kind: 'rope',
      a: { part: 'a', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
      rope: { restLength: taut ? 1.97 : 2.5, diameter: 0.02, segments: 8, material: 'nylon' },
    },
  ];
  const c = compileAssembly(bp, { ground: null }).configuration;
  c.bodies[0].fixed = true;
  return c;
}
const frame = (s) => s.observe().frames.at(-1);
const identity = { build: 'rope-session-witness', runtime: process.version };
test('rope session slack/taut checkpoints preserve pending input, fractional clock and full continuation', async () => {
  for (const taut of [false, true]) {
    const c = configuration(taut),
      a = await createSession(c, identity),
      b = await createSession(c, identity);
    try {
      a.step(taut ? 60 : 1);
      assert.equal(a.act({ type: 'impulse', body: 1, value: [0.0001, 0, 0] }).ok, true);
      a.advanceTime(2);
      const cp = JSON.parse(JSON.stringify(a.checkpoint())),
        before = deterministicProjection(frame(a));
      b.restore(cp);
      assert.deepEqual(deterministicProjection(frame(b)), before);
      assert.deepEqual(b.checkpoint(), cp);
      const trace = [];
      for (let tick = 0; tick < 60; tick++) {
        if (tick === 17) {
          const command = { type: 'impulse', body: 1, value: [-0.0002, 0, 0] };
          a.act(command);
          b.act(command);
        }
        a.step(1);
        b.advanceTime(DT * 1000);
        assert.deepEqual(deterministicProjection(frame(b)), deterministicProjection(frame(a)));
        trace.push(deterministicProjection(frame(a)));
      }
      const oldCursor = a.observe().cursor;
      a.restore(cp);
      assert.equal(a.observe('scene', 'full', oldCursor).reasonCode, 'RESYNC_REQUIRED');
      for (let tick = 0; tick < 60; tick++) {
        if (tick === 17) a.act({ type: 'impulse', body: 1, value: [-0.0002, 0, 0] });
        a.step(1);
        assert.deepEqual(deterministicProjection(frame(a)), trace[tick]);
      }
    } finally {
      a.dispose();
      b.dispose();
    }
  }
});
test('rope session rejected restores preserve cursor, physics, force readings, energy and future inputs', async () => {
  const s = await createSession(configuration(true), identity);
  try {
    s.step(60);
    s.act({ type: 'impulse', body: 1, value: [0.0001, 0, 0] });
    s.advanceTime(2);
    const cp = s.checkpoint(),
      cursor = s.observe().cursor,
      before = deterministicProjection(frame(s));
    for (const edit of [
      (p) => (p.energy.ropeWorkJ += 1),
      (p) => {
        // Matching redundant copies must still describe a possible work ledger.
        p.energy.ropeWorkJ += 1;
        const bytes = Uint8Array.from(p.physics),
          size = new DataView(bytes.buffer).getUint32(4),
          metadata = JSON.parse(new TextDecoder().decode(bytes.slice(12, 12 + size)));
        metadata.ropeWork.ropeWorkJ += 1;
        const header = new TextEncoder().encode(JSON.stringify(metadata)),
          bad = new Uint8Array(12 + header.length + bytes.length - 12 - size),
          view = new DataView(bad.buffer);
        view.setUint32(0, 0x53494d31);
        view.setUint32(4, header.length);
        bad.set(header, 12);
        bad.set(bytes.slice(12 + size), 12 + header.length);
        let hash = 2166136261;
        for (const b of bad.subarray(12)) hash = Math.imul(hash ^ b, 16777619);
        view.setUint32(8, hash >>> 0);
        p.physics = [...bad];
      },
      (p) => (p.energy.ropeDampingWorkJ = -1),
      (p) => (p.energy.ropePotentialJ = -1),
      (p) => (p.energy.ropePotentialJ += 1),
      (p) => (p.physics[p.physics.length - 1] ^= 1),
      (p) => (p.pending[0].command.body = 999),
      (p) => (p.accumulator = -1),
    ]) {
      const bad = structuredClone(cp);
      edit(bad);
      assert.throws(() => s.restore(bad));
      assert.deepEqual(s.checkpoint(), cp);
      assert.deepEqual(s.observe().cursor, cursor);
      assert.deepEqual(deterministicProjection(frame(s)), before);
      assert.equal(s.failureBundle(), null);
    }
    s.step(1);
    const next = deterministicProjection(frame(s));
    s.restore(cp);
    s.step(1);
    assert.deepEqual(deterministicProjection(frame(s)), next);
  } finally {
    s.dispose();
  }
});
test('rope failure bundle replays recorded commands from a restored nonzero anchor and rejects wrong traces', async () => {
  const s = await createSession(configuration(true), identity);
  try {
    s.step(30);
    s.act({ type: 'impulse', body: 1, value: [0.0001, 0, 0] });
    const cp = s.checkpoint();
    s.restore(cp);
    s.step(5);
    s.act({ type: 'impulse', body: 1, value: [100, 0, 0] });
    assert.throws(() => s.step(1));
    const bundle = JSON.parse(JSON.stringify(s.failureBundle()));
    assert.equal(bundle.anchor.tick, 30);
    assert.equal(bundle.reasonCode, 'ROPE_MOTION_LIMIT');
    assert.equal(
      (
        await replayBundle(bundle, {
          expectedBuild: identity.build,
          expectedRuntime: identity.runtime,
        })
      ).matched,
      true,
    );
    const wrong = structuredClone(bundle);
    wrong.inputs.at(-1).command.value = [0, 0, 0];
    await assert.rejects(() => replayBundle(wrong));
    s.restore(cp);
    s.step(6);
    assert.equal(s.failureBundle(), null);
  } finally {
    s.dispose();
  }
});
