import test from 'node:test';
import assert from 'node:assert/strict';
import { createStarterVehicle } from '../src/model/starter-vehicle.mjs';
import { createPart } from '../src/model/blueprint.mjs';
import { inspectorSummary } from '../src/presentation/inspector-summary.mjs';
const part = (bp, id) => bp.parts.find((p) => p.id === id);
test('inspector summary names the type, the primary connection and the wired count', () => {
  const bp = createStarterVehicle();
  assert.equal(inspectorSummary(part(bp, 'drive'), bp), 'Grip Wheel · Shaft to Motor · 1 wired');
  assert.equal(
    inspectorSummary(part(bp, 'motor'), bp),
    'Powered Motor · Shaft to Drive wheel · 3 wired',
    'the shaft outranks the power wire and the mount',
  );
  assert.equal(inspectorSummary(part(bp, 'cell'), bp), 'Power Cell · Power to Motor · 2 wired');
  bp.parts.push(createPart('beam', 'loose', [0, 3, 0]));
  assert.equal(inspectorSummary(part(bp, 'loose'), bp), 'Beam · no connections yet');
});
test('a compiler-rejected connection is not counted as wired', () => {
  const bp = createStarterVehicle();
  const shaft = bp.connections.find((c) => c.kind === 'shaft' && c.a.part === 'motor');
  const compiled = bp.connections.map((c) => ({
    id: c.id,
    reasonCode: c.id === shaft.id ? 'AXIS_MISMATCH' : 'OK',
  }));
  assert.equal(
    inspectorSummary(part(bp, 'drive'), bp, compiled),
    'Grip Wheel · no connections yet',
  );
  assert.equal(
    inspectorSummary(part(bp, 'motor'), bp, compiled),
    'Powered Motor · Power to Cell · 2 wired',
    'the next-ranked compiled connection becomes primary',
  );
});
