import test from 'node:test';
import assert from 'node:assert/strict';
import { createDrivingMachine } from '../src/model/fixtures/driving-machine.mjs';
import { diagnoseMotion } from '../src/model/motion-diagnostics.mjs';
function trace() {
  const bp = createDrivingMachine();
  for (const edge of bp.connections)
    if (edge.kind === 'signal' && edge.a.part === 'right-control') edge.a.part = 'left-control';
  return {
    tick: 240,
    metadata: {
      blueprint: bp,
      mode: 'run',
      connections: bp.connections.map((c) => ({ id: c.id, reasonCode: 'OK' })),
    },
    physics: bp.parts.map((p) => ({ rotation: p.rotation, angularVelocity: [0, 0, 0] })),
    power: {
      cells: [],
      sources: [{ node: bp.parts.findIndex((p) => p.id === 'left-control'), duty: 1 }],
      motors: bp.parts.flatMap((p, node) =>
        p.type === 'poweredMotor' ? [{ node, current: 2, reasonCode: 'OK' }] : [],
      ),
    },
  };
}
test('stalled opposed wheel drives suggest checking direction without asserting root cause', () => {
  const f = trace();
  const issue = diagnoseMotion(f).find((i) => i.code === 'OPPOSED_DRIVES');
  assert.ok(issue);
  assert.match(issue.action, /If.*same direction/);
  // Wrong trace: explicit inversion makes both world-axis commands agree.
  f.metadata.blueprint.parts.find((p) => p.id === 'right-motor').parameters.inputPolarity = -1;
  assert.equal(
    diagnoseMotion(f).some((i) => i.code === 'OPPOSED_DRIVES'),
    false,
  );
});
test('normal spinning, separate commands and unwired shafts do not get opposed stall advisory', () => {
  const f = trace();
  for (const body of f.physics) body.angularVelocity = [2, 0, 0];
  f.physics[f.metadata.blueprint.parts.findIndex((p) => p.id === 'left-wheel')].angularVelocity = [
    5, 0, 0,
  ];
  assert.equal(
    diagnoseMotion(f).some((i) => i.code === 'OPPOSED_DRIVES'),
    false,
  );
  const unwired = trace();
  unwired.metadata.blueprint.connections = unwired.metadata.blueprint.connections.filter(
    (c) => c.kind !== 'shaft',
  );
  assert.equal(
    diagnoseMotion(unwired).some((i) => i.code === 'OPPOSED_DRIVES'),
    false,
  );
  const independent = trace();
  independent.metadata.blueprint.connections.find(
    (c) => c.kind === 'signal' && c.b.part === 'right-motor',
  ).a.part = 'right-control';
  assert.equal(
    diagnoseMotion(independent).some((i) => i.code === 'OPPOSED_DRIVES'),
    false,
  );
});
test('shaft telemetry respects the vertical hinge socket frame', async () => {
  const { motorShaftSpeed } = await import('../src/model/motion-diagnostics.mjs');
  const f = {
    metadata: {
      blueprint: {
        parts: [
          { id: 'hinge', type: 'poweredHinge' },
          { id: 'hub', type: 'wheelHub' },
        ],
        connections: [
          {
            kind: 'shaft',
            a: { part: 'hinge', port: 'shaft' },
            b: { part: 'hub', port: 'steering' },
          },
        ],
      },
    },
    physics: [
      { rotation: [0, 0, 0, 1], angularVelocity: [0, 0, 0] },
      { angularVelocity: [0, 2, 0] },
    ],
  };
  assert.ok(Math.abs(motorShaftSpeed(f, 0) - 2) < 1e-12);
});
test('shared zero command has one explanation rather than one per motor', () => {
  const f = trace();
  f.power.sources[0].duty = 0;
  assert.equal(diagnoseMotion(f).filter((i) => i.code === 'COMMAND_OFF').length, 1);
});
