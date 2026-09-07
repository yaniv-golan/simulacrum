import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionTestPaths } from '../src/model/connection-test-paths.mjs';
const part = (id, type) => ({ id, type, name: id });
const wire = (kind, a, ap, b, bp) => ({
  id: `${kind}-${a}-${ap}-${b}-${bp}`,
  kind,
  a: { part: a, port: ap },
  b: { part: b, port: bp },
});

test('connection test follows only power wires and direct signal ownership in either endpoint order', () => {
  const bp = {
    parts: [
      part('m', 'poweredMotor'),
      part('bus', 'distributionBus'),
      part('cell', 'powerCell'),
      part('r', 'commandReceiver'),
      part('wheel', 'gripWheel'),
      part('isolated', 'powerCell'),
    ],
    connections: [
      wire('power', 'bus', 'power', 'm', 'power'),
      wire('power', 'cell', 'power', 'bus', 'power'),
      wire('signal', 'm', 'signal', 'r', 'signal'),
      wire('shaft', 'wheel', 'axle', 'm', 'shaft'),
      wire('fixed', 'isolated', 'x', 'm', 'x'),
    ],
  };
  const result = connectionTestPaths(bp, 'm');
  assert.deepEqual(
    result.powerSources.map((p) => p.id),
    ['cell'],
  );
  assert.deepEqual(
    result.powerPath.map((p) => p.id),
    ['m', 'bus', 'cell'],
  );
  assert.equal(result.manualReceiver.id, 'r');
  assert.deepEqual(
    result.shaftPeers.map((p) => p.id),
    ['wheel'],
  );
  bp.connections = bp.connections.map((c) => ({ ...c, a: c.b, b: c.a }));
  assert.deepEqual(connectionTestPaths(bp, 'm'), result);
  bp.connections.push(wire('signal', 'isolated', 'signal', 'r', 'command'));
  assert.equal(
    connectionTestPaths(bp, 'm').manualReceiver,
    null,
    'upstream authority blocks manual override',
  );
  bp.connections = bp.connections.filter((c) => c.kind !== 'signal');
  assert.equal(connectionTestPaths(bp, 'm').signalOwner, null);
  assert.equal(connectionTestPaths(bp, 'm').manualReceiver, null);
});

test('power graph terminates cycles, finds multiple cells, and never traverses a signal owner', () => {
  const bp = {
    parts: [
      part('m', 'poweredMotor'),
      part('a', 'distributionBus'),
      part('b', 'distributionBus'),
      part('c1', 'powerCell'),
      part('c2', 'powerCell'),
      part('logic', 'logicController'),
      part('r', 'commandReceiver'),
    ],
    connections: [
      wire('power', 'm', 'power', 'a', 'power'),
      wire('power', 'a', 'power', 'b', 'power'),
      wire('power', 'b', 'power', 'm', 'power'),
      wire('power', 'a', 'power', 'c1', 'power'),
      wire('power', 'b', 'power', 'c2', 'power'),
      wire('signal', 'logic', 'out', 'm', 'signal'),
      wire('signal', 'r', 'signal', 'logic', 'signal'),
    ],
  };
  const result = connectionTestPaths(bp, 'm');
  assert.deepEqual(
    result.powerSources.map((p) => p.id),
    ['c1', 'c2'],
  );
  assert.equal(result.signalOwner.id, 'logic');
  assert.equal(result.manualReceiver, null);
  assert.deepEqual(connectionTestPaths(bp, 'missing').powerSources, []);
});
test('diagnostic IDs are the chosen edges, not all edges induced by highlighted parts', () => {
  const edge = (id, kind, a, ap, b, bp) => ({ ...wire(kind, a, ap, b, bp), id });
  const bp = {
    parts: [
      part('m', 'poweredMotor'),
      part('peer', 'poweredMotor'),
      part('branch', 'distributionBus'),
      part('cell', 'powerCell'),
      part('other', 'powerCell'),
      part('wheel', 'gripWheel'),
    ],
    connections: [
      edge('chosen', 'power', 'm', 'power', 'peer', 'power'),
      edge('parallel', 'power', 'm', 'power', 'peer', 'power'),
      edge('signal', 'signal', 'm', 'signal', 'peer', 'signal'),
      edge('cell-edge', 'power', 'peer', 'power', 'cell', 'power'),
      edge('branch-edge', 'power', 'm', 'power', 'branch', 'power'),
      edge('cycle', 'power', 'branch', 'power', 'peer', 'power'),
      edge('other-cell', 'power', 'branch', 'power', 'other', 'power'),
      edge('shaft', 'shaft', 'm', 'shaft', 'wheel', 'axle'),
      edge('fixed', 'fixed', 'm', 'x', 'peer', 'x'),
    ],
  };
  const result = connectionTestPaths(bp, 'm');
  assert.deepEqual(
    result.powerSources.map((p) => p.id),
    ['cell', 'other'],
  );
  assert.deepEqual(result.powerConnectionIds, ['chosen', 'cell-edge']);
  assert.deepEqual(result.signalConnectionIds, ['signal']);
  assert.deepEqual(result.shaftConnectionIds, ['shaft']);
  const nodes = new Set(result.powerPath.map((p) => p.id));
  const wrong = bp.connections
    .filter((c) => nodes.has(c.a.part) && nodes.has(c.b.part))
    .map((c) => c.id);
  assert.notDeepEqual(
    wrong,
    result.powerConnectionIds,
    'parallel, signal and fixed edges are not the displayed source path',
  );
  assert.deepEqual(
    connectionTestPaths(
      { ...bp, connections: bp.connections.map((c) => ({ ...c, a: c.b, b: c.a })) },
      'm',
    ),
    result,
  );
  assert.deepEqual(connectionTestPaths(bp, 'missing').powerConnectionIds, []);
  assert.deepEqual(connectionTestPaths({ ...bp, connections: [] }, 'm').signalConnectionIds, []);
});
