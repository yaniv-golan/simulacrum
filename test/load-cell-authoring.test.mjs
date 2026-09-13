import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG, MATERIALS } from '../src/model/catalog.mjs';
import {
  createPart,
  createEmptyBlueprint,
  loadSave,
  validateBlueprint,
} from '../src/model/blueprint.mjs';
import { compileAssembly, proposeSurfaceMount } from '../src/model/assembly.mjs';
import { surfaceRegions } from '../src/model/surfaces.mjs';
import { captureAssembly, insertAssembly } from '../src/model/reusable-assemblies.mjs';
import { proposeMirroredAssembly } from '../src/model/mirror-assembly.mjs';

function machine() {
  let b = createEmptyBlueprint('force-machine', 'Force machine');
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
  return proposeSurfaceMount(b, {
    part: 'payload',
    sourceRegion: 'left',
    targetPart: 'sensor',
    targetRegion: 'right',
    id: 'B',
  }).blueprint;
}
const descriptor = (b, id = 'sensor') =>
  compileAssembly(b).configuration.power.sensors.find(
    (s) => s.node === b.parts.findIndex((p) => p.id === id),
  );
const surface = (part, region, u = 0) => ({ part, surface: { region, u, v: 0, twist: 0 } });

test('load cell has exactly two full mounting faces and ordinary supplied force output ports', () => {
  const b = createEmptyBlueprint('empty-force', 'Empty force');
  b.parts.push(createPart('loadCellSensor', 'sensor', [0, 2, 0]));
  assert.deepEqual(CATALOG.loadCellSensor.primitives[0].halfExtents, [0.06, 0.02, 0.02]);
  assert.equal(CATALOG.loadCellSensor.primitives[0].materialKey, 'aluminium');
  assert.equal(CATALOG.loadCellSensor.milestone, 'M3b');
  const regions = surfaceRegions(b.parts[0]);
  assert.deepEqual(regions.map((r) => r.id).sort(), ['left', 'right']);
  for (const r of regions) assert.deepEqual(r.padHalfSize, [0.02, 0.02]);
  assert.deepEqual(
    CATALOG.loadCellSensor.ports.map((p) => [p.id, p.kind, p.direction, p.multiplicity]),
    [
      ['power', 'power', 'bidirectional', 'many'],
      ['axialForce', 'signal', 'output', 'many'],
      ['load', 'signal', 'output', 'many'],
    ],
  );
  assert.deepEqual(descriptor(b), {
    node: 0,
    body: 0,
    kind: 'loadCell',
    joint: -1,
    support: -1,
    sign: 1,
    supply: { resistance: 1000, minVoltage: 1 },
  });
});

test('ordinary two-face mounting binds B and its physical side independently of serialization', () => {
  const b = machine();
  assert.deepEqual(descriptor(b), {
    node: 1,
    body: 1,
    kind: 'loadCell',
    joint: 1,
    support: 0,
    sign: -1,
    supply: { resistance: 1000, minVoltage: 1 },
  });
  assert.ok(compileAssembly(b).connections.every((c) => c.reasonCode === 'OK'));
  for (const edge of b.connections) [edge.a, edge.b] = [edge.b, edge.a];
  assert.equal(descriptor(b).sign, 1);
  assert.equal(descriptor(b).joint, 1);
  b.connections = b.connections.filter((c) => c.id !== 'B');
  assert.equal(descriptor(b).joint, -1);
  assert.equal(descriptor(b).support, 0);
});

test('one-per-face admission counts both endpoint roles and receiving-face offsets', () => {
  for (const face of ['left', 'right'])
    for (const sensorSide of ['a', 'b']) {
      const b = machine();
      b.parts.push(createPart('spacerBlock', 'extra', [5, 2, 0]));
      const own = surface('sensor', face, sensorSide === 'a' ? 0.003 : 0);
      const other = surface(
        sensorSide === 'a' ? 'extra' : 'support',
        sensorSide === 'a' ? 'left' : 'right',
      );
      b.connections.push({
        id: 'duplicate',
        kind: 'fixed',
        a: sensorSide === 'a' ? own : other,
        b: sensorSide === 'b' ? own : other,
      });
      assert.equal(
        validateBlueprint(b).reasonCode,
        'PORT_OCCUPIED',
        JSON.stringify({ face, sensorSide }),
      );
    }
});

