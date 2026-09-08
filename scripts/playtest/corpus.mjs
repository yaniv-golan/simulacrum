// Private synthetic workload, independent of the human recording archive.
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { assertCaptureWorkload } from './load.mjs';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digest = (value) => sha(JSON.stringify(value));
const hash = (value) => /^[a-f0-9]{64}$/.test(value ?? '');
async function boundedRead(path, limit) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    throw Error('Corpus file bounds/integrity');
  return readFile(path);
}
export async function writeCorpus(directory, input) {
  const captures = Array.isArray(input) ? input : [input];
  if (!captures.length || captures.length > 9) throw Error('Bounded capture cases required');
  const first = captures[0];
  for (const c of captures) {
    assertCaptureWorkload(c);
    if (
      JSON.stringify(c.source) !== JSON.stringify(first.source) ||
      c.build !== first.build ||
      c.browserVersion !== first.browserVersion ||
      !/^[a-f0-9]{32}$/.test(c.syntheticRun ?? '')
    )
      throw Error('Synthetic corpus case identity mismatch');
  }
  const maxChunkBytes = Math.max(...captures.map((c) => c.maximumScreenChunkBytes));
  const envelope = {
    maxChunkBytes,
    mediaCopiesPerTick: Math.max(
      1,
      Math.ceil(
        (Math.max(...captures.map((c) => c.screenBytes / c.captureSeconds)) * 3) / maxChunkBytes,
      ),
    ),
    eventsPerTick: Math.max(
      1,
      Math.ceil(Math.max(...captures.map((c) => c.eventSamples.length / c.captureSeconds)) * 3),
    ),
  };
  const capture = {
    ...first,
    captureSeconds: captures.reduce((n, c) => n + c.captureSeconds, 0),
    mediaFiles: captures.flatMap((c) => c.mediaFiles),
    eventSamples: captures.flatMap((c) => c.eventSamples),
    screenBytes: captures.reduce((n, c) => n + c.screenBytes, 0),
    maximumScreenChunkBytes: maxChunkBytes,
  };
  assertCaptureWorkload(capture);
  if (
    !/^[a-f0-9]{32}$/.test(capture.syntheticRun ?? '') ||
    !hash(capture.source?.workingTreeDigest) ||
    !capture.browserVersion ||
    !capture.build
  )
    throw Error('Authenticated synthetic capture provenance required');
  if (
    capture.mediaFiles.length < 2 ||
    capture.mediaFiles.length > 2048 ||
    capture.eventSamples.length > 1000000
  )
    throw Error('Bounded sample distribution required');
  const samples = await Promise.all(
    capture.mediaFiles.map((file) => boundedRead(file, 10 * 1024 ** 2)),
  );
  const bytes = samples.reduce((n, b) => n + b.length, 0);
  if (bytes > 256 * 1024 ** 2 || bytes !== capture.screenBytes || samples.some((b) => !b.length))
    throw Error('Corpus distribution integrity');
  const events = Buffer.from(JSON.stringify(capture.eventSamples));
  if (events.length > 32 * 1024 ** 2) throw Error('Corpus event bounds');
  const body = {
    schema: 2,
    envelope,
    runs: captures.map((c) => c.syntheticRun),
    purpose: 'synthetic-capacity-v1',
    source: capture.source,
    build: capture.build,
    browserVersion: capture.browserVersion,
    syntheticRun: capture.syntheticRun,
    captureSeconds: capture.captureSeconds,
    media: samples.map((b, i) => ({ file: `sample-${i}.bin`, bytes: b.length, sha256: sha(b) })),
    events: { file: 'events.json', bytes: events.length, sha256: sha(events) },
  };
  const manifest = { ...body, id: digest(body) };
  await mkdir(directory, { mode: 0o700 });
  for (let i = 0; i < samples.length; i++)
    await writeFile(join(directory, body.media[i].file), samples[i], { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'events.json'), events, { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'corpus.json'), JSON.stringify(manifest), {
    flag: 'wx',
    mode: 0o600,
  });
  return manifest;
}
export async function readCorpus(directory, expectedId) {
  const record = JSON.parse(await boundedRead(join(directory, 'corpus.json'), 512 * 1024));
  const { id, ...body } = record;
  if (!hash(expectedId) || id !== expectedId || digest(body) !== id)
    throw Error('Corpus identity mismatch');
  if (
    body.schema !== 2 ||
    body.purpose !== 'synthetic-capacity-v1' ||
    !/^[a-f0-9]{32}$/.test(body.syntheticRun ?? '') ||
    !hash(body.source?.workingTreeDigest) ||
    !body.browserVersion ||
    !body.build ||
    !Array.isArray(body.media) ||
    body.media.length < 2 ||
    body.media.length > 2048 ||
    body.events?.file !== 'events.json'
  )
    throw Error('Invalid synthetic corpus');
  if (
    !Number.isSafeInteger(body.envelope?.mediaCopiesPerTick) ||
    body.envelope.mediaCopiesPerTick < 1 ||
    body.envelope.mediaCopiesPerTick > 20 ||
    !Number.isSafeInteger(body.envelope.eventsPerTick) ||
    body.envelope.eventsPerTick < 1 ||
    body.envelope.eventsPerTick > 1000
  )
    throw Error('Corpus stress envelope bounds');
  let total = 0;
  const sizes = [];
  for (const [i, row] of body.media.entries()) {
    if (row.file !== `sample-${i}.bin`) throw Error('Corpus path integrity');
    const bytes = await boundedRead(join(directory, row.file), 10 * 1024 ** 2);
    if (bytes.length !== row.bytes || !bytes.length || sha(bytes) !== row.sha256)
      throw Error('Corpus media integrity');
    total += bytes.length;
    sizes.push(bytes.length);
  }
  if (body.envelope.maxChunkBytes !== Math.max(...sizes))
    throw Error('Corpus envelope chunk integrity');
  if (total > 256 * 1024 ** 2) throw Error('Corpus bounds');
  const events = await boundedRead(join(directory, 'events.json'), 32 * 1024 ** 2);
  if (events.length !== body.events.bytes || sha(events) !== body.events.sha256)
    throw Error('Corpus event integrity');
  const eventSamples = JSON.parse(events);
  if (!Array.isArray(eventSamples) || eventSamples.length > 100000)
    throw Error('Corpus event distribution');
  const capture = {
    ...body,
    corpusId: id,
    maximumMediaFile: join(directory, body.media[sizes.indexOf(Math.max(...sizes))].file),
    mediaFiles: body.media.map((r) => join(directory, r.file)),
    eventSamples,
    screenBytes: total,
    maximumScreenChunkBytes: Math.max(...sizes),
    finalOutbox: { bytes: 0, pending: 0 },
  };
  assertCaptureWorkload(capture);
  return capture;
}
