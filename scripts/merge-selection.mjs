import { measuredScopeReached } from './browser-selection.mjs';
import { readFileSync } from 'node:fs';
import { parseExpressionAt } from 'acorn';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { execFileSync } from 'node:child_process';
import { integrationChanges } from './merge-shadow.mjs';

/** Routine merge selection never evaluates release or milestone qualification. */
export function mergeSelection({
  checks,
  selection,
  files,
  reviewOnlyFiles = [],
  metadataOnlyFiles = [],
}) {
  const ids = new Set(checks.map((check) => check.id));
  if (
    ids.size !== checks.length ||
    checks.filter((check) => check.mergeSmoke === true).length !== 3
  )
    throw Error('Invalid merge registry: require unique checks and exactly three mergeSmoke rows');
  if (
    !selection ||
    !Array.isArray(selection.checks) ||
    selection.checks.some((check) => !ids.has(check.id))
  )
    throw Error('Invalid affected merge selection');
  const risky = (files ?? []).find(
    (path) =>
      /^src\/(?:model|simulation|core|scripting)\//.test(path) ||
      (/^(?:scripts|\.github)\//.test(path) &&
        !(path === 'scripts/manifest.json' && metadataOnlyFiles.includes(path))) ||
      (path.startsWith('docs/development/') &&
        !/^docs\/development\/\.reviews\/[\w-]+\/[\w-]+\.json$/.test(path) &&
        !(/^docs\/development\/[\w./-]+\.md$/.test(path) && reviewOnlyFiles.includes(path))) ||
      (!path.includes('/') && !['README.md', 'LICENSE', 'LICENSE.md'].includes(path)),
  );
  const fullReason = risky
    ? `shared runtime, configuration or verification policy: ${risky} (timing-budget rows by measured scope)`
    : !files?.length
      ? 'changed files unavailable'
      : selection.fallback ||
        (!['local-contract', 'documentation', 'non-runtime'].includes(selection.scope)
          ? 'unaudited affected scope'
          : null);
  const affected = new Set(selection.checks.map((check) => check.id));
  // A timing-budget row runs in a merge tier when the delta can reach what it measures: its
  // own import closure, or the runtime files of its class. Otherwise it is omitted with the
  // reason — final and a local all-checks run execute every row regardless.
  const outOfMeasuredScope = (check) =>
    check.timingSensitive === true &&
    Boolean(files?.length) && // an unknown delta cannot be said to miss anything
    !measuredScopeReached(check, files, selection.closureReached ?? {});
  const chosen = checks.filter(
    (check) =>
      (fullReason && !outOfMeasuredScope(check)) ||
      check.mergeSmoke === true ||
      (affected.has(check.id) && !outOfMeasuredScope(check)),
  );
  const chosenIds = new Set(chosen.map((check) => check.id));
  return {
    mode: 'MERGE_ONLY',
    qualification: 'NOT_EVALUATED',
    files,
    fullReason,
    scope: fullReason ? 'full' : selection.scope,
    checks: chosen,
    selected: chosen.map((check) => ({
      ...check,
      reason:
        fullReason ||
        (check.mergeSmoke === true
          ? 'registered merge smoke'
          : 'existing audited affected selection'),
    })),
    omitted: checks
      .filter((check) => !chosenIds.has(check.id))
      .map((check) => ({
        ...check,
        reason: outOfMeasuredScope(check)
          ? `timing budget (${check.measures}): its measured scope is not in the delta; final and a local all-checks run execute it`
          : `outside audited ${selection.scope} selection and registered merge smoke`,
        coverage: 'NOT_EXECUTED',
      })),
    selectionReasons: selection.reasons ?? [],
  };
}

