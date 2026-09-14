import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMechanicalAudioAdapter,
  contactMotion,
} from '../src/application/mechanical-audio-adapter.mjs';
import { linearCoordinateSpeed } from '../src/model/completed-motion.mjs';
import {
  createMechanicalEvents,
  driveVoice,
  contactVoice,
  spatialMix,
  selectVoices,
} from '../src/presentation/mechanical-audio-model.mjs';
import { createMechanicalAudio } from '../src/presentation/mechanical-audio.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
const body = (changes = {}) => ({
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  angularVelocity: [0, 0, 0],
  ...changes,
});
const contact = (changes = {}) => ({
  pairKey: '0:1',
  position: [0, 0, 0],
  normalImpulseNs: 1,
  normalLoadN: 120,
  slipSpeedMS: 0,
  rollingSpeedMS: 0,
  materialPair: ['rubber', 'surface'],
  geometryClass: 'curved',
  frictionEligibility: 'positive',
  frictionResponseNs: 0,
  valid: true,
  distance: 0,
  ...changes,
});
const packet = (tick, contacts = [], changes = {}) => ({
  epoch: 1,
  tick,
  interval: 1 / 120,
  available: true,
  drives: [],
  contacts,
  ...changes,
});

test('audio contact kinematics distinguish rolling, sliding, common motion and normal spin', () => {
  const row = { localPointA: [0, -1, 0], localPointB: [0, 0, 0], normal: [0, 1, 0] };
  const sphere = { shape: 'sphere', halfExtents: [1, 1, 1] },
    flat = { shape: 'box', halfExtents: [1, 1, 1] };
  const a = body({ velocity: [1, 0, 0], angularVelocity: [0, 0, -1] });
  const roll = contactMotion(a, body(), row, sphere, flat);
  assert.equal(roll.slipSpeedMS, 0);
  assert.equal(roll.rollingSpeedMS, 1);
  assert.equal(
    contactMotion(body({ velocity: [1, 0, 0] }), body(), row, sphere, flat).slipSpeedMS,
    1,
  );
  assert.equal(
    contactMotion(body({ angularVelocity: [0, 1, 0] }), body(), row, sphere, flat).rollingSpeedMS,
    0,
  );
  assert.equal(contactMotion(a, a, row, sphere, flat).rollingSpeedMS, 0);
  assert.equal(contactMotion(a, body(), row, flat, flat).rollingSpeedMS, null);
  const platform = body({ velocity: [1, 0, 0] });
  assert.equal(
    contactMotion(body({ velocity: [1, 0, 0] }), platform, row, sphere, flat).slipSpeedMS,
    0,
  );
  assert.equal(contactMotion(body({ velocity: [NaN, 0, 0] }), body(), row, sphere, flat), null);
});

test('linear coordinate reads anchor motion and rotating guide with distinct missing measurement', () => {
  const joint = { a: 0, b: 1, anchorA: [0, 1, 0], anchorB: [0, 1, 0], axisA: [1, 0, 0] };
  assert.equal(linearCoordinateSpeed([body(), body({ velocity: [2, 0, 0] })], joint), 2);
  assert.equal(linearCoordinateSpeed([body(), body({ velocity: [-2, 0, 0] })], joint), -2);
  assert.equal(linearCoordinateSpeed([body({ angularVelocity: [0, 0, 1] }), body()], joint), 1);
  assert.equal(linearCoordinateSpeed([body()], joint), null);
  // d(axis)/dt term: a rotating guide observes a stationary transverse anchor.
  assert.equal(
    linearCoordinateSpeed(
      [body({ angularVelocity: [0, 0, 1] }), body({ position: [0, 2, 0] })],
      joint,
    ),
    3,
  );
});

