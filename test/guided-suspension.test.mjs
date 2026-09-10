import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSuspensionComparison,
  createGuidedSuspensionModule,
} from '../src/model/fixtures/guided-suspension.mjs';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { captureAssembly, insertAssembly } from '../src/model/reusable-assemblies.mjs';
import { proposeMirroredAssembly } from '../src/model/mirror-assembly.mjs';

const upwardSupportForce = (contact, environment) =>
  (contact.a === environment ? 1 : -1) * (contact.normalImpulse?.[1] ?? 0) * 120;

const face = (part, region) => ({ part, surface: { region, u: 0, v: 0, twist: 0 } });
async function moduleMotion(blueprint, wheelId, chassisId, receiverId) {
  const configuration = compileAssembly(blueprint, {
    gravity: [0, 0, 0],
    ground: null,
  }).configuration;
  const wheel = blueprint.parts.findIndex((part) => part.id === wheelId),
    chassis = blueprint.parts.findIndex((part) => part.id === chassisId);
  const { power, ...numeric } = configuration;
  const world = await createPhysicsWorld(numeric);
  try {
    const before = world.read();
    world.applyImpulse(wheel, [0, 1, 0]);
    for (let tick = 0; tick < 12; tick++) {
      world.prepareConstraints();
      world.prepareSprings();
      world.applyPreparedConstraints();
      world.applySprings();
      world.step();
    }
    const after = world.read();
    const travel =
      after[wheel].position[1] -
      after[chassis].position[1] -
      (before[wheel].position[1] - before[chassis].position[1]);
    assert.ok(
      Math.abs(travel) > 1e-4,
      'the named wheel mount must move on the spring relative to the named chassis mount',
    );
  } finally {
    world.dispose();
  }
  if (receiverId) {
    const session = await createSession(configuration);
    try {
      session.act({
        type: 'receiver',
        node: blueprint.parts.findIndex((part) => part.id === receiverId),
        duty: 0.1,
      });
      for (let tick = 0; tick < 30; tick++) session.step();
      const frame = session.observe().frames[0];
      assert.equal(frame.status, 'ready');
      assert.ok(
        Math.hypot(...frame.physics[wheel].angularVelocity) > 0.1,
        'the named power and command ports must turn the attached wheel',
      );
      assert.ok(
        frame.power.cells.some((cell) => cell.energyJ < 36000),
        'wheel motion must consume actual cell energy',
      );
    } finally {
      session.dispose();
    }
  }
}

test('passive and driven suspension modules mount through named ports and remain physical after save, copy and mirror', async () => {
  for (const driven of [false, true]) {
    const workshop = await createWorkshop(createEmptyBlueprint('module-test', 'Module test'));
    const act = async (command) => {
      const result = await workshop.act(command);
      assert.ok(result.ok, JSON.stringify({ command, result }));
    };
    try {
      await act({
        type: 'insert-assembly',
        definition: createGuidedSuspensionModule({ driven }),
        position: [0, 3, 0],
        rotation: [0, 0, 0, 1],
      });
      const id = workshop.save().assemblies[0].id;
      await act({ type: 'insert', part: createPart('chassis', 'chassis', [1, 3, 0]) });
      await act({
        type: 'connect-assembly',
        id,
        portName: 'Chassis mount',
        target: face('chassis', 'bottom'),
        connectionId: 'mount',
      });
      await act({ type: 'insert', part: createPart('gripWheel', 'wheel', [-2, 3, 0]) });
      await act({
        type: 'connect-assembly',
        id,
        portName: 'Wheel axle',
        target: { part: 'wheel', port: 'axle' },
        connectionId: 'wheel',
      });
      if (driven) {
        await act({ type: 'insert', part: createPart('powerCell', 'cell', [2, 3, 0]) });
        await act({ type: 'insert', part: createPart('commandReceiver', 'receiver', [3, 3, 0]) });
        await act({
          type: 'connect-assembly',
          id,
          portName: 'Drive power',
          target: { part: 'cell', port: 'power' },
          connectionId: 'power',
        });
        await act({
          type: 'connect-assembly',
          id,
          portName: 'Drive command',
          target: { part: 'receiver', port: 'signal' },
          connectionId: 'signal',
        });
      }
      const blueprint = workshop.save(),
        loaded = loadSave(JSON.stringify(blueprint));
      assert.ok(loaded.ok);
      await moduleMotion(loaded.blueprint, 'wheel', 'chassis', driven ? 'receiver' : null);
      const definition = captureAssembly(blueprint, {
        name: 'Mounted wheel module',
        ids: blueprint.parts.map((part) => part.id),
        ports: [],
      }).definition;
      const copy = insertAssembly(
        createEmptyBlueprint('copy', 'Copy'),
        definition,
        [0, 3, 0],
        [0, 0, 0, 1],
      );
      await moduleMotion(
        copy.blueprint,
        copy.idMap.wheel,
        copy.idMap.chassis,
        driven ? copy.idMap.receiver : null,
      );
      const source = structuredClone(blueprint);
      source.parts.push(createPart('beam', 'reference', [4, 3, 0]));
      const mirrored = proposeMirroredAssembly(source, {
        referenceId: 'reference',
        ids: blueprint.parts.map((part) => part.id),
        axis: 'x',
      });
      await moduleMotion(
        mirrored.blueprint,
        mirrored.idMap.wheel,
        mirrored.idMap.chassis,
        driven ? mirrored.idMap.receiver : null,
      );
    } finally {
      workshop.dispose();
    }
  }
});

