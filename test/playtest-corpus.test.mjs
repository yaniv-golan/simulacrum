import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as corpus from '../scripts/playtest/corpus.mjs';
test('corpus rejects human provenance and changed samples, preserving synthetic distribution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'corpus-'));
  try {
    const files = [join(root, 'a.bin'), join(root, 'b.bin')];
    await writeFile(files[0], 'aaa');
    await writeFile(files[1], 'bbbb');
    const capture = {
      captureSeconds: 60,
      mediaFiles: files,
      eventSamples: [
        { id: 'a', kind: 'input' },
        { id: 'b', kind: 'command-result' },
      ],
      screenBytes: 7,
      maximumScreenChunkBytes: 4,
      finalOutbox: { bytes: 0, pending: 0 },
      browserVersion: 'test',
      source: { head: 'a'.repeat(40), workingTreeDigest: 'b'.repeat(64) },
      build: 'app-test',
      syntheticRun: 'c'.repeat(32),
    };
    await assert.rejects(
      corpus.writeCorpus(join(root, 'human'), { ...capture, syntheticRun: null }),
      /synthetic/i,
    );
    const manifest = await corpus.writeCorpus(join(root, 'good'), capture);
    const read = await corpus.readCorpus(join(root, 'good'), manifest.id);
    assert.equal(read.mediaFiles.length, 2);
    assert.equal(read.screenBytes, 7);
    assert.deepEqual(read.eventSamples, capture.eventSamples);
    await writeFile(read.mediaFiles[1], 'changed');
    await assert.rejects(corpus.readCorpus(join(root, 'good'), manifest.id), /integrity/);
    await assert.rejects(corpus.readCorpus(join(root, 'good'), 'd'.repeat(64)), /identity/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
