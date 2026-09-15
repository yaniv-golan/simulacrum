import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkFormat, FORMAT_TARGETS } from '../scripts/check-format.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
function tree(t) {
  const root = mkdtempSync(join(tmpdir(), 'format-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  symlinkSync(join(repo, 'node_modules'), join(root, 'node_modules'));
  writeFileSync(join(root, '.prettierrc.json'), '{"singleQuote":true,"printWidth":100}\n');
  for (const dir of FORMAT_TARGETS) {
    mkdirSync(join(root, dir));
    // prettier refuses an empty target directory; every target starts with one formatted file.
    writeFileSync(join(root, dir, 'ok.mjs'), "export const ok = 'yes';\n");
  }
  return root;
}

test('the format gate refuses a tree with one file outside prettier layout and names it', (t) => {
  const root = tree(t);
  assert.deepEqual(checkFormat(root), { targets: [...FORMAT_TARGETS] });
  // The real slip this gate exists for: a hand-edited line past the print width.
  writeFileSync(
    join(root, 'scripts/env.mjs'),
    "export const names = Object.freeze(['NODE_ENV', 'NODE_OPTIONS', 'POWER_BASELINE_SOURCE', 'SIMULACRUM_HOST_PROFILE']);\n",
  );
  assert.throws(() => checkFormat(root), /1 file\(s\) not in prettier layout: scripts\/env\.mjs/);
  // Formatting it clears the gate; a second unformatted file is counted too.
  writeFileSync(
    join(root, 'scripts/env.mjs'),
    "export const names = Object.freeze([\n  'NODE_ENV',\n  'NODE_OPTIONS',\n  'POWER_BASELINE_SOURCE',\n  'SIMULACRUM_HOST_PROFILE',\n]);\n",
  );
  assert.doesNotThrow(() => checkFormat(root));
  writeFileSync(join(root, 'test/a.test.mjs'), 'const a = 1\n');
  writeFileSync(join(root, 'src/b.mjs'), 'export const b={x:1}\n');
  assert.throws(() => checkFormat(root), /2 file\(s\).*src\/b\.mjs.*test\/a\.test\.mjs/);
});

test('the gate names the file under a CI environment, where prettier colours its warnings', (t) => {
  // GitHub's runner sets CI, and prettier (picocolors) then colours `[warn]` even through a
  // pipe: hosted runs #2–#4 (2026-09-15) fell to the generic "prettier --check failed" line
  // because the parser matched plain `[warn] ` only. The gate must read the file name either way.
  const root = tree(t);
  writeFileSync(
    join(root, 'scripts/env.mjs'),
    "export const names = Object.freeze(['NODE_ENV', 'NODE_OPTIONS', 'POWER_BASELINE_SOURCE', 'SIMULACRUM_HOST_PROFILE']);\n",
  );
  const previous = {
    CI: process.env.CI,
    NO_COLOR: process.env.NO_COLOR,
    FORCE_COLOR: process.env.FORCE_COLOR,
  };
  process.env.CI = '1';
  process.env.FORCE_COLOR = '1';
  delete process.env.NO_COLOR;
  t.after(() => {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  });
  assert.throws(() => checkFormat(root), /1 file\(s\) not in prettier layout: scripts\/env\.mjs/);
});

test('the format gate runs from the registered manifest row on every commit', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = JSON.parse(readFileSync(new URL('../scripts/manifest.json', import.meta.url)));
  const row = manifest.checks.find((c) => c.id === 'format');
  assert.equal(row?.dueAt, 'M0');
  assert.equal(row.module, 'scripts/check-format.mjs');
  assert.equal(row.export, 'checkFormat');
  assert.equal(row.ruleId, 'gate-integrity');
  // A tree without prettier cannot pass silently.
  const root = mkdtempSync(join(tmpdir(), 'format-gate-bare-'));
  try {
    assert.throws(() => checkFormat(root), /not installed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
