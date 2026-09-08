import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
const cli = resolve('scripts/docs.mjs');
test('clean source needs explicit section review; impact and generated refresh cannot approve it', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'docs-workflow-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.equal(spawnSync('git', ['init', '-q', root]).status, 0);
  for (const dir of ['scripts', 'src', 'docs/development'])
    mkdirSync(join(root, dir), { recursive: true });
  writeFileSync(join(root, 'src/owner.mjs'), 'export function owner() { return 1; }\n');
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ scripts: { 'docs:generate': 'node scripts/docs.mjs' } }),
  );
  writeFileSync(
    join(root, 'scripts/manifest.json'),
    JSON.stringify({ checks: [], invariants: [] }),
  );
  writeFileSync(
    join(root, 'docs/development/map.md'),
    '# Map\n\n## Owner\n\n[owner](../../src/owner.mjs#symbol=owner) returns one.\n',
  );
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const run = (...args) =>
    spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
  const prepared = run('prepare');
  assert.equal(prepared.status, 1, 'preparation leaves semantic review pending');
  assert.ok(
    JSON.parse(prepared.stdout).sections.some((s) => s.stale),
    'preparation reports pending sections after generation',
  );
  assert.equal(run('generate').status, 0);
  assert.notEqual(run('check').status, 0);
  const before = readFileSync(join(root, 'docs/development/map.md'), 'utf8');
  const impact = run('impact');
  assert.notEqual(impact.status, 0);
  assert.match(impact.stdout, /owner/);
  assert.equal(
    Object.hasOwn(JSON.parse(impact.stdout).sections[0], 'dependencies'),
    false,
    'impact output must not flood discovery with hash maps',
  );
  assert.equal(readFileSync(join(root, 'docs/development/map.md'), 'utf8'), before);
  assert.notEqual(run('review', '--accept-all').status, 0);
  assert.equal(
    run(
      'review',
      'docs/development/map.md',
      'owner',
      'updated',
      'The owner returns the documented constant through its exported function.',
    ).status,
    0,
  );
  const checked = run('check');
  assert.equal(checked.status, 0, checked.stderr);
  const report = JSON.parse(
    readFileSync(join(root, 'artifacts/developer-documentation.json'), 'utf8'),
  );
  assert.match(report.analysis.contentIdentity, /sha256:/);
  rmSync(join(root, 'artifacts'), { recursive: true });
  assert.equal(run('check').status, 0); // No ignored receipt is needed in a clean checkout.
  writeFileSync(join(root, 'docs/development/.reviews/map/orphan.json'), '{}');
  assert.notEqual(
    run('check').status,
    0,
    'orphaned review records must not become retained history',
  );
  rmSync(join(root, 'docs/development/.reviews/map/orphan.json'));
  writeFileSync(join(root, 'src/owner.mjs'), 'export function owner() { return 2; }\n');
  assert.notEqual(run('check').status, 0);
  assert.equal(run('generate').status, 0);
  assert.notEqual(run('check').status, 0);
});
