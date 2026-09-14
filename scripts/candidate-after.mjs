/** Diagnosed retry of a failed candidate attempt. Pure decisions; the candidate command wires them.
 * A retry applies the tier's own policy to what changed: non-pass leaves, the registered controls
 * of their invariants and every always-fresh class execute; only unit and non-always-fresh browser
 * leaves that passed on identical bytes and relevant identity are reused, each naming its origin.
 * When bytes differ, the tier's selection sees the byte delta only if identity and dependencies
 * still match; otherwise it runs its fresh policy. */
import { createHmac, timingSafeEqual } from 'node:crypto';
export const CHAIN_DEPTH_LIMIT = 3;
const attestationOf = (report, key) => {
  const { attestation, ...rest } = report;
  return createHmac('sha256', key).update(JSON.stringify(rest)).digest('hex');
};
/** HMAC of the report under the candidate's resume key; the report is published with it. The key
 * lives 0600 in the candidate directory: this is the same same-UID trust class as the signed
 * descriptor and leaf receipts (see verification-resume.mjs) — it refuses an edited or re-pointed
 * report unless the editor holds the candidate's key, not proof against the key's owner. */
export function attestReport(report, key) {
  return attestationOf(report, key);
}
/** A parent report is admitted only when the key in its own candidate directory attests it. */
export function verifyAttestation(parent, readKey) {
  if (typeof parent?.attestation !== 'string' || typeof parent.directory !== 'string')
    throw Error('parent attempt report is not attested by its candidate; run a fresh candidate');
  let key;
  try {
    key = readKey();
  } catch {
    throw Error('parent candidate directory or resume key is unavailable; run a fresh candidate');
  }
  const expected = Buffer.from(attestationOf(parent, key), 'hex'),
    given = Buffer.from(parent.attestation, 'hex');
  if (expected.length !== given.length || !timingSafeEqual(expected, given))
    throw Error('parent attempt report attestation does not match its candidate key');
  return true;
}
export const CANDIDATE_CAUSE = 'candidate';
const usage =
  'Usage: verify:candidate -- <tier> [tier options] --after <attemptReport.json> --cause <checkId>=<diagnosed cause> [--cause ...]';
const attemptId = (v) => /^[\da-f-]{36}$/.test(v ?? '');

/** Strip --after/--cause from the tier arguments. Causes keep their order and refuse empty text. */
export function parseAfterArgs(argv) {
  const rest = [],
    causes = new Map();
  let after = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--after') {
      if (after !== null || !argv[i + 1] || argv[i + 1].startsWith('-'))
        throw Error(`${usage}\n--after needs one report path`);
      after = argv[++i];
    } else if (arg === '--cause') {
      const value = argv[++i] ?? '',
        eq = value.indexOf('=');
      const id = value.slice(0, eq).trim(),
        text = value.slice(eq + 1).trim();
      if (eq <= 0 || !id || !text || causes.has(id))
        throw Error(`${usage}\n--cause needs <checkId>=<non-empty diagnosed cause>, once per id`);
      causes.set(id, text);
    } else rest.push(arg);
  }
  if (after === null && causes.size) throw Error(`${usage}\n--cause needs --after`);
  if (after !== null && rest[0] === 'resume')
    throw Error('--after cannot be combined with resume; retry from the failed attempt report');
  if (after !== null && rest[0] === 'final')
    throw Error('--after is refused for final; qualification evidence is always a fresh full run');
  return { rest, after, causes: after === null ? null : causes };
}

/** Passing, failed and unexecuted leaves of a completed failed attempt, plus aborted aggregates
 * and whether the candidate itself failed around the tier (drift, dependencies, window). */
