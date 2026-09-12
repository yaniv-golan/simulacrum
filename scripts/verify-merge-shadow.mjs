import { readFileSync } from 'node:fs';
import { assertRuntime } from './runtime-preflight.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { affectedBrowserChecks } from './browser-selection.mjs';
import { browserChecks } from './browser-registry.mjs';
import { integrationChanges, mergeShadowReport } from './merge-shadow.mjs';

// Intentionally has no execution/qualification path and never modifies gate selection.
try {
  assertRuntime();
  const options = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i].replace(/^--/, '');
    if (
      !['base', 'incoming', 'destination', 'historical'].includes(name) ||
      options[name] ||
      !args[i + 1] ||
      args[i + 1].startsWith('-')
    )
      throw Error(
        'Usage: verify:merge:shadow --base <common-commit> --incoming <commit> --destination <commit> [--historical <browser-report.json>]; no path or check selectors',
      );
    options[name] = args[i + 1];
  }
  const source = sourceIdentity();
  const changes = integrationChanges(options);
  const selection = affectedBrowserChecks(changes.files);
  const report = mergeShadowReport({
    checks: browserChecks(),
    selection,
    files: changes.files,
    historical: options.historical
      ? JSON.parse(readFileSync(options.historical, 'utf8'))
      : undefined,
  });
  if (
    JSON.stringify(source) !== JSON.stringify(sourceIdentity()) ||
    JSON.stringify(changes) !== JSON.stringify(integrationChanges(options))
  )
    throw Error('Source or integration references changed during shadow analysis');
  console.log(JSON.stringify({ ...report, source, refs: changes.refs }, null, 2));
} catch (error) {
  console.error(error.stack);
  process.exitCode = 1;
}
