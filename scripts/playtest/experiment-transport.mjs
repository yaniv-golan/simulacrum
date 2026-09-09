// GitHub transports measurements, never policy decisions, private capture or credentials.
import { readFile, writeFile, readdir, mkdir, lstat, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { normalizeExperimentEvidence, validateExperimentReceiptIntegrity } from './experiments.mjs';
const maxBytes = 512 * 1024;
const metadataKeys = [
  'repository',
  'workflow',
  'branch',
  'event',
  'runId',
  'runNumber',
  'head',
  'environment',
];
function keys(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw Error('Unexpected or private transport fields');
}
const numeric = (value) => {
  if (!Number.isFinite(value) || value < 0) throw Error('Invalid numeric transport measurement');
};
function measurement(value) {
  keys(value, [
    'recordingMode',
    'captureSchema',
    'captureSeconds',
    'corpusId',
    'outboxSamples',
    'finalOutbox',
    'workload',
    'clients',
    'seconds',
    'completed',
    'scheduled',
    'finalBacklog',
    'backlog',
    'eventsPerTick',
    'mediaPerTick',
    'mediaSamples',
    'bytes',
    'requests',
    'retries',
    'timeouts',
    'p95Ms',
    'maximum',
    'cpu',
    'memory',
    'exportMs',
    'storageBytes',
    'network',
  ]);
  for (const [key, v] of Object.entries(value)) {
    if (key === 'recordingMode') {
      if (!['data', 'video'].includes(v)) throw Error('Invalid recording mode');
    } else if (key === 'captureSchema') {
      if (v !== 1) throw Error('Invalid capture schema');
    } else if (key === 'corpusId') {
      if (typeof v !== 'string' || !/^[a-f0-9]{64}$/.test(v))
        throw Error('Invalid capacity corpus identity');
    } else if (['outboxSamples', 'backlog'].includes(key)) {
      if (!Array.isArray(v) || v.length > 10000) throw Error('Invalid measurement samples');
      for (const row of v) {
        keys(row, key === 'outboxSamples' ? ['at', 'bytes', 'pending'] : ['at', 'pending']);
        Object.values(row).forEach(numeric);
      }
    } else if (['finalOutbox', 'workload', 'maximum', 'cpu', 'memory', 'network'].includes(key)) {
      const fields = {
        finalOutbox: ['at', 'bytes', 'pending'],
        workload: ['mediaBytesPerSecond', 'eventsPerSecond'],
        maximum: ['concurrent', 'bytes', 'elapsedMs'],
        cpu: ['scope', 'user', 'system'],
        memory: ['scope', 'peakRss'],
        network: ['uplinkMbps', 'rttMs'],
      };
      keys(v, fields[key]);
      for (const [k, n] of Object.entries(v)) {
        if (k === 'scope') {
          if (n !== 'load generator process') throw Error('Invalid measurement scope');
        } else numeric(n);
      }
    } else numeric(v);
  }
}
function receipt(record) {
  keys(record, [
    'schema',
    'recordingMode',
    'captureSchema',
    'family',
    'status',
    'artifact',
    'identity',
    'configuration',
    'environment',
    'profile',
    'measuredAt',
    'expires',
    'measurement',
    'id',
  ]);
  validateExperimentReceiptIntegrity(record);
  measurement(record.measurement);
  return record;
}
export function sanitizeDiagnostic(value) {
  const result = { kind: 'experiment-failure' };
  if (['endurance', 'capacity'].includes(value?.family)) result.family = value.family;
  if (/^[a-f0-9]{64}$/.test(value?.artifact || '')) result.artifact = value.artifact;
  if (value?.capture) {
    result.capture = {};
    for (const key of ['captureSeconds', 'screenBytes', 'maximumScreenChunkBytes'])
      if (Number.isFinite(value.capture[key]) && value.capture[key] >= 0)
        result.capture[key] = value.capture[key];
    if (value.capture.finalOutbox) {
      keys(value.capture.finalOutbox, ['at', 'bytes', 'pending']);
      Object.values(value.capture.finalOutbox).forEach(numeric);
      result.capture.finalOutbox = value.capture.finalOutbox;
    }
    if (value.capture.outboxSamples) {
      measurement({ outboxSamples: value.capture.outboxSamples });
      result.capture.outboxSamples = value.capture.outboxSamples;
    }
  }
  return result;
}
export function createTransport(metadata, prior, current, diagnostics, jobStatus) {
  keys(metadata, metadataKeys);
  if (!['success', 'failure', 'cancelled', 'skipped'].includes(jobStatus))
    throw Error('Invalid job status');
  const normalized = normalizeExperimentEvidence([...prior, ...current]);
  const records = normalized.filter((r) => r.status === 'PASS').map(receipt);
  const failures = normalized.filter((r) => r.status === 'FAIL');
  // Carry both successful families even when this run explicitly skips experiments.
  // Older identities remain in originating run artifacts; selection still owns reuse eligibility.
  const receipts = [];
  for (const family of ['endurance', 'capacity']) {
    const latest = records
      .filter((r) => r.family === family && r.environment === metadata.environment)
      .sort((a, b) => b.measuredAt - a.measuredAt)[0];
    if (latest) receipts.push(latest);
  }
  if (!Array.isArray(diagnostics) || diagnostics.length + failures.length > 64)
    throw Error('Too many experiment diagnostics');
  const value = {
    schema: 1,
    ...metadata,
    jobStatus,
    receipts,
    diagnostics: [...diagnostics, ...failures].map(sanitizeDiagnostic),
  };
  if (Buffer.byteLength(JSON.stringify(value)) > maxBytes)
    throw Error('Experiment transport exceeds bound');
  return value;
}
export function readTransport(bytes, expected) {
  if (Buffer.byteLength(bytes) > maxBytes) throw Error('Experiment transport exceeds bound');
  const value = JSON.parse(bytes);
  keys(value, ['schema', ...metadataKeys, 'jobStatus', 'receipts', 'diagnostics']);
  if (value.schema !== 1 || metadataKeys.some((k) => value[k] !== expected[k]))
    throw Error('Experiment transport provenance mismatch');
  if (
    !Array.isArray(value.receipts) ||
    value.receipts.length > 2 ||
    !Array.isArray(value.diagnostics) ||
    value.diagnostics.length > 64
  )
    throw Error('Invalid experiment transport');
  if (!['success', 'failure', 'cancelled', 'skipped'].includes(value.jobStatus))
    throw Error('Invalid job status');
  for (const d of value.diagnostics)
    if (JSON.stringify(sanitizeDiagnostic(d)) !== JSON.stringify(d))
      throw Error('Unsafe experiment diagnostics');
  return normalizeExperimentEvidence(value.receipts.map(receipt));
}
export async function retrieveEvidence({
  query,
  download,
  repository,
  branch,
  currentRunId,
  now = Date.now(),
}) {
  const records = [];
  const seen = new Set();
  for (const event of ['push', 'workflow_dispatch']) {
    const response = await query(
      `repos/${repository}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&event=${event}&status=success&per_page=10`,
    );
    if (!Array.isArray(response.workflow_runs) || response.workflow_runs.length > 10)
      throw Error('Invalid bounded release listing');
    for (const run of response.workflow_runs) {
      if (
        run.event !== event ||
        run.head_branch !== branch ||
        run.conclusion !== 'success' ||
        run.path !== '.github/workflows/ci.yml' ||
        run.head_repository?.full_name !== repository ||
        String(run.id) === String(currentRunId)
      )
        continue;
      if (
        !Number.isSafeInteger(run.id) ||
        !Number.isSafeInteger(run.run_number) ||
        !/^[a-f0-9]{40}$/.test(run.head_sha || '')
      )
        throw Error('Invalid release run identity');
      if (seen.has(run.id)) continue;
      seen.add(run.id);
      const listing = await query(
        `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
      );
      if (!Array.isArray(listing.artifacts) || listing.total_count > 100)
        throw Error('Invalid bounded artifact listing');
      const candidates = listing.artifacts.filter(
        (a) => a.name === 'experiment-evidence' && !a.expired,
      );
      if (candidates.length > 1) throw Error('Ambiguous experiment artifact');
      if (!candidates.length) continue;
      const artifact = candidates[0];
      if (
        !Number.isSafeInteger(artifact.id) ||
        !Number.isFinite(artifact.size_in_bytes) ||
        artifact.size_in_bytes > maxBytes
      )
        throw Error('Oversized experiment artifact');
      const expected = {
        repository,
        workflow: run.path,
        branch,
        event,
        runId: run.id,
        runNumber: run.run_number,
        head: run.head_sha,
        environment: 'staging',
      };
      const bytes = await download(run.id, artifact.id);
      // Download-by-name is safe only while the uniquely identified artifact remains
      // current. GitHub artifact IDs are immutable and never reused after replacement.
      const after = await query(
        `repos/${repository}/actions/runs/${run.id}/artifacts?per_page=100`,
      );
      if (!Array.isArray(after.artifacts) || after.total_count > 100)
        throw Error('Invalid bounded artifact listing');
      const current = after.artifacts.filter((a) => a.name === 'experiment-evidence' && !a.expired);
      if (
        current.length !== 1 ||
        current[0].id !== artifact.id ||
        current[0].size_in_bytes !== artifact.size_in_bytes
      )
        throw Error('Experiment artifact changed during download');
      records.push(...readTransport(bytes, expected));
    }
  }
  // Check conflicts/corruption before discarding expired evidence. Expiry is never repaired.
  return normalizeExperimentEvidence(records).filter((r) => r.expires > now);
}
export async function retrieveGitHubEvidence(repository, branch, currentRunId) {
  const query = (path) =>
    JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }));
  return retrieveEvidence({
    query,
    repository,
    branch,
    currentRunId,
    download: async (runId) => {
      const directory = await mkdtemp(join(tmpdir(), 'experiment-artifact-'));
      try {
        execFileSync(
          'gh',
          [
            'run',
            'download',
            String(runId),
            '--repo',
            repository,
            '--name',
            'experiment-evidence',
            '--dir',
            directory,
          ],
          { stdio: 'pipe', timeout: 60000 },
        );
        const entries = await readdir(directory);
        if (entries.length !== 1 || entries[0] !== 'experiment-transport.json')
          throw Error('Unexpected experiment artifact files');
        const path = join(directory, entries[0]),
          stat = await lstat(path);
        if (!stat.isFile() || stat.size > maxBytes) throw Error('Unsafe experiment artifact');
        return await readFile(path, 'utf8');
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  });
}
export async function exportTransport(directory, environment, env = process.env) {
  await mkdir(directory, { recursive: true });
  const optional = async (path) =>
    lstat(path)
      .then(async (stat) => {
        if (!stat.isFile() || stat.size > maxBytes) throw Error('Unsafe experiment evidence file');
        return JSON.parse(await readFile(path, 'utf8'));
      })
      .catch((e) => {
        if (e.code === 'ENOENT') return [];
        throw e;
      });
  const prior = await optional(join(directory, 'prior-experiment-evidence.json'));
  const current = await optional(join(directory, 'experiment-evidence.json'));
  const diagnostics = [];
  for (const file of await readdir(directory))
    if (/^experiment-failure-[A-Za-z0-9_-]+\.json$/.test(file)) {
      if (diagnostics.length >= 64) throw Error('Too many experiment diagnostics');
      const path = join(directory, file),
        stat = await lstat(path);
      if (!stat.isFile() || stat.size > maxBytes) throw Error('Unsafe experiment diagnostic');
      diagnostics.push(JSON.parse(await readFile(path, 'utf8')));
    }
  const metadata = {
    repository: env.GITHUB_REPOSITORY,
    workflow:
      environment === 'staging'
        ? '.github/workflows/ci.yml'
        : '.github/workflows/deploy-production.yml',
    branch: env.GITHUB_REF_NAME,
    event: env.GITHUB_EVENT_NAME,
    runId: Number(env.GITHUB_RUN_ID),
    runNumber: Number(env.GITHUB_RUN_NUMBER),
    head: env.GITHUB_SHA,
    environment,
  };
  const output = createTransport(
    metadata,
    prior,
    current,
    diagnostics,
    env.RELEASE_JOB_STATUS || 'failure',
  );
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, 'experiment-transport.json'), JSON.stringify(output), {
    mode: 0o600,
  });
  return output;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [directory, environment] = process.argv.slice(2);
  if (!directory || !['staging', 'production'].includes(environment))
    throw Error('Transport export directory and environment required');
  await exportTransport(directory, environment);
}
