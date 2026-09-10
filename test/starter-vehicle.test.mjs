import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createStarterVehicle } from '../src/model/starter-vehicle.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { deterministicProjection } from '../src/model/tick.mjs';
import { finalRollingIntervals } from '../scripts/starter-motion.mjs';
import { sourceIdentity } from '../scripts/source-identity.mjs';
import { appFingerprint } from '../scripts/build-fingerprint.mjs';
const horizontal = (a, b) => Math.hypot(a[0] - b[0], a[2] - b[2]);
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const protocol = Object.freeze({
  version: 2,
  ticks: 3600,
  minimumExcursion: 2,
  minimumFinalTenSecondsTravel: 0.3,
  maximumPowerlessTravel: 0.1,
  minimumHousingClearance: 0.005,
});
function assessPoweredMotion({ maximumExcursion, finalSamples }) {
  assert.ok(maximumExcursion > protocol.minimumExcursion, `excursion ${maximumExcursion}`);
  const intervals = finalRollingIntervals(finalSamples);
  const sampledTravel = intervals.reduce((sum, value) => sum + value, 0);
  assert.ok(sampledTravel > protocol.minimumFinalTenSecondsTravel);
  return { intervals, sampledTravel };
}
function lowerFace(body, halfExtents) {
  const [x, y, z, w] = body.rotation;
  return (
    body.position[1] -
    Math.abs(2 * (x * y + w * z)) * halfExtents[0] -
    Math.abs(1 - 2 * (x * x + z * z)) * halfExtents[1] -
    Math.abs(2 * (y * z - w * x)) * halfExtents[2]
  );
}

test('ordinary starter travels continuously for thirty seconds with powerless control', async () => {
  const evidence = [];
  for (const powered of [true, false]) {
    const blueprint = createStarterVehicle({ powered }),
      compiled = compileAssembly(blueprint);
    assert.ok(compiled.connections.every((c) => c.reasonCode === 'OK'));
    const session = await createSession(compiled.configuration),
      start = session.observe().frames[0].physics[0].position;
    let middle,
      checkpoint,
      minimumClearance = Infinity,
      maximumExcursion = 0,
      pathTravel = 0,
      previousPosition = start;
    const samples = [],
      hashes = [];
    try {
      for (let tick = 1; tick <= protocol.ticks; tick++) {
        session.step(1);
        const frame = session.observe().frames[0];
        assert.equal(frame.status, 'ready');
        maximumExcursion = Math.max(maximumExcursion, horizontal(frame.physics[0].position, start));
        pathTravel += horizontal(frame.physics[0].position, previousPosition);
        previousPosition = frame.physics[0].position;
        minimumClearance = Math.min(
          minimumClearance,
          lowerFace(frame.physics[1], compiled.configuration.bodies[1].halfExtents),
        );
        hashes.push(digest(deterministicProjection(frame)));
        if (tick === 1200) checkpoint = session.checkpoint();
        if (tick === 2400) middle = frame.physics[0].position;
        if (tick % 120 === 0)
          samples.push({
            tick,
            physics: [{ position: frame.physics[0].position }],
            position: frame.physics[0].position,
            motor: frame.power.motors[0],
            cell: frame.power.cells[0],
          });
      }
      const end = session.observe().frames[0],
        travel = horizontal(end.physics[0].position, start),
        finalTravel = horizontal(end.physics[0].position, middle);
      const result = {
        powered,
        blueprint,
        configuration: compiled.configuration,
        protocol,
        inputTrace: [],
        start,
        travel,
        finalTravel,
        minimumClearance,
        maximumExcursion,
        pathTravel,
        samples,
        hashes,
      };
      evidence.push(result);
      assert.ok(
        minimumClearance > protocol.minimumHousingClearance,
        `housing clearance ${minimumClearance}`,
      );
      if (powered) {
        result.finalRolling = assessPoweredMotion({
          maximumExcursion,
          finalSamples: samples.filter((row) => row.tick >= 2400),
        });
        assert.ok(end.power.cells[0].energyJ < blueprint.parts[2].parameters.capacityJ);
      } else {
        assert.ok(travel < protocol.maximumPowerlessTravel, `unpowered drift ${travel}`);
        assert.equal(end.power.motors[0].shaftWorkJ, 0);
      }
      session.restore(checkpoint);
      for (let tick = 1201; tick <= protocol.ticks; tick++) {
        session.step(1);
        assert.equal(
          digest(deterministicProjection(session.observe().frames[0])),
          hashes[tick - 1],
          `replay tick ${tick}`,
        );
      }
    } finally {
      session.dispose();
    }
  }
  mkdirSync('artifacts/starter-vehicle', { recursive: true });
  writeFileSync(
    'artifacts/starter-vehicle/qualification.json',
    JSON.stringify(
      {
        source: sourceIdentity(),
        build: appFingerprint(),
        runtime: process.version,
        platform: process.platform,
        architecture: process.arch,
        evidence,
      },
      null,
      2,
    ) + '\n',
  );
});
test('starter compiled physics ignores identifiers and wrong traces are rejected', () => {
  const bp = createStarterVehicle(),
    renamed = structuredClone(bp),
    ids = new Map(renamed.parts.map((p, i) => [p.id, `renamed-${i}`]));
  renamed.id = 'different';
  renamed.name = 'Different';
  for (const p of renamed.parts) {
    p.id = ids.get(p.id);
    p.name = 'Changed';
  }
  for (const c of renamed.connections) {
    c.id = `other-${c.id}`;
    c.a.part = ids.get(c.a.part);
    c.b.part = ids.get(c.b.part);
  }
  assert.deepEqual(compileAssembly(bp).configuration, compileAssembly(renamed).configuration);
  const original = { tick: 3600, position: [0, 0, 2.1] };
  assert.throws(() => assert.deepEqual({ ...original, tick: 3599 }, original));
  const wrong = structuredClone(bp);
  wrong.parts[1].parameters.torqueConstant = 0.1;
  assert.notDeepEqual(compileAssembly(wrong).configuration, compileAssembly(bp).configuration);
});

test('starter motion requires spatial excursion and every final rolling interval, while allowing a loop', () => {
  const circle = Array.from({ length: 11 }, (_, i) => ({
    tick: 2400 + i * 120,
    physics: [
      { position: [2 * Math.cos((i * Math.PI) / 5), 0.1, 2 * Math.sin((i * Math.PI) / 5)] },
    ],
  }));
  const initial = circle[0].physics[0].position;
  const maximumExcursion = Math.max(
    ...circle.map((s) => horizontal(s.physics[0].position, initial)),
  );
  assert.ok(horizontal(circle.at(-1).physics[0].position, initial) < 1e-12);
  assert.equal(
    assessPoweredMotion({ maximumExcursion, finalSamples: circle }).intervals.length,
    10,
  );
  // High-frequency jitter can accumulate path length while staying near its origin.
  const jitter = structuredClone(circle);
  jitter.forEach((s, i) => {
    s.physics[0].position = [i % 2 ? 0.01 : -0.01, 0.1, 0];
  });
  assert.throws(
    () => assessPoweredMotion({ maximumExcursion: 0.02, finalSamples: jitter }),
    /excursion/,
  );
  const stopped = structuredClone(circle);
  for (let i = 6; i < stopped.length; i++) stopped[i].physics = structuredClone(stopped[5].physics);
  assert.throws(
    () => assessPoweredMotion({ maximumExcursion, finalSamples: stopped }),
    /movement stopped/,
  );
  assert.throws(
    () => assessPoweredMotion({ maximumExcursion, finalSamples: circle.slice(1) }),
    /coverage/,
  );
});
