import test from 'node:test';
import assert from 'node:assert/strict';
import { redactCommandInput } from '../src/application/recording-privacy.mjs';
test('nested command payloads omit names, programs, numbers and assembly bodies', () => {
  assert.deepEqual(
    redactCommandInput({
      type: 'insert-assembly',
      definition: { parts: [{ name: 'secret', controllerProgram: { source: 'write("out1", 1)' } }] },
      position: [1, 2, 3],
      rotation: [0, 0, 0, 1],
    }),
    {
      type: 'insert-assembly',
      definition: 'not captured',
      position: 'not captured',
      rotation: 'not captured',
    },
  );
  assert.deepEqual(
    redactCommandInput({ type: 'insert', part: { name: 'Wheel', parameters: { diameter: 0.2 } } }),
    { type: 'insert', part: 'not captured' },
  );
  assert.deepEqual(redactCommandInput({ type: 'rename', id: 'a', name: 'Secret' }), {
    type: 'rename',
    id: 'a',
    name: 'not captured',
  });
  assert.deepEqual(
    redactCommandInput({ type: 'parameter', id: 'a', key: 'length', value: 0.4 }),
    { type: 'parameter', id: 'a', key: 'length', value: 'not captured' },
  );
  assert.deepEqual(
    redactCommandInput({
      type: 'create-assembly',
      name: 'My group',
      ids: ['a'],
      ports: [],
    }),
    { type: 'create-assembly', name: 'not captured', ids: ['a'], ports: [] },
  );
});
