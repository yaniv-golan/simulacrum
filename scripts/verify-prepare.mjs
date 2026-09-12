import { scopeArtifact } from './browser-scope-apply.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { prepareVerification, assertVerificationReady } from './verification-preparation.mjs';
const usage =
  'verify:prepare [--check] [--declarations file] [--scope-review file] [--documentation-review file] [--out artifacts/verification-preparation.json]';
try {
  const args = process.argv.slice(2),
    options = {},
    seen = new Set();
  let check = false,
    out = 'artifacts/verification-preparation.json';
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check' && !check) {
      check = true;
      continue;
    }
    const key = {
      '--declarations': 'declarations',
      '--scope-review': 'scopeReview',
      '--documentation-review': 'documentationReview',
      '--out': 'out',
    }[args[i]];
    if (!key || !args[i + 1] || args[i + 1].startsWith('--') || seen.has(key)) throw Error(usage);
    seen.add(key);
    const value = args[++i];
    if (key === 'out') out = value;
    else options[key] = JSON.parse(readFileSync(value, 'utf8'));
  }
  if (check && Object.keys(options).length) throw Error(usage);
  const path = scopeArtifact(process.cwd(), out);
  if (!check)
    console.log(
      'Preparation writes generated references and explicitly reviewed metadata. Use an isolated worktree with one writer; it never approves reviews automatically.',
    );
  const report = check
    ? await assertVerificationReady()
    : await prepareVerification(process.cwd(), options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log(`${report.status}: ${path}`);
  if (report.proposal)
    console.log(
      'Review proposal with browser:scopes review format; supply --scope-review. Unknown reads need --declarations.',
    );
  if (report.documentation)
    console.log(
      'Supply --documentation-review JSON {source: <report.source>, decisions: <docs:review batch rows>}.',
    );
  process.exitCode = report.status === 'READY' ? 0 : 1;
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
