import test from 'node:test';
import assert from 'node:assert/strict';
import { experimentReceipt } from '../scripts/playtest/experiments.mjs';
import {
  createTransport,
  readTransport,
  retrieveEvidence,
  sanitizeDiagnostic,
} from '../scripts/playtest/experiment-transport.mjs';
const metadata = {
  repository: 'owner/repo',
  workflow: '.github/workflows/ci.yml',
  branch: 'v2',
  event: 'push',
  runId: 5,
  runNumber: 5,
  head: 'a'.repeat(40),
  environment: 'staging',
};
const profile = {
  schema: 1,
  recordingMode: 'video',
  captureSchema: 1,
  enduranceSeconds: 360,
  capacitySeconds: 120,
  maxAgeMs: 86400000,
  calibration: {
    evidence: 'b'.repeat(64),
    browserVersion: 'fixture',
    workload: {
      maxEventBytes: 1000,
      maxMediaBytesPerSecond: 1,
      maxEventsPerSecond: 1,
      maxChunkBytes: 1,
    },
  },
};
const context = {
  artifact: 'a'.repeat(64),
  configuration: 'b'.repeat(64),
  inputs: { endurance: 'c'.repeat(64), capacity: 'd'.repeat(64) },
  environment: 'staging',
  profile,
};
const receipt = (f) => experimentReceipt(f, context, { captureSeconds: 60 }, Date.now() - 100);
test('transport preserves successful families across bypass and rejects provenance, corruption and private fields', () => {
  const prior = [receipt('endurance'), receipt('capacity')];
  const transport = createTransport(metadata, prior, [], [], 'failure');
  assert.deepEqual(
    readTransport(JSON.stringify(transport), metadata).map((r) => r.id),
    prior.map((r) => r.id),
  );
  assert.throws(
    () => readTransport(JSON.stringify(transport), { ...metadata, repository: 'fork/repo' }),
    /provenance/i,
  );
  assert.throws(
    () =>
      readTransport(
        JSON.stringify({ ...transport, receipts: [{ ...prior[0], expires: 1 }] }),
        metadata,
      ),
    /receipt/i,
  );
  assert.throws(
    () => createTransport(metadata, [], [{ ...prior[0], token: 'secret' }], [], 'success'),
    /private|fields/i,
  );
  const diag = sanitizeDiagnostic({
    family: 'endurance',
    artifact: context.artifact,
    reason: 'token TOPSECRET /private/file',
    capture: { captureSeconds: 60, screenBytes: 100, mediaFiles: ['/private/video'] },
  });
  assert.ok(!JSON.stringify(diag).includes('TOPSECRET'));
  assert.ok(!JSON.stringify(diag).includes('/private'));
});
test('retrieval only downloads bounded trusted release workflow artifacts and combines families', async () => {
  const run = {
    id: 5,
    run_number: 5,
    head_sha: metadata.head,
    head_branch: 'v2',
    event: 'push',
    conclusion: 'success',
    path: metadata.workflow,
    head_repository: { full_name: metadata.repository },
  };
  let downloads = 0;
  const query = (path) =>
    path.includes('/artifacts?')
      ? { artifacts: [{ id: 8, name: 'experiment-evidence', expired: false, size_in_bytes: 100 }] }
      : {
          workflow_runs: path.includes('event=push')
            ? [
                run,
                { ...run, id: 6, event: 'pull_request' },
                { ...run, id: 7, head_repository: { full_name: 'fork/repo' } },
              ]
            : [],
        };
  const result = await retrieveEvidence({
    query,
    download: async () => {
      downloads++;
      return JSON.stringify(createTransport(metadata, [receipt('endurance')], [], [], 'success'));
    },
    repository: metadata.repository,
    branch: 'v2',
    currentRunId: 10,
  });
  assert.equal(downloads, 1);
  assert.equal(result.length, 1);
  await assert.rejects(
    retrieveEvidence({
      query,
      download: async () => '{bad',
      repository: metadata.repository,
      branch: 'v2',
      currentRunId: 10,
    }),
  );
});
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { exportTransport } from '../scripts/playtest/experiment-transport.mjs';
test('failure export carries prior successful evidence but never owner credentials or raw diagnostics', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'transport-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const previous = receipt('capacity');
  await writeFile(join(directory, 'prior-experiment-evidence.json'), JSON.stringify([previous]));
  await writeFile(join(directory, 'owner-private.json'), JSON.stringify({ token: 'VERYSECRET' }));
  await writeFile(
    join(directory, 'experiment-failure-attempt.json'),
    JSON.stringify({
      family: 'endurance',
      artifact: context.artifact,
      reason: 'VERYSECRET',
      capture: { captureSeconds: 60, screenBytes: 500, mediaFiles: ['PRIVATEPATH'] },
    }),
  );
  await exportTransport(directory, 'staging', {
    GITHUB_REPOSITORY: metadata.repository,
    GITHUB_REF_NAME: 'v2',
    GITHUB_EVENT_NAME: 'push',
    GITHUB_RUN_ID: '5',
    GITHUB_RUN_NUMBER: '5',
    GITHUB_SHA: metadata.head,
    RELEASE_JOB_STATUS: 'failure',
  });
  const bytes = await readFile(join(directory, 'experiment-transport.json'), 'utf8');
  assert.ok(!bytes.includes('VERYSECRET'));
  assert.ok(!bytes.includes('PRIVATEPATH'));
  assert.equal(readTransport(bytes, metadata)[0].id, previous.id);
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8');
  assert.match(
    workflow,
    /if: always\(\)\n        run: node scripts\/playtest\/experiment-transport.mjs/,
  );
  assert.match(
    workflow,
    /name: experiment-evidence[\s\S]*path: .release-private\/ci\/experiment-transport.json/,
  );
});

