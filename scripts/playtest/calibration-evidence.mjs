// Release admission consumes actual characterization files; a hash-shaped string is not evidence.
import { readFile, lstat } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { validateProfile } from './experiments.mjs';
import {
  assertCaptureBacklog,
  assertCaptureWorkload,
  assertDrivenMotion,
  assertCaptureIdentity,
  captureMedia,
} from './load.mjs';
import { readCorpus } from './corpus.mjs';
export const CALIBRATION_CASES = Object.freeze([
  { id: 'long', seconds: 1800 },
  { id: 'short-360-a', seconds: 360 },
  { id: 'short-360-b', seconds: 360 },
  { id: 'short-600-a', seconds: 600 },
  { id: 'short-600-b', seconds: 600 },
  { id: 'withheld-ack', seconds: 180, fault: 'withheld-ack' },
  { id: 'stalled-request', seconds: 180, fault: 'stalled-request' },
  { id: 'periodic-loss', seconds: 180, fault: 'periodic-loss' },
  { id: 'reload-recovery', seconds: 180, fault: 'reload-recovery' },
]);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function bounded(path, limit = 8 * 1024 * 1024) {
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
    throw Error('Calibration evidence file bounds');
  return readFile(path);
}
export async function readCalibrationEvidence(profile, path) {
  validateProfile(profile);
  if (typeof path !== 'string' || !path) throw Error('Calibration evidence file required');
  const measurements = [];
  const bytes = await bounded(path);
  if (sha(bytes) !== profile.calibration.evidence)
    throw Error('Calibration evidence fingerprint mismatch');
  const report = JSON.parse(bytes);
  assertCaptureIdentity(report, profile);
  if (
    report.schema !== 2 ||
    report.protocol !== 'capture-characterization-v2' ||
    report.calibrationStatus !== 'MEASURED_NOT_APPROVED' ||
    !/^[a-f0-9]{64}$/.test(report.source?.workingTreeDigest ?? '') ||
    !/^[a-f0-9]{64}$/.test(report.artifact ?? '') ||
    report.browserVersion !== profile.calibration.browserVersion ||
    !/^[a-f0-9]{64}$/.test(report.effective?.effectiveDigest ?? '') ||
    report.effective?.loggingVerified !== true ||
    !Array.isArray(report.cases)
  )
    throw Error('Incomplete calibration provenance');
  const review = profile.calibration.review;
  if (
    !review?.reviewer?.trim() ||
    !Number.isSafeInteger(review.reviewedAt) ||
    review.reviewedAt < report.completedAt ||
    review.reviewedAt > Date.now() ||
    !['duration', 'age', 'workload', 'limitations'].every(
      (k) => typeof review[k] === 'string' && review[k].trim().length > 0,
    )
  )
    throw Error('Explicit duration, age, workload and limitations review required');
  if (!Number.isSafeInteger(report.completedAt) || report.completedAt > Date.now())
    throw Error('Invalid calibration time');
  if (![360, 600, 1800].includes(profile.enduranceSeconds))
    throw Error('Profile duration was not characterized');
  const root = resolve(dirname(path));
  if (
    report.cases.length !== CALIBRATION_CASES.length ||
    new Set(report.cases.map((r) => r.id)).size !== report.cases.length
  )
    throw Error('Ambiguous calibration cases');
  const runs = new Set();
  const files = new Set();
  for (const spec of CALIBRATION_CASES) {
    const row = report.cases.find((r) => r.id === spec.id);
    if (
      !row ||
      row.seconds !== spec.seconds ||
      row.status !== 'PASS' ||
      !/^[a-f0-9]{64}$/.test(row.sha256 ?? '') ||
      typeof row.file !== 'string'
    )
      throw Error('Incomplete independent calibration cases');
    const file = resolve(root, row.file);
    if (!file.startsWith(root + sep) || row.file.split(/[\\/]/).includes('..'))
      throw Error('Calibration artifact path');
    const artifact = await bounded(file, 32 * 1024 * 1024);
    if (sha(artifact) !== row.sha256) throw Error('Calibration artifact integrity mismatch');
    const capture = JSON.parse(artifact);
    assertCaptureIdentity(capture, profile);
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        capture.syntheticRun ?? '',
      ) ||
      runs.has(capture.syntheticRun) ||
      files.has(row.file)
    )
      throw Error('Calibration captures must be independent');
    measurements.push({
      run: capture.syntheticRun,
      captureSeconds: capture.captureSeconds,
      eventCount: capture.eventCount ?? capture.eventSamples.length,
      screenBytes: capture.screenBytes,
      voiceBytes: capture.voiceBytes ?? 0,
      maximumEventBytes:
        capture.maximumEventBytes ??
        Math.max(...capture.eventSamples.map((e) => Buffer.byteLength(JSON.stringify(e)))),
      maximumScreenChunkBytes: capture.maximumScreenChunkBytes,
    });
    runs.add(capture.syntheticRun);
    files.add(row.file);
    if (
      capture.captureSeconds !== spec.seconds ||
      capture.browserVersion !== report.browserVersion ||
      capture.finalOutbox?.bytes !== 0 ||
      capture.finalOutbox?.pending !== 0 ||
      capture.build !== report.build ||
      JSON.stringify(capture.source) !== JSON.stringify(report.source) ||
      !capture.syntheticRun ||
      !capture.workloadActions?.includes('drive')
    )
      throw Error('Calibration capture identity or drain mismatch');
    assertCalibrationObservations(capture);
    assertCaptureWorkload(capture, profile.calibration.workload);
    if (!spec.fault) assertCaptureBacklog(capture, spec.seconds);
    if (
      spec.fault === 'stalled-request' &&
      (!Number.isSafeInteger(capture.fault?.aborted) || capture.fault.aborted < 1)
    )
      throw Error('Stalled request abort evidence required');
    if (
      spec.fault === 'reload-recovery' &&
      (!Number.isSafeInteger(capture.fault?.pendingBeforeReload) ||
        capture.fault.pendingBeforeReload < 1)
    )
      throw Error('Pending reload recovery evidence required');
    if (spec.fault === 'periodic-loss' && capture.fault?.injected < 2)
      throw Error('Periodic fault repetition required');
    if (
      spec.fault &&
      (capture.fault?.name !== spec.fault ||
        !Number.isSafeInteger(capture.fault.injected) ||
        capture.fault.injected < 1 ||
        capture.fault.recovered !== true)
    )
      throw Error('Missing real browser fault evidence');
  }
  if (
    !Number.isSafeInteger(report.capacity?.seconds) ||
    report.capacity.seconds < 120 ||
    report.capacity.seconds > 600 ||
    !Number.isFinite(report.capacity.p95Ms) ||
    report.capacity.p95Ms < 0
  )
    throw Error('Invalid calibration capacity measurements');
  if (
    report.capacity?.status !== 'PASS' ||
    report.capacity.seconds < profile.capacitySeconds ||
    report.capacity.p95Ms >= 5000 ||
    report.capacity.finalBacklog !== 0 ||
    !/^[a-f0-9]{64}$/.test(report.corpusId ?? '')
  )
    throw Error('Calibration capacity evidence required');
  const capacityBytes = await bounded(resolve(root, 'capacity.json'));
  if (report.capacity.file !== 'capacity.json' || sha(capacityBytes) !== report.capacity.sha256)
    throw Error('Calibration capacity artifact integrity');
  const capacity = JSON.parse(capacityBytes);
  assertCaptureIdentity(capacity, profile);
  if (
    capacity.seconds !== report.capacity.seconds ||
    capacity.p95Ms !== report.capacity.p95Ms ||
    capacity.finalBacklog !== 0 ||
    capacity.clients !== 20 ||
    capacity.corpusId !== report.corpusId
  )
    throw Error('Calibration capacity measurement mismatch');
  if (
    !Number.isSafeInteger(capacity.scheduled) ||
    capacity.scheduled < 20 * Math.ceil(capacity.seconds / 3) * 2 ||
    capacity.completed !== capacity.scheduled ||
    capacity.maximum?.concurrent !== 2 ||
    capacity.maximum?.bytes !== 10 * 1024 ** 2 ||
    !Number.isFinite(capacity.maximum?.elapsedMs) ||
    capacity.maximum.elapsedMs < 0 ||
    capacity.maximum.elapsedMs > 90000 ||
    capacity.network?.uplinkMbps !== 5 ||
    capacity.network?.rttMs !== 100
  )
    throw Error('Incomplete calibration capacity workload');
  const corpus = await readCorpus(resolve(root, 'corpus'), report.corpusId);
  assertCaptureIdentity(corpus, profile);
  for (const measured of measurements) {
    const c = corpus.cases.find((c) => c.run === measured.run);
    if (!c || Object.keys(measured).some((k) => c[k] !== measured[k]))
      throw Error('Corpus case observations mismatch');
  }
  if (JSON.stringify([...corpus.runs].sort()) !== JSON.stringify([...runs].sort()))
    throw Error('Corpus must cover every characterization run');
  if (
    capacity.scheduled !==
    20 *
      Math.ceil(capacity.seconds / 3) *
      ((corpus.mediaFiles.length ? 1 : 0) +
        corpus.envelope.mediaCopiesPerTick +
        corpus.envelope.eventsPerTick)
  )
    throw Error('Capacity did not execute corpus stress envelope');
  if (corpus.browserVersion !== report.browserVersion)
    throw Error('Calibration corpus browser mismatch');
  assertCaptureWorkload(corpus, profile.calibration.workload);
  const tested = {
    maxMediaBytesPerSecond: (corpus.envelope.mediaCopiesPerTick * captureMedia(corpus).maximum) / 3,
    maxEventsPerSecond: corpus.envelope.eventsPerTick / 3,
    maxChunkBytes: captureMedia(corpus).maximum,
    maxEventBytes: corpus.maximumEventBytes,
  };
  if (Object.keys(tested).some((k) => profile.calibration.workload[k] > tested[k]))
    throw Error('Profile workload exceeds tested capacity distribution');
  if (
    report.controls?.fastDetected !== true ||
    report.controls?.slowDetected !== true ||
    report.controls?.burstAccepted !== true ||
    report.controls?.undrainedRejected !== true ||
    report.controls?.lateOnlyLongDetected !== true
  )
    throw Error('Calibration negative controls required');
  return report;
}