test('audio adapter resolves compiled body provenance and sums physical pairs once', () => {
  const bp = createEmptyBlueprint('fixture', 'Fixture');
  bp.environment = 'rounded-bump';
  bp.parts.push(createPart('ball', 'ball', [0, 2, 0]));
  bp.parts[0].authoredMaterial.body = 'steel';
  const compiled = compileAssembly(bp),
    adapter = createMechanicalAudioAdapter();
  const frame = {
    tick: 1,
    metadata: { blueprint: bp, mode: 'run' },
    physics: compiled.configuration.bodies.map(body),
    power: { motors: [] },
    contacts: { available: true, intervalSeconds: 1 / 120, rows: [] },
  };
  const row = {
    a: 0,
    b: 1,
    available: true,
    solved: true,
    localPointA: [0, -0.04, 0],
    localPointB: [0, 0.1, 0],
    normal: [0, 1, 0],
    normalImpulse: [0, 1, 0],
    distance: 0,
    frictionImpulse: [0.2, 0, 0],
    frictionGroupSize: 2,
  };
  frame.contacts.rows = [row, { ...row, frictionImpulse: null, frictionGroupSize: 0 }];
  const p = adapter.read(frame, 1);
  assert.equal(p.contacts.length, 1);
  assert.equal(p.contacts[0].normalImpulseNs, 2);
  assert.deepEqual(p.contacts[0].materialPair, ['steel', 'surface']);
  assert.equal(p.contacts[0].frictionResponseNs, 0.2);
  frame.contacts.rows = [{ ...row, b: 2 }];
  assert.deepEqual(adapter.read(frame, 1).contacts[0].materialPair, ['steel', 'surface']);
  frame.contacts.rows = [{ ...row, b: 99 }];
  assert.equal(adapter.read(frame, 1).contacts[0].rollingSpeedMS, null);
  assert.equal(adapter.read(frame, 1).contacts[0].frictionEligibility, 'unknown');
  assert.equal(adapter.read(frame, 1).contacts[0].valid, false);
  const frictionless = structuredClone(bp);
  frictionless.parts[0].authoredContact = { body: { friction: 0 } };
  frame.metadata.blueprint = frictionless;
  frame.contacts.rows = [row];
  assert.equal(adapter.read(frame, 2).contacts[0].frictionEligibility, 'zero');
});

test('mechanical episodes reject gaps, chatter, stale ticks but retain strong rapid reimpacts', () => {
  const events = createMechanicalEvents();
  assert.equal(events.read(packet(0)).impacts.length, 0);
  assert.equal(events.read(packet(1, [contact()])).impacts.length, 1);
  assert.equal(events.read(packet(2, [contact()])).impacts.length, 0);
  events.read(packet(3));
  assert.equal(events.read(packet(4, [contact()])).impacts.length, 0);
  events.read(packet(5));
  assert.equal(events.read(packet(6, [contact({ normalImpulseNs: 5 })])).impacts.length, 1);
  assert.equal(events.read(packet(6, [contact({ normalImpulseNs: 50 })])).impacts.length, 0);
  assert.equal(events.read(packet(9, [contact({ normalImpulseNs: 50 })])).impacts.length, 0);
  assert.equal(events.read(packet(10, [contact()], { available: false })).impacts.length, 0);
  assert.equal(events.read(packet(11, [contact()])).impacts.length, 0);
  events.reset();
  assert.equal(events.read(packet(12, [contact()])).impacts.length, 0);
  assert.equal(events.read(packet(13, [contact({ valid: false })])).contacts.length, 0);
});

test('drive and friction envelopes follow measured coordinates, never requested movement', () => {
  const d = {
    emitterKey: '0',
    position: [0, 0, 0],
    coordinate: 'rotation',
    speedRadS: 100,
    currentA: 0,
    torqueNm: 0,
    currentScaleA: 2,
  };
  assert.ok(driveVoice(d).motionGain > 0);
  assert.equal(driveVoice({ ...d, speedRadS: null }).motionGain, 0);
  assert.equal(driveVoice({ ...d, speedRadS: 0, currentA: 2 }).motionGain, 0);
  assert.ok(driveVoice({ ...d, speedRadS: 0, currentA: 2 }).loadGain > 0);
  assert.equal(driveVoice({ ...d, speedRadS: -100 }).frequency, driveVoice(d).frequency);
  assert.ok(driveVoice({ ...d, speedRadS: 200 }).frequency > driveVoice(d).frequency);
  assert.equal(driveVoice({ ...d, currentA: NaN }), null);
  const linear = {
    emitterKey: '1',
    position: [0, 0, 0],
    coordinate: 'linear',
    speedMS: 0.2,
    currentA: 0,
    forceN: 10,
    currentScaleA: 2,
  };
  assert.equal(driveVoice(linear).wave, 'noise');
  assert.equal(driveVoice({ ...linear, speedMS: 0 }).motionGain, 0);
  assert.ok(contactVoice(contact({ slipSpeedMS: 1 })).scrapeGain > 0);
  assert.equal(
    contactVoice(contact({ slipSpeedMS: 1, frictionEligibility: 'zero' })).scrapeGain,
    0,
  );
  assert.equal(
    contactVoice(contact({ slipSpeedMS: 1, frictionEligibility: 'unknown' })).scrapeGain,
    0,
  );
  assert.ok(contactVoice(contact({ rollingSpeedMS: 1 })).rollGain > 0);
  assert.equal(contactVoice(contact({ rollingSpeedMS: null })).rollGain, 0);
  assert.equal(contactVoice(contact()).rollGain, 0);
});

