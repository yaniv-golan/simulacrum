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
  const unexecuted = [
    ...new Set(
      verification.checks.flatMap((r) =>
        Array.isArray(r.unexecuted) ? r.unexecuted.map((file) => `unit:${file}`) : [],
      ),
    ),
  ].sort();
  const abortedAggregates = verification.results
    .filter((row) => row.status === 'failed')
    .map((row) => row.id)
    .sort();
  return { passing, failed, unexecuted, abortedAggregates };
}

/** Every failed or unexecuted leaf needs its own cause; a failed aggregate may carry one for the
 * leaves that never ran beneath it. Unknown targets are refused. */
export function validateCauses({ failed, unexecuted, abortedAggregates }, causes) {
  if (!(causes instanceof Map) || !causes.size) throw Error('--after needs at least one --cause');
  const required = [...failed, ...unexecuted];
  const missing = required.filter((id) => !causes.has(id));
  if (missing.length) throw Error(`--cause required for each non-pass leaf: ${missing.join(', ')}`);
  const coverage = {};
  for (const [id, text] of causes) {
    if (required.includes(id)) coverage[id] = { aggregate: false, covers: [id] };
    else if (abortedAggregates.includes(id))
      coverage[id] = { aggregate: true, covers: 'leaves that did not run' };
    else
      throw Error(`--cause ${id} names a leaf that passed or does not exist in the parent attempt`);
    if (!text.trim()) throw Error(`--cause ${id} needs a diagnosed cause`);
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
    manifest.browserChecks.some((c) => c.id === checkId) ? `browser:${checkId}` : `gate:${checkId}`;
  for (const id of [...set]) {
    const check = browserId(id) ?? (id.startsWith('gate:') ? id.slice(5) : null),
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
  const parentPassing = new Set(classifyParentLeaves(parent).passing.map((r) => r.id));
  const executed = new Set(receipts.filter((r) => !r.resumed).map((r) => r.id));
  const alwaysFresh = [...reexecute].filter((id) => parentPassing.has(id)).sort();
  const noReceipt = [...parentPassing]
    .filter((id) => !reexecute.has(id) && executed.has(id))
    .sort();
  const after = {
    parentAttempt: parent.attempt,
    parentReport: parent.attemptReport ?? null,
    mode,
    causes: Object.fromEntries(causes),
    coverage,
    reexecuted: [...reexecute].sort(),
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
  if (report.status !== 'passed after failure') {
    if (report.after && report.status === 'passed')
      throw Error('status must be passed after failure when receipts were reused');
    return report;
  }
  const after = report.after;
  if (!after || !attemptId(after.parentAttempt) || !Array.isArray(after.reused))
    throw Error('passed after failure needs a consistent after block');
  const receipts = new Map((report.verification?.checks ?? []).map((r) => [r.id, r]));
  for (const { id, origin } of after.reused)
    if (!receipts.get(id)?.resumed || !attemptId(origin?.attempt))
      throw Error(`reused leaf ${id} has no resumed receipt with an origin attempt`);
  for (const id of after.reexecuted) {
    const r = receipts.get(id);
    if (r && r.resumed) throw Error(`re-executed leaf ${id} was resumed instead of executed`);
  }
  for (const [id, r] of receipts)
    if (r.resumed && !after.reused.some((x) => x.id === id))
      throw Error(`resumed leaf ${id} is missing from the after block`);
  for (const id of Object.keys(after.causes ?? {}))
    if (!after.coverage?.[id]) throw Error(`cause ${id} has no recorded coverage`);
  for (const [id, entry] of Object.entries(after.coverage ?? {}))
    if (!entry.aggregate && !entry.covers.every((leaf) => after.reexecuted.includes(leaf)))
      throw Error(`non-pass leaf ${id} was not re-executed`);
  return report;
}