async function guidedTrial(rigid) {
  const blueprint = createSuspensionComparison({ rigid }),
    configuration = compileAssembly(blueprint).configuration;
  const wheels = blueprint.parts.flatMap((part, index) =>
      part.type === 'gripWheel' ? [index] : [],
    ),
    chassis = blueprint.parts.flatMap((part, index) => (part.type === 'chassis' ? [index] : []));
  const receiver = blueprint.parts.findIndex((part) => part.type === 'commandReceiver'),
    floor = blueprint.parts.length,
    bump = configuration.bodies.length - 1;
  const session = await createSession(configuration),
    rows = [],
    encountered = new Set();
  let entry = null,
    start = null,
    clear = null;
  try {
    for (let tick = 0; tick < 600; tick++) session.step();
    const settled = session.observe().frames[0],
      settledHeights = chassis.map((index) => settled.physics[index].position[1]);
    // Different, disclosed run-up commands match the physical entry condition.
    // The comparison below checks the measured entry speeds within two percent.
    // Both runs use the identical command throughout the measurement window.
    session.act({ type: 'receiver', node: receiver, duty: rigid ? 0.8 : 0.71 });
    for (let tick = 0; tick < 1200; tick++) {
      session.step();
      const frame = session.observe().frames[0];
      assert.equal(frame.status, 'ready');
      assert.equal(frame.contacts.available, true);
      const measured = blueprint.parts.findIndex((part) => part.id === 'left-1base');
      const vy = frame.physics[measured].velocity[1];
      const vz =
        chassis.reduce((sum, index) => sum + frame.physics[index].velocity[2], 0) / chassis.length;
      const wheelZ = wheels.map((index) => frame.physics[index].position[2]),
        badSupport = [],
        supported = new Set();
      for (const contact of frame.contacts.rows) {
        const impulse = Math.hypot(...(contact.normalImpulse ?? []));
        assert.ok(Number.isFinite(impulse));
        if (impulse <= 1e-8) continue;
        for (const environment of [floor, bump])
          if (contact.a === environment || contact.b === environment) {
            const part = contact.a === environment ? contact.b : contact.a;
            const upwardForce = upwardSupportForce(contact, environment);
            if (upwardForce <= 0.01) continue;
            if (wheels.includes(part)) supported.add(part);
            if (part < blueprint.parts.length && !wheels.includes(part))
              badSupport.push(blueprint.parts[part].id);
            if (environment === bump && wheels.includes(part)) {
              encountered.add(part);
              entry ??= { tick, speed: -(rows.at(-1)?.vz ?? vz) };
            }
          }
      }
      if (start === null && Math.min(...wheelZ) <= -0.47) {
        start = tick;
        session.act({ type: 'receiver', node: receiver, duty: 0.8 });
      }
      if (clear === null && Math.max(...wheelZ) < -0.73) clear = tick;
      rows.push({
        tick,
        vy,
        vz,
        wheelZ,
        lengths: frame.springs.map((spring) => spring.length),
        badSupport,
        supported: [...supported],
        cell: frame.power.cells[0].energyJ,
      });
      if (clear !== null && tick >= clear + 60) break;
    }
    return {
      rigid,
      blueprint,
      wheels,
      settledHeights,
      rows,
      start,
      clear,
      entry,
      encountered: [...encountered],
    };
  } finally {
    session.dispose();
  }
}
function assessTrial(trial) {
  assert.ok(
    trial.entry && trial.entry.speed > 0 && Number.isFinite(trial.entry.speed),
    'missing finite entry speed',
  );
  assert.equal(new Set(trial.encountered).size, 4, 'all four tires must encounter the bump');
  assert.ok(trial.wheels.every((wheel) => trial.encountered.includes(wheel)));
  assert.ok(
    Number.isInteger(trial.start) && Number.isInteger(trial.clear) && trial.clear > trial.start,
    'both axles must clear the bump',
  );
  assert.equal(
    trial.rows.length,
    trial.clear + 61,
    'retain the full half-second settling interval',
  );
  assert.ok(
    trial.rows.at(-1).wheelZ.every((z) => z < -0.73),
    'trailing axle has not cleared',
  );
  const window = trial.rows.slice(Math.max(trial.start, 12), trial.clear + 61);
  assert.ok(window.length > 60);
  assert.ok(
    trial.rows.every((row) => Number.isFinite(row.cell) && row.cell >= 0),
    'cell energy must remain finite and nonnegative',
  );
  assert.ok(
    trial.rows.at(-1).cell < trial.rows[0].cell,
    'the complete traversal must consume real cell energy',
  );
  let squares = 0;
  for (const row of window) {
    assert.deepEqual(row.badSupport, [], 'only tires may support the cart on terrain');
    assert.ok(
      row.lengths.every((length) => Number.isFinite(length) && length >= 0.085 && length <= 0.395),
      'retain 5 mm margin to both spring stops',
    );
    const acceleration = (row.vy - trial.rows[row.tick - 12].vy) / 0.1;
    assert.ok(Number.isFinite(acceleration));
    squares += acceleration * acceleration;
  }
  trial.supportedFraction =
    window.reduce((sum, row) => sum + row.supported.length, 0) / (4 * window.length);
  return Math.sqrt(squares / window.length);
}
function assessComparison(sprung, rigid) {
  assert.deepEqual(
    sprung.blueprint.parts,
    rigid.blueprint.parts,
    'comparison must preserve all hardware, materials and authored poses',
  );
  assert.equal(
    rigid.blueprint.connections.length - sprung.blueprint.connections.length,
    4,
    'rigid mounting adds four ordinary fixed fasteners',
  );
  assert.ok(
    sprung.settledHeights.every((height, i) => Math.abs(height - rigid.settledHeights[i]) <= 0.005),
    'settled ride heights must match within 5 mm',
  );
  const a = assessTrial(sprung),
    b = assessTrial(rigid);
  const difference =
    Math.abs(sprung.entry.speed - rigid.entry.speed) /
    ((sprung.entry.speed + rigid.entry.speed) / 2);
  assert.ok(difference <= 0.02, `entry speeds differ by ${difference}`);
  assert.ok(
    sprung.supportedFraction >= rigid.supportedFraction,
    `supported sample fraction ${sprung.supportedFraction} is below rigid ${rigid.supportedFraction}`,
  );
  assert.ok(b > 0.1, 'positive control must expose a measurable rigid bump response');
  assert.ok(a <= b * 0.8, `100 ms vertical acceleration RMS ratio ${a / b} exceeds 0.8`);
  return {
    sprungRms: a,
    rigidRms: b,
    entryDifference: difference,
    sprungSupportedFraction: sprung.supportedFraction,
    rigidSupportedFraction: rigid.supportedFraction,
  };
}
test('ordinary guided and braced carts complete a matched-speed bump trial with lower vertical acceleration', async (t) => {
  assert.equal(upwardSupportForce({ a: 0, b: 1, normalImpulse: [0, 1 / 120, 0] }, 0), 1);
  assert.equal(upwardSupportForce({ a: 1, b: 0, normalImpulse: [0, -1 / 120, 0] }, 0), 1);
  assert.equal(upwardSupportForce({ a: 0, b: 1, normalImpulse: [0, -1 / 120, 0] }, 0), -1);
  assert.equal(upwardSupportForce({ a: 0, b: 1, normalImpulse: [1 / 120, 0, 0] }, 0), 0);
  const sprung = await guidedTrial(false),
    rigid = await guidedTrial(true);
  t.diagnostic(JSON.stringify(assessComparison(sprung, rigid)));
  const unsupported = structuredClone(sprung);
  for (const row of unsupported.rows) row.supported = [];
  assert.throws(() => assessComparison(unsupported, rigid), /supported sample fraction/);
  const incomplete = structuredClone(rigid);
  incomplete.encountered.pop();
  assert.throws(() => assessComparison(sprung, incomplete), /four tires/);
  const unmatched = structuredClone(rigid);
  unmatched.entry.speed *= 0.9;
  assert.throws(() => assessComparison(sprung, unmatched), /entry speeds/);
  const flat = structuredClone(rigid);
  for (const row of flat.rows) row.vy = 0;
  assert.throws(() => assessComparison(sprung, flat), /positive control/);
  const unchangedRide = structuredClone(sprung);
  for (const row of unchangedRide.rows) row.vy *= 20;
  assert.throws(() => assessComparison(unchangedRide, rigid), /RMS ratio/);
});

