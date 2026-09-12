import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../src/model/catalog.mjs';
import { portLabel, portPurpose } from '../src/presentation/port-wording.mjs';
test('every sensor exposes distinguishable measurement channels and an honest Power port', () => {
  for (const type of [
    'rotationSensor',
    'travelSensor',
    'rangeSensor',
    'linearMotionSensor',
    'tiltSensor',
    'jointAngleSensor',
    'contactSensor',
    'targetSensor',
  ]) {
    const ports = CATALOG[type].ports,
      part = { type };
    const labels = ports.map((p) => portLabel(part, p));
    assert.equal(new Set(labels).size, labels.length, type + ' has ambiguous ports');
    assert.equal(
      portLabel(
        part,
        ports.find((p) => p.kind === 'power'),
      ),
      'Power',
      type,
    );
    for (const port of ports.filter((p) => p.kind === 'signal'))
      assert.match(portPurpose(part, port), /sensor channel/);
  }
  assert.equal(
    portLabel({ type: 'logicController' }, { id: 'input16', kind: 'signal', direction: 'input' }),
    'Sensor input 16',
  );
  assert.equal(
    portLabel(
      { type: 'learningController' },
      { id: 'input10', kind: 'signal', direction: 'input' },
    ),
    'Sensor input 10',
  );
});
