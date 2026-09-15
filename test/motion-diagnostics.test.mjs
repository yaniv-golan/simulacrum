import test from 'node:test';
import assert from 'node:assert/strict';
import { createStarterVehicle } from '../src/model/starter-vehicle.mjs';
import { createPart } from '../src/model/blueprint.mjs';
import { diagnoseMotion, readinessLine, readinessNext } from '../src/model/motion-diagnostics.mjs';
function fixture() {
  const blueprint = createStarterVehicle();
  return {
    tick: 240,
    metadata: {
      blueprint,
      mode: 'build',
      connections: blueprint.connections.map((c) => ({ id: c.id, reasonCode: 'OK' })),
    },
    physics: blueprint.parts.map(() => ({ rotation: [0, 0, 0, 1], angularVelocity: [0, 0, 0] })),
    power: {
      cells: [{ node: 2, energyJ: 100 }],
      sources: [],
      motors: [{ node: 1, reasonCode: 'OK', current: 1 }],
    },
  };
}
const codes = (f) => diagnoseMotion(f).map((i) => i.code);
test('ready machine, missing power and rigid support are distinguished', () => {
  const f = fixture();
  assert.deepEqual(codes(f), []);
  f.metadata.blueprint.connections = f.metadata.blueprint.connections.filter(
    (c) => c.kind !== 'power',
  );
  assert.deepEqual(codes(f), ['MISSING_POWER']);
  assert.ok(diagnoseMotion(f)[0].action.includes('mount does not carry'));
});
test('simultaneous missing axle and power do not mask each other', () => {
  const f = fixture();
  f.metadata.blueprint.connections = f.metadata.blueprint.connections.filter(
    (c) => c.kind !== 'power' && c.kind !== 'shaft',
  );
  assert.deepEqual(codes(f), ['MISSING_AXLE', 'MISSING_POWER']);
});
test('empty charge differs from off command and controlling receiver owns action', () => {
  const f = fixture();
  f.power.cells[0].energyJ = 0;
  assert.deepEqual(codes(f), ['EMPTY_CELL']);
  f.power.cells[0].energyJ = 100;
  f.metadata.blueprint.parts[1].parameters.defaultDuty = 0;
  assert.deepEqual(codes(f), ['COMMAND_OFF']);
  const receiver = createPart('commandReceiver', 'receiver', [0, 1, 0]);
  f.metadata.blueprint.parts.push(receiver);
  f.metadata.blueprint.connections.push({
    id: 'signal',
    kind: 'signal',
    a: { part: 'receiver', port: 'signal' },
    b: { part: 'motor', port: 'signal' },
  });
  f.power.sources = [{ node: 8, duty: 1 }];
  assert.deepEqual(codes(f), [], 'live receiver overrides motor default');
  f.power.sources[0].duty = 0;
  assert.equal(diagnoseMotion(f)[0].partId, 'receiver');
});
test('rigid loop is not inferred from an ordinary axle or from low speed', () => {
  const f = fixture();
  f.metadata.mode = 'paused';
  assert.deepEqual(codes(f), ['SLOW_UNDER_POWER']);
  assert.match(diagnoseMotion(f)[0].evidence, /do not identify the cause/);
  f.physics[3].angularVelocity = [2, 0, 0];
  assert.deepEqual(codes(f), []);
  f.metadata.blueprint.connections.push({
    id: 'wrong-mount',
    kind: 'fixed',
    a: { part: 'frame', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
    b: { part: 'drive', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
  });
  assert.deepEqual(codes(f), ['RIGIDLY_LOCKED']);
  assert.equal(diagnoseMotion(f)[0].partId, 'drive');
});
test('a rejected rigid mount cannot be blamed for locking a turning wheel', async () => {
  const { createWorkshop } = await import('../src/core/workshop.mjs');
  const bp = createStarterVehicle();
  bp.connections.push({
    id: 'misaligned-lock',
    kind: 'fixed',
    a: { part: 'frame', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
    b: { part: 'drive', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
  });
  const workshop = await createWorkshop(bp);
  try {
    await workshop.act({ type: 'run' });
    workshop.step(240);
    const frame = workshop.observe().frames[0];
    assert.equal(
      frame.metadata.connections.find((c) => c.id === 'misaligned-lock').reasonCode,
      'MISALIGNED',
    );
    assert.ok(
      !codes(frame).includes('RIGIDLY_LOCKED'),
      'a non-admitted constraint does not lock the axle',
    );
    assert.ok(codes(frame).includes('MOUNT_ALIGNMENT'));
  } finally {
    workshop.dispose();
  }
});
test('production telemetry distinguishes healthy, disconnected, stopped and depleted motors', async () => {
  const { createWorkshop } = await import('../src/core/workshop.mjs');
  for (const [variant, reason, expected] of [
    ['healthy', 'OK', []],
    ['disconnected', 'NO_POWER', ['MISSING_POWER']],
    ['stopped', 'OFF', ['COMMAND_OFF']],
    ['depleted', 'DEPLETED', ['EMPTY_CELL']],
  ]) {
    const bp = createStarterVehicle();
    if (variant === 'disconnected')
      bp.connections = bp.connections.filter((c) => c.kind !== 'power');
    if (variant === 'stopped') bp.parts[1].parameters.defaultDuty = 0;
    if (variant === 'depleted') bp.parts[2].parameters.capacityJ = 1;
    const workshop = await createWorkshop(bp);
    try {
      await workshop.act({ type: 'run' });
      workshop.step(240);
      const frame = workshop.observe().frames[0];
      assert.equal(frame.status, 'ready');
      assert.equal(frame.power.motors[0].reasonCode, reason);
      assert.deepEqual(codes(frame), expected);
      if (variant === 'depleted') {
        await workshop.act({ type: 'build' });
        assert.deepEqual(
          codes(workshop.observe().frames[0]),
          [],
          'Build recharges the cell as advised',
        );
      }
    } finally {
      workshop.dispose();
    }
  }
});
test('build readiness line claims ready only when every issue is a zero drive setting', () => {
  const f = fixture(),
    line = () => readinessLine(diagnoseMotion(f), f.metadata.blueprint);
  assert.equal(line(), 'Ready to run · power ✓ · axles ✓ · drive set ✓ · Check machine');
  f.metadata.blueprint.parts[1].parameters.defaultDuty = 0;
  assert.equal(
    line(),
    'Ready to run · power ✓ · axles ✓ · drive set ✗ · Check machine',
    'zero drive coasts; it must not read drive set ✓',
  );
  f.metadata.blueprint.parts[1].parameters.defaultDuty = 1;
  f.metadata.blueprint.connections = f.metadata.blueprint.connections.filter(
    (c) => c.kind !== 'power',
  );
  assert.equal(line(), 'Not ready to run · power ✗ · axles ✓ · drive set ✓ · Check machine');
  f.metadata.blueprint.connections = f.metadata.blueprint.connections.filter(
    (c) => c.kind !== 'shaft',
  );
  assert.equal(line(), 'Not ready to run · power ✗ · axles ✗ · drive set ✓ · Check machine');
});
test('build readiness line defers to other issues and says nothing on an empty bench', () => {
  const f = fixture(),
    line = () => readinessLine(diagnoseMotion(f), f.metadata.blueprint),
    shaft = f.metadata.blueprint.connections.find((c) => c.kind === 'shaft');
  f.metadata.connections.find((c) => c.id === shaft.id).reasonCode = 'AXIS_MISMATCH';
  assert.equal(line(), 'Motor needs its axle checked · Check machine', 'never "axles ✓" here');
  assert.doesNotMatch(line(), /Ready/);
  f.metadata.blueprint.parts = f.metadata.blueprint.parts.filter((p) => p.type !== 'poweredMotor');
  f.metadata.blueprint.connections = [];
  assert.equal(line(), 'No motor yet · Check machine');
  f.metadata.blueprint.parts.push(createPart('poweredHinge', 'hinge', [0, 1, 0]));
  assert.equal(line(), null, 'hinge-only machines are not "missing" a motor');
  f.metadata.blueprint.parts = [createPart('linearActuator', 'ram', [0, 1, 0])];
  assert.equal(line(), null, 'an actuator the diagnosis does not check gets no verdict');
  const g = fixture();
  g.metadata.blueprint.parts.push(createPart('poweredHinge', 'hinge', [0, 1, 0]));
  assert.equal(
    readinessLine(diagnoseMotion(g), g.metadata.blueprint),
    null,
    '"power ✓" must not speak for an unchecked hinge beside a ready motor',
  );
  f.metadata.blueprint.parts = [];
  assert.equal(line(), null, 'the empty bench explains itself');
});
test('the next step names the first missing readiness class and nothing else', () => {
  const f = fixture(),
    next = () => readinessNext(diagnoseMotion(f), f.metadata.blueprint);
  assert.equal(next(), null, 'a ready machine has no invented next step');
  f.metadata.blueprint.parts[1].parameters.defaultDuty = 0;
  assert.equal(next(), 'set the drive above zero');
  f.metadata.blueprint.connections = f.metadata.blueprint.connections.filter(
    (c) => c.kind !== 'power',
  );
  assert.equal(next(), 'wire a cell to the motor', 'power comes before the drive setting');
  const shaft = f.metadata.blueprint.connections.find((c) => c.kind === 'shaft');
  f.metadata.connections.find((c) => c.id === shaft.id).reasonCode = 'AXIS_MISMATCH';
  assert.equal(next(), null, 'an alignment blocker is the health line’s story');
  f.metadata.blueprint.parts = [createPart('linearActuator', 'ram', [0, 1, 0])];
  assert.equal(next(), null, 'no "add a motor" for a machine built on another actuator');
  f.metadata.blueprint.parts = [];
  assert.equal(next(), null);
});
