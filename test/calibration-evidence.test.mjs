import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  readCalibrationEvidence,
  CALIBRATION_CASES,
} from '../scripts/playtest/calibration-evidence.mjs';
import { writeCorpus } from '../scripts/playtest/corpus.mjs';
const hash = (b) => createHash('sha256').update(b).digest('hex');
test('release calibration admission requires reviewed report and all intact independent artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'calibration-evidence-'));
  try {
    const source = { head: 'a'.repeat(40), workingTreeDigest: 'b'.repeat(64) };
    const media = [join(root, 'one.bin'), join(root, 'two.bin')];
    await writeFile(media[0], 'aaa');
    await writeFile(media[1], 'bbbb');
    const base = {
      source,
      build: 'fixture',
      browserVersion: 'fixture-browser',
      captureSeconds: 60,
      mediaFiles: media,
      eventSamples: [{ id: 'a', kind: 'input' }],
      screenBytes: 7,
      maximumScreenChunkBytes: 4,
      finalOutbox: { bytes: 0, pending: 0 },
      syntheticRun: 'c'.repeat(32),
      workloadActions: ['drive'],
      driving: { fromTick: 0, toTick: 7200, from: [[0, 0, 0]], to: [[1, 0, 0]] },
    };
    const corpus = await writeCorpus(join(root, 'corpus'), base);
    const report = {
      schema: 2,
      protocol: 'capture-characterization-v2',
      calibrationStatus: 'MEASURED_NOT_APPROVED',
      source,
      artifact: 'd'.repeat(64),
      build: base.build,
      browserVersion: base.browserVersion,
      effective: { effectiveDigest: 'e'.repeat(64), loggingVerified: true },
      completedAt: 1000,
      corpusId: corpus.id,
      cases: [],
      controls: {
        fastDetected: true,
        slowDetected: true,
        burstAccepted: true,
        undrainedRejected: true,
        lateOnlyLongDetected: true,
      },
    };
    for (const spec of CALIBRATION_CASES) {
      const file = spec.id + '.json';
      const bytes = JSON.stringify({
        ...base,
        syntheticRun: CALIBRATION_CASES.indexOf(spec).toString(16).padStart(32, '0'),
        captureSeconds: spec.seconds,
        captureStarted: 0,
        captureEnded: spec.seconds * 1000,
        finalOutbox: { at: spec.seconds * 1000 + 6000, bytes: 0, pending: 0 },
        resourceSamples: Array.from({ length: spec.seconds / 3 }, (_, i) => ({
          at: (i + 1) * 3000,
          JSHeapUsedSize: 100,
          Nodes: 20,
          Documents: 1,
        })),
        outboxSamples: Array.from({ length: spec.seconds / 3 }, (_, i) => ({
          at: (i + 1) * 3000,
          bytes: 0,
          pending: 0,
        })),
        fault: spec.fault
          ? {
              name: spec.fault,
              injected: 2,
              recovered: true,
              aborted: 1,
              pendingBeforeReload: 1,
              startedAt: spec.fault === 'reload-recovery' ? spec.seconds * 1000 : 0,
              endedAt: spec.seconds * 1000 + 3,
              requests: (spec.fault === 'reload-recovery'
                ? [spec.seconds * 1000 + 1, spec.seconds * 1000 + 2]
                : [1, 30001]
              ).map((at) => ({ at, fault: spec.fault })),
            }
          : null,
      });
      await writeFile(join(root, file), bytes);
      report.cases.push({
        id: spec.id,
        seconds: spec.seconds,
        status: 'PASS',
        file,
        sha256: hash(bytes),
      });
    }
    const capacity = JSON.stringify({
      clients: 20,
      seconds: 600,
      p95Ms: 50,
      finalBacklog: 0,
      corpusId: corpus.id,
      scheduled: 8000,
      completed: 8000,
      maximum: { concurrent: 2, bytes: 10485760, elapsedMs: 50 },
      network: { uplinkMbps: 5, rttMs: 100 },
    });
    await writeFile(join(root, 'capacity.json'), capacity);
    report.capacity = {
      status: 'PASS',
      seconds: 600,
      p95Ms: 50,
      finalBacklog: 0,
      file: 'capacity.json',
      sha256: hash(capacity),
    };
    const file = join(root, 'comparison.json');
    await writeFile(file, JSON.stringify(report));
    const profile = {
      schema: 1,
      enduranceSeconds: 360,
      capacitySeconds: 120,
      maxAgeMs: 86400000,
      calibration: {
        evidence: hash(await readFile(file)),
        browserVersion: base.browserVersion,
        workload: { maxMediaBytesPerSecond: 1, maxEventsPerSecond: 1 / 3, maxChunkBytes: 4 },
        review: {
          reviewer: 'fixture reviewer',
          reviewedAt: 2000,
          duration: 'fixture only duration justification',
          age: 'fixture only expiry justification',
          workload: 'fixture only workload justification',
          limitations: 'fixture only limitations review',
        },
      },
    };
    await assert.doesNotReject(readCalibrationEvidence(profile, file));
    await assert.rejects(readCalibrationEvidence(profile), /file required/);
    await assert.rejects(
      readCalibrationEvidence(
        { ...profile, calibration: { ...profile.calibration, evidence: 'e'.repeat(64) } },
        file,
      ),
      /fingerprint/,
    );
    await assert.rejects(
      readCalibrationEvidence(
        { ...profile, calibration: { ...profile.calibration, review: null } },
        file,
      ),
      /review/,
    );
    const missing = structuredClone(report);
    delete missing.capacity.seconds;
    delete missing.capacity.p95Ms;
    const originalCapacity = await readFile(join(root, 'capacity.json'));
    const badCapacity = JSON.parse(originalCapacity);
    delete badCapacity.seconds;
    delete badCapacity.p95Ms;
    await writeFile(join(root, 'capacity.json'), JSON.stringify(badCapacity));
    missing.capacity.sha256 = hash(JSON.stringify(badCapacity));
    await writeFile(file, JSON.stringify(missing));
    await assert.rejects(
      readCalibrationEvidence(
        {
          ...profile,
          calibration: { ...profile.calibration, evidence: hash(JSON.stringify(missing)) },
        },
        file,
      ),
      /capacity/,
    );
    await writeFile(join(root, 'capacity.json'), originalCapacity);
    await writeFile(file, JSON.stringify(report));
    for (const [index, mutate, expected] of [
      [0, (c) => c.resourceSamples.forEach((r) => (r.at = 0)), /observations/],
      [
        0,
        (c) => {
          delete c.driving;
        },
        /driving/,
      ],
      [
        5,
        (c) => {
          c.outboxSamples = [];
        },
        /observations/,
      ],
      [
        7,
        (c) => {
          c.fault.requests = [{ at: 0 }, { at: 0 }];
        },
        /fault/,
      ],
      [
        5,
        (c) => {
          delete c.fault.injected;
        },
        /fault/,
      ],
      [
        1,
        (c) => {
          c.syntheticRun = '0'.repeat(32);
        },
        /independent/,
      ],
      [
        6,
        (c) => {
          delete c.fault.aborted;
        },
        /abort/,
      ],
      [
        8,
        (c) => {
          delete c.fault.pendingBeforeReload;
        },
        /reload/,
      ],
    ]) {
      const modified = structuredClone(report),
        row = modified.cases[index];
      const original = await readFile(join(root, row.file));
      const capture = JSON.parse(original);
      mutate(capture);
      const bytes = JSON.stringify(capture);
      await writeFile(join(root, row.file), bytes);
      row.sha256 = hash(bytes);
      const reportBytes = JSON.stringify(modified);
      await writeFile(file, reportBytes);
      await assert.rejects(
        readCalibrationEvidence(
          { ...profile, calibration: { ...profile.calibration, evidence: hash(reportBytes) } },
          file,
        ),
        expected,
      );
      await writeFile(join(root, row.file), original);
      await writeFile(file, JSON.stringify(report));
    }
    await writeFile(join(root, report.cases[2].file), '{}');
    await assert.rejects(readCalibrationEvidence(profile, file), /integrity/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
