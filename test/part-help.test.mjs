import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../src/model/catalog.mjs';
import { PART_HELP, PART_EXAMPLES } from '../src/presentation/part-help-content.mjs';
import { PRIMARY_PARTS, MORE_PARTS } from '../src/presentation/part-palette.mjs';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
import { compileAssembly, snapConnection, proposeSurfaceMount } from '../src/model/assembly.mjs';
function coverage(content) {
  assert.deepEqual(Object.keys(content).sort(), Object.keys(CATALOG).sort());
  for (const entry of Object.values(content)) {
    for (const key of ['purpose', 'explanation', 'needs']) assert.ok(entry[key].length > 12);
    assert.ok(entry.steps.length);
    for (const id of entry.examples) assert.ok(PART_EXAMPLES[id]);
  }
}
test('catalog help coverage rejects an omitted supported loaded type', () => {
  coverage(PART_HELP);
  const missing = { ...PART_HELP };
  delete missing.logicController;
  assert.throws(() => coverage(missing));
  assert.deepEqual(PRIMARY_PARTS, ['powerCell', 'poweredMotor', 'gripWheel']);
  assert.deepEqual(
    MORE_PARTS,
    Object.keys(CATALOG).filter(
      (type) => !PRIMARY_PARTS.includes(type) && type !== 'logicController',
    ),
  );
  const loaded = {
    ...createEmptyBlueprint('help', 'Help'),
    parts: [createPart('logicController', 'logic', [0, 1, 0])],
  };
  assert.equal(loadSave(loaded).blueprint.parts[0].type, 'logicController');
  loaded.parts[0].type = 'unsupported';
  assert.equal(loadSave(loaded).ok, false);
});
function fixture(example) {
  let bp = {
    ...createEmptyBlueprint('example', 'Example'),
    parts: Object.entries(example.nodes).map(([id, type], i) =>
      createPart(type, id, [i * 2, 1, 0]),
    ),
  };
  for (const [i, edge] of example.edges.entries()) {
    if (edge.kind === 'mount') {
      bp = proposeSurfaceMount(bp, {
        part: edge.a.node,
        sourceRegion: edge.a.port,
        targetPart: edge.b.node,
        targetRegion: edge.b.port,
        u: edge.a.node === 'bearing' ? 0.1 : 0.04,
        v: 0,
        id: `edge-${i}`,
      }).blueprint;
    } else {
      const a = { part: edge.a.node, port: edge.a.port },
        b = { part: edge.b.node, port: edge.b.port };
      bp = snapConnection(bp, a, b);
      bp.connections.push({ id: `edge-${i}`, kind: edge.kind, a, b });
    }
  }
  return bp;
}
test('all schematic endpoints compile as ordinary authored connections', () => {
  for (const [id, example] of Object.entries(PART_EXAMPLES)) {
    const bp = fixture(example);
    assert.equal(compileAssembly(bp).connections.length, example.edges.length, id);
    const wrong = structuredClone(bp);
    const edge = wrong.connections.find((e) => e.kind !== 'fixed');
    edge.b.port = 'invented-port';
    assert.throws(() => compileAssembly(wrong), id);
    const crossed = structuredClone(example);
    const wire = crossed.edges.find((edge) => edge.kind === 'power');
    if (wire) {
      wire.kind = 'shaft';
      assert.throws(
        () => compileAssembly(fixture(crossed)),
        'power ports are not shaft attachments',
      );
    }
    const wheelIndex = bp.parts.findIndex((part) => part.type === 'gripWheel');
    if (wheelIndex >= 0) {
      const joint = compileAssembly(bp).configuration.joints.find(
        (j) => j.a === wheelIndex || j.b === wheelIndex,
      );
      assert.equal(joint.kind, 'revolute', `${id}: wheel spin must remain independent`);
    }
  }
  const swapped = structuredClone(PART_EXAMPLES.steer);
  for (const edge of swapped.edges)
    for (const endpoint of [edge.a, edge.b]) {
      if (endpoint.node === 'hub') endpoint.port = endpoint.port === 'shaft' ? 'steering' : 'shaft';
    }
  assert.throws(() => {
    const bp = fixture(swapped);
    const c = compileAssembly(bp).configuration;
    const wheel = bp.parts.findIndex((p) => p.id === 'wheel');
    assert.equal(c.joints.find((j) => j.a === wheel || j.b === wheel).kind, 'revolute');
  }, 'swapping hub endpoints cannot teach independent wheel spin');
});

test('free-wheel example permits relative spin and rejects a rigid-wheel explanation', async () => {
  const { createPhysicsWorld } = await import('../src/simulation/physics/world.mjs');
  const blueprint = fixture(PART_EXAMPLES.free);
  const { bodies, joints, gravity } = compileAssembly(blueprint, {
    gravity: [0, 0, 0],
    ground: null,
  }).configuration;
  const wheel = blueprint.parts.findIndex((p) => p.id === 'wheel');
  const bearing = blueprint.parts.findIndex((p) => p.id === 'bearing');
  async function speed(constraints) {
    const world = await createPhysicsWorld({ bodies, joints: constraints, gravity });
    try {
      for (let i = 0; i < 60; i++) {
        world.applyTorquePair(bearing, wheel, [1, 0, 0], 0.01);
        world.step();
      }
      const state = world.read();
      return Math.abs(state[wheel].angularVelocity[0] - state[bearing].angularVelocity[0]);
    } finally {
      world.dispose();
    }
  }
  const free = await speed(joints);
  assert.ok(free > 0.5, `Free wheel must turn relative to its housing: ${free}`);
  const rigid = joints.map((j) =>
    j.kind === 'revolute'
      ? {
          kind: 'fixed',
          a: j.a,
          b: j.b,
          anchorA: j.anchorA,
          anchorB: j.anchorB,
          rotationA: [0, 0, 0, 1],
          rotationB: [0, 0, 0, 1],
        }
      : j,
  );
  assert.ok(
    (await speed(rigid)) < 0.01,
    'A rigidly attached wheel cannot satisfy the free-spin explanation',
  );
});
