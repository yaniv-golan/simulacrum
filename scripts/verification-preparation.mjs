import { assertRuntime, assertLocalServerAccess } from './runtime-preflight.mjs';
import { prepareScopeProposal, same } from './browser-scope-proposal.mjs';
import { applyScopeProposal } from './browser-scope-apply.mjs';
import { candidateIdentity } from './candidate.mjs';
import { documentationReport } from './check-documentation.mjs';
import { refreshReference } from './development-reference.mjs';
import { reviewSections } from './documentation.mjs';
const defaults = {
  runtime: assertRuntime,
  environment: assertLocalServerAccess,
  identity: candidateIdentity,
  proposal: prepareScopeProposal,
  apply: applyScopeProposal,
  generate: refreshReference,
  documentation: documentationReport,
  review: reviewSections,
};
function requireFreshRegistry(proposal) {
  if (!proposal.blocked.length && !proposal.changes.length) return;
  // Rows without a witness list are treated as stale; only an explicit empty list is review-only.
  const reviewOnly = proposal.changes.filter(
      (r) => Array.isArray(r.witnesses) && !r.witnesses.length,
    ),
    stale = proposal.changes.filter((r) => !reviewOnly.includes(r));
  const parts = [
    ...(proposal.blocked.length || stale.length
      ? [
          `Browser registry is stale: ${[...proposal.blocked, ...stale.map((r) => `${r.kind}:${r.entrypoint}`)].join('; ')}`,
          ...(proposal.declarationSkeletons
            ? [
                `Unclassified reads need a declaration; browser:scopes -- prepare --out <proposal.json> writes a skeleton next to the proposal for: ${proposal.declarationSkeletons.map((s) => s.entrypoint).join(', ')}`,
              ]
            : []),
        ]
      : []),
    ...(reviewOnly.length
      ? [
          `Browser scope review required (no witnesses): ${reviewOnly.map((r) => `${r.kind}:${r.entrypoint}`).join('; ')}`,
        ]
      : []),
  ];
  throw Error(
    `${parts.join('. ')}. Run npm run verify:prepare and review its scope proposal before capture.`,
  );
}
/** Read-only, uncached origin preflight. Does not install, regenerate, or execute witnesses. */
export async function assertVerificationReady(root = process.cwd(), overrides = {}) {
  const d = { ...defaults, ...overrides };
  d.runtime();
  const before = d.identity(root);
  requireFreshRegistry(d.proposal(root));
  const docs = await d.documentation(root);
  if (docs.value.errors.length)
    throw Error(
      `Documentation preflight failed: ${docs.value.errors.join('; ')}. Run npm run verify:prepare before capture.`,
    );
  const after = d.identity(root);
  if (!same(before, after))
    throw Error('Source changed during readiness inspection; rerun preparation.');
  return { status: 'READY', source: after };
}
/** Single writer required. One ordered pass; unresolved decisions stop the pass. */
export async function prepareVerification(root = process.cwd(), options = {}, overrides = {}) {
  const d = { ...defaults, ...overrides };
  d.runtime();
  await d.environment();
  const proposal = d.proposal(root, options.declarations ?? [], { base: options.base ?? null });
  if (proposal.blocked.length) return { status: 'BLOCKED_SCOPE', proposal };
  if (proposal.changes.length) {
    if (!options.scopeReview) return { status: 'NEEDS_SCOPE_REVIEW', proposal };
    await d.apply(root, proposal, options.scopeReview);
    requireFreshRegistry(d.proposal(root));
  }
  d.generate(root);
  const reviewSource = d.identity(root);
  if (options.documentationReview) {
    if (!same(options.documentationReview.source, reviewSource))
      throw Error(
        'Documentation review source changed; inspect the new preparation report and submit fresh decisions.',
      );
    d.review(root, options.documentationReview.decisions);
  }
  const beforeInspection = d.identity(root);
  const docs = await d.documentation(root);
  if (!same(beforeInspection, d.identity(root)))
    throw Error('Source changed during documentation inspection; rerun preparation.');
  if (docs.value.errors.length)
    return {
      status: 'NEEDS_DOCUMENTATION_REVIEW',
      source: d.identity(root),
      documentation: docs.value,
    };
  return assertVerificationReady(root, d);
}