test('layer gains are derived from the registered level and what the layer renders, not raw literals', async () => {
  const { AUDIO_POLICY, layerGain, noiseRms, TRIANGLE_RMS, triangleRms, lowpassMagnitude } =
    await import('../src/presentation/mechanical-audio-model.mjs');
  // Independent derivation of the triangle factor: a unit triangle sampled in time, its
  // spectrum scaled by the analytic second-order response written out here, summed as power.
  const q = 10 ** (AUDIO_POLICY.filterQDb / 20),
    n = 4096,
    wave = Float64Array.from({ length: n }, (_, i) => {
      const phase = (i / n) % 1;
      return phase < 0.5 ? 4 * phase - 1 : 3 - 4 * phase;
    });
  let power = 0;
  for (let k = 1; k < 200; k++) {
    let re = 0,
      im = 0;
    for (let i = 0; i < n; i++) {
      re += wave[i] * Math.cos((2 * Math.PI * k * i) / n);
      im -= wave[i] * Math.sin((2 * Math.PI * k * i) / n);
    }
    const amplitude = (2 * Math.hypot(re, im)) / n,
      ratio = k / 4,
      response = 1 / Math.sqrt((1 - ratio * ratio) ** 2 + (ratio / q) ** 2);
    power += (amplitude * response) ** 2 / 2;
  }
  const independent = Math.sqrt(power);
  assert.ok(
    Math.abs(TRIANGLE_RMS - independent) / independent < 0.02,
    `triangle factor ${TRIANGLE_RMS} vs independent ${independent}`,
  );
  assert.ok(TRIANGLE_RMS > 0.55 && TRIANGLE_RMS < 0.65, 'a filtered triangle is ≈ 0.6, not 0.8');
  assert.ok(Math.abs(lowpassMagnitude(0) - 1) < 1e-12 && lowpassMagnitude(4) < 0.1);
  // Far above its cutoff the filter passes everything: the factor tends to a triangle's own RMS
  // (1/√3). Near the cutoff the second-order peak (Q ≈ 1.06) lifts the fundamental, so the
  // factor is not monotonic in the cutoff ratio — 2f renders slightly hotter than 4f.
  assert.ok(Math.abs(triangleRms(1000) - 1 / Math.sqrt(3)) < 0.005);
  assert.ok(triangleRms(2) > triangleRms(4) && triangleRms(4) > triangleRms(0.5));
  // A narrower lowpass leaves less noise, so the gain that renders the same level is larger.
  assert.ok(noiseRms(100) < noiseRms(400) && noiseRms(400) < noiseRms(1600));
  assert.ok(Math.abs(noiseRms(400) / noiseRms(100) - 2) < 1e-9, 'noise RMS grows with √bandwidth');
  assert.ok(layerGain(1, noiseRms(100)) > layerGain(1, noiseRms(400)));
  assert.ok(
    Math.abs(layerGain(1, noiseRms(400)) * noiseRms(400) - AUDIO_POLICY.nominalRms) < 1e-12,
  );
  assert.ok(Math.abs(layerGain(1, TRIANGLE_RMS) * TRIANGLE_RMS - AUDIO_POLICY.nominalRms) < 1e-12);
  // Weight is clamped: no layer renders above the nominal level or below silence.
  assert.equal(layerGain(2, TRIANGLE_RMS), layerGain(1, TRIANGLE_RMS));
  assert.equal(layerGain(-1, TRIANGLE_RMS), 0);
  // A nominal motor and a nominal actuator render the same level despite different waveforms.
  const rotation = driveVoice({
      emitterKey: '0',
      position: [0, 0, 0],
      coordinate: 'rotation',
      speedRadS: 20,
      currentA: 0,
      torqueNm: 0,
      currentScaleA: 2,
    }),
    linear = driveVoice({
      emitterKey: '1',
      position: [0, 0, 0],
      coordinate: 'linear',
      speedMS: 0.08,
      currentA: 0,
      forceN: 0,
      currentScaleA: 2,
    });
  assert.ok(Math.abs(rotation.motionGain * TRIANGLE_RMS - AUDIO_POLICY.nominalRms) < 1e-12);
  assert.ok(
    Math.abs(linear.motionGain * noiseRms(linear.frequency * 2) - AUDIO_POLICY.nominalRms) < 1e-12,
  );
});

