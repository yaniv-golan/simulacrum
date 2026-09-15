/** Stacking derived from the repository instead of typed: `merge --stack <ref>` names the
 * earlier integration branch the candidate merged; destination, the pre-integration tip and
 * the base follow from the first-parent history, and the landing order is printed. Pure over
 * an injected `git`; the ordinary merge scope validation (unique merge-base, incoming within
 * HEAD) still runs on the derived values. */
import { execFileSync } from 'node:child_process';

const defaultGit = (args, options = {}) =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], ...options });
const short = (sha) => sha.slice(0, 7);

/** The stack derivation: `{stack, destinationName, destination, incoming, base, head, chain,
 * landingOrder}` or a refusal naming the shas. `incoming` is the last commit of the branch's
 * own first-parent history that does not contain the ref (the pre-integration tip); a branch
 * built linearly on the ref (no merge commit) integrates as a whole, with the ref as base. */
export function deriveStack(ref, git = defaultGit) {
  if (typeof ref !== 'string' || !ref || ref.startsWith('-'))
    throw Error('--stack needs the earlier integration branch name');
  if (ref === 'main')
    throw Error(
      '--stack main is not a stack: a candidate integrating into main uses --base <commit> (with --incoming/--destination for a branch pair)',
    );
  const resolve = (name) => {
    try {
      return git(['rev-parse', '--verify', '--end-of-options', `${name}^{commit}`]).trim();
    } catch {
      throw Error(`--stack ${ref}: ${name} does not resolve to a commit`);
    }
  };
  const isAncestor = (ancestor, descendant) => {
    try {
      git(['merge-base', '--is-ancestor', ancestor, descendant]);
      return true;
    } catch {
      return false;
    }
  };
  const head = resolve('HEAD'),
    destination = resolve(ref);
  if (head === destination)
    throw Error(
      `--stack ${ref}: HEAD is ${ref} @ ${short(destination)}; a stack needs a branch with its own commits`,
    );
  if (!isAncestor(destination, head))
    throw Error(
      `--stack ${ref}: HEAD ${short(head)} does not contain ${ref} @ ${short(destination)}; merge ${ref} into the branch first (re-merge its head if it moved)`,
    );
  const firstParents = git(['rev-list', '--first-parent', head]).split('\n').filter(Boolean);
  const own = firstParents.find((commit) => !isAncestor(destination, commit));
  let incoming, base;
  if (!own || isAncestor(own, destination)) {
    // Linear on the ref: every own commit descends from it; the branch integrates whole.
    incoming = head;
    base = destination;
  } else {
    incoming = own;
    const bases = git(['merge-base', '--all', incoming, destination]).split('\n').filter(Boolean);
    if (bases.length !== 1)
      throw Error(
        `--stack ${ref}: ${short(incoming)} and ${ref} @ ${short(destination)} have ${bases.length} merge-bases (${bases.map(short).join(', ')}); a stack needs one`,
      );
    [base] = bases;
  }
  const chain = { stack: ref, destination, incoming, base, head };
  return {
    stack: ref,
    destinationName: ref,
    destination,
    incoming,
    base,
    head,
    chain,
    landingOrder: [`${ref} @ ${short(destination)}`, `this candidate @ ${short(head)}`],
  };
}
export const landingOrderText = ({ landingOrder }) =>
  `landing order: ${landingOrder.join(', then ')}`;
