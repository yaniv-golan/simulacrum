import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { check } from './fixtures/assessment-fixture.mjs';

check('arbitrary config and imported markdown change app identity', (f) => {
  writeFileSync(join(f.dir, 'config/runtime.json'), '{}');
  const before = f.fingerprint();
  writeFileSync(join(f.dir, 'config/runtime.json'), '{"x":1}');
  assert.notEqual(before, f.fingerprint());
  writeFileSync(join(f.dir, 'src/main.js'), "import text from '../docs/runtime.md?raw';");
  writeFileSync(join(f.dir, 'docs/runtime.md'), 'one');
  const first = f.fingerprint();
  writeFileSync(join(f.dir, 'docs/runtime.md'), 'two');
  assert.notEqual(first, f.fingerprint());
});
check('unimported documentation preserves app identity', (f) => {
  const before = f.fingerprint();
  writeFileSync(join(f.dir, 'docs/readme.md'), 'Contributor prose');
  assert.equal(f.fingerprint(), before);
});
check('ignored imported dependency is included and missing import fails closed', (f) => {
  writeFileSync(join(f.dir, '.gitignore'), 'config/secret.json\n');
  writeFileSync(join(f.dir, 'src/main.js'), "import settings from '../config/secret.json';");
  writeFileSync(join(f.dir, 'config/secret.json'), '{}');
  const first = f.fingerprint();
  writeFileSync(join(f.dir, 'config/secret.json'), '{"changed":true}');
  assert.notEqual(first, f.fingerprint());
  rmSync(join(f.dir, 'config/secret.json'));
  assert.notEqual(f.run('scripts/build-fingerprint.mjs').status, 0);
});
check('nonliteral imports refuse a certifying fingerprint', (f) => {
  writeFileSync(join(f.dir, 'src/main.js'), "const path = '../docs/runtime.md'; import(path);");
  assert.notEqual(f.run('scripts/build-fingerprint.mjs').status, 0);
});