test('spatial mix and voice selection are bounded and keep audible incumbents', () => {
  const listener = { position: [0, 0, 0], right: [1, 0, 0] };
  assert.ok(spatialMix([1, 0, 0], listener).pan > 0);
  assert.ok(spatialMix([-1, 0, 0], listener).pan < 0);
  assert.ok(spatialMix([10, 0, 0], listener).gain < spatialMix([1, 0, 0], listener).gain);
  assert.deepEqual(spatialMix([1, 0, 0], null), { pan: 0, gain: 1 });
  const rows = [
    { key: 'old', score: 1 },
    { key: 'new', score: 1.2 },
  ];
  assert.equal(selectVoices(rows, new Set(['old']), 1)[0].key, 'old');
  rows[1].score = 1.3;
  assert.equal(selectVoices(rows, new Set(['old']), 1)[0].key, 'new');
});

test('mechanical audio stale enable cannot override mute, later enable or disposal', async () => {
  let resolves = [];
  const ctx = {
    state: 'suspended',
    currentTime: 0,
    resume() {
      return new Promise((r) => resolves.push(r));
    },
    close() {
      this.state = 'closed';
    },
    addEventListener() {},
    removeEventListener() {},
  };
  const engine = createMechanicalAudio({ createContext: () => ctx });
  const first = engine.enable(true);
  await engine.enable(false);
  const second = engine.enable(true);
  ctx.state = 'running';
  resolves[0]();
  assert.equal(await first, false);
  resolves[1]();
  assert.equal(await second, true);
  const third = engine.enable(true);
  engine.dispose();
  resolves[2]();
  assert.equal(await third, false);
  assert.equal(engine.enabled(), false);
});

test('adapter keeps linear force units and excludes every noncolliding rope node', async () => {
  const { machine } = await import('./fixtures/linear-machine.mjs');
  const bp = machine(),
    compiled = compileAssembly(bp),
    adapter = createMechanicalAudioAdapter();
  const frame = {
    tick: 1,
    metadata: { blueprint: bp },
    physics: compiled.configuration.bodies.map((v) => body(v)),
    power: { motors: [{ node: 0, current: -2, torque: 12 }] },
    contacts: { available: true, intervalSeconds: 1 / 120, rows: [] },
  };
  const { rotateVector } = await import('../src/model/transforms.mjs');
  frame.physics[1].velocity = rotateVector(
    frame.physics[0].rotation,
    compiled.configuration.joints[0].axisA,
  ).map((v) => v * 0.2);
  const drive = adapter.read(frame, 1).drives[0];
  assert.equal(drive.coordinate, 'linear');
  assert.ok(Math.abs(drive.speedMS - 0.2) < 1e-10);
  assert.equal(drive.forceN, 12);
  assert.equal(drive.torqueNm, undefined);
  assert.equal(drive.speedRadS, undefined);
  const rope = createEmptyBlueprint('rope', 'Rope');
  rope.parts = [createPart('beam', 'a', [0, 3, 0]), createPart('plate', 'b', [0, 1, 0])];
  rope.connections = [
    {
      id: 'r',
      kind: 'rope',
      a: { part: 'a', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'top', u: 0, v: 0, twist: 0 } },
      rope: { restLength: 2.5, diameter: 0.02, segments: 8, material: 'nylon' },
    },
  ];
  const c = compileAssembly(rope);
  frame.metadata.blueprint = rope;
  frame.physics = c.configuration.bodies.map((v) => body(v));
  frame.power.motors = [];
  const excluded = c.configuration.bodies.flatMap((b, i) => (b.collision === false ? [i] : []));
  assert.ok(excluded.length > 0);
  frame.contacts.rows = excluded.map((i) => ({
    a: i,
    b: 2,
    available: true,
    solved: true,
    normalImpulse: [0, 10, 0],
    distance: 0,
    normal: [0, 1, 0],
    localPointA: [0, 0, 0],
    localPointB: [0, 0, 0],
    frictionGroupSize: 0,
    frictionImpulse: null,
  }));
  assert.deepEqual(adapter.read(frame, 2).contacts, []);
});