export function classifyParentLeaves(parent) {
  if (parent?.status !== 'failed')
    throw Error('--after needs a failed attempt report; a passed attempt has nothing to retry');
  if ((parent.after?.chain?.length ?? 0) >= CHAIN_DEPTH_LIMIT)
    throw Error(`retry chain exceeds ${CHAIN_DEPTH_LIMIT} attempts; run a fresh candidate`);
  const verification = parent.verification;
  if (
    !Array.isArray(verification?.checks) ||
    !Array.isArray(verification.results) ||
    !attemptId(parent.attempt) ||
    typeof parent.directory !== 'string'
  )
    throw Error(
      'parent attempt report has no tier receipts to retry from (it failed before the tier completed); run a fresh candidate',
    );
  const passing = verification.checks.filter((r) => r.ok === true);
  const failed = verification.checks.filter((r) => r.ok === false).map((r) => r.id);
  // Files a budget-bound aggregate never admitted, keyed by the leaf that listed them.
  const unexecutedBy = {};
  for (const r of verification.checks)
    if (Array.isArray(r.unexecuted) && r.unexecuted.length)
      unexecutedBy[r.id] = r.unexecuted.map((file) => `unit:${file}`).sort();
  const unexecuted = [...new Set(Object.values(unexecutedBy).flat())].sort();
  const abortedAggregates = verification.results
    .filter((row) => row.status === 'failed')
    .map((row) => row.id)
    .sort();
  // A candidate-level failure (drift, dependency change, window) leaves no failed leaf behind;
  // it is a cause of its own, named `candidate`.
  const candidateFailure =
    typeof parent.error === 'string' && parent.error.trim() ? parent.error.trim() : null;
  return { passing, failed, unexecuted, unexecutedBy, abortedAggregates, candidateFailure };
}

/** Every failed or unexecuted leaf needs its own cause; a failed aggregate may carry one for the
 * leaves that never ran beneath it (optional: each such leaf may carry its own instead). A
 * candidate-level failure needs `--cause candidate=<reason>`. Unknown targets are refused. */
export function validateCauses(
  { failed, unexecuted, unexecutedBy = {}, abortedAggregates, candidateFailure = null },
  causes,
) {
  if (!(causes instanceof Map)) throw Error('--after needs --cause entries');
  const coverage = {};
  if (candidateFailure) {
    if (!causes.has(CANDIDATE_CAUSE))
      throw Error(
        `--cause ${CANDIDATE_CAUSE}=<reason> required: the parent attempt failed around the tier (${candidateFailure})`,
      );
    coverage[CANDIDATE_CAUSE] = { aggregate: false, covers: [], candidateFailure };
  } else if (causes.has(CANDIDATE_CAUSE))
    throw Error(`--cause ${CANDIDATE_CAUSE} names a candidate failure the parent did not report`);
  if (!failed.length && !unexecuted.length) {
    const extra = [...causes.keys()].filter((id) => id !== CANDIDATE_CAUSE);
    if (extra.length)
      throw Error(
        `--cause names leaves but nothing failed in the parent attempt: ${extra.join(', ')}`,
      );
    if (!candidateFailure)
      throw Error(
        'the parent attempt reports no failed leaf and no candidate failure; nothing to retry (a cause on an aborted phase only accompanies failed leaves)',
      );
    return coverage;
  }
  // An unexecuted file is covered by its own cause or by a cause on the leaf that listed it.
  const coveredByAggregate = new Set(
    Object.entries(unexecutedBy).flatMap(([id, files]) => (causes.has(id) ? files : [])),
  );
  const missing = [
    ...failed.filter((id) => !causes.has(id)),
    ...unexecuted.filter((id) => !causes.has(id) && !coveredByAggregate.has(id)),
  ];
  if (missing.length) throw Error(`--cause required for each non-pass leaf: ${missing.join(', ')}`);
  for (const [id, text] of causes) {
    if (id === CANDIDATE_CAUSE) continue;
    if (!text.trim()) throw Error(`--cause ${id} needs a diagnosed cause`);
    if (failed.includes(id))
      coverage[id] = unexecutedBy[id]
        ? { aggregate: true, covers: unexecutedBy[id] }
        : { aggregate: false, covers: [id] };
    else if (unexecuted.includes(id)) coverage[id] = { aggregate: false, covers: [id] };
    else if (abortedAggregates.includes(id)) coverage[id] = { aggregate: true, covers: [] };
    else
      throw Error(`--cause ${id} names a leaf that passed or does not exist in the parent attempt`);
  }
  return coverage;
}

