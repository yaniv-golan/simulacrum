import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  dependencyDigest,
  writeResumeDescriptor,
  readResumeDescriptor,
} from '../scripts/candidate-resume.mjs';
test('dependency records are framed and reject escaping links', () => {
  const root = mkdtempSync(join(tmpdir(), 'dependency-resume-'));
  try {
    mkdirSync(join(root, 'node_modules'));
    const a = join(root, 'node_modules/a'),
      b = join(root, 'node_modules/b');
    writeFileSync(a, '', { mode: 0o644 });
    writeFileSync(b, '', { mode: 0o644 });
    const original = dependencyDigest(root);
    rmSync(b);
    writeFileSync(a, 'b\0' + 420 + '\0');
    assert.notEqual(dependencyDigest(root), original, 'different installed bytes must not collide');
    const changed = dependencyDigest(root);
    writeFileSync(a, 'different');
    assert.notEqual(dependencyDigest(root), changed);
    symlinkSync(root, b);
    assert.throws(() => dependencyDigest(root), /escapes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test('candidate descriptor rejects edited payload and wrong key', () => {
  const root = mkdtempSync(join(tmpdir(), 'descriptor-resume-')),
    key = Buffer.alloc(32, 3);
  try {
    writeResumeDescriptor(root, { source: 'original' }, key);
    assert.deepEqual(readResumeDescriptor(root, key), { source: 'original' });
    assert.throws(() => readResumeDescriptor(root, Buffer.alloc(32, 4)), /integrity/);
    const file = join(root, 'resume-descriptor.json'),
      row = JSON.parse(readFileSync(file));
    row.text = JSON.stringify({ source: 'forged' });
    writeFileSync(file, JSON.stringify(row));
    assert.throws(() => readResumeDescriptor(root, key), /integrity/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('internal dependency links remain internal through an aliased candidate path', () => {
  const root = mkdtempSync(join(tmpdir(), 'dependency-alias-'));
  try {
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'node_modules/installed'), 'bytes');
    symlinkSync('installed', join(root, 'node_modules/bin'));
    symlinkSync(root, join(root, 'alias'));
    assert.equal(dependencyDigest(join(root, 'alias')), dependencyDigest(root));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
