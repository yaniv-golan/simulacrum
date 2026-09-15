import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareScopeProposal, summarizeScopeProposal } from './browser-scope-proposal.mjs';
import {
  applyScopeProposal,
  scopeArtifact,
  assertScopeEnvironment,
} from './browser-scope-apply.mjs';
import { assertRuntime } from './runtime-preflight.mjs';
export const scopeUsage =
  'Use browser:scopes -- prepare [--declarations file.json] [--base commit] --out artifacts/proposal.json, or browser:scopes -- apply artifacts/proposal.json --review artifacts/review.json';
export async function scopeCLI(args, root = process.cwd()) {
  assertRuntime();
  assertScopeEnvironment();
  const [mode, ...rest] = args;
  const options = {},
    positional = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) {
      const key = rest[i].slice(2);
      if (
        !['declarations', 'out', 'review', 'base'].includes(key) ||
        options[key] ||
        !rest[i + 1] ||
        rest[i + 1].startsWith('--')
      )
        throw Error(scopeUsage);
      options[key] = rest[++i];
    } else positional.push(rest[i]);
  }
  const read = (p) => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
  if (mode === 'prepare' && !positional.length && options.out && !options.review) {
    const out = scopeArtifact(root, options.out);
    const proposal = prepareScopeProposal(
      root,
      options.declarations ? read(options.declarations) : [],
      { base: options.base ?? null },
    );
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(proposal, null, 2) + '\n');
    console.log(summarizeScopeProposal(proposal));
    console.log(`Saved ${out}`);
    if (proposal.declarationSkeletons) {
      // Unclassified reads: hand the operator the declaration to author rather than a refusal.
      const skeleton = out.replace(/\.json$/, '') + '.declarations.json';
      writeFileSync(skeleton, JSON.stringify(proposal.declarationSkeletons, null, 2) + '\n');
      console.log(
        `Declaration skeleton saved to ${skeleton}: choose each read's purpose, keep both exclusions, then rerun prepare with --declarations ${skeleton}`,
      );
    }
    return proposal.blocked.length ? 1 : 0;
  }
  if (
    mode === 'apply' &&
    positional.length === 1 &&
    options.review &&
    !options.out &&
    !options.declarations &&
    !options.base
  ) {
    const report = await applyScopeProposal(root, read(positional[0]), read(options.review));
    console.log(
      JSON.stringify(
        report.status === 'applied'
          ? { status: report.status, reportPath: report.reportPath }
          : report,
      ),
    );
    return 0;
  }
  throw Error(scopeUsage);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await scopeCLI(process.argv.slice(2));
  } catch (error) {
    console.error(error.message + (error.reportPath ? `\nEvidence: ${error.reportPath}` : ''));
    process.exitCode = 1;
  }
}
