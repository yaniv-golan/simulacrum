// One policy for local and GitHub publishers. Evidence reuse is not a fresh pass.
import { createHash } from 'node:crypto';
const families = ['endurance', 'capacity'];
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function validateProfile(profile) {
  if (
    profile?.schema !== 1 ||
    !hash(profile.calibration?.evidence) ||
    typeof profile.calibration.browserVersion !== 'string' ||
    !profile.calibration.browserVersion.trim()
  )
    throw Error(
      'Measured calibration profile required; use an explicit bypass for an unqualified preview',
    );
  if (
    !Number.isInteger(profile.enduranceSeconds) ||
    profile.enduranceSeconds < 360 ||
    profile.enduranceSeconds > 1800 ||
    !Number.isInteger(profile.capacitySeconds) ||
    profile.capacitySeconds < 120 ||
    profile.capacitySeconds > 600
  )
    throw Error('Invalid experiment duration');
  if (
    !Number.isSafeInteger(profile.maxAgeMs) ||
    profile.maxAgeMs <= 0 ||
    profile.maxAgeMs > 30 * 86400000
  )
    throw Error('Invalid evidence age');
  for (const key of ['maxMediaBytesPerSecond', 'maxEventsPerSecond', 'maxChunkBytes'])
    if (
      !(
        Number.isFinite(profile.calibration.workload?.[key]) &&
        profile.calibration.workload[key] > 0
      )
    )
      throw Error('Calibrated workload bounds required');
  return profile;
}
export function experimentIdentity(family, context) {
  validateProfile(context.profile);
  if (
    !families.includes(family) ||
    !hash(context.inputs?.[family]) ||
    !hash(context.configuration) ||
    !['staging', 'production'].includes(context.environment)
  )
    throw Error('Experiment input identity required');
  return digest({
    family,
    inputs: context.inputs[family],
    configuration: context.configuration,
    environment: context.environment,
    profile: digest(context.profile),
  });
}
export function experimentReceipt(family, context, measurement, measuredAt = Date.now()) {
  const receipt = {
    schema: 1,
    family,
    status: 'PASS',
    artifact: context.artifact,
    identity: experimentIdentity(family, context),
    configuration: context.configuration,
    environment: context.environment,
    profile: digest(context.profile),
    measuredAt,
    expires: measuredAt + context.profile.maxAgeMs,
    measurement,
  };
  return { ...receipt, id: digest(receipt) };
}
function validReceipt(receipt, family, context, now) {
  if (
    !receipt ||
    receipt.schema !== 1 ||
    receipt.family !== family ||
    receipt.status !== 'PASS' ||
    !hash(receipt.artifact) ||
    !receipt.measurement ||
    receipt.environment !== context.environment ||
    receipt.configuration !== context.configuration ||
    receipt.profile !== digest(context.profile) ||
    receipt.identity !== experimentIdentity(family, context) ||
    !Number.isFinite(receipt.measuredAt) ||
    receipt.measuredAt > now ||
    !Number.isFinite(receipt.expires) ||
    receipt.expires <= now ||
    receipt.expires !== receipt.measuredAt + context.profile.maxAgeMs
  )
    return false;
  const { id, ...body } = receipt;
  return id === digest(body);
}
// Coordinator failures intentionally contain only these durable fields; local
// evidence may retain diagnostics. Compare their common immutable identity first.
export function normalizeExperimentEvidence(records) {
  if (!Array.isArray(records)) throw Error('Experiment evidence array required');
  const canonical = (value) =>
    JSON.stringify(value, (_, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
        : v,
    );
  const byId = new Map();
  const fields = ['id', 'family', 'status', 'identity', 'artifact', 'measuredAt', 'reason'];
  for (const record of records) {
    if (
      !record ||
      typeof record.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(record.id) ||
      !families.includes(record.family) ||
      !['PASS', 'FAIL'].includes(record.status) ||
      !hash(record.identity) ||
      !hash(record.artifact) ||
      !Number.isFinite(record.measuredAt) ||
      record.measuredAt < 0 ||
      (record.status === 'FAIL' &&
        (typeof record.reason !== 'string' || !record.reason.trim() || record.reason.length > 1000))
    )
      throw Error('Invalid experiment evidence');
    const previous = byId.get(record.id);
    if (previous) {
      const comparable = (r) =>
        r.status === 'FAIL' ? Object.fromEntries(fields.map((key) => [key, r[key]])) : r;
      if (canonical(comparable(previous)) !== canonical(comparable(record)))
        throw Error('Conflicting experiment evidence ID');
      if (Object.keys(record).length > Object.keys(previous).length) byId.set(record.id, record);
    } else byId.set(record.id, record);
  }
  return [...byId.values()];
}
export function selectExperiments(context) {
  const {
    mode = 'auto',
    reason,
    evidence = [],
    acknowledgeFailures = [],
    now = Date.now(),
  } = context;
  if (!['auto', 'full', 'bypass-expensive'].includes(mode)) throw Error('Unknown experiment mode');
  if (!Array.isArray(evidence) || !Array.isArray(acknowledgeFailures))
    throw Error('Invalid experiment evidence');
  const failures = evidence.filter((r) => r?.status === 'FAIL');
  // A known failure remains visible until a later matching actual pass supersedes it.
  const unresolved = failures.filter(
    (f) =>
      !Number.isFinite(f.measuredAt) ||
      !evidence.some(
        (r) =>
          context.profile &&
          validReceipt(r, f.family, context, now) &&
          r.identity === f.identity &&
          r.measuredAt > f.measuredAt,
      ),
  );
  if (mode === 'bypass-expensive') {
    if (typeof reason !== 'string' || !reason.trim() || reason.length > 2000)
      throw Error('Explicit bypass reason required');
    for (const f of unresolved)
      if (!f.id || !acknowledgeFailures.includes(f.id))
        throw Error(`Explicitly acknowledge known failure ${f.id || 'invalid failure record'}`);
    return {
      mode,
      smokeSeconds: 60,
      run: [],
      results: Object.fromEntries(
        families.map((f) => [f, { status: 'NOT_RUN', reason: 'explicit exception' }]),
      ),
      exception: { reason: reason.trim(), acknowledgeFailures },
    };
  }
  validateProfile(context.profile);
  const run = [],
    results = {};
  for (const family of families) {
    const receipt =
      mode === 'auto' && !unresolved.some((f) => f.family === family)
        ? evidence
            .filter((r) => validReceipt(r, family, context, now))
            .sort((a, b) => b.measuredAt - a.measuredAt)[0]
        : null;
    if (receipt) results[family] = { status: 'REUSED', receipt };
    else {
      run.push(family);
      results[family] = { status: 'NOT_RUN', reason: 'fresh evidence required' };
    }
  }
  return { mode, smokeSeconds: 60, run, results };
}
export function validateExperimentReceiptIntegrity(receipt) {
  if (
    !receipt ||
    receipt.schema !== 1 ||
    !families.includes(receipt.family) ||
    receipt.status !== 'PASS' ||
    !hash(receipt.id) ||
    !hash(receipt.artifact) ||
    !hash(receipt.identity) ||
    !hash(receipt.configuration) ||
    !hash(receipt.profile) ||
    !['staging', 'production'].includes(receipt.environment) ||
    !Number.isFinite(receipt.measuredAt) ||
    receipt.measuredAt < 0 ||
    !Number.isFinite(receipt.expires) ||
    receipt.expires <= receipt.measuredAt ||
    !receipt.measurement
  )
    throw Error('Experiment receipt required');
  const { id, ...body } = receipt;
  if (id !== digest(body)) throw Error('Invalid experiment receipt');
  return receipt;
}
export function verifyExperimentResults(results, now = Date.now()) {
  for (const family of families) {
    const result = results?.[family];
    if (!['PASS', 'REUSED'].includes(result?.status))
      throw Error('Endurance/capacity qualification missing');
    const receipt = validateExperimentReceiptIntegrity(result.receipt);
    if (receipt.family !== family) throw Error('Experiment receipt required');
    if (receipt.expires <= now || receipt.measuredAt > now)
      throw Error('Invalid or expired experiment receipt');
  }
}
export function experimentReservation(plan, profile) {
  const capacity = plan.run.includes('capacity'),
    endurance = plan.run.includes('endurance');
  return {
    slots: capacity ? 20 : 2,
    bytes: capacity ? 20 * 1024 ** 3 : endurance ? 2 * 1024 ** 3 : 32 * 1024 ** 2,
    metadataBytes: capacity ? 1024 ** 3 : endurance ? 128 * 1024 ** 2 : 4 * 1024 ** 2,
    requiredMs:
      ((endurance ? profile.enduranceSeconds : plan.smokeSeconds) +
        (capacity ? profile.capacitySeconds + 180 : 0) +
        1200) *
      1000,
  };
}

// Explicitly environment-specific deployment addresses do not change capture laws.
// Every other config field, including unknown future fields and limits, stays bound.
export function behaviorConfiguration(worker) {
  const value = structuredClone(worker);
  for (const key of ['name', 'account_id', 'main', 'routes', 'workers_dev', 'preview_urls'])
    delete value[key];
  if (value.vars) delete value.vars.ALLOWED_ORIGIN;
  if (value.assets) delete value.assets.directory;
  for (const bucket of value.r2_buckets || []) delete bucket.bucket_name;
  const order = (v) =>
    Array.isArray(v)
      ? v.map(order)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, order(x)]),
          )
        : v;
  return digest(order(value));
}
export function stagingResults(evidence, artifact, worker, profile, now = Date.now()) {
  validateProfile(profile);
  if (
    evidence?.schema !== 2 ||
    evidence.environment !== 'staging' ||
    evidence.artifact !== artifact ||
    evidence.smoke?.status !== 'PASS' ||
    evidence.behaviorConfiguration !== behaviorConfiguration(worker)
  )
    throw Error('Staging capture configuration incompatible with production');
  verifyExperimentResults(evidence.experiments, now);
  for (const family of families) {
    const receipt = evidence.experiments[family].receipt;
    if (
      receipt.profile !== digest(profile) ||
      !Number.isFinite(receipt.measuredAt) ||
      receipt.measuredAt > now ||
      receipt.expires !== receipt.measuredAt + profile.maxAgeMs
    )
      throw Error('Staging experiment profile incompatible with production');
  }
  return Object.fromEntries(
    families.map((f) => [
      f,
      {
        status: 'REUSED',
        receipt: evidence.experiments[f].receipt,
        scope: 'staging-performance; production smoke required',
      },
    ]),
  );
}
