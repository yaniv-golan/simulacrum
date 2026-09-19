import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { liveJointConnections } from '../src/presentation/sensor-controls.mjs';

test('joint-angle options omit MISALIGNED connections and shafts with no revolute', () => {
  const blueprint = createEmptyBlueprint('joints', 'Joints');
  blueprint.parts = [
    createPart('poweredMotor', 'motor', [0, 0.4, 0]),
    createPart('steelAxle', 'axle', [0.2, 0.4, 0]),
    createPart('chassis', 'frame', [0, 0.2, 0]),
    createPart('mountingBlock', 'block', [0.4, 0.2, 0]),
  ];
  blueprint.connections = [
    {
      id: 'live-shaft',
      kind: 'shaft',
      a: { part: 'motor', port: 'shaft' },
      b: { part: 'axle', port: 'left' },
    },
    {
      id: 'misaligned-shaft',
      kind: 'shaft',
      a: { part: 'motor', port: 'shaft' },
      b: { part: 'axle', port: 'right' },
    },
    {
      id: 'fixed-pair',
      kind: 'fixed',
      a: { part: 'frame', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
      b: { part: 'block', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
    },
  ];
  const live = liveJointConnections(blueprint, [
    { id: 'live-shaft', reasonCode: 'OK' },
    { id: 'misaligned-shaft', reasonCode: 'MISALIGNED' },
  ]);
  assert.deepEqual(
    live.map((edge) => edge.id),
    ['live-shaft'],
  );
  const withoutDiagnostics = liveJointConnections(blueprint);
  assert.equal(
    withoutDiagnostics.some((edge) => edge.id === 'live-shaft'),
    true,
  );
  assert.equal(
    withoutDiagnostics.some((edge) => edge.id === 'fixed-pair'),
    false,
  );
});
