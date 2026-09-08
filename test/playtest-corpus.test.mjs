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

test('capacity corpus covers every case envelope before load is measured', async () => {
  const root = await mkdtemp(join(tmpdir(), 'corpus-envelope-'));
  try {
    const captures = [];
    for (const [i, size] of [4, 5].entries()) {
      const file = join(root, `${i}.bin`);
      await writeFile(file, Buffer.alloc(size));
      captures.push({
        captureSeconds: 60,
        mediaFiles: [file, file],
        eventSamples: Array.from({ length: i ? 80 : 2 }, (_, j) => ({ id: String(j) })),
        screenBytes: size * 2,
        maximumScreenChunkBytes: size,
        finalOutbox: { bytes: 0, pending: 0 },
        browserVersion: 'test',
        source: { head: 'a'.repeat(40), workingTreeDigest: 'b'.repeat(64) },
        build: 'test',
        syntheticRun: String(i).repeat(32),
      });
    }
    const record = await corpus.writeCorpus(join(root, 'all'), captures);
    const result = await corpus.readCorpus(join(root, 'all'), record.id);
    assert.equal(result.maximumScreenChunkBytes, 5);
    assert.equal(result.envelope.maxChunkBytes, 5);
    assert.ok(
      (result.envelope.mediaCopiesPerTick * 5) / 3 >=
        Math.max(...captures.map((c) => c.screenBytes / c.captureSeconds)),
    );
    assert.ok(result.envelope.eventsPerTick / 3 >= 80 / 60);
    assert.equal(result.mediaFiles.length, 4);
    await assert.rejects(
      corpus.writeCorpus(join(root, 'mixed'), [captures[0], { ...captures[1], build: 'other' }]),
      /identity/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