test('audio reads and batching leave real simulation projections and saves unchanged', async () => {
  const { createWorkshop } = await import('../src/core/workshop.mjs');
  const { deterministicProjection } = await import('../src/model/tick.mjs');
  const { createBallDrop } = await import('../src/model/fixtures/ball-drop.mjs');
  const a = await createWorkshop(createBallDrop()),
    b = await createWorkshop(createBallDrop());
  const adapter = createMechanicalAudioAdapter(),
    events = createMechanicalEvents();
  try {
    await a.act({ type: 'run' });
    await b.act({ type: 'run' });
    const input = [];
    for (let i = 0; i < 120; i++) {
      a.step(1);
      b.step(1);
      const observation = a.observe(),
        frame = observation.frames[0];
      const before = JSON.stringify(frame);
      const packet = adapter.read(frame, observation.cursor.epoch);
      input.push(packet);
      events.read(packet);
      assert.equal(JSON.stringify(frame), before);
      assert.deepEqual(
        deterministicProjection(frame),
        deterministicProjection(b.observe().frames[0]),
      );
    }
    assert.deepEqual(a.save(), b.save());
    const process = (size) => {
      const e = createMechanicalEvents(),
        rows = [];
      for (let i = 0; i < input.length; i += size)
        for (const p of input.slice(i, i + size)) rows.push(...e.read(p).impacts);
      return rows;
    };
    assert.deepEqual(process(1), process(7));
  } finally {
    a.dispose();
    b.dispose();
  }
});

test('renaming and body reordering preserve acoustic descriptors and symmetric material pairs', () => {
  const bp = createEmptyBlueprint('one', 'One');
  bp.parts = [createPart('ball', 'ball', [0, 1, 0]), createPart('beam', 'beam', [0, 3, 0])];
  const row = {
    a: 0,
    b: 1,
    localPointA: [0, -0.04, 0],
    localPointB: [0, 0.01, 0],
    normal: [0, 1, 0],
    normalImpulse: [0, 2, 0],
    available: true,
    solved: true,
    distance: 0,
    frictionImpulse: [0.1, 0, 0],
    frictionGroupSize: 1,
  };
  const frame = {
    tick: 1,
    metadata: { blueprint: bp },
    physics: compileAssembly(bp).configuration.bodies.map((v) => body(v)),
    power: { motors: [] },
    contacts: { available: true, intervalSeconds: 1 / 120, rows: [row] },
  };
  const adapter = createMechanicalAudioAdapter(),
    original = adapter.read(frame, 1).contacts[0];
  const next = structuredClone(frame);
  next.metadata.blueprint.parts.reverse();
  next.metadata.blueprint.parts.forEach((p, i) => {
    p.id = `renamed-${i}`;
    p.name = 'A different name';
  });
  [next.physics[0], next.physics[1]] = [next.physics[1], next.physics[0]];
  next.contacts.rows = [
    {
      ...row,
      localPointA: row.localPointB,
      localPointB: row.localPointA,
      normal: [0, -1, 0],
      normalImpulse: [0, -2, 0],
    },
  ];
  const reordered = adapter.read(next, 2).contacts[0];
  delete original.patches;
  delete reordered.patches;
  assert.deepEqual(reordered, original);
});

