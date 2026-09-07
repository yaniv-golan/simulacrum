import test from 'node:test';
import assert from 'node:assert/strict';
import { createAssemblyLibrary } from '../src/application/assembly-library.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { captureAssembly } from '../src/model/reusable-assemblies.mjs';
const definition = () => {
  const bp = createEmptyBlueprint('test', 'Test');
  bp.parts.push(createPart('powerCell', 'cell', [0, 1, 0]));
  return captureAssembly(bp, { name: 'Battery', ids: ['cell'], ports: [] }).definition;
};
test('library persists independent validated definitions and preserves data on corruption and quota failure', () => {
  const values = new Map();
  let fail = false;
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (fail) throw Error('quota');
      values.set(key, value);
    },
  };
  const lib = createAssemblyLibrary(storage);
  const input = definition();
  lib.add(input);
  input.parts[0].name = 'Changed';
  assert.equal(lib.list()[0].definition.parts[0].name, 'Power Cell');
  assert.deepEqual(createAssemblyLibrary(storage).list(), lib.list());
  const before = lib.list();
  fail = true;
  assert.throws(() => lib.add(definition()));
  assert.deepEqual(lib.list(), before);
  fail = false;
  const key = [...values.keys()][0];
  values.set(key, '{broken');
  const corrupt = createAssemblyLibrary(storage);
  assert.throws(() => corrupt.list());
  assert.throws(() => corrupt.add(definition()));
  assert.equal(values.get(key), '{broken');
  values.set(key, JSON.stringify({ version: 1, items: [{ id: 'bad', definition: {} }] }));
  assert.throws(() => createAssemblyLibrary(storage).list());
});

test('saved revisions have distinct names and can be renamed without altering authored content', () => {
  const values = new Map();
  const lib = createAssemblyLibrary({
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => values.set(k, v),
  });
  const first = lib.add(definition()),
    second = lib.add(definition());
  assert.notEqual(first.definition.name, second.definition.name);
  lib.rename(second.id, 'Travel supply');
  assert.equal(lib.list()[1].definition.name, 'Travel supply');
  assert.equal(lib.list()[1].definition.assemblies[0].name, 'Travel supply');
  assert.deepEqual(lib.list()[1].definition.parts, first.definition.parts);
  const before = lib.list();
  assert.throws(() => lib.rename(second.id, ''));
  assert.deepEqual(lib.list(), before);
});
