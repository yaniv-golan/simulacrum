import test from 'node:test';
import assert from 'node:assert/strict';
import {
  boundaryTypes,
  schemaType,
  generateBoundaryTypes,
} from '../scripts/generate-boundary-types.mjs';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildBlueprintSchema } from '../scripts/generate-schema.mjs';
import {
  radiansToDegrees,
  degreesToRadians,
  metresToMillimetres,
  millimetresToMetres,
} from '../src/model/display-units.mjs';

test('runtime schema generates exclusive endpoints, tuples and catalog-specific parameters', () => {
  const schema = buildBlueprintSchema(),
    output = boundaryTypes();
  assert.match(schemaType(schema.$defs.endpoint), /"surface"\?: never/);
  assert.match(schemaType(schema.$defs.endpoint), /"port"\?: never/);
  assert.equal(schemaType(schema.$defs.position), '[number, number, number]');
  for (const variant of schema.$defs.part.allOf) {
    const type = variant.if.properties.type.const;
    assert.ok(output.includes(`"type": "${type}"`));
    for (const key of Object.keys(variant.then.properties.parameters.properties))
      assert.ok(output.includes(`"${key}"`));
  }
});
test('unsupported structural schemas fail closed', () => {
  assert.throws(() => schemaType({ type: 'object' }), /Unsupported structural schema/);
  assert.throws(() => schemaType({ allOf: [] }), /Resolve conditional/);
});
test('generated freshness gate rejects changed declaration text', () => {
  const directory = mkdtempSync(join(tmpdir(), 'boundary-types-'));
  const destination = join(directory, 'types.d.ts');
  try {
    generateBoundaryTypes({ destination });
    assert.doesNotThrow(() => generateBoundaryTypes({ check: true, destination }));
    writeFileSync(
      destination,
      readFileSync(destination, 'utf8').replace('"diameter"?: number', '"diameter"?: string'),
    );
    assert.throws(() => generateBoundaryTypes({ check: true, destination }), /stale/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test('named display conversions preserve SI round trips and signed angles', () => {
  assert.equal(radiansToDegrees(Math.PI / 2), 90);
  assert.equal(degreesToRadians(-180), -Math.PI);
  assert.equal(metresToMillimetres(0.025), 25);
  assert.equal(millimetresToMetres(-25), -0.025);
  for (const value of [-1.2, 0, 0.53])
    assert.ok(Math.abs(degreesToRadians(radiansToDegrees(value)) - value) < 1e-15);
});