// Coverage is independent of the five-minute growth predicate, including fault windows.
export function assertCalibrationObservations(capture) {
  const { captureStarted: start, captureEnded: end, captureSeconds: seconds } = capture;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    !Number.isInteger(seconds) ||
    seconds < 1 ||
    end - start < seconds * 1000 ||
    end - start > seconds * 1000 + 6000
  )
    throw Error('Invalid capture observations interval');
  for (const [samples, fields] of [
    [capture.resourceSamples, ['JSHeapUsedSize', 'Nodes', 'Documents']],
    [capture.outboxSamples, ['bytes', 'pending']],
  ]) {
    if (
      !Array.isArray(samples) ||
      samples.length < Math.floor(seconds / 3) - 2 ||
      !samples.length ||
      samples[0].at > start + 6000 ||
      samples.at(-1).at < end - 6000 ||
      samples.some(
        (r, i) =>
          !Number.isSafeInteger(r.at) ||
          r.at < start ||
          r.at > end ||
          fields.some((k) => !Number.isFinite(r[k]) || r[k] < 0) ||
          (i && (r.at <= samples[i - 1].at || r.at - samples[i - 1].at > 6000)),
      )
    )
      throw Error('Incomplete or unordered capture observations');
  }
  const d = capture.driving;
  if (!d || !Array.isArray(d.from) || !Array.isArray(d.to)) throw Error('Missing driving evidence');
  assertDrivenMotion(
    { tick: d.fromTick, physics: d.from.map((position) => ({ position })) },
    { tick: d.toTick, physics: d.to.map((position) => ({ position })) },
  );
  if (capture.fault) {
    const f = capture.fault;
    if (
      !Number.isSafeInteger(capture.finalOutbox?.at) ||
      capture.finalOutbox.at < end ||
      !Number.isSafeInteger(f.startedAt) ||
      !Number.isSafeInteger(f.endedAt) ||
      f.startedAt < 0 ||
      f.endedAt < f.startedAt ||
      f.endedAt > capture.finalOutbox.at ||
      (f.name === 'reload-recovery'
        ? f.startedAt < end
        : Math.abs(f.startedAt - start) > 6000 || f.endedAt < end) ||
      !Array.isArray(f.requests) ||
      f.requests.length !== f.injected ||
      !f.requests.length ||
      f.requests.some(
        (r) =>
          !Number.isSafeInteger(r.at) ||
          r.at < f.startedAt ||
          r.at > f.endedAt ||
          r.fault !== f.name,
      )
    )
      throw Error('Incomplete fault interval observations');
    if (
      f.name === 'periodic-loss' &&
      (new Set(f.requests.map((r) => Math.floor((r.at - f.startedAt) / 30000))).size < 2 ||
        f.requests.some((r) => r.at - f.startedAt >= 90000 || (r.at - f.startedAt) % 30000 >= 5000))
    )
      throw Error('Periodic fault must cover distinct loss periods');
  }
}