test('save admission rejects invented sensor bindings and preserves selected material and identity-independent mass', () => {
  for (const material of Object.keys(MATERIALS)) {
    const b = machine();
    b.parts[1].authoredMaterial.body = material;
    const first = compileAssembly(b).configuration;
    assert.ok(
      Math.abs(first.bodies[1].mass - 0.12 * 0.04 * 0.04 * MATERIALS[material].density) < 1e-12,
    );
    b.parts[1].name = 'A different name';
    b.parts[1].id = 'renamed';
    for (const edge of b.connections)
      for (const endpoint of [edge.a, edge.b])
        if (endpoint.part === 'sensor') endpoint.part = 'renamed';
    const loaded = loadSave(JSON.stringify(b));
    assert.equal(loaded.reasonCode, 'OK');
    assert.deepEqual(compileAssembly(b).configuration, first);
    for (const key of ['jointBinding', 'targetBinding', 'springBinding']) {
      const bad = structuredClone(b);
      bad.parts[1][key] = 'B';
      assert.equal(loadSave(bad).reasonCode, 'INVALID_BLUEPRINT');
    }
  }
});

test('independent assembly copies and mirrors bind their own B while partial copies stay disconnected', () => {
  const b = machine();
  b.parts[1].authoredMaterial.body = 'steel';
  const full = captureAssembly(b, {
    name: 'Force chain',
    ids: b.parts.map((p) => p.id),
    ports: [],
  }).definition;
  const inserted = insertAssembly(b, full, [0, 4, 0], [0, 0, 0, 1]);
  const out = inserted.blueprint;
  const cells = compileAssembly(out).configuration.power.sensors;
  assert.equal(cells.length, 2);
  assert.notEqual(cells[0].joint, cells[1].joint);
  const cfg = compileAssembly(out).configuration;
  assert.ok([cfg.joints[cells[1].joint].a, cfg.joints[cells[1].joint].b].includes(cells[1].body));
  const partial = captureAssembly(b, { name: 'Cell only', ids: ['sensor'], ports: [] }).definition;
  const p = insertAssembly(
    createEmptyBlueprint('partial', 'Partial'),
    partial,
    [0, 2, 0],
    [0, 0, 0, 1],
  ).blueprint;
  assert.equal(compileAssembly(p).configuration.power.sensors[0].joint, -1);
  const mirror = proposeMirroredAssembly(b, {
    ids: ['sensor', 'payload'],
    referenceId: 'support',
    axis: 'x',
  });
  const mirrored = descriptor(mirror.blueprint, mirror.idMap.sensor);
  assert.notEqual(mirrored.joint, descriptor(b).joint);
  assert.equal(
    mirror.blueprint.parts.find((part) => part.id === mirror.idMap.sensor).authoredMaterial.body,
    'steel',
  );
});

test('existing Rules controller receives force channels with SI units', () => {
  const b = machine();
  const controller = createPart('logicController', 'rules', [0, 2, 2]);
  controller.controllerProgram = {
    version: 1,
    mode: 'rules',
    source: '',
    rules: [],
    savedCode: [],
  };
  b.parts.push(controller);
  for (const [i, channel] of ['axialForce', 'load'].entries())
    b.connections.push({
      id: `sense-${i}`,
      kind: 'signal',
      a: { part: 'sensor', port: channel },
      b: { part: 'rules', port: `input${i + 1}` },
    });
  const inputs = compileAssembly(b).configuration.power.controllers[0].program.inputs;
  assert.deepEqual(
    inputs.map((x) => [x.port, x.channel, x.unit]),
    [
      ['input1', 'axialForce', 'N'],
      ['input2', 'load', 'N'],
    ],
  );
});
