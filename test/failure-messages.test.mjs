import test from 'node:test';
import assert from 'node:assert/strict';
import { explainFailure, normalizeFailure, explainReason } from '../src/model/messages.mjs';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
import { proposeSurfaceMount } from '../src/model/assembly.mjs';
import { proposeMirroredAssembly } from '../src/model/mirror-assembly.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';

const fixture = () => ({
  ...createEmptyBlueprint('message-test', 'Machine'),
  parts: [{ ...createPart('poweredMotor', 'motor', [0, 0.2, 0]), name: 'Left drive' }],
});
test('invalid save exposes exact field and authored part name without exposing its value', () => {
  const bp = fixture();
  bp.parts[0].parameters.defaultDuty = 'private invalid value';
  const result = loadSave(bp);
  assert.equal(result.ok, false);
  const message = explainFailure(result, bp);
  assert.match(message, /Left drive/);
  assert.match(message, /Drive setting/);
  assert.ok(message.includes('/parts/0/parameters/defaultDuty'));
  assert.ok(!message.includes('private invalid value'));
});
test('missing and escaped fields remain actionable without dereferencing an invalid part', () => {
  const message = explainFailure({
    reasonCode: 'INVALID_BLUEPRINT',
    path: '/parts/3/parameters/not~1a~0field',
  });
  assert.match(message, /Part 4/);
  assert.ok(message.includes('/parts/3/parameters/not~1a~0field'));
  assert.match(
    explainFailure({ reasonCode: 'INVALID_BLUEPRINT', path: '/version' }),
    /Save format/,
  );
  assert.ok(
    !explainFailure({ reasonCode: 'INVALID_BLUEPRINT', path: '' }).includes('indicated field'),
  );
});
test('unexpected exceptions and getter properties cannot leak internal text into messages or result codes', () => {
  const error = new Error('secret /Users/private/source.mjs');
  error.path = '/Users/private/source.mjs';
  assert.deepEqual(normalizeFailure(error), { ok: false, reasonCode: 'INVALID_COMMAND', path: '' });
  assert.equal(explainFailure(error), explainReason('INVALID_COMMAND'));
  const hostile = {};
  Object.defineProperty(hostile, 'reasonCode', {
    get() {
      assert.fail('error getter executed');
    },
  });
  Object.defineProperty(hostile, 'path', {
    get() {
      assert.fail('path getter executed');
    },
  });
  assert.equal(explainFailure(hostile), explainReason('INVALID_COMMAND'));
  assert.deepEqual(
    normalizeFailure(Object.assign(Error('INVALID_ROTATION'), { path: '/parts/0/rotation' })),
    { ok: false, reasonCode: 'INVALID_ROTATION', path: '/parts/0/rotation' },
  );
});
test('real parameter rejection preserves current authored name and precise location', async () => {
  const workshop = await createWorkshop(fixture());
  try {
    const result = await workshop.act({
      type: 'parameter',
      id: 'motor',
      key: 'defaultDuty',
      value: 4,
    });
    assert.equal(result.ok, false);
    const message = explainFailure(result, workshop.save());
    assert.match(message, /Left drive/);
    assert.match(message, /Drive setting/);
    assert.ok(message.includes('/parts/0/parameters/defaultDuty'));
  } finally {
    workshop.dispose();
  }
});

test('mirror refusals name the authored part and distinguish unavailable mounts from shapes', () => {
  const bp = fixture();
  for (const [field, words] of [
    ['surface', /Left drive has no mounting face at the mirrored position/],
    ['ports/shaft', /Left drive has no matching connector at the mirrored position/],
    ['geometry', /Left drive.*shape or material layout/],
  ]) {
    const error = { reasonCode: 'MIRROR_UNREPRESENTABLE', path: `parts/motor/${field}` };
    assert.equal(normalizeFailure(error).path, error.path);
    assert.match(explainFailure(error, bp), words);
    assert.match(explainFailure(error, bp), /Try|Choose/);
  }
  for (const path of [
    'parts/missing/surface',
    '/Users/private/source.mjs',
    'parts/motor/../../secret',
  ]) {
    assert.equal(
      explainFailure({ reasonCode: 'MIRROR_UNREPRESENTABLE', path }, bp),
      explainReason('MIRROR_UNREPRESENTABLE'),
    );
  }
});

test('cell mount rejection retains its cause through the real mirror proposal', () => {
  let bp = createEmptyBlueprint('cell-mirror', 'Cell mirror');
  bp.parts = [
    createPart('powerCell', 'cell', [0, 1, 0]),
    createPart('poweredMotor', 'motor', [1, 1, 0]),
  ];
  bp.parts[0].name = 'My battery';
  bp = proposeSurfaceMount(bp, {
    part: 'motor',
    sourceRegion: 'left',
    targetPart: 'cell',
    targetRegion: 'left',
    id: 'mount',
  }).blueprint;
  const before = structuredClone(bp);
  assert.throws(
    () => proposeMirroredAssembly(bp, { ids: ['motor'], referenceId: 'cell', axis: 'x' }),
    (error) => {
      assert.equal(error.reasonCode, 'MIRROR_UNREPRESENTABLE');
      assert.match(
        explainFailure(normalizeFailure(error), bp),
        /My battery has no mounting face at the mirrored position/,
      );
      return true;
    },
  );
  assert.deepEqual(bp, before);
});