const browserId = (id) => (id.startsWith('browser:') ? id.slice('browser:'.length) : null);
const unitFile = (id) => (id.startsWith('unit:') ? id.slice('unit:'.length) : null);
/** Only unit leaves and browser checks registered neither timing-sensitive nor as merge smoke
 * may carry a receipt forward. Always-fresh is derived: the registered timingSensitive and
 * mergeSmoke facts plus the structural classes (gates, builds, aggregates, hosted and human bars). */
export function reusableLeaf(id, manifest) {
  if (unitFile(id)) return true;
  const check = browserId(id);
  if (!check) return false;
  const row = manifest.browserChecks.find((c) => c.id === check);
  return !!row && row.timingSensitive !== true && row.mergeSmoke !== true;
}

/** Leaves a retry must observe executing and passing: non-pass leaves, the registered controls
 * of their invariants and the checks of invariants a failed control guards. */
export function requiredReexecution({ classification, manifest }) {
  const set = new Set([...classification.failed, ...classification.unexecuted]);
  const invariants = manifest.invariants ?? [];
  const controlsOf = (invariant) =>
    [...invariant.controls.positive, ...invariant.controls.negative].map((c) => `unit:${c.path}`);
  const leafOfCheck = (checkId) =>
    manifest.browserChecks.some((c) => c.id === checkId)
      ? `browser:${checkId}`
      : `check:${checkId}`;
  for (const id of [...set]) {
    const check = browserId(id) ?? (id.startsWith('check:') ? id.slice(6) : null),
      file = unitFile(id);
    for (const invariant of invariants) {
      if (check && invariant.checks?.includes(check))
        for (const c of controlsOf(invariant)) set.add(c);
      if (
        file &&
        [...invariant.controls.positive, ...invariant.controls.negative].some(
          (c) => c.path === file,
        )
      )
        for (const checkId of invariant.checks ?? []) set.add(leafOfCheck(checkId));
    }
  }
  return set;
}

/** The required set plus every passing leaf that never carries a receipt (always fresh). */
export function reexecutionSet({ classification, manifest }) {
  const set = requiredReexecution({ classification, manifest });
  for (const r of classification.passing) if (!reusableLeaf(r.id, manifest)) set.add(r.id);
  return set;
}

export function afterMode({ sameSource, sameDependencies, sameIdentity }) {
  return sameSource && sameDependencies && sameIdentity ? 'same-bytes' : 'delta';
}
/** In delta mode the tier's selection sees the byte delta only when identity and installed
 * dependencies are unchanged; a new runtime, platform, dependency set or relevant environment
 * invalidates every parent browser pass, so the tier runs its ordinary fresh policy. */
export function deltaSelection({ sameDependencies, sameIdentity }) {
  return sameDependencies && sameIdentity ? 'source-only' : 'fresh-policy';
}

/** A source-only delta retry never runs less than the tier's fresh policy would, except for checks
 * the parent attempt already passed (`covered`) that the delta does not reach: those are skipped
 * by reasoning and named. `fresh` is the tier's own selection for the candidate's base diff,
 * `narrow` the same policy applied to the byte delta between the two candidates, `required` the
 * re-execution the retry must observe. Anything the fresh policy selects that the parent never
 * passed executes; fallbacks (unknown inputs, risky paths) in either selection select everything. */