test('ordinary Build commands reconstruct both complete comparison carts and their preload', async () => {
  for (const rigid of [false, true]) {
    const blueprint = createSuspensionComparison({ rigid });
    const workshop = await createWorkshop(createEmptyBlueprint('authored', 'Authored comparison'));
    const act = async (command) => {
      const result = await workshop.act(command);
      assert.ok(result.ok, JSON.stringify({ command, result }));
    };
    try {
      for (const source of blueprint.parts) {
        const part = structuredClone(source);
        if (part.type === 'springGuide')
          part.parameters.restLength = part.id.includes('-1') ? 0.101 : 0.171;
        await act({ type: 'insert', part });
      }
      for (const edge of [
        ...blueprint.connections.filter((edge) => edge.kind !== 'spring'),
        ...blueprint.connections.filter((edge) => edge.kind === 'spring'),
      ])
        await act({ type: 'connect', id: edge.id, a: edge.a, b: edge.b });
      for (const part of blueprint.parts.filter((part) => part.type === 'springGuide'))
        await act({
          type: 'parameter',
          id: part.id,
          key: 'restLength',
          value: part.parameters.restLength,
        });
      await act({ type: 'choose-environment', environment: blueprint.environment });
      const saved = workshop.save();
      assert.ok(loadSave(JSON.stringify(saved)).ok);
      for (let index = 0; index < saved.parts.length; index++) {
        const { position, rotation, ...actual } = saved.parts[index];
        const {
          position: expectedPosition,
          rotation: expectedRotation,
          ...expected
        } = blueprint.parts[index];
        assert.deepEqual(actual, expected);
        assert.ok(
          position.every((value, axis) => Math.abs(value - expectedPosition[axis]) <= 1e-12),
        );
        assert.ok(
          rotation.every((value, axis) => Math.abs(value - expectedRotation[axis]) <= 1e-12),
        );
      }
      assert.deepEqual(saved.connections, [
        ...blueprint.connections.filter((edge) => edge.kind !== 'spring'),
        ...blueprint.connections.filter((edge) => edge.kind === 'spring'),
      ]);
      const copy = captureAssembly(saved, {
        name: 'Comparison cart',
        ids: saved.parts.map((part) => part.id),
        ports: [],
      });
      assert.equal(copy.definition.parts.length, 44);
      assert.equal(
        compileAssembly(saved).configuration.joints.length,
        compileAssembly(blueprint).configuration.joints.length,
      );
    } finally {
      workshop.dispose();
    }
  }
});