test('real capture rows and capacity corpus metadata survive mixed failure history export', () => {
  const endurance = experimentReceipt(
    'endurance',
    context,
    {
      captureSeconds: 360,
      outboxSamples: [{ at: 1, pending: 2, bytes: 3 }],
      finalOutbox: { at: 1788881031770, bytes: 0, pending: 0 },
      workload: { mediaBytesPerSecond: 4, eventsPerSecond: 1 },
    },
    Date.now() - 100,
  );
  const capacity = experimentReceipt(
    'capacity',
    context,
    {
      mediaPerTick: 2,
      corpusId: 'f'.repeat(64),
      outboxSamples: [{ at: 1, pending: 2, bytes: 3 }],
      clients: 20,
    },
    Date.now() - 100,
  );
  const failure = {
    id: 'failure-known',
    family: 'endurance',
    status: 'FAIL',
    identity: 'a'.repeat(64),
    artifact: context.artifact,
    measuredAt: Date.now(),
    reason: 'PRIVATE reason',
  };
  const exported = createTransport(metadata, [endurance], [capacity, failure], [], 'failure');
  assert.equal(exported.receipts.length, 2);
  assert.equal(exported.diagnostics.length, 1);
  assert.ok(!JSON.stringify(exported).includes('PRIVATE'));
  assert.equal(readTransport(JSON.stringify(exported), metadata).length, 2);
});
test('replacement of a named artifact during download fails closed', async () => {
  const run = {
    id: 5,
    run_number: 5,
    head_sha: metadata.head,
    head_branch: 'v2',
    event: 'push',
    conclusion: 'success',
    path: metadata.workflow,
    head_repository: { full_name: metadata.repository },
  };
  let listed = 0;
  const query = (path) =>
    path.includes('/artifacts?')
      ? {
          artifacts: [
            {
              id: ++listed === 1 ? 8 : 9,
              name: 'experiment-evidence',
              expired: false,
              size_in_bytes: 100,
            },
          ],
        }
      : { workflow_runs: path.includes('event=push') ? [run] : [] };
  await assert.rejects(
    retrieveEvidence({
      query,
      download: async () =>
        JSON.stringify(createTransport(metadata, [receipt('endurance')], [], [], 'success')),
      repository: metadata.repository,
      branch: 'v2',
      currentRunId: 10,
    }),
    /changed|replaced/i,
  );
});