export function resolveRetrySelection({ fresh, narrow, required = [], covered = [], checks }) {
  const registry = new Map(checks.map((c) => [c.id, c]));
  const freshIds = fresh.checks.map((c) => c.id);
  const narrowIds = new Set(narrow.checks.map((c) => c.id));
  const coveredIds = new Set(covered),
    requiredIds = new Set(required);
  const keep = (id) => narrowIds.has(id) || requiredIds.has(id) || !coveredIds.has(id);
  const skippedByDelta = freshIds.filter((id) => !keep(id)).sort();
  const ids = [...freshIds.filter(keep), ...[...narrowIds].filter((id) => !freshIds.includes(id))];
  const rows = ids.map(
    (id) => registry.get(id) ?? [...fresh.checks, ...narrow.checks].find((c) => c.id === id),
  );
  // The resolved selection keeps the fresh policy's own metadata (scope, files, fallback); the
  // delta's is reported under `delta` so nothing downstream mistakes Δ for the base scope.
  const widened = withRequiredChecks(
    {
      ...fresh,
      fresh: { scope: fresh.scope, fallback: fresh.fallback ?? null, checks: freshIds },
      delta: {
        scope: narrow.scope ?? null,
        fallback: narrow.fallback ?? null,
        files: narrow.files ?? null,
        checks: [...narrowIds].sort(),
      },
      checks: rows,
    },
    required,
    checks,
  );
  return {
    ...widened,
    reasons: [
      ...(fresh.reasons ?? []).filter((r) => keep(r.id)),
      ...(narrow.reasons ?? []).filter((r) => !freshIds.includes(r.id)),
      ...(widened.reasons ?? []).filter((r) => /required re-execution/.test(r.reason)),
    ],
    skippedByDelta,
    covered: [...coveredIds].sort(),
  };
}

/** Browser check ids the tier must add to its own selection: required re-execution is a widening
 * of the tier's policy, never a narrowing. Rows are the registered checks. */
export function withRequiredChecks(selection, required, checks) {
  const ids = new Set((selection.checks ?? []).map((c) => c.id));
  const added = [];
  for (const id of [...new Set(required)].sort()) {
    if (ids.has(id)) continue;
    const row = checks.find((c) => c.id === id);
    if (!row) throw Error(`required re-execution names an unregistered browser check: ${id}`);
    added.push(row);
  }
  if (!added.length) return selection;
  return {
    ...selection,
    checks: [...(selection.checks ?? []), ...added],
    reasons: [
      ...(selection.reasons ?? []),
      ...added.map((row) => ({ id: row.id, reason: 'diagnosed retry: required re-execution' })),
    ],
    required: added.map((row) => row.id),
  };
}

