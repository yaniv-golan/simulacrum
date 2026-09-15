/** One owner for what an audited opaque read looks like. Selection trusts a metadata row only
 * when every read passes here; the proposal refuses a declaration that would not, naming the
 * read and the field, and the manifest validator refuses a hand-edited row the same way — so a
 * row can never exist that silently widens selection. No imports: selection, proposal and the
 * manifest validator all import this module. */
export const READ_PURPOSES = Object.freeze(['identity', 'fixture', 'runtime', 'source-analysis']);
export const REQUIRED_EXCLUSIONS = Object.freeze(['documentation', 'unit-test']);

/** `{ ok: true }` or `{ ok: false, reason }` for one read; reasons name the field to fix. */
export function classifyRead(read) {
  if (!read || typeof read !== 'object' || Array.isArray(read))
    return { ok: false, reason: 'read is not an object' };
  if (typeof read.expression !== 'string' || !read.expression)
    return { ok: false, reason: 'read has no expression' };
  if (!READ_PURPOSES.includes(read.purpose))
    return {
      ok: false,
      reason: `read \`${read.expression}\` needs purpose in ${READ_PURPOSES.join('|')}`,
    };
  if (
    !Array.isArray(read.excludedInputs) ||
    !read.excludedInputs.every((k) => typeof k === 'string')
  )
    return { ok: false, reason: `read \`${read.expression}\` needs excludedInputs` };
  const unknown = read.excludedInputs.filter((k) => !REQUIRED_EXCLUSIONS.includes(k));
  if (unknown.length)
    return {
      ok: false,
      reason: `read \`${read.expression}\` excludes unknown input kind ${unknown.join(', ')}`,
    };
  const missing = REQUIRED_EXCLUSIONS.filter((k) => !read.excludedInputs.includes(k));
  if (missing.length)
    return {
      ok: false,
      reason: `read \`${read.expression}\` must exclude ${missing.join(' and ')} (excludedInputs)`,
    };
  return { ok: true };
}

/** Every read of a row, in order; `ok` only when all pass. */
export function classifyReads(reads) {
  if (!Array.isArray(reads)) return { ok: false, reasons: ['reads is not an array'] };
  const reasons = reads
    .map(classifyRead)
    .filter((r) => !r.ok)
    .map((r) => r.reason);
  return { ok: reasons.length === 0, reasons };
}

/** The declaration an operator must author for an entrypoint's unclassified reads: every
 * expression with the purpose left to choose and both exclusions already present. */
export function declarationSkeleton(entrypoint, expressions, { checks = [] } = {}) {
  return {
    kind: 'metadata',
    entrypoint,
    reads: [...expressions].sort().map((expression) => ({
      expression,
      purpose: `<one of ${READ_PURPOSES.join('|')}>`,
      excludedInputs: [...REQUIRED_EXCLUSIONS],
    })),
    checks: checks.length ? [...checks] : ['<registered witness check id>'],
  };
}