/** Pin refs and include staged, unstaged, deleted, rename endpoints and untracked inputs. */
export function mergeChanges(
  { base, incoming, destination },
  git = (args) => execFileSync('git', args, { encoding: 'utf8' }),
) {
  const resolve = (name, ref) => {
    if (typeof ref !== 'string' || !ref || ref.startsWith('-'))
      throw Error(`Explicit ${name} commit required`);
    return git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`]).trim();
  };
  if ((incoming !== undefined) !== (destination !== undefined))
    throw Error('incoming and destination must appear together');
  const refs = { base: resolve('base', base), head: resolve('HEAD', 'HEAD') };
  git(['merge-base', '--is-ancestor', refs.base, refs.head]);
  if (incoming !== undefined) {
    refs.incoming = resolve('incoming', incoming);
    refs.destination = resolve('destination', destination);
    const common = git(['merge-base', '--all', refs.incoming, refs.destination]).trim();
    if (common !== refs.base)
      throw Error('Explicit base must equal unique incoming/destination merge-base');
    git(['merge-base', '--is-ancestor', refs.incoming, refs.head]);
    const changes = integrationChanges(refs, git);
    if (changes.refs.head !== refs.head) throw Error('HEAD changed during merge scope capture');
    // Keep the destination as supplied: a ref name lets completion detect drift.
    return {
      ...changes,
      refs: { ...changes.refs, destinationName: destination },
      scopeKind: 'branch-pair',
      reviewOnlyFiles: [],
      metadataOnlyFiles: [],
    };
  }
  const lists = [
    git(['diff', '--no-renames', '--name-only', '-z', refs.base, '--']),
    git(['ls-files', '--others', '--exclude-standard', '-z']),
  ];
  const files = [...new Set(lists.flatMap((list) => list.split('\0')).filter(Boolean))].sort();
  return {
    refs,
    scopeKind: 'explicit-base',
    files,
    metadataOnlyFiles: metadataOnlyPolicyFiles(files, refs.base, (path) =>
      git(['show', `${refs.base}:${path}`]),
    ),
    reviewOnlyFiles: reviewOnlyPolicyFiles(files, refs.base, (path) =>
      git(['show', `${refs.base}:${path}`]),
    ),
  };
}

/** Exemption evidence is computed from pinned old and actual bytes, never CLI assertions.
 * Markdown's existing parser distinguishes actual HTML receipts from code examples.
 * Semantic receipt and sidecar validity remain mandatory docs:check responsibilities.
 */
export function reviewOnlyPolicyFiles(
  files,
  base,
  readOld = (path) => execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8' }),
  readNew = (path) => readFileSync(path, 'utf8'),
) {
  function withoutReceipts(source) {
    const spans = [];
    function visit(node) {
      if (node.type === 'html' && node.value.includes('doc-review')) {
        const match = /^<!--\s*doc-review\s+(\{[\s\S]*\})\s*-->$/.exec(node.value);
        if (!match) throw Error('malformed review marker');
        const receipt = JSON.parse(match[1]);
        if (
          Object.keys(receipt).sort().join(',') !==
            'dependencies,dependencyDigest,disposition,fingerprint,rationale,version' ||
          receipt.version !== 1 ||
          !/^[a-f0-9]{64}$/.test(receipt.fingerprint) ||
          !/^[a-f0-9]{64}$/.test(receipt.dependencyDigest) ||
          typeof receipt.dependencies !== 'string' ||
          typeof receipt.disposition !== 'string' ||
          typeof receipt.rationale !== 'string'
        )
          throw Error('malformed review receipt');
        spans.push([node.position.start.offset, node.position.end.offset]);
      }
      for (const child of node.children ?? []) visit(child);
    }
    visit(fromMarkdown(source));
    let result = source;
    for (const [start, end] of spans.sort((a, b) => b[0] - a[0]))
      result = result.slice(0, start) + result.slice(end);
    return result;
  }
  return files.filter((path) => {
    if (!/^docs\/development\/[\w./-]+\.md$/.test(path)) return false;
    try {
      return withoutReceipts(readOld(path)) === withoutReceipts(readNew(path));
    } catch {
      return false;
    }
  });
}

/** Only reviewed-scope hash value bytes may differ; every other manifest byte is bound.
 * Freshness/semantic admission is still mandatory before executing a merge tier.
 */
export function metadataOnlyPolicyFiles(
  files,
  base,
  readOld = (path) => execFileSync('git', ['show', `${base}:${path}`], { encoding: 'utf8' }),
  readNew = (path) => readFileSync(path, 'utf8'),
) {
  const path = 'scripts/manifest.json';
  if (!files.includes(path)) return [];
  function withoutHashes(source) {
    JSON.parse(source);
    const root = parseExpressionAt(source, 0, { ecmaVersion: 'latest' });
    const spans = [];
    const scopes = root.properties?.filter(
      (property) => property.key.value === 'browserReviewMetadataScopes',
    );
    if (scopes?.length !== 1 || scopes[0].value.type !== 'ArrayExpression')
      throw Error('Missing or ambiguous review metadata');
    for (const row of scopes[0].value.elements) {
      if (row.type !== 'ObjectExpression') throw Error('Invalid review row');
      for (const field of ['sourceSha256', 'consumerSourceHash']) {
        const properties = row.properties.filter((property) => property.key.value === field);
        if (
          properties.length !== 1 ||
          properties[0].value.type !== 'Literal' ||
          typeof properties[0].value.value !== 'string' ||
          !/^[a-f0-9]{64}$/.test(properties[0].value.value)
        )
          throw Error('Invalid or ambiguous review hash');
        spans.push([properties[0].value.start, properties[0].value.end]);
      }
    }
    for (const [start, end] of spans.sort((a, b) => b[0] - a[0]))
      source = source.slice(0, start) + '""' + source.slice(end);
    return source;
  }
  try {
    return withoutHashes(readOld(path)) === withoutHashes(readNew(path)) ? [path] : [];
  } catch {
    return [];
  }
}