/** The after block and the candidate status. Reuse is evidence only with an origin receipt. */
export function afterSummary({
  parent,
  mode,
  causes,
  coverage,
  reexecute,
  required,
  child,
  skippedByDelta = [],
  covered = [],
  deltaSelection: deltaKind = null,
}) {
  const chain = [...(parent.after?.chain ?? []), parent.attempt];
  if (chain.length > CHAIN_DEPTH_LIMIT)
    throw Error(`retry chain exceeds ${CHAIN_DEPTH_LIMIT} attempts; run a fresh candidate`);
  const receipts = child.checks ?? [];
  // Every resumed receipt counts as reuse, with or without an origin; validation refuses the
  // ones that cannot name theirs.
  const reused = receipts
    .filter((r) => r.resumed)
    .map((r) => ({ id: r.id, origin: r.origin ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const classification = classifyParentLeaves(parent);
  const parentPassing = new Set(classification.passing.map((r) => r.id));
  const nonPass = new Set([...classification.failed, ...classification.unexecuted]);
  const executed = new Set(receipts.filter((r) => !r.resumed).map((r) => r.id));
  // Split what re-executed and why: the parent's failures, the controls they pulled in, and
  // the timing-sensitive or structural classes that never carry a receipt.
  const alwaysFresh = [...reexecute]
    .filter((id) => parentPassing.has(id) && !required.has(id))
    .sort();
  const controls = [...required].filter((id) => id.startsWith('unit:') && !nonPass.has(id)).sort();
  const noReceipt =
    mode === 'same-bytes'
      ? [...parentPassing].filter((id) => !reexecute.has(id) && executed.has(id)).sort()
      : [];
  // Re-executed is what the child observed running, never the plan; planned always-fresh
  // leaves the tier's own policy did not select are named separately.
  const after = {
    parentAttempt: parent.attempt,
    parentReport: parent.attemptReport ?? null,
    mode,
    ...(mode === 'delta' ? { deltaSelection: deltaKind } : {}),
    causes: Object.fromEntries(causes),
    coverage,
    reexecuted: [...reexecute].filter((id) => executed.has(id)).sort(),
    notSelected: [...reexecute].filter((id) => !executed.has(id) && !required.has(id)).sort(),
    required: [...required].sort(),
    nonPass: [...nonPass].sort(),
    controls,
    alwaysFresh,
    reused,
    noReceipt,
    skippedByDelta,
    covered: [...covered].sort(),
    chain,
  };
  const status =
    child.status !== 'passed'
      ? 'failed'
      : reused.length || skippedByDelta.length
        ? 'passed after failure'
        : 'passed';
  return { status, after };
}

/** A passed-after-failure report must carry a block consistent with the child receipts. */
export function validateAfterReport(report) {
  const after = report.after,
    receipts = new Map((report.verification?.checks ?? []).map((r) => [r.id, r]));
  if (report.status !== 'passed after failure') {
    if (after && report.status === 'passed') {
      if (after.reused?.length || after.skippedByDelta?.length)
        throw Error(
          'status must be passed after failure when receipts were reused or leaves skipped',
        );
      for (const [id, r] of receipts)
        if (r.resumed) throw Error(`retry reports passed with a resumed receipt: ${id}`);
      observeReexecution(after, receipts);
    }
    return report;
  }
  if (!after || !attemptId(after.parentAttempt) || !Array.isArray(after.reused))
    throw Error('passed after failure needs a consistent after block');
  observeReexecution(after, receipts);
  for (const { id, origin } of after.reused)
    if (!receipts.get(id)?.resumed || !attemptId(origin?.attempt))
      throw Error(`reused leaf ${id} has no resumed receipt with an origin attempt`);
  for (const [id, r] of receipts)
    if (r.resumed && !after.reused.some((x) => x.id === id))
      throw Error(`resumed leaf ${id} is missing from the after block`);
  return report;
}
/** Re-execution is an observation: every non-pass leaf of the parent, every leaf a cause covers
 * and every invariant-derived leaf must appear in the child as an executed, passing receipt,
 * never merely as a plan; nothing re-executed may also be listed as skipped by delta. */
function observeReexecution(after, receipts) {
  for (const id of after.reexecuted ?? []) {
    const r = receipts.get(id);
    if (r && r.resumed) throw Error(`re-executed leaf ${id} was resumed instead of executed`);
  }
  const skipped = new Set((after.skippedByDelta ?? []).map((row) => row.id));
  for (const id of after.reexecuted ?? [])
    if (skipped.has(id)) throw Error(`leaf ${id} is both re-executed and skipped by delta`);
  // A skipped leaf is reasoning on a parent receipt: it must be one the parent covered, and
  // the child must not have run it.
  const covered = new Set(after.covered ?? []);
  for (const id of skipped) {
    if (!covered.has(id)) throw Error(`leaf ${id} was skipped by delta without parent coverage`);
    if (receipts.has(id)) throw Error(`leaf ${id} was skipped by delta but has a child receipt`);
  }
  for (const id of Object.keys(after.causes ?? {}))
    if (!after.coverage?.[id]) throw Error(`cause ${id} has no recorded coverage`);
  const mustRun = new Set([
    ...(after.nonPass ?? []),
    ...(after.required ?? []),
    ...Object.values(after.coverage ?? {}).flatMap((entry) => entry.covers ?? []),
  ]);
  for (const id of mustRun) {
    const r = receipts.get(id);
    if (!(after.reexecuted ?? []).includes(id) || !r || r.resumed || r.ok !== true)
      throw Error(`non-pass leaf ${id} was not re-executed by this attempt`);
  }
}
