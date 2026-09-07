import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { connectionRenderSpecs } from '../src/presentation/connection-render.mjs';
import { createConnectionView } from '../src/presentation/connection-view.mjs';
const edge = (id, kind = 'power') => ({
  id,
  kind,
  a: { part: 'a', port: 'power' },
  b: { part: 'b', port: 'power' },
});
test('render producer uses exact test edges and preserves source and endpoint poses', () => {
  const connections = [edge('tested'), edge('other', 'signal')];
  const input = {
    wiringVisible: true,
    revealedConnectionIds: new Set(),
    sourceEndpoint: null,
    connections,
    diagnostics: connections.map((e) => ({ id: e.id, reasonCode: 'OK' })),
    resolveEndpoint: (e) => new THREE.Vector3(e.part === 'a' ? 1 : 2, 3, 4),
    exploded: false,
    selectedPartId: null,
    tracedConnectionId: null,
    testConnectionIds: new Set(['tested']),
  };
  const before = structuredClone(connections),
    specs = connectionRenderSpecs(input);
  assert.deepEqual(
    specs.map((s) => [s.id, s.highlighted, s.visible]),
    [
      ['tested', true, true],
      ['other', false, true],
    ],
  );
  assert.deepEqual(
    specs[0].ends.map((p) => p.toArray()),
    [
      [1, 3, 4],
      [2, 3, 4],
    ],
  );
  assert.deepEqual(connections, before);
  assert.deepEqual(connectionRenderSpecs({ ...input, resolveEndpoint: () => null }), []);
});
test('hidden render resources neither intercept rays nor churn geometry and restore current endpoints', () => {
  const view = createConnectionView(new THREE.Group());
  const spec = {
    id: 'edge',
    kind: 'power',
    ends: [new THREE.Vector3(), new THREE.Vector3(1, 0, 0)],
    visible: true,
    highlighted: false,
    exploded: true,
    failed: false,
  };
  view.update([spec]);
  const resource = view.resources.get(spec.id),
    line = resource.group.children[0];
  const ray = new THREE.Raycaster(new THREE.Vector3(0.5, 0, 1), new THREE.Vector3(0, 0, -1));
  resource.group.updateMatrixWorld(true);
  assert.ok(ray.intersectObjects(view.pickableObjects()).length);
  view.update([{ ...spec, visible: false }]);
  assert.equal(resource.group.visible, false);
  assert.deepEqual(view.pickableObjects(), []);
  spec.ends[1].set(2, 0, 0);
  view.update([{ ...spec, visible: false }]);
  view.update([spec]);
  assert.equal(view.resources.get(spec.id), resource);
  assert.equal(resource.group.children[0], line);
  assert.equal(line.geometry.attributes.position.getX(1), 2);
  assert.equal(resource.group.visible, true);
  view.dispose();
  assert.deepEqual(view.pickableObjects(), []);
});

test('electrical visibility unions exact inspection edges without revealing ordinary selections', () => {
  const connections = [
    edge('power'),
    edge('signal', 'signal'),
    edge('shaft', 'shaft'),
    { ...edge('unrelated'), a: { part: 'x', port: 'power' }, b: { part: 'y', port: 'power' } },
  ];
  const input = {
    connections,
    diagnostics: [],
    resolveEndpoint: () => new THREE.Vector3(),
    exploded: false,
    selectedPartId: 'a',
    tracedConnectionId: null,
    testConnectionIds: new Set(),
    wiringVisible: false,
    revealedConnectionIds: new Set(),
    sourceEndpoint: null,
  };
  const visible = (overrides = {}) =>
    connectionRenderSpecs({ ...input, ...overrides })
      .filter((s) => s.visible)
      .map((s) => s.id);
  assert.deepEqual(visible(), ['shaft']);
  assert.deepEqual(visible({ tracedConnectionId: 'signal' }), ['signal', 'shaft']);
  assert.deepEqual(visible({ revealedConnectionIds: new Set(['power', 'deleted']) }), [
    'power',
    'shaft',
  ]);
  assert.deepEqual(visible({ sourceEndpoint: { part: 'a', port: 'missing' } }), ['shaft']);
  assert.deepEqual(visible({ sourceEndpoint: { part: 'a', port: 'power' } }), [
    'power',
    'signal',
    'shaft',
  ]);
  assert.deepEqual(
    visible({ tracedConnectionId: 'signal', revealedConnectionIds: new Set(['power']) }),
    ['power', 'signal', 'shaft'],
  );
  assert.deepEqual(
    visible({ exploded: true }),
    connections.map((e) => e.id),
  );
  assert.deepEqual(
    visible({ wiringVisible: true }),
    connections.map((e) => e.id),
  );
});

test('mounted wiring preferences separate build from run and paused and reset on remount', async () => {
  const { createWiringPreferences } = await import('../src/presentation/connection-render.mjs');
  const prefs = createWiringPreferences();
  assert.equal(prefs.read('build'), true);
  assert.equal(prefs.read('run'), false);
  prefs.set('build', false);
  prefs.set('paused', true);
  assert.equal(prefs.read('run'), true);
  assert.equal(prefs.read('build'), false);
  assert.equal(prefs.read('paused'), true);
  assert.equal(createWiringPreferences().read('run'), false);
  assert.equal(createWiringPreferences().read('build'), true);
});
