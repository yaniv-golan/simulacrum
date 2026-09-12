// Private synthetic workload, independent of the human recording archive.
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readFeedbackSamples, feedbackWorkloadIdentity } from './feedback-load.mjs';
import { sampleCapture } from './capture-samples.mjs';
import { assertCaptureWorkload, captureIdentity, captureMedia } from './load.mjs';
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
  const rawCaptures = Array.isArray(input) ? input : [input];
  if (!rawCaptures.length || rawCaptures.length > 9) throw Error('Bounded capture cases required');
  const captures = [];
  for (const capture of rawCaptures) captures.push(await sampleCapture(capture));
  if (!captures.length || captures.length > 9) throw Error('Bounded capture cases required');
  const first = captures[0];
  for (const c of captures) {
    assertCaptureWorkload(c);
    if (
      JSON.stringify(c.source) !== JSON.stringify(first.source) ||
      c.recordingMode !== first.recordingMode ||
      c.captureSchema !== first.captureSchema ||
      c.build !== first.build ||
      c.browserVersion !== first.browserVersion ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        c.syntheticRun ?? '',
      )
    )
      throw Error('Synthetic corpus case identity mismatch');
  }
  const feedbackFiles = captures.flatMap((c) => c.feedbackFiles ?? []);
  const feedbackSamples = feedbackFiles.length ? await readFeedbackSamples(feedbackFiles) : [];
  if (
    captures.some(
      (c) =>
        c.feedbackFiles !== undefined &&
        (!Array.isArray(c.feedbackFiles) || !c.feedbackFiles.length),
    )
  )
    throw Error('Explicit feedback corpus requires observed samples');
  const maxChunkBytes = Math.max(...captures.map((c) => captureMedia(c).maximum));
  const envelope = {
    maxChunkBytes,
    mediaCopiesPerTick: !captures.some((c) => c.mediaFiles.length)
      ? 0
      : Math.max(
          1,
          Math.ceil(
            (Math.max(...captures.map((c) => captureMedia(c).bytes / c.captureSeconds)) * 3) /
              maxChunkBytes,
          ),
        ),
    eventsPerTick: Math.max(
      1,
      1 + Math.ceil(Math.max(...captures.map((c) => c.eventCount / c.captureSeconds)) * 3),
    ),
  };
  const capture = {
    ...first,
    captureSeconds: captures.reduce((n, c) => n + c.captureSeconds, 0),
    mediaFiles: captures.flatMap((c) => c.mediaFiles),
    eventSamples: captures.flatMap((c) => c.eventSamples),
    eventCount: captures.reduce((n, c) => n + c.eventCount, 0),
    screenBytes: captures.reduce((n, c) => n + c.screenBytes, 0),
    voiceBytes: captures.reduce((n, c) => n + (c.voiceBytes ?? 0), 0),
    maximumVoiceChunkBytes: first.recordingMode === 'data' ? maxChunkBytes : 0,
    maximumScreenChunkBytes: first.recordingMode === 'video' ? maxChunkBytes : 0,
  };
  assertCaptureWorkload(capture);
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      capture.syntheticRun ?? '',
    ) ||
    !hash(capture.source?.workingTreeDigest) ||
    !capture.browserVersion ||
    !capture.build
  )
    throw Error('Authenticated synthetic capture provenance required');
  if (
    (first.recordingMode === 'video' && capture.mediaFiles.length < 2) ||
    capture.mediaFiles.length > 2048 ||
    capture.eventSamples.length > 1000000
  )
    throw Error('Bounded sample distribution required');
  const samples = await Promise.all(
    capture.mediaFiles.map((file) => boundedRead(file, 10 * 1024 ** 2)),
  );
  const bytes = samples.reduce((n, b) => n + b.length, 0);
  if (
    bytes > 256 * 1024 ** 2 ||
    bytes > captureMedia(capture).bytes ||
    samples.some((b) => !b.length)
  )
    throw Error('Corpus distribution integrity');
  const events = Buffer.from(JSON.stringify(capture.eventSamples));
  if (events.length > 32 * 1024 ** 2) throw Error('Corpus event bounds');
  const body = {
    schema: feedbackSamples.length ? 4 : 3,
    ...(feedbackSamples.length
      ? {
          feedback: {
            ...feedbackWorkloadIdentity,
            samples: feedbackSamples.map((sample, i) => ({
              file: `feedback-${i}.json`,
              bytes: sample.bytes.length,
              sha256: sample.sha256,
            })),
            cases: captures.map((c) => ({
              run: c.syntheticRun,
              samples: c.feedbackFiles?.length ?? 0,
            })),
          },
        }
      : {}),
    ...captureIdentity(capture),
    eventCount: capture.eventCount,
    screenBytes: capture.screenBytes,
    voiceBytes: capture.voiceBytes,
    mediaBytes: captureMedia(capture).bytes,
    cases: captures.map((c, i) => ({
      eventOffset: captures.slice(0, i).reduce((n, x) => n + x.eventSamples.length, 0),
      eventSamples: c.eventSamples.length,
      mediaOffset: captures.slice(0, i).reduce((n, x) => n + x.mediaFiles.length, 0),
      mediaSamples: c.mediaFiles.length,
      run: c.syntheticRun,
      captureSeconds: c.captureSeconds,
      eventCount: c.eventCount,
      screenBytes: c.screenBytes,
      voiceBytes: c.voiceBytes ?? 0,
      mediaBytes: captureMedia(c).bytes,
      maximumMediaChunkBytes: captureMedia(c).maximum,
      maximumEventBytes: c.maximumEventBytes,
      maximumScreenChunkBytes: c.maximumScreenChunkBytes,
    })),
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
  for (const [i, sample] of feedbackSamples.entries())
    await writeFile(join(directory, body.feedback.samples[i].file), sample.bytes, {
      flag: 'wx',
      mode: 0o600,
    });
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
  const { recordingMode } = captureIdentity(body);
  const video = recordingMode === 'video';
  if (!hash(expectedId) || id !== expectedId || digest(body) !== id)
    throw Error('Corpus identity mismatch');
  if (
    ![3, 4].includes(body.schema) ||
    (body.schema === 4) !== (body.feedback !== undefined) ||
    body.purpose !== 'synthetic-capacity-v1' ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
      body.syntheticRun ?? '',
    ) ||
    !hash(body.source?.workingTreeDigest) ||
    !body.browserVersion ||
    !body.build ||
    !Array.isArray(body.media) ||
    (video && body.media.length < 2) ||
    body.media.length > 2048 ||
    body.events?.file !== 'events.json'
  )
    throw Error('Invalid synthetic corpus');
  if (
    !Number.isSafeInteger(body.envelope?.mediaCopiesPerTick) ||
    body.envelope.mediaCopiesPerTick < (body.media.length ? 1 : 0) ||
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
  if (body.envelope.maxChunkBytes !== Math.max(0, ...sizes))
    throw Error('Corpus envelope chunk integrity');
  if (total > 256 * 1024 ** 2) throw Error('Corpus bounds');
  const events = await boundedRead(join(directory, 'events.json'), 32 * 1024 ** 2);
  if (events.length !== body.events.bytes || sha(events) !== body.events.sha256)
    throw Error('Corpus event integrity');
  const eventSamples = JSON.parse(events);
  if (!Array.isArray(eventSamples) || eventSamples.length > 100000)
    throw Error('Corpus event distribution');
  if (
    !Array.isArray(body.cases) ||
    body.cases.length < 1 ||
    body.cases.length > 9 ||
    new Set(body.runs).size !== body.cases.length
  )
    throw Error('Corpus case coverage');
  let eventOffset = 0,
    mediaOffset = 0,
    measuredEvents = 0,
    measuredBytes = 0,
    seconds = 0;
  for (const [i, c] of body.cases.entries()) {
    if (
      c.run !== body.runs[i] ||
      c.mediaBytes !== (video ? c.screenBytes : c.voiceBytes) ||
      (!video && c.screenBytes !== 0) ||
      c.eventOffset !== eventOffset ||
      c.mediaOffset !== mediaOffset ||
      !Number.isSafeInteger(c.eventSamples) ||
      c.eventSamples < 1 ||
      c.eventSamples > 128 ||
      !Number.isSafeInteger(c.mediaSamples) ||
      c.mediaSamples < (video ? 1 : 0) ||
      c.mediaSamples > 32 ||
      !Number.isSafeInteger(c.eventCount) ||
      c.eventCount < c.eventSamples ||
      !Number.isSafeInteger(c.mediaBytes) ||
      c.mediaBytes < (video ? 1 : 0) ||
      !Number.isFinite(c.captureSeconds) ||
      c.captureSeconds < 60
    )
      throw Error('Corpus case measurement');
    const events = eventSamples.slice(eventOffset, eventOffset + c.eventSamples),
      media = sizes.slice(mediaOffset, mediaOffset + c.mediaSamples);
    if (
      events.length !== c.eventSamples ||
      media.length !== c.mediaSamples ||
      Math.max(...events.map((e) => Buffer.byteLength(JSON.stringify(e)))) !==
        c.maximumEventBytes ||
      Math.max(0, ...media) !== c.maximumMediaChunkBytes ||
      media.reduce((a, b) => a + b, 0) > c.mediaBytes
    )
      throw Error('Corpus case maximum or coverage');
    eventOffset += c.eventSamples;
    mediaOffset += c.mediaSamples;
    measuredEvents += c.eventCount;
    measuredBytes += c.mediaBytes;
    seconds += c.captureSeconds;
  }
  if (
    eventOffset !== eventSamples.length ||
    mediaOffset !== sizes.length ||
    body.eventCount !== measuredEvents ||
    body.mediaBytes !== measuredBytes ||
    body.mediaBytes !== (video ? body.screenBytes : body.voiceBytes) ||
    (!video && body.screenBytes !== 0) ||
    body.captureSeconds !== seconds ||
    body.envelope.eventsPerTick !==
      1 + Math.ceil(Math.max(...body.cases.map((c) => c.eventCount / c.captureSeconds)) * 3) ||
    body.envelope.mediaCopiesPerTick !==
      (body.media.length
        ? Math.max(
            1,
            Math.ceil(
              (Math.max(...body.cases.map((c) => c.mediaBytes / c.captureSeconds)) * 3) /
                body.envelope.maxChunkBytes,
            ),
          )
        : 0)
  )
    throw Error('Corpus measured envelope mismatch');
  let feedbackFiles;
  if (body.feedback !== undefined) {
    const feedback = body.feedback;
    if (
      feedback.protocolVersion !== 1 ||
      feedback.transport !== feedbackWorkloadIdentity.transport ||
      !Array.isArray(feedback.samples) ||
      !Array.isArray(feedback.cases) ||
      feedback.cases.length !== body.cases.length ||
      feedback.cases.some(
        (c, i) => c.run !== body.cases[i].run || !Number.isSafeInteger(c.samples) || c.samples < 0,
      ) ||
      feedback.cases.reduce((n, c) => n + c.samples, 0) !== feedback.samples.length ||
      feedback.samples.some((row, i) => row.file !== `feedback-${i}.json`)
    )
      throw Error('Feedback corpus identity or case coverage');
    feedbackFiles = feedback.samples.map((row) => join(directory, row.file));
    const samples = await readFeedbackSamples(feedbackFiles);
    if (
      samples.some(
        (sample, i) =>
          sample.bytes.length !== feedback.samples[i].bytes ||
          sample.sha256 !== feedback.samples[i].sha256,
      )
    )
      throw Error('Feedback corpus integrity');
  }
  const capture = {
    ...body,
    ...(feedbackFiles ? { feedbackFiles } : {}),
    corpusId: id,
    maximumEvent: eventSamples.reduce((a, b) =>
      Buffer.byteLength(JSON.stringify(a)) >= Buffer.byteLength(JSON.stringify(b)) ? a : b,
    ),
    maximumMediaFile: body.media.length
      ? join(directory, body.media[sizes.indexOf(Math.max(0, ...sizes))].file)
      : null,
    mediaFiles: body.media.map((r) => join(directory, r.file)),
    eventSamples,
    screenBytes: body.screenBytes,
    maximumScreenChunkBytes: video ? Math.max(0, ...sizes) : 0,
    maximumVoiceChunkBytes: video ? 0 : Math.max(0, ...sizes),
    maximumEventBytes: Math.max(...body.cases.map((c) => c.maximumEventBytes)),
    finalOutbox: { bytes: 0, pending: 0 },
  };
  assertCaptureWorkload(capture);
  return capture;
}
