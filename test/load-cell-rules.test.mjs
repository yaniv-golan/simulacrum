import test from 'node:test';
import assert from 'node:assert/strict';
import { createPart, createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { compileAssembly, proposeSurfaceMount, snapConnection } from '../src/model/assembly.mjs';
import { emptyControllerProgram, editControllerDraft } from '../src/model/controller-authoring.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { createProgramExecutors } from '../src/scripting/controller-executors.mjs';

const frame = (s) => s.observe().frames[0];
const reading = (s) => frame(s).sensors.readings.find((r) => r.node === 1).channels;
const receiver = (s) => frame(s).receiverControl.receivers[0];
const motor = (s) => frame(s).power.motors[0];
function wire(b, kind, source, sourcePort, target, targetPort) {
  b.connections.push({
    id: 'wire-' + b.connections.length,
    kind,
    a: { part: source, port: sourcePort },
    b: { part: target, port: targetPort },
  });
}
function machine() {
  let b = createEmptyBlueprint('force-rules', 'Force Rules');
  b.parts.push(
    createPart('beam', 'support', [0, 2, 0]),
    createPart('loadCellSensor', 'sensor', [2, 2, 0]),
  );
  b = proposeSurfaceMount(b, {
    part: 'sensor',
    sourceRegion: 'left',
    targetPart: 'support',
    targetRegion: 'right',
    id: 'A',
  }).blueprint;
  b.parts.push(createPart('beam', 'payload', [4, 2, 0]));
  b = proposeSurfaceMount(b, {
    part: 'payload',
    sourceRegion: 'left',
    targetPart: 'sensor',
    targetRegion: 'right',
    id: 'B',
  }).blueprint;
  b.parts.push(
    createPart('logicController', 'rules', [2, 2, 2]),
    createPart('commandReceiver', 'receiver', [3, 2, 2]),
    createPart('poweredMotor', 'motor', [4, 2, 2]),
    createPart('gripWheel', 'wheel', [5, 2, 2]),
    createPart('powerCell', 'driveSupply', [6, 2, 2]),
    createPart('powerCell', 'senseSupply', [7, 2, 2]),
  );
  const shaft = { part: 'motor', port: 'shaft' },
    axle = { part: 'wheel', port: 'axle' };
  b = snapConnection(b, shaft, axle);
  b.connections.push({ id: 'shaft', kind: 'shaft', a: shaft, b: axle });
  wire(b, 'power', 'driveSupply', 'power', 'motor', 'power');
  wire(b, 'power', 'senseSupply', 'power', 'sensor', 'power');
  wire(b, 'signal', 'sensor', 'load', 'rules', 'input1');
  wire(b, 'signal', 'rules', 'out1', 'receiver', 'command');
  wire(b, 'signal', 'receiver', 'signal', 'motor', 'signal');
  b.parts.find((p) => p.id === 'rules').controllerProgram = editControllerDraft(
    emptyControllerProgram(),
    {
      type: 'rules',
      rules: [
        { input: 'input1', operator: '<', threshold: 0.1, output: 'out1', duty: 0.5, otherwise: 0 },
      ],
    },
  );
  return b;
}
const configuration = (b = machine()) =>
  compileAssembly(b, { gravity: [0, 0, 0], ground: null }).configuration;
const session = (c) => createSession(c, undefined, undefined, undefined, createProgramExecutors);
function arm(s) {
  s.act({ type: 'receiver-mode', node: 4, mode: 'automatic' });
  s.step();
}

test('cold-start Automatic latches Off until the completed sensor is valid and the player rearms', async () => {
  const s = await session(configuration());
  try {
    arm(s);
    assert.equal(receiver(s).mode, 'off');
    assert.equal(receiver(s).reason, 'INVALID_SENSOR');
    assert.equal(receiver(s).duty, 0);
    assert.equal(motor(s).torque, 0);
    s.step(5);
    assert.equal(reading(s).load.status, 'ok');
    assert.equal(receiver(s).mode, 'off');
    arm(s);
    assert.equal(receiver(s).mode, 'automatic');
    assert.equal(receiver(s).duty, 0.5);
    assert.ok(Math.abs(motor(s).torque) > 0);
    s.step(5);
    assert.ok(
      Math.hypot(
        ...frame(s).physics[6].angularVelocity.map(
          (v, k) => v - frame(s).physics[5].angularVelocity[k],
        ),
      ) > 0.01,
      'valid force permission must spin the real rotor',
    );
  } finally {
    s.dispose();
  }
});

test('load magnitude blocks both strong compression and shear at the actual motor receiver', async () => {
  for (const impulse of [
    [-0.2, 0, 0],
    [0, 0.2, 0],
  ]) {
    const s = await session(configuration());
    try {
      s.step(5);
      arm(s);
      assert.equal(receiver(s).duty, 0.5);
      assert.equal(s.act({ type: 'impulse', body: 2, value: impulse }).ok, true);
      let stopped = false;
      for (let k = 0; k < 8; k++) {
        s.step();
        const r = reading(s);
        if (r.load.status !== 'ok' || r.load.value < 0.1) continue;
        if (impulse[0]) assert.ok(r.axialForce.value < -0.1, 'compression must be negative');
        else
          assert.ok(
            Math.abs(r.axialForce.value) < r.load.value * 0.05,
            'transverse force must defeat an axial-only condition',
          );
        assert.equal(receiver(s).duty, 0);
        assert.equal(motor(s).torque, 0);
        stopped = true;
      }
      assert.ok(stopped, 'the force threshold must stop electrical drive after sampling');
    } finally {
      s.dispose();
    }
  }
});

test('sensor supply depletion switches actual Automatic output Off and renewed sensing does not rearm it', async () => {
  const c = configuration();
  c.power.cells.find((p) => p.node === 8).initialJ = 0.012;
  const s = await session(c);
  try {
    s.step(3);
    arm(s);
    assert.equal(receiver(s).mode, 'automatic');
    assert.ok(Math.abs(motor(s).torque) > 0);
    let lost = false;
    for (let k = 0; k < 50; k++) {
      s.step();
      if (reading(s).load.status !== 'no-power') continue;
      assert.equal(receiver(s).mode, 'off');
      assert.equal(receiver(s).reason, 'INVALID_SENSOR');
      assert.equal(motor(s).torque, 0);
      lost = true;
      break;
    }
    assert.ok(lost);
    await s.replaceConfiguration(configuration(), {});
    arm(s);
    s.step(5);
    assert.equal(reading(s).load.status, 'ok');
    assert.equal(receiver(s).mode, 'off');
    arm(s);
    assert.ok(Math.abs(motor(s).torque) > 0);
  } finally {
    s.dispose();
  }
});

test('ordinary disconnection invalidates Automatic and repaired mounting requires explicit rearm', async () => {
  const b = machine(),
    s = await session(configuration(b));
  try {
    s.step(5);
    arm(s);
    b.connections = b.connections.filter((e) => e.id !== 'B');
    await s.replaceConfiguration(configuration(b), {});
    s.step(5);
    arm(s);
    assert.equal(reading(s).load.status, 'disconnected');
    assert.equal(receiver(s).mode, 'off');
    assert.equal(motor(s).torque, 0);
    await s.replaceConfiguration(configuration(), {});
    arm(s);
    s.step(5);
    assert.equal(reading(s).load.status, 'ok');
    assert.equal(receiver(s).mode, 'off');
    arm(s);
    assert.equal(receiver(s).duty, 0.5);
  } finally {
    s.dispose();
  }
});

function pressingMachine() {
  let b = createEmptyBlueprint('force-press', 'Force press');
  b.parts.push(
    createPart('chassis', 'base', [0, 0.02, 0]),
    createPart('loadCellSensor', 'sensor', [2, 1, 0]),
  );
  const mount = (part, sourceRegion, targetPart, targetRegion, id, u = 0, v = 0, twist = 0) => {
    b = proposeSurfaceMount(b, {
      part,
      sourceRegion,
      targetPart,
      targetRegion,
      id,
      u,
      v,
      twist,
    }).blueprint;
  };
  mount('sensor', 'left', 'base', 'top', 'sensor-A', 0.1);
  b.parts.push(createPart('spacerBlock', 'pressed', [2, 1, 1]));
  mount('pressed', 'left', 'sensor', 'right', 'sensor-B');
  b.parts.push(createPart('chassis', 'column', [2, 1, 2]));
  mount('column', 'back', 'base', 'top', 'column-base');
  b.parts.push(createPart('linearActuator', 'drive', [2, 1, 3]));
  mount('drive', 'right', 'column', 'top', 'drive-column', 0, 0.18, -Math.PI / 2);
  b.parts.push(createPart('springCarriage', 'carriage', [2, 1, 4]));
  const a = { part: 'drive', port: 'slide' },
    output = { part: 'carriage', port: 'slide' };
  b = snapConnection(b, a, output);
  b.connections.push({ id: 'stroke', kind: 'spring', a, b: output });
  b.parts.push(
    createPart('logicController', 'rules', [2, 0.03, 0]),
    createPart('commandReceiver', 'receiver', [3, 0.03, 0]),
    createPart('powerCell', 'supply', [4, 0.05, 0]),
  );
  wire(b, 'power', 'supply', 'power', 'drive', 'power');
  wire(b, 'power', 'supply', 'power', 'sensor', 'power');
  wire(b, 'signal', 'sensor', 'load', 'rules', 'input1');
  wire(b, 'signal', 'rules', 'out1', 'receiver', 'command');
  wire(b, 'signal', 'receiver', 'signal', 'drive', 'signal');
  b.parts.find((p) => p.id === 'rules').controllerProgram = editControllerDraft(
    emptyControllerProgram(),
    {
      type: 'rules',
      rules: [
        { input: 'input1', operator: '<', threshold: 40, output: 'out1', duty: 0.5, otherwise: 0 },
      ],
    },
  );
  return b;
}

test('an ordinary ground-supported actuator press stops drive on measured attachment force', async () => {
  const b = pressingMachine(),
    c = compileAssembly(b).configuration;
  assert.ok(
    c.bodies.slice(0, b.parts.length).every((body) => body.fixed === false),
    'only the ordinary workshop ground can be fixed',
  );
  const s = await session(c),
    passive = await session(c),
    receiverNode = b.parts.findIndex((p) => p.id === 'receiver');
  let powered = false,
    pressed = false;
  try {
    s.step(20);
    passive.step(20);
    assert.equal(reading(s).load.status, 'ok');
    assert.ok(reading(s).load.value < 40, 'passive carriage weight must start below threshold');
    assert.equal(s.act({ type: 'receiver-mode', node: receiverNode, mode: 'automatic' }).ok, true);
    for (let k = 0; k < 360; k++) {
      s.step();
      passive.step();
      assert.equal(frame(s).status, 'ready');
      const r = reading(s);
      powered ||= Math.abs(motor(s).torque) > 0;
      if (!powered || r.load.status !== 'ok' || r.load.value <= 40) continue;
      assert.ok(r.axialForce.value < -2, 'the pressing force must be actual compression');
      assert.equal(receiver(s).duty, 0);
      assert.equal(motor(s).torque, 0);
      assert.equal(motor(passive).torque, 0);
      assert.ok(
        reading(passive).load.value < 40,
        'identical passive gravity loading must not explain the threshold crossing',
      );
      assert.ok(
        frame(s).contacts.rows.some(
          (row) =>
            [row.a, row.b].includes(2) &&
            [row.a, row.b].includes(5) &&
            Math.hypot(...(row.normalImpulse ?? [])) > 0,
        ),
        'carriage must physically contact the measured block',
      );
      pressed = true;
      break;
    }
    assert.ok(
      powered && pressed,
      'the powered carriage must create load and the force rule must remove drive',
    );
  } finally {
    s.dispose();
    passive.dispose();
  }
});
