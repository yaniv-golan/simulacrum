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
export async function writeCorpus(directory, capture) {
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
    capture.mediaFiles.length > 600 ||
    capture.eventSamples.length > 10000
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
    schema: 1,
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
  const record = JSON.parse(await boundedRead(join(directory, 'corpus.json'), 256 * 1024));
  const { id, ...body } = record;
  if (!hash(expectedId) || id !== expectedId || digest(body) !== id)
    throw Error('Corpus identity mismatch');
  if (
    body.schema !== 1 ||
    body.purpose !== 'synthetic-capacity-v1' ||
    !/^[a-f0-9]{32}$/.test(body.syntheticRun ?? '') ||
    !hash(body.source?.workingTreeDigest) ||
    !body.browserVersion ||
    !body.build ||
    !Array.isArray(body.media) ||
    body.media.length < 2 ||
    body.media.length > 600 ||
    body.events?.file !== 'events.json'
  )
    throw Error('Invalid synthetic corpus');
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
  if (total > 256 * 1024 ** 2) throw Error('Corpus bounds');
  const events = await boundedRead(join(directory, 'events.json'), 32 * 1024 ** 2);
  if (events.length !== body.events.bytes || sha(events) !== body.events.sha256)
    throw Error('Corpus event integrity');
  const eventSamples = JSON.parse(events);
  if (!Array.isArray(eventSamples) || eventSamples.length > 10000)
    throw Error('Corpus event distribution');
  const capture = {
    ...body,
    corpusId: id,
    mediaFiles: body.media.map((r) => join(directory, r.file)),
    eventSamples,
    screenBytes: total,
    maximumScreenChunkBytes: Math.max(...sizes),
    finalOutbox: { bytes: 0, pending: 0 },
  };
  assertCaptureWorkload(capture);
  return capture;
}
