/** Diagnosed retry of a failed candidate attempt. Pure decisions; the candidate command wires them.
 * A retry never narrows below the tier's own policy: non-pass leaves, the registered controls of
 * their invariants and every always-fresh class execute; only unit and non-always-fresh browser
 * leaves that passed on identical bytes and relevant identity are reused, each naming its origin. */
export const CHAIN_DEPTH_LIMIT = 3;
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
  return { rest, after, causes: after === null ? null : causes };
}

/** Passing, failed and unexecuted leaves of a completed failed attempt, plus aborted aggregates. */
export function classifyParentLeaves(parent) {
  if (!['failed', 'passed after failure'].includes(parent?.status))
    throw Error(
      '--after needs a completed failed attempt report (or a chained passed-after-failure one)',
    );
  if ((parent.after?.chain?.length ?? 0) >= CHAIN_DEPTH_LIMIT)
    throw Error(`retry chain exceeds ${CHAIN_DEPTH_LIMIT} attempts; run a fresh candidate`);
  const verification = parent.verification;
  if (
    !Array.isArray(verification?.checks) ||
    !Array.isArray(verification.results) ||
    !attemptId(parent.attempt) ||
    typeof parent.directory !== 'string'
  )
    throw Error('parent attempt report is incomplete');
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
  return { passing, failed, unexecuted, unexecutedBy, abortedAggregates };
}

/** Every failed or unexecuted leaf needs its own cause; a failed aggregate may carry one for the
 * leaves that never ran beneath it. Unknown targets are refused. */
export function validateCauses(
  { failed, unexecuted, unexecutedBy = {}, abortedAggregates },
  causes,
) {
  if (!(causes instanceof Map)) throw Error('--after needs --cause entries');
  if (!failed.length && !unexecuted.length) {
    if (causes.size) throw Error('--cause names leaves but nothing failed in the parent attempt');
    return {};
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
  const coverage = {};
  for (const [id, text] of causes) {
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
/** Only unit leaves and browser checks not registered timing-sensitive may carry a receipt
 * forward. Always-fresh is derived: the registered timingSensitive fact plus the structural
 * classes (gates, builds, aggregates, hosted and human bars). */
export function reusableLeaf(id, manifest) {
  if (unitFile(id)) return true;
  const check = browserId(id);
  if (!check) return false;
  const row = manifest.browserChecks.find((c) => c.id === check);
  return !!row && row.timingSensitive !== true;
}

/** Non-pass leaves, the registered controls of their invariants, the checks of invariants a
 * failed control guards, and every structural or timing-sensitive (always-fresh) leaf. */
export function reexecutionSet({ classification, manifest }) {
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
  for (const r of classification.passing) if (!reusableLeaf(r.id, manifest)) set.add(r.id);
  return set;
}

export function afterMode({ sameSource, sameDependencies, sameIdentity }) {
  return sameSource && sameDependencies && sameIdentity ? 'same-bytes' : 'delta';
}

/** The after block and the candidate status. Reuse is evidence only with an origin receipt. */
export function afterSummary({
  parent,
  mode,
  causes,
  coverage,
  reexecute,
  child,
  skippedByDelta = [],
}) {
  const chain = [...(parent.after?.chain ?? []), parent.attempt];
  if (chain.length > CHAIN_DEPTH_LIMIT)
    throw Error(`retry chain exceeds ${CHAIN_DEPTH_LIMIT} attempts; run a fresh candidate`);
  const receipts = child.checks ?? [];
  const reused = receipts
    .filter((r) => r.resumed && r.origin)
    .map((r) => ({ id: r.id, origin: r.origin }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const classification = classifyParentLeaves(parent);
  const parentPassing = new Set(classification.passing.map((r) => r.id));
  const nonPass = new Set([...classification.failed, ...classification.unexecuted]);
  const executed = new Set(receipts.filter((r) => !r.resumed).map((r) => r.id));
  // Split what re-executed and why: the parent's failures, the controls they pulled in, and
  // the timing-sensitive or structural classes that never carry a receipt.
  const alwaysFresh = [...reexecute]
    .filter((id) => parentPassing.has(id) && !id.startsWith('unit:'))
    .sort();
  const controls = [...reexecute].filter((id) => id.startsWith('unit:') && !nonPass.has(id)).sort();
  const noReceipt =
    mode === 'same-bytes'
      ? [...parentPassing].filter((id) => !reexecute.has(id) && executed.has(id)).sort()
      : [];
  const after = {
    parentAttempt: parent.attempt,
    parentReport: parent.attemptReport ?? null,
    mode,
    causes: Object.fromEntries(causes),
    coverage,
    reexecuted: [...reexecute].sort(),
    nonPass: [...nonPass].sort(),
    controls,
    alwaysFresh,
    reused,
    noReceipt,
    skippedByDelta,
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
    if (
      after &&
      report.status === 'passed' &&
      (after.reused?.length || after.skippedByDelta?.length)
    )
      throw Error(
        'status must be passed after failure when receipts were reused or leaves skipped',
      );
    if (after && report.status === 'passed') observeReexecution(after, receipts);
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
/** Re-execution is an observation: every non-pass leaf of the parent and every leaf a cause
 * covers must appear in the child as an executed, passing receipt, never merely as a plan. */
function observeReexecution(after, receipts) {
  for (const id of after.reexecuted ?? []) {
    const r = receipts.get(id);
    if (r && r.resumed) throw Error(`re-executed leaf ${id} was resumed instead of executed`);
  }
  for (const id of Object.keys(after.causes ?? {}))
    if (!after.coverage?.[id]) throw Error(`cause ${id} has no recorded coverage`);
  const mustRun = new Set([
    ...(after.nonPass ?? []),
    ...Object.values(after.coverage ?? {}).flatMap((entry) => entry.covers ?? []),
  ]);
  for (const id of mustRun) {
    const r = receipts.get(id);
    if (!(after.reexecuted ?? []).includes(id) || !r || r.resumed || r.ok !== true)
      throw Error(`non-pass leaf ${id} was not re-executed by this attempt`);
  }
}
