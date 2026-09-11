import { same } from './browser-scope-proposal.mjs';
export function scopeWitnessRequest(proposal) {
  return {
    proposalDigest: proposal.digest,
    scopes: proposal.changes.map((c) => ({ kind: c.kind, witnesses: c.witnesses })),
  };
}
export function validateScopeWitnessResult(proposal, result) {
  if (
    !result?.ok ||
    !same(result.requested, scopeWitnessRequest(proposal)) ||
    !same(result.candidateIdentity, proposal.expected)
  )
    throw Error('Scope witness request or candidate identity mismatch');
  const manifest = JSON.parse(proposal.proposedManifest),
    expected = new Set();
  for (const c of proposal.changes)
    for (const id of c.witnesses) {
      expected.add(`${c.kind === 'local' ? 'browser' : 'scope'}:${id}`);
      const row = manifest.checks.find((r) => r.id === id);
      if (
        c.kind === 'metadata' &&
        row?.module === 'scripts/check-invariant-controls.mjs' &&
        row.export === 'checkInvariantControls'
      )
        for (const invariant of manifest.invariants)
          for (const control of [...invariant.controls.positive, ...invariant.controls.negative])
            expected.add(`unit:${control.path}`);
    }
  if (
    !expected.size ||
    !Array.isArray(result.checks) ||
    result.checks.some((c) => c.ok !== true) ||
    [...expected].some(
      (id) => result.checks.filter((c) => c.id === id && c.ok === true).length !== 1,
    )
  )
    throw Error('Scope witnesses missing successful execution receipts');
}
