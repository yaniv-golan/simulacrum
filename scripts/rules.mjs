import { failureControlView } from './invariant-coverage.mjs';
import { readManifest } from './validate-manifest.mjs';
import { hostProfileStateLine } from './host-profile.mjs';
const manifest = readManifest();
const checks = [
  ...manifest.checks,
  ...Object.values(manifest.exitObligations).flat(),
  ...(manifest.browserChecks ?? []),
];
const args = process.argv.slice(2);
if (args.length && (args.length !== 1 || args[0] !== '--failures')) {
  console.error('Usage: npm run rules -- [--failures]');
  process.exitCode = 1;
} else if (args[0] === '--failures') {
  const view = failureControlView(manifest);
  console.log(
    `Failure controls · execution ${view.execution}. Registered pointers are not results.`,
  );
  for (const item of view.invariants) {
    console.log(
      `${item.id} | ${item.ruleId} | ${item.coverage} | checks: ${item.checks.join(', ') || 'UNKNOWN'}`,
    );
    for (const control of item.controls) console.log(`  ${control.path}: ${control.anchor}`);
  }
} else
  for (const rule of manifest.rules) {
    const owners = checks
      .filter((c) => c.ruleId === rule.id && (c.module || c.script || c.check))
      .map((c) => c.id);
    console.log(
      `${rule.id} | ${rule.rule} | ${owners.length ? [...new Set(owners)].join(', ') : 'UNENFORCED'}`,
    );
  }
if (!args.length && hostProfileStateLine(manifest)) console.log(hostProfileStateLine(manifest));
