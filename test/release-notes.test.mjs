import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { RELEASE_NOTES, validateReleaseNotes } from '../src/application/release-notes.mjs';
import { UI_FEATURES } from '../src/model/features.mjs';
import { CATALOG } from '../src/model/catalog.mjs';
import {
  unseenNotes,
  readCursor,
  writeCursor,
  planConsider,
  STORAGE_KEY,
} from '../src/presentation/whats-new.mjs';
import { checkReleaseNotes, latestNoteDate } from '../scripts/check-release-notes.mjs';
import { REPOSITORY_URL } from '../src/model/features.mjs';

const context = () => ({
  featureKeys: Object.keys(UI_FEATURES),
  partTypes: Object.keys(CATALOG),
  latestDate: '2026-09-14',
});
const notes = (overrides = []) => {
  const copy = RELEASE_NOTES.map((note) => ({ ...note }));
  for (const [index, patch] of overrides) Object.assign(copy[index], patch);
  return copy;
};

test('seed release notes validate against this build and every field rule rejects a wrong trace', () => {
  assert.deepEqual(validateReleaseNotes(RELEASE_NOTES, context()), []);
  const cases = [
    ['duplicate id', 1, { id: RELEASE_NOTES[0].id }, /id/],
    ['date out of order', 1, { date: '2026-09-20', id: '2026-09-20-late' }, /order/],
    ['future date', 0, { date: '2026-09-15', id: '2026-09-15-soon' }, /future/],
    ['unknown feature', 0, { feature: 'nope' }, /feature/],
    ['summary too long', 0, { summary: 'x'.repeat(141) }, /summary/],
    ['summary with a URL', 0, { summary: 'See https://example.test' }, /summary/],
    ['id not starting with its date', 0, { id: '2026-09-01-mismatch' }, /id/],
    ['empty example', 0, { example: '' }, /example/],
    ['misspelled field', 0, { exmaple: 'spring-launcher-example' }, /exmaple/],
  ];
  for (const [label, index, patch, field] of cases) {
    const wrong = notes([[index, patch]]);
    const errors = validateReleaseNotes(wrong, context());
    assert.ok(errors.length >= 1, label);
    assert.match(errors.join('\n'), field, label);
    assert.ok(
      errors.some((e) => e.startsWith(`${wrong[index].id}:`)),
      `${label} names the offending id`,
    );
  }
  assert.ok(validateReleaseNotes([], context()).length >= 1, 'empty notes reject');
  assert.ok(RELEASE_NOTES.length >= 9, 'the seed carries every player-visible landing');
});

test('unseen notes follow the stored cursor and never treat an unknown cursor as everything new', () => {
  const seed = RELEASE_NOTES;
  assert.deepEqual(unseenNotes(seed, null), { firstVisit: true, unseen: [] });
  assert.deepEqual(unseenNotes(seed, seed[0].id), { firstVisit: false, unseen: [] });
  const twoBack = unseenNotes(seed, seed[2].id);
  assert.equal(twoBack.firstVisit, false);
  assert.deepEqual(twoBack.unseen.map((n) => n.id), [seed[0].id, seed[1].id]);
  assert.deepEqual(unseenNotes(seed, '2020-01-01-rolled-back'), { firstVisit: true, unseen: [] });
});

test('cursor storage reports unavailable on throwing reads and swallows failed writes visibly', () => {
  const throwing = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.deepEqual(readCursor(throwing), { mode: 'unavailable', cursor: null });
  const memory = new Map();
  const storage = {
    getItem: (k) => memory.get(k) ?? null,
    setItem: (k, v) => memory.set(k, v),
  };
  assert.deepEqual(readCursor(storage), { mode: 'available', cursor: null });
  memory.set(STORAGE_KEY, '{not json');
  assert.deepEqual(readCursor(storage), { mode: 'available', cursor: null });
  assert.equal(writeCursor(storage, { seenId: 'a', seenBuildId: 'b', seenAt: 't' }), true);
  const stored = JSON.parse(memory.get(STORAGE_KEY));
  assert.deepEqual(stored, { seenId: 'a', seenBuildId: 'b', seenAt: 't' });
  assert.deepEqual(readCursor(storage), { mode: 'available', cursor: 'a' });
  assert.equal(writeCursor(throwing, { seenId: 'a' }), false);
});

test('consider plan badges and opens only for returning devices with unseen notes and a clear gate', () => {
  const unseen = [RELEASE_NOTES[0]];
  const plan = (mode, firstVisit, list, gateReason) =>
    planConsider({ mode, firstVisit, unseen: list, gateReason });
  const nothing = { badge: false, open: false, write: false };
  assert.deepEqual(plan('unavailable', true, unseen, null), nothing);
  assert.deepEqual(plan('unavailable', false, unseen, null), nothing, 'blocked storage: no badge');
  assert.deepEqual(plan('available', true, [], null), { badge: false, open: false, write: true });
  assert.deepEqual(plan('available', false, [], null), nothing);
  for (const gateReason of ['dialog', 'placement', 'run', 'recording', 'focus', 'scene'])
    assert.deepEqual(
      plan('available', false, unseen, gateReason),
      { badge: true, open: false, write: false },
      gateReason,
    );
  const clear = { badge: true, open: true, write: true };
  assert.deepEqual(plan('available', false, unseen, null), clear);
});

test('release-notes check accepts the tree, rejects markdown notes first and allows same-day notes', async () => {
  await checkReleaseNotes();
  assert.ok(latestNoteDate() >= new Date().toISOString().slice(0, 10));
  const root = mkdtempSync(join(tmpdir(), 'release-notes-'));
  try {
    mkdirSync(join(root, 'docs', 'release-notes'), { recursive: true });
    writeFileSync(join(root, 'docs', 'release-notes', 'x.md'), '# no\n');
    // No module or git in this root: the markdown tripwire must fire first.
    await assert.rejects(checkReleaseNotes(root), /fingerprint/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('release-notes check fails a release tag that disagrees with package.json or a non-semver version', async () => {
  const root = mkdtempSync(join(tmpdir(), 'release-gate-'));
  const git = (...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args],
      { cwd: root, encoding: 'utf8' },
    );
  try {
    git('init', '-q');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.4.0' }));
    git('add', 'package.json');
    git('commit', '-qm', 'bump');
    await checkReleaseNotes(root);
    git('tag', '-a', 'v0.3.1', '-m', 'wrong tag on the bumped commit');
    await assert.rejects(checkReleaseNotes(root), /does not match/);
    git('tag', '-d', 'v0.3.1');
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: 'x' }));
    await assert.rejects(checkReleaseNotes(root), /must be semver/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the repository URL is the public source', () => {
  assert.equal(REPOSITORY_URL, 'https://github.com/yaniv-golan/simulacrum');
});
