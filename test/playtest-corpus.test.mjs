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
      recordingMode: 'video',
      captureSchema: 1,
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
      syntheticRun: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    };
    await assert.rejects(
      corpus.writeCorpus(join(root, 'human'), { ...capture, syntheticRun: null }),
      /synthetic/i,
    );
    for (const invalid of ['c'.repeat(32), 'cccccccc-cccc-0ccc-8ccc-cccccccccccc'])
      await assert.rejects(
        corpus.writeCorpus(join(root, `invalid-${invalid}`), { ...capture, syntheticRun: invalid }),
        /identity/,
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
        recordingMode: 'video',
        captureSchema: 1,
        captureSeconds: 60,
        mediaFiles: [file, file],
        eventSamples: Array.from({ length: i ? 80 : 2 }, (_, j) => ({ id: String(j) })),
        screenBytes: size * 2,
        maximumScreenChunkBytes: size,
        finalOutbox: { bytes: 0, pending: 0 },
        browserVersion: 'test',
        source: { head: 'a'.repeat(40), workingTreeDigest: 'b'.repeat(64) },
        build: 'test',
        syntheticRun: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
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

test('bounded capture sampling preserves full rates and rare largest payloads', async () => {
  const { sampleCapture } = await import('../scripts/playtest/capture-samples.mjs');
  const root = await mkdtemp(join(tmpdir(), 'capture-samples-'));
  try {
    const small = join(root, 'small.bin'),
      large = join(root, 'large.bin');
    await writeFile(small, Buffer.alloc(100));
    await writeFile(large, Buffer.alloc(1000));
    const events = Array.from({ length: 400 }, (_, i) => ({
      id: String(i),
      data: 'x'.repeat(i === 197 ? 100000 : 20000),
    }));
    const mediaFiles = Array.from({ length: 400 }, (_, i) => (i === 197 ? large : small));
    const input = {
      eventSamples: events,
      mediaFiles,
      screenBytes: 40900,
      maximumScreenChunkBytes: 1000,
      recordingMode: 'video',
      captureSchema: 1,
      captureSeconds: 1800,
    };
    const sampled = await sampleCapture(input);
    assert.equal(sampled.eventCount, 400);
    assert.equal(sampled.screenBytes, 40900);
    assert.equal(sampled.maximumScreenChunkBytes, 1000);
    assert.ok(sampled.eventSamples.some((x) => x.id === '197'));
    assert.ok(sampled.mediaFiles.includes(large));
    assert.ok(sampled.mediaFiles.length <= 32);
    assert.ok(Buffer.byteLength(JSON.stringify(sampled.eventSamples)) <= 3 * 1024 ** 2);
    assert.deepEqual(await sampleCapture(sampled), sampled);
    await assert.rejects(sampleCapture({ ...sampled, eventCount: 0 }), /sampling/i);
    await assert.rejects(sampleCapture({ ...input, screenBytes: 1 }), /sampling/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('data corpus binds mode and schema without inventing screen media', async () => {
  const root = await mkdtemp(join(tmpdir(), 'data-corpus-'));
  const capture = {
    recordingMode: 'data',
    captureSchema: 1,
    captureSeconds: 60,
    mediaFiles: [],
    eventSamples: [{ id: 'p1', kind: 'capture-batch', data: { schema: 1, events: [] } }],
    screenBytes: 0,
    maximumScreenChunkBytes: 0,
    finalOutbox: { bytes: 0, pending: 0 },
    browserVersion: 'test',
    source: { workingTreeDigest: 'b'.repeat(64) },
    build: 'app-test',
    syntheticRun: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  };
  try {
    const record = await corpus.writeCorpus(join(root, 'data'), capture);
    const actual = await corpus.readCorpus(join(root, 'data'), record.id);
    assert.equal(actual.recordingMode, 'data');
    assert.equal(actual.captureSchema, 1);
    assert.deepEqual(actual.mediaFiles, []);
    assert.equal(actual.envelope.mediaCopiesPerTick, 0);
    assert.equal(actual.maximumMediaFile, null);
    const audio = join(root, 'voice.bin');
    await writeFile(audio, 'voice');
    const withVoice = {
      ...capture,
      mediaFiles: [audio],
      voiceBytes: 5,
      voiceChunks: 1,
      maximumVoiceChunkBytes: 5,
    };
    const vm = await corpus.writeCorpus(join(root, 'voice'), withVoice);
    const vr = await corpus.readCorpus(join(root, 'voice'), vm.id);
    assert.equal(vr.voiceBytes, 5);
    assert.equal(vr.screenBytes, 0);
    assert.equal(vr.maximumVoiceChunkBytes, 5);
    assert.ok(vr.envelope.mediaCopiesPerTick > 0);
    assert.equal(vr.mediaFiles.length, 1);
    await assert.rejects(
      corpus.writeCorpus(join(root, 'wrong'), { ...capture, captureSchema: 99 }),
      /mode|schema/i,
    );
    await assert.rejects(
      corpus.writeCorpus(join(root, 'legacy'), { ...capture, recordingMode: undefined }),
      /mode|schema/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
