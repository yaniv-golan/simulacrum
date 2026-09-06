import test from 'node:test';
import assert from 'node:assert/strict';
import { explainFailure, normalizeFailure, explainReason } from '../src/model/messages.mjs';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
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
