import test from 'node:test';
import assert from 'node:assert/strict';
import { CATALOG } from '../src/model/catalog.mjs';
import { PART_SEARCH, searchParts, ESSENTIAL_PARTS } from '../src/presentation/part-search.mjs';

test('search metadata covers available parts without becoming an alternative catalog', () => {
  assert.deepEqual(Object.keys(PART_SEARCH).sort(), Object.keys(CATALOG).sort());
  assert.equal(new Set(ESSENTIAL_PARTS).size, 9);
  for (const type of ESSENTIAL_PARTS) assert.ok(CATALOG[type]);
});
test('everyday words and roles find the intended part before incidental references', () => {
  for (const [query, type] of [
    ['battery', 'powerCell'],
    ['batery', 'powerCell'],
    ['batetry', 'powerCell'],
    ['tyre', 'gripWheel'],
    ['TIRE', 'gripWheel'],
    ['keyboard', 'commandReceiver'],
    ['engine', 'poweredMotor'],
    ['spin', 'poweredMotor'],
    ['latch', 'releaseCoupler'],
    ['headlight', 'poweredLamp'],
    ['camera', 'camera'],
    ['photograph', 'camera'],
    ['headlamp', 'poweredLamp'],
    ['illuminate', 'poweredLamp'],
    ['release cargo', 'releaseCoupler'],
    ['detect rotation', 'rotationSensor'],
    ['load cell', 'loadCellSensor'],
    ['measure tension', 'loadCellSensor'],
  ])
    assert.equal(searchParts(query)[0]?.type, type, query);
  assert.deepEqual(
    searchParts('cog').map((r) => r.type),
    ['gear12', 'gear24'],
  );
  assert.ok(
    searchParts('detect distance')
      .slice(0, 2)
      .every((r) => PART_SEARCH[r.type].category === 'Sensors'),
  );
  assert.match(searchParts('batery')[0].reason, /battery/);
  assert.equal(
    searchParts('engine').some((r) => r.type === 'powerCell'),
    false,
  );
});
test('numeric identity, coverage, deduplication and empty queries fail closed', () => {
  assert.deepEqual(
    searchParts('24T').map((r) => r.type),
    ['gear24'],
  );
  assert.deepEqual(searchParts('25T'), []);
  assert.deepEqual(searchParts('zz'), []);
  assert.deepEqual(searchParts(''), []);
  const result = searchParts('  DETECT, distance  ');
  assert.deepEqual(result, searchParts('detect distance'));
  assert.equal(new Set(result.map((r) => r.type)).size, result.length);
  assert.equal(searchParts('battery moon')[0]?.related, true);
  assert.deepEqual(searchParts('battery'), searchParts('battery'));
  assert.deepEqual(searchParts('battery', []), []);
});
test('canonical short descriptions satisfy the full query as well as added keywords', () => {
  const result = searchParts('stores energy')[0];
  assert.equal(result.type, 'powerCell');
  assert.equal(result.related, false);
});
test('multiword intent combines fields and recovers typos ahead of partial matches', () => {
  for (const query of ['motor spin', 'detect rotatoin']) {
    const result = searchParts(query)[0];
    assert.equal(result.type, query === 'motor spin' ? 'poweredMotor' : 'rotationSensor');
    assert.equal(result.related, false);
  }
  assert.match(searchParts('detect rotatoin')[0].reason, /Matched/);
  assert.equal(searchParts('motor moon')[0].related, true);
  assert.deepEqual(searchParts('25T cog'), []);
});
