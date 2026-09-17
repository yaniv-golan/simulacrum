import manifest from '../scripts/manifest.json' with { type: 'json' };
import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  CURRENT_SAVE_VERSION,
  createEmptyBlueprint,
  createPart,
  validateBlueprint,
  loadSave,
} from '../src/model/blueprint.mjs';
import { CATALOG, MATERIALS } from '../src/model/catalog.mjs';
const valid = () => ({
  ...createEmptyBlueprint('machine', 'Workshop machine'),
  parts: [createPart('beam', 'a', [0, 0, 0]), createPart('beam', 'b', [0.4, 0, 0])],
  connections: [
    {
      id: 'join',
      kind: 'fixed',
      a: { part: 'a', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
      b: { part: 'b', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
    },
  ],
});
test('explicit authoring factory creates strict valid data without validator mutation', () => {
  const blueprint = valid(),
    before = structuredClone(blueprint);
  assert.deepEqual(validateBlueprint(blueprint), { ok: true, reasonCode: 'OK', path: '' });
  assert.deepEqual(blueprint, before);
  assert.deepEqual(createPart('plate', 'p', [0, 0, 0]).rotation, [0, 0, 0, 1]);
  assert.deepEqual(createPart('plate', 'p', [0, 0, 0]).authoredMaterial, {});
});
test('every required runtime field is rejected when missing', () => {
  const blueprint = valid();
  for (const path of [[], ['parts', 0], ['connections', 0], ['connections', 0, 'a']]) {
    const target = path.reduce((value, key) => value[key], blueprint);
    for (const key of Object.keys(target)) {
      const wrong = structuredClone(blueprint),
        record = path.reduce((value, key) => value[key], wrong);
      delete record[key];
      const result = validateBlueprint(wrong);
      assert.equal(result.ok, false, `${path.join('/')}/${key}`);
      assert.equal(typeof result.path, 'string');
    }
  }
});
test('malformed schema and semantic witnesses fail with actionable paths', () => {
  const witnesses = [
    [(b) => (b.parts[0].rotation = [0, 0, 0, 2]), 'INVALID_ROTATION', '/parts/0/rotation'],
    [(b) => (b.parts[0].position[0] = Infinity), 'INVALID_BLUEPRINT', '/parts/0/position/0'],
    [(b) => (b.parts[1].id = 'a'), 'DUPLICATE_ID', '/parts/1/id'],
    [(b) => (b.parts[0].type = 'magic'), 'UNKNOWN_PART_TYPE', '/parts/0/type'],
    [(b) => (b.connections[0].a.part = 'absent'), 'UNKNOWN_PART', '/connections/0/a/part'],
    [(b) => (b.connections[0].a.surface.region = 'absent'), 'UNKNOWN_SURFACE', '/connections/0'],
    [(b) => (b.connections[0].b.part = 'a'), 'SELF_CONNECTION', '/connections/0/b/part'],
    [
      (b) => (b.parts[0].authoredMaterial.body = 'secret'),
      'UNKNOWN_MATERIAL',
      '/parts/0/authoredMaterial/body',
    ],
    [(b) => (b.parts[0].rigRole = 'foot'), 'INVALID_BLUEPRINT', '/parts/0/rigRole'],
    [
      (b) => (b.parts[0].authoredMaterial.extra = 'steel'),
      'INVALID_BLUEPRINT',
      '/parts/0/authoredMaterial/extra',
    ],
  ];
  for (const [mutate, reasonCode, path] of witnesses) {
    const b = valid();
    mutate(b);
    assert.deepEqual(validateBlueprint(b), { ok: false, reasonCode, path });
  }
});
test('a fixed attachment port cannot silently acquire a second connection', () => {
  const b = valid();
  b.parts.push(createPart('beam', 'c', [0.4, 0, 0]));
  b.connections.push({
    id: 'other',
    kind: 'fixed',
    a: { part: 'c', surface: { region: 'right', u: 0, v: 0, twist: 0 } },
    b: { part: 'b', surface: { region: 'left', u: 0, v: 0, twist: 0 } },
  });
  assert.equal(validateBlueprint(b).reasonCode, 'PORT_OCCUPIED');
});
test('save versions explicitly refuse unsupported formats; no missing-field inference', () => {
  for (const version of [0, -1])
    assert.equal(loadSave({ ...valid(), version }).reasonCode, 'SAVE_VERSION_UNSUPPORTED_OLD');
  assert.equal(loadSave({ ...valid(), version: 5 }).reasonCode, 'SAVE_VERSION_FUTURE');
  const missing = valid();
  delete missing.version;
  assert.equal(loadSave(missing).ok, false);
  assert.equal(loadSave('{broken').reasonCode, 'INVALID_JSON');
  const b = valid();
  assert.deepEqual(loadSave(JSON.stringify(b)).blueprint, b);
  const loaded = loadSave(b);
  loaded.blueprint.parts[0].name = 'Changed';
  assert.notEqual(b.parts[0].name, 'Changed');
});
test('catalog geometry, materials and port frames are immutable and player-selectable', () => {
  for (const material of Object.values(MATERIALS)) {
    assert.equal(material.selectable, true);
    assert.ok(material.density > 0);
    assert.ok(material.friction >= 0);
    assert.throws(() => {
      material.density = 1;
    });
  }
  for (const part of Object.values(CATALOG)) {
    assert.ok(manifest.milestones.includes(part.milestone));
    assert.ok(
      manifest.milestones.indexOf(part.milestone) <=
        manifest.milestones.indexOf(manifest.milestone),
    );
    assert.equal(part.primitives[0].id, 'body');
    assert.ok(Object.hasOwn(MATERIALS, part.primitives[0].materialKey));
    assert.throws(() => {
      part.primitives[0].halfExtents[0] = 100;
    });
    for (const port of part.ports) assert.equal(port.rotation.length, 4);
  }
});
test('generated valid authoring data roundtrips and malformed variants shrink', () => {
  const identifiers = fc.stringMatching(/^[a-z][a-z0-9]{0,12}$/);
  fc.assert(
    fc.property(
      identifiers,
      identifiers,
      fc.constantFrom(...Object.keys(CATALOG)),
      fc.constantFrom(...Object.keys(MATERIALS)),
      fc.tuple(
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
        fc.integer({ min: -100, max: 100 }),
      ),
      (id, name, type, material, position) => {
        const b = createEmptyBlueprint(id, name),
          p = createPart(type, 'part', position);
        p.authoredMaterial.body = material;
        b.parts.push(p);
        assert.equal(validateBlueprint(b).ok, true);
        assert.deepEqual(loadSave(JSON.stringify(b)).blueprint, b);
        const bad = structuredClone(b);
        bad.parts[0].rotation[3] = 2;
        assert.equal(validateBlueprint(bad).ok, false);
      },
    ),
    { seed: 19471, numRuns: 100 },
  );
});
test('non-JSON objects and accessors are rejected without invoking getters', () => {
  const b = valid();
  let invoked = false;
  Object.defineProperty(b.parts[0], 'name', {
    enumerable: true,
    get() {
      invoked = true;
      return 'fake';
    },
  });
  assert.equal(validateBlueprint(b).ok, false);
  assert.equal(invoked, false);
  const cyclic = valid();
  cyclic.extra = cyclic;
  assert.equal(validateBlueprint(cyclic).ok, false);
});
test('string limits reject terminal newlines beyond the bounded field', () => {
  const b = valid();
  b.id = 'machine\n';
  assert.equal(validateBlueprint(b).ok, false);
  b.id = 'machine';
  b.name = 'x'.repeat(128) + '\n';
  assert.equal(validateBlueprint(b).ok, false);
  b.name = 'x'.repeat(128);
  assert.equal(validateBlueprint(b).ok, true);
});
test('M3 factories expose complete player-authored electrical ratings', () => {
  const motor = createPart('poweredMotor', 'motor', [0, 0, 0]);
  assert.equal(motor.parameters.defaultDuty, 1);
  assert.equal(motor.parameters.torqueConstant, 0.4);
  const cell = createPart('powerCell', 'cell', [0, 0, 0]);
  assert.equal(cell.parameters.voltage, 24);
  assert.equal(CATALOG.poweredMotor.milestone, 'M3');
  assert.equal(CATALOG.gripWheel.primitives[0].materialKey, 'rubber');
});
test('current runtime requires parameters and rejects unknown or out-of-range ratings', () => {
  const b = valid();
  assert.equal(b.version, CURRENT_SAVE_VERSION);
  delete b.parts[0].parameters;
  assert.equal(validateBlueprint(b).ok, false);
  const motor = createPart('poweredMotor', 'motor', [0, 0, 0]);
  const machine = createEmptyBlueprint('m', 'Motor');
  machine.parts.push(motor);
  delete motor.parameters.resistance;
  assert.equal(validateBlueprint(machine).ok, false);
  motor.parameters.resistance = 1;
  motor.parameters.secretTorque = 100;
  assert.equal(validateBlueprint(machine).ok, false);
  delete motor.parameters.secretTorque;
  motor.parameters.currentLimit = 0;
  assert.equal(validateBlueprint(machine).ok, false);
});
test('only the current save format is admitted', () => {
  for (const version of [1, 2, 3])
    assert.equal(loadSave({ ...valid(), version }).reasonCode, 'SAVE_VERSION_UNSUPPORTED_OLD');
  assert.equal(loadSave(valid()).ok, true);
});
test('power ports permit fanout and signal ports enforce authored direction', () => {
  const b = createEmptyBlueprint('wiring', 'Wiring');
  b.parts.push(
    createPart('powerCell', 'cell', [0, 0, 0]),
    createPart('poweredMotor', 'm1', [0, 0, 0]),
    createPart('poweredMotor', 'm2', [0, 0, 0]),
  );
  b.connections.push(
    {
      id: 'p1',
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: 'm1', port: 'power' },
    },
    {
      id: 'p2',
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: 'm2', port: 'power' },
    },
  );
  assert.equal(validateBlueprint(b).ok, true);
  b.parts.push(createPart('commandReceiver', 'receiver', [0, 0, 0]));
  b.connections.push({
    id: 's',
    kind: 'signal',
    a: { part: 'receiver', port: 'signal' },
    b: { part: 'm1', port: 'signal' },
  });
  assert.equal(validateBlueprint(b).ok, true);
  b.connections.at(-1).a = { part: 'm2', port: 'signal' };
  assert.equal(validateBlueprint(b).ok, false);
});
