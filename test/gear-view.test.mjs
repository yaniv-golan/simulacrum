import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createConnectionView } from '../src/presentation/connection-view.mjs';
import { portLabel, portPurpose, connectionSuffix } from '../src/presentation/port-wording.mjs';
import { ASSEMBLY_REASON_CODES } from '../src/model/assembly.mjs';
import { parameterInputRange } from '../src/presentation/parameter-input.mjs';
import { CATALOG } from '../src/model/catalog.mjs';

test('gear mesh draws a dashed relationship, never a supporting shaft', () => {
  const parent = new THREE.Group(),
    view = createConnectionView(parent);
  view.update([
    {
      id: 'mesh',
      kind: 'gear',
      ends: [new THREE.Vector3(), new THREE.Vector3(0, 0, 0.18)],
      visible: true,
      highlighted: true,
      exploded: false,
      failed: false,
    },
  ]);
  const objects = [];
  parent.traverse((object) => objects.push(object));
  assert.equal(
    objects.filter((object) => object.isMesh).length,
    0,
    'a mesh relationship must not depict a solid shaft between gear centres',
  );
  assert.ok(objects.some((object) => object.isLine && object.material.isLineDashedMaterial));
  view.dispose();
  assert.equal(parent.children.length, 0);
});

test('mesh wording distinguishes transmission from structural support', () => {
  const port = { id: 'mesh', kind: 'gear' };
  assert.equal(portLabel({ type: 'spurGear' }, port), 'Gear mesh');
  assert.match(portPurpose({ type: 'spurGear' }, port), /separate.*shaft|independently/i);
  assert.match(portPurpose({ type: 'spurGear' }, port), /stay|move/i);
});

test('a diagnosed connection row names what the player would change, and an unnamed code falls back', () => {
  // An OK row carries no suffix at all: the wording is the diagnosis, not decoration.
  assert.equal(connectionSuffix('OK'), '');
  assert.equal(connectionSuffix('GEAR_TOOTH_SIZE_MISMATCH'), ' \u00b7 different tooth sizes');
  assert.equal(connectionSuffix('GEAR_MISALIGNED'), ' \u00b7 check spacing');
  // The two gear diagnoses must not read the same, or the row cannot tell them apart.
  assert.notEqual(
    connectionSuffix('GEAR_TOOTH_SIZE_MISMATCH'),
    connectionSuffix('GEAR_MISALIGNED'),
  );
  // Every other reason code keeps the established wording rather than an empty row.
  for (const code of ASSEMBLY_REASON_CODES.filter(
    (reason) => !['GEAR_TOOTH_SIZE_MISMATCH', 'GEAR_MISALIGNED'].includes(reason),
  ))
    assert.equal(connectionSuffix(code), ' \u00b7 check alignment', code);
  assert.equal(connectionSuffix('SOME_FUTURE_CODE'), ' \u00b7 check alignment');
});

test('a parameter with a fixed menu gives the control that menu bounds and spacing', () => {
  // Tooth size is a two-value menu, so the control steps between exactly those two values
  // instead of reporting 0.007 as a valid number and letting the schema refuse it.
  assert.deepEqual(parameterInputRange(CATALOG.spurGear.parameterDefinitions.module), {
    min: 0.005,
    max: 0.01,
    step: 0.005,
  });
  // The wrong trace a raw subtraction leaves: a step that is not the authored decimal.
  assert.equal(
    parameterInputRange({ type: 'number', minimum: 0, maximum: 1, enum: [0.1, 0.3] }).step,
    0.2,
  );
  // An integer menu keeps its own spacing, so a sign parameter cannot reach zero.
  assert.deepEqual(
    parameterInputRange({ type: 'integer', minimum: -1, maximum: 1, enum: [-1, 1] }),
    {
      min: -1,
      max: 1,
      step: 2,
    },
  );
  // A non-uniform menu can only be stepped by its smallest gap; the schema stays the authority.
  assert.equal(
    parameterInputRange({ type: 'integer', minimum: 1, maximum: 5, enum: [1, 2, 5] }).step,
    1,
  );
  // Without a menu nothing changes: integers step by one and other numbers stay free.
  assert.deepEqual(parameterInputRange(CATALOG.spurGear.parameterDefinitions.teeth), {
    min: 12,
    max: 36,
    step: 1,
  });
  assert.deepEqual(parameterInputRange(CATALOG.beam.parameterDefinitions.length), {
    min: 0.1,
    max: 1,
    step: null,
  });
});
