import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionTestPaths } from '../src/model/connection-test-paths.mjs';
const part = (id, type) => ({ id, type, name: id });
const wire = (kind, a, ap, b, bp) => ({ kind, a: { part: a, port: ap }, b: { part: b, port: bp } });

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