test('a new supported witness strikes within an existing pair while smooth rolling stays quiet', () => {
  const events = createMechanicalEvents();
  const patch = (x) => ({ a: [x, 0, 0], b: [x, 0, 0], impulse: 1 });
  events.read(packet(0));
  assert.equal(events.read(packet(1, [contact({ patches: [patch(0)] })])).impacts.length, 1);
  assert.equal(events.read(packet(2, [contact({ patches: [patch(0.001)] })])).impacts.length, 0);
  assert.equal(
    events.read(packet(3, [contact({ patches: [patch(0.001), patch(0.1)] })])).impacts.length,
    1,
  );
  assert.equal(
    events.read(packet(4, [contact({ patches: [patch(0.002), patch(0.101)] })])).impacts.length,
    0,
  );
  assert.equal(
    events.read(packet(5, [], { available: false })).reset,
    false,
    'contact unavailability must not restart measured motor loops',
  );
});

test('audio device graph failure disables sound without escaping into the workshop clock', async () => {
  const context = {
    state: 'running',
    currentTime: 0,
    resume: async () => {},
    createGain() {
      throw Error('device interrupted');
    },
    close() {},
    addEventListener() {},
    removeEventListener() {},
  };
  const engine = createMechanicalAudio({ createContext: () => context });
  await engine.enable(true);
  assert.doesNotThrow(() =>
    engine.play({ tick: 1, interval: 1 / 120, drives: [], contacts: [], impacts: [] }),
  );
  assert.equal(engine.enabled(), false);
  engine.dispose();
});

test('cached completed transforms retain rotated witness velocity and reject invalid bodies', async () => {
  const { createCompletedPointReader } = await import('../src/model/completed-motion.mjs');
  const read = createCompletedPointReader(),
    rotated = body({
      rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
      velocity: [0, 1, 0],
      angularVelocity: [0, 0, 1],
    });
  const point = read(rotated, [0, -1, 0]);
  assert.ok(Math.abs(point.position[0] - 1) < 1e-12);
  assert.ok(Math.abs(point.position[1]) < 1e-12);
  assert.ok(Math.abs(point.velocity[1] - 2) < 1e-12);
  assert.deepEqual(read(rotated, [0, -1, 0]), point);
  assert.equal(read(body({ rotation: [0, 0, 0, 0] }), [0, 0, 0]), null);
});

test('a browser activation promise that never settles returns to Sound off for retry', async () => {
  const context = {
    state: 'suspended',
    resume: () => new Promise(() => {}),
    close() {},
    addEventListener() {},
    removeEventListener() {},
  };
  const engine = createMechanicalAudio({ createContext: () => context, activationTimeoutMs: 10 });
  const result = await Promise.race([
    engine.enable(true),
    new Promise((r) => setTimeout(() => r('hung'), 100)),
  ]);
  assert.equal(result, false);
  assert.equal(engine.enabled(), false);
  engine.dispose();
});

test('measured separation preserves a rapid bounce of the same impulse inside chatter grace', () => {
  const bp = createEmptyBlueprint('bounce', 'Bounce');
  bp.parts = [createPart('ball', 'ball', [0, 0.04, 0])];
  const compiled = compileAssembly(bp),
    adapter = createMechanicalAudioAdapter(),
    events = createMechanicalEvents();
  const row = {
    a: 0,
    b: 1,
    localPointA: [0, -0.04, 0],
    localPointB: [0, 0.1, 0],
    normal: [0, -1, 0],
    normalImpulse: [0, -1, 0],
    available: true,
    solved: true,
    distance: 0,
    frictionImpulse: [0, 0, 0],
    frictionGroupSize: 1,
  };
  const frame = {
    tick: 0,
    metadata: { blueprint: bp },
    physics: compiled.configuration.bodies.map((v) => body(v)),
    power: { motors: [] },
    contacts: { available: true, intervalSeconds: 1 / 120, rows: [] },
  };
  events.read(adapter.read(frame, 1));
  frame.tick = 1;
  frame.contacts.rows = [row];
  assert.equal(events.read(adapter.read(frame, 1)).impacts.length, 1);
  frame.tick = 2;
  frame.contacts.rows = [];
  frame.physics[0].position[1] += 0.001;
  frame.physics[0].velocity[1] = 0.1;
  const separation = adapter.read(frame, 1);
  assert.deepEqual(separation.separations, ['0:1']);
  events.read(separation);
  frame.tick = 3;
  frame.contacts.rows = [row];
  frame.physics[0].position[1] -= 0.001;
  frame.physics[0].velocity[1] = 0;
  assert.equal(events.read(adapter.read(frame, 1)).impacts.length, 1);
});
