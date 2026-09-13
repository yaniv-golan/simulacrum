// Real capture supplies the sample distribution. Every scheduled event/chunk must be acknowledged.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  readFeedbackSamples,
  feedbackLoadRequest,
  feedbackWorkloadIdentity,
} from './feedback-load.mjs';
import { validateFeedbackReceipt } from '../../src/application/feedback-protocol.mjs';
import { captureAdmin, cleanupSynthetic } from './verify-deployment.mjs';
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hash = (bytes, mime = '') => createHash('sha256').update(mime).update(bytes).digest('hex');
export async function retryUpload({
  path,
  bytes,
  mime,
  expected,
  deadline,
  send,
  stats,
  now = Date.now,
  wait = delay,
}) {
  while (now() < deadline) {
    stats.requests++;
    let response;
    try {
      response = await send(path, bytes, mime);
    } catch (error) {
      stats.timeouts++;
      if (now() >= deadline) throw error;
      stats.retries++;
      await wait(1000);
      continue;
    }
    if (response.ok) {
      const receipt = await response.json();
      for (const [key, value] of Object.entries(expected))
        if (receipt[key] !== value) throw Error('Load receipt identity mismatch');
      return receipt;
    }
    await response.arrayBuffer();
    if (![429, 503].includes(response.status)) throw Error(`Load upload ${response.status}`);
    stats.retries++;
    await wait(Math.max(1000, Number(response.headers.get('retry-after') || 0) * 1000));
  }
  throw Error('Load delivery deadline: queued data remains unacknowledged');
}
export async function uploadFeedbackSample({ sample, sessionId, ...delivery }) {
  const request = feedbackLoadRequest(sample, { sessionId });
  const receipt = await retryUpload({ ...delivery, ...request });
  if (
    !validateFeedbackReceipt(receipt, {
      id: request.expected.submissionId,
      uploadHash: request.expected.uploadHash,
    })
  )
    throw Error('Feedback load receipt identity mismatch');
  return { receipt, bytes: request.bytes.length };
}
// Five consecutive one-minute medians must not rise by >1 MiB overall,
// with each adjacent minute rising by >128 KiB. Brief bursts may drain normally.
export function assertCaptureBacklog(capture, durationSeconds = 1800) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 360 || durationSeconds > 1800)
    throw Error('Invalid endurance duration');
  const samples = capture.outboxSamples;
  if (
    capture.captureSeconds !== durationSeconds ||
    !Array.isArray(samples) ||
    samples.length < Math.floor(durationSeconds / 3) - 2
  )
    throw Error('Complete endurance outbox samples required');
  if (!capture.finalOutbox || capture.finalOutbox.bytes !== 0 || capture.finalOutbox.pending !== 0)
    throw Error('Capture must drain');
  for (let i = 0; i < samples.length; i++)
    if (
      !Number.isFinite(samples[i].at) ||
      !Number.isFinite(samples[i].bytes) ||
      samples[i].bytes < 0 ||
      (i && (samples[i].at <= samples[i - 1].at || samples[i].at - samples[i - 1].at > 6000))
    )
      throw Error('Invalid outbox samples');
  if (samples.at(-1).at - samples[0].at < (durationSeconds - 6) * 1000)
    throw Error('Incomplete outbox samples');
  const medians = [];
  for (let start = samples[0].at; start + 60000 <= samples.at(-1).at + 3000; start += 60000) {
    const values = samples
      .filter((s) => s.at >= start && s.at < start + 60000)
      .map((s) => s.bytes)
      .sort((a, b) => a - b);
    if (values.length < 10) throw Error('Sparse outbox samples');
    medians.push(values[Math.floor(values.length / 2)]);
  }
  for (let i = 4; i < medians.length; i++)
    if (
      medians[i] - medians[i - 4] > 1024 ** 2 &&
      medians.slice(i - 3, i + 1).every((value, j) => value - medians[i - 4 + j] > 128 * 1024)
    )
      throw Error('Sustained capture outbox growth');
}
export function captureIdentity(value) {
  if (!['data', 'video'].includes(value?.recordingMode) || value.captureSchema !== 1)
    throw Error('Explicit recording mode and capture schema required');
  return { recordingMode: value.recordingMode, captureSchema: value.captureSchema };
}
export function assertCaptureIdentity(value, expected) {
  const actual = captureIdentity(value),
    wanted = captureIdentity(expected);
  if (
    actual.recordingMode !== wanted.recordingMode ||
    actual.captureSchema !== wanted.captureSchema
  )
    throw Error('Recording mode or capture schema mismatch');
}
export function captureMedia(capture) {
  return capture.recordingMode === 'data'
    ? {
        bytes: capture.voiceBytes ?? 0,
        maximum: capture.maximumVoiceChunkBytes ?? 0,
        chunks: capture.voiceChunks ?? 0,
        kind: 'voice',
        mime: 'audio/webm',
      }
    : {
        bytes: capture.screenBytes,
        maximum: capture.maximumScreenChunkBytes,
        chunks: capture.screenChunks,
        kind: 'screen',
        mime: 'video/webm',
      };
}
export function assertCaptureWorkload(capture, bounds) {
  const { recordingMode } = captureIdentity(capture);
  const video = recordingMode === 'video';
  const observedMedia = captureMedia(capture);
  if (
    !Number.isFinite(capture?.captureSeconds) ||
    capture.captureSeconds < 60 ||
    !capture.finalOutbox ||
    capture.finalOutbox.bytes !== 0 ||
    capture.finalOutbox.pending !== 0 ||
    !Array.isArray(capture.mediaFiles) ||
    (video && !capture.mediaFiles.length) ||
    (!video && capture.screenBytes !== 0) ||
    !capture.eventSamples?.length
  )
    throw Error('Drained representative capture workload required');
  const rates = {
    mediaBytesPerSecond: observedMedia.bytes / capture.captureSeconds,
    eventsPerSecond: (capture.eventCount ?? capture.eventSamples.length) / capture.captureSeconds,
  };
  if (
    !Number.isFinite(rates.mediaBytesPerSecond) ||
    (video ? rates.mediaBytesPerSecond <= 0 : rates.mediaBytesPerSecond < 0)
  )
    throw Error('Measured screen bytes required');
  if (
    bounds &&
    (rates.mediaBytesPerSecond > bounds.maxMediaBytesPerSecond ||
      rates.eventsPerSecond > bounds.maxEventsPerSecond ||
      !Number.isFinite(observedMedia.maximum) ||
      observedMedia.maximum > bounds.maxChunkBytes ||
      !Number.isFinite(capture.maximumEventBytes) ||
      capture.maximumEventBytes > bounds.maxEventBytes)
  )
    throw Error('Capture workload exceeds calibrated bounds; new calibration required');
  return rates;
}
// Keep fractional observations; cumulative slots distribute sparse submissions across clients.
export function feedbackLoadRate(capture, sampleCount) {
  if (!sampleCount) return 0;
  const rates = (capture.feedback?.cases ?? [{ samples: sampleCount }]).map((c, i) => {
    const seconds = capture.cases?.[i]?.captureSeconds ?? capture.captureSeconds;
    if (
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      !Number.isSafeInteger(c.samples) ||
      c.samples < 0
    )
      throw Error('Invalid observed feedback rate');
    return (c.samples * 3) / seconds;
  });
  if (!rates.length) throw Error('Missing observed feedback rate');
  return Math.max(...rates);
}
export function feedbackScheduled(rate, slots) {
  return Math.floor(rate * slots);
}
export async function measureCaptureLoad({ origin, capture, seconds = 120, reservation }) {
  assertCaptureWorkload(capture);
  if (!capture?.eventSamples?.length)
    throw Error('Measured media distribution and event traffic required');
  const feedbackSamples =
    capture.feedbackFiles === undefined ? [] : await readFeedbackSamples(capture.feedbackFiles);
  const feedbackPerTick = feedbackLoadRate(capture, feedbackSamples.length);
  const clients = 20,
    ticks = Math.ceil(seconds / 3),
    mediaPerTick = !capture.mediaFiles.length
      ? 0
      : capture.envelope
        ? 1 + capture.envelope.mediaCopiesPerTick
        : 1,
    eventsPerTick =
      capture.envelope?.eventsPerTick ??
      Math.max(
        1,
        Math.ceil(
          (capture.eventCount ?? capture.eventSamples.length) /
            Math.max(1, capture.captureSeconds / 3),
        ),
      );
  const rows =
    clients * (ticks * (mediaPerTick + eventsPerTick) + 1) +
    feedbackScheduled(feedbackPerTick, clients * ticks) +
    2 +
    (feedbackSamples.length ? 2 : 0);
  const run =
    reservation ||
    (await captureAdmin(origin, 'synthetic', {
      slots: clients,
      bytes: 20 * 1024 ** 3,
      metadataBytes: (rows + clients) * 4096,
    }));
  const stats = { requests: 0, retries: 0, timeouts: 0 },
    latencies = [],
    backlog = [],
    feedbackLatencies = [];
  let feedbackCompleted = 0,
    feedbackBytes = 0;
  const cpu = process.cpuUsage(),
    memory = { scope: 'load generator process', peakRss: process.memoryUsage().rss };
  let completed = 0,
    scheduled = 0,
    byteCount = 0,
    measurement,
    primaryError;
  const sample = setInterval(() => {
    memory.peakRss = Math.max(memory.peakRss, process.memoryUsage().rss);
    backlog.push({ at: Date.now(), pending: scheduled - completed });
  }, 250);
  try {
    const invite = await captureAdmin(origin, `synthetic/${run.id}/invitation`);
    const login = await fetch(new URL(`/join?token=${encodeURIComponent(invite.token)}`, origin), {
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    if (login.status !== 303 || !cookie) throw Error('Load invitation failed');
    const send = async (path, bytes, mime, shaped = true) => {
      let body = bytes;
      if (shaped) {
        let offset = 0;
        body = new ReadableStream({
          async pull(controller) {
            if (offset === bytes.length) {
              controller.close();
              return;
            }
            const part = bytes.subarray(offset, offset + 32768);
            offset += part.length;
            await delay((part.length * 8) / 5000);
            controller.enqueue(part);
          },
        });
        await delay(100);
      }
      return fetch(new URL(path, origin), {
        method: 'POST',
        headers: { cookie, origin, 'content-type': mime, 'content-length': String(bytes.length) },
        body,
        redirect: 'error',
        signal: AbortSignal.timeout(45000),
        ...(shaped ? { duplex: 'half' } : {}),
      });
    };
    const sessions = [];
    for (let i = 0; i < clients; i++) {
      const bytes = Buffer.from(
        JSON.stringify({
          requestId: crypto.randomUUID(),
          metadata: { synthetic: true, ...captureIdentity(capture) },
        }),
      );
      const response = await send('/api/playtest/v2/session', bytes, 'application/json', false);
      stats.requests++;
      if (!response.ok) throw Error(`Load session admission ${response.status}`);
      sessions.push((await response.json()).sessionId);
    }
    const start = Date.now();
    const delivery = async (session, key, bytes, mime, path, due, normal = true) => {
      byteCount += bytes.length;
      await retryUpload({
        path,
        bytes,
        mime,
        expected: {
          protocolVersion: 2,
          sessionId: session,
          logicalKey: key,
          uploadHash: hash(bytes, key.startsWith('media:') ? mime : ''),
        },
        deadline: start + seconds * 1000 + 45000,
        send,
        stats,
      });
      if (normal) {
        latencies.push(Date.now() - due);
        completed++;
      }
    };
    const scheduledThrough = (count) =>
      count * clients * (eventsPerTick + mediaPerTick) +
      feedbackScheduled(feedbackPerTick, count * clients);
    const producer = setInterval(() => {
      scheduled = scheduledThrough(Math.min(ticks, Math.floor((Date.now() - start) / 3000) + 1));
    }, 50);
    let outcomes;
    try {
      scheduled = scheduledThrough(1);
      outcomes = await Promise.allSettled(
        sessions.map(async (session, index) => {
          for (let seq = 0; seq < ticks; seq++) {
            const due = start + seq * 3000;
            await delay(Math.max(0, due - Date.now()));
            for (let m = 0; m < mediaPerTick; m++) {
              const media = await readFile(
                m === 0
                  ? capture.mediaFiles[(seq * clients + index) % capture.mediaFiles.length]
                  : capture.maximumMediaFile,
              );
              if (!media.length || media.length > 10 * 1024 ** 2)
                throw Error('Capture chunk outside admitted bounds');
              await delivery(
                session,
                `media:${captureMedia(capture).kind}:load:${seq * mediaPerTick + m}`,
                media,
                captureMedia(capture).mime,
                `/api/playtest/v2/${session}/media?kind=${captureMedia(capture).kind}&clip=load&seq=${seq * mediaPerTick + m}`,
                due,
              );
            }
            const feedbackSlot = seq * clients + index;
            const feedbackBefore = feedbackScheduled(feedbackPerTick, feedbackSlot);
            const feedbackCount =
              feedbackScheduled(feedbackPerTick, feedbackSlot + 1) - feedbackBefore;
            for (let f = 0; f < feedbackCount; f++) {
              const uploaded = await uploadFeedbackSample({
                sample: feedbackSamples[(feedbackBefore + f) % feedbackSamples.length].bytes,
                sessionId: session,
                deadline: start + seconds * 1000 + 45000,
                send,
                stats,
              });
              byteCount += uploaded.bytes;
              feedbackBytes += uploaded.bytes;
              completed++;
              feedbackCompleted++;
              const latency = Date.now() - due;
              latencies.push(latency);
              feedbackLatencies.push(latency);
            }
            for (let e = 0; e < eventsPerTick; e++) {
              const id = `load-${seq}-${e}`,
                template =
                  e > 0 && capture.maximumEvent
                    ? capture.maximumEvent
                    : capture.eventSamples[(seq * eventsPerTick + e) % capture.eventSamples.length];
              const bytes = Buffer.from(JSON.stringify({ ...template, id }));
              await delivery(
                session,
                `event:${id}`,
                bytes,
                'application/json',
                `/api/playtest/v2/${session}/event`,
                due,
              );
            }
          }
        }),
      );
    } finally {
      clearInterval(producer);
      scheduled = scheduledThrough(ticks);
    }
    const failures = outcomes.filter((r) => r.status === 'rejected');
    if (failures.length)
      throw new AggregateError(
        failures.map((r) => r.reason),
        'Load failed with undelivered requests',
      );
    // The maximum-size case is separate from normal-upload latency qualification.
    const video = capture.recordingMode === 'video';
    // Independent admitted-envelope stress, explicitly separate from measured rates.
    const maximum = new Uint8Array(10 * 1024 ** 2);
    const seed = capture.mediaFiles.length
      ? await readFile(capture.mediaFiles[0])
      : new Uint8Array([0]);
    if (!seed.length) throw Error('Empty maximum-size media seed');
    for (let offset = 0; offset < maximum.length; offset += seed.length)
      maximum.set(seed.subarray(0, maximum.length - offset), offset);
    const maximumMime = captureMedia(capture).mime;
    const maximumKey = `media:${captureMedia(capture).kind}:maximum:0`;
    const maxStart = Date.now();
    const maximumResults = await Promise.allSettled(
      sessions.slice(0, 2).map((session) =>
        retryUpload({
          path: `/api/playtest/v2/${session}/media?kind=${captureMedia(capture).kind}&clip=maximum&seq=0`,
          bytes: maximum,
          mime: maximumMime,
          expected: {
            protocolVersion: 2,
            sessionId: session,
            logicalKey: maximumKey,
            uploadHash: hash(maximum, maximumMime),
          },
          deadline: Date.now() + 90000,
          send,
          stats,
        }),
      ),
    );
    if (maximumResults.some((r) => r.status === 'rejected'))
      throw Error('Concurrent 10 MiB upload failed');
    let feedbackMaximum;
    if (feedbackSamples.length) {
      const largest = feedbackSamples.reduce((a, b) => (a.bytes.length >= b.bytes.length ? a : b));
      const began = Date.now();
      const maximumResults = await Promise.allSettled(
        sessions.slice(0, 2).map((sessionId) =>
          uploadFeedbackSample({
            sample: largest.bytes,
            sessionId,
            deadline: Date.now() + 90000,
            send,
            stats,
          }),
        ),
      );
      if (maximumResults.some((r) => r.status === 'rejected'))
        throw new AggregateError(
          maximumResults.filter((r) => r.status === 'rejected').map((r) => r.reason),
          'Concurrent observed feedback envelope upload failed',
        );
      byteCount += maximumResults.reduce((n, r) => n + r.value.bytes, 0);
      feedbackMaximum = {
        concurrent: 2,
        scope: 'largest observed sample; not protocol maximum',
        bytes: maximumResults.map((r) => r.value.bytes),
        elapsedMs: Date.now() - began,
      };
    }
    feedbackLatencies.sort((a, b) => a - b);
    latencies.sort((a, b) => a - b);
    const p95 =
      latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))] ?? Infinity;
    const result = {
      ...captureIdentity(capture),
      clients,
      seconds,
      completed,
      scheduled,
      finalBacklog: scheduled - completed,
      backlog,
      eventsPerTick,
      mediaPerTick,
      mediaSamples: capture.mediaFiles.length,
      ...(feedbackSamples.length
        ? {
            feedback: {
              ...feedbackWorkloadIdentity,
              qualification: 'UNQUALIFIED',
              samples: feedbackSamples.length,
              perTick: feedbackPerTick,
              scheduled: feedbackScheduled(feedbackPerTick, clients * ticks),
              completed: feedbackCompleted,
              bytes: feedbackBytes,
              p95Ms:
                feedbackLatencies[
                  Math.min(
                    feedbackLatencies.length - 1,
                    Math.floor(feedbackLatencies.length * 0.95),
                  )
                ] ?? Infinity,
              maximumObservedEnvelope: feedbackMaximum,
            },
          }
        : {}),
      ...(capture.corpusId ? { corpusId: capture.corpusId } : {}),
      bytes: byteCount + maximum.length * 2,
      ...stats,
      p95Ms: p95,
      maximum: { concurrent: 2, bytes: maximum.length, elapsedMs: Date.now() - maxStart },
      cpu: { scope: 'load generator process', ...process.cpuUsage(cpu) },
      memory,
      outboxSamples: capture.outboxSamples,
      finalOutbox: capture.finalOutbox,
      exportMs: capture.exportMs,
      storageBytes: capture.storageBytes,
      network: { uplinkMbps: 5, rttMs: 100 },
    };
    measurement = result;
    if (p95 >= 5000 || result.finalBacklog !== 0)
      throw Object.assign(Error('Capture load target failed'), { result });
    return result;
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    clearInterval(sample);
    try {
      await cleanupSynthetic(origin, run.id);
    } catch (cleanupError) {
      const errors = primaryError ? [primaryError, cleanupError] : [cleanupError];
      // AggregateError.errors is not enumerable. Preserve private, serializable
      // diagnostics as well as the actual causes and any completed measurement.
      const describe = (error) => ({
        name: error.name || 'Error',
        message: String(error.message ?? error),
        ...(error instanceof AggregateError ? { errors: error.errors.map(describe) } : {}),
      });
      throw Object.assign(
        new AggregateError(
          errors,
          errors.map((error) => String(error.message ?? error)).join('; '),
        ),
        {
          failures: errors.map(describe),
          ...(measurement || primaryError?.result
            ? { result: measurement ?? primaryError.result }
            : {}),
        },
      );
    }
  }
}

// A smoke witness, not locomotion qualification: gravity alone cannot satisfy it.
export function assertDrivenMotion(start, end) {
  if (
    !Number.isSafeInteger(start?.tick) ||
    !Number.isSafeInteger(end?.tick) ||
    end.tick - start.tick < 120
  )
    throw Error('Active capture must advance simulation');
  if (
    !Array.isArray(start.physics) ||
    !start.physics.length ||
    end.physics?.length !== start.physics.length
  )
    throw Error('Active capture body identity changed');
  const valid = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
  if (start.physics.some((b, i) => !valid(b.position) || !valid(end.physics[i].position)))
    throw Error('Invalid active capture transforms');
  if (
    !end.physics.some(
      (b, i) =>
        Math.hypot(
          b.position[0] - start.physics[i].position[0],
          b.position[2] - start.physics[i].position[2],
        ) > 0.05,
    )
  )
    throw Error('Active capture must contain horizontal vehicle motion');
}
