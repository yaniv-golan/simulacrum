import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildModuleGraph } from '../module-graph.mjs';
import { sourceIdentity } from '../source-identity.mjs';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ordered = (value) =>
  Array.isArray(value)
    ? value.map(ordered)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, ordered(item)]),
        )
      : value;

// Manifest scopes are audited exact implementations, not a filename whitelist.
const boundedRuntime = (value) =>
  value &&
  ['data', 'video'].includes(value.recordingMode) &&
  value.captureSchema === 1 &&
  /^[a-f0-9]{64}$/.test(value.calibrationEvidence ?? '') &&
  /^[a-f0-9]{64}$/.test(value.effectiveProvider ?? '') &&
  typeof value.browserVersion === 'string' &&
  value.browserVersion.trim() &&
  ['maxMediaBytesPerSecond', 'maxEventsPerSecond', 'maxChunkBytes', 'maxEventBytes'].every(
    (key) =>
      Number.isFinite(value.workload?.[key]) &&
      (value.recordingMode === 'data' && ['maxMediaBytesPerSecond', 'maxChunkBytes'].includes(key)
        ? value.workload[key] >= 0
        : value.workload[key] > 0),
  );
const matchesScope = (scope, path, node, hash, family) =>
  scope.family === family &&
  scope.runtimeBoundary ===
    (family === 'capacity' ? 'synthetic-capacity-envelope-v1' : 'packaged-capture-runtime-v1') &&
  scope.entrypoint === path &&
  scope.sourceSha256 === hash &&
  JSON.stringify([...(scope.dependencies ?? [])].sort()) ===
    JSON.stringify([...node.dependencies].sort()) &&
  JSON.stringify([...(scope.externalImports ?? [])].sort()) ===
    JSON.stringify(
      (node.imports ?? [])
        .filter((x) => x.target === null)
        .map((x) => x.specifier)
        .sort(),
    );

/** Package byte inventory is a bounded runtime input, not an assertion about opaque verifier reads.
 * Capacity independence from rendered assets is valid only with the caller's measured workload admission.
 */
export function deriveExperimentInputs({
  files,
  desired,
  roots,
  graph,
  read,
  source,
  runtime,
  capacityRuntime,
  scopes = [],
}) {
  if (graph.errors?.length || graph.parseErrors?.length)
    throw Error('Experiment dependency discovery failed');
  if (
    !files ||
    !Object.keys(files).some((path) => path.startsWith('assets/')) ||
    !Object.keys(files).some((path) => path.startsWith('backend/')) ||
    Object.entries(files).some(
      ([path, hash]) =>
        path.startsWith('/') || path.split('/').includes('..') || !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw Error('Invalid experiment payload inventory');
  const unknown = Object.keys(files).filter(
    (path) => !path.startsWith('assets/') && !path.startsWith('backend/'),
  );
  const boundaries = {},
    inputs = {};
  for (const family of ['endurance', 'capacity']) {
    const closure = {},
      reasons = unknown.map((path) => `unclassified packaged input: ${path}`),
      queue = [...roots[family]];
    const seen = new Set();
    for (const path of queue) {
      if (seen.has(path)) continue;
      seen.add(path);
      const node = graph.nodes.get(path);
      if (!node) {
        reasons.push(`unresolved verifier input: ${path}`);
        continue;
      }
      closure[path] = createHash('sha256').update(read(path)).digest('hex');
      if (
        node.opaqueInputs &&
        !(
          boundedRuntime(capacityRuntime) &&
          scopes.some((scope) => matchesScope(scope, path, node, closure[path], family))
        )
      )
        reasons.push(`opaque verifier input: ${path}`);
      queue.push(...node.dependencies);
    }
    const fallback = reasons.length > 0;
    if (fallback && (typeof source !== 'string' || !source))
      throw Error('Complete source identity required for opaque experiment inputs');
    const payload = Object.fromEntries(
      Object.entries(files).filter(
        ([path]) => fallback || family === 'endurance' || path.startsWith('backend/'),
      ),
    );
    boundaries[family] = {
      scope: fallback ? 'all-source' : 'packaged-runtime-and-verifier-closure',
      reasons,
      owners: [...seen].sort(),
    };
    inputs[family] = digest(
      ordered({
        version: 1,
        payload,
        closure,
        runtime,
        experimentRuntime: capacityRuntime ?? null,
        scopes: scopes.filter((scope) => scope.family === family),
        identityImplementation: createHash('sha256')
          .update(read('scripts/playtest/experiment-inputs.mjs'))
          .digest('hex'),
        ...(fallback ? { source } : {}),
      }),
    );
  }
  return { inputs, configuration: digest(ordered(desired)), boundaries };
}

export async function experimentInputs(manifest, desired, { capacityRuntime } = {}) {
  const root = process.cwd(),
    before = sourceIdentity();
  const result = deriveExperimentInputs({
    files: manifest.files,
    desired,
    capacityRuntime,
    scopes:
      JSON.parse(readFileSync(resolve(root, 'scripts/manifest.json'), 'utf8'))
        .experimentInputScopes ?? [],
    roots: {
      endurance: ['scripts/verify-remote-playtest.mjs', 'scripts/playtest/load.mjs'],
      capacity: ['scripts/playtest/load.mjs'],
    },
    graph: buildModuleGraph(root, { purpose: 'test-selection' }),
    read: (path) => readFileSync(resolve(root, path)),
    source: before.workingTreeDigest,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      lock: readFileSync(resolve(root, 'package-lock.json'), 'utf8'),
      package: readFileSync(resolve(root, 'package.json'), 'utf8'),
    },
  });
  if (JSON.stringify(sourceIdentity()) !== JSON.stringify(before))
    throw Error('Source changed during experiment input discovery');
  return result;
}
