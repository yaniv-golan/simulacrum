import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const cell = (value) =>
  String(value ?? '')
    .replaceAll('|', '&#124;')
    .replaceAll('\n', ' ');
export const referencePath = 'docs/development/reference.md';
export function generatedReference(pkg, manifest) {
  return [
    '<!-- generated: development-reference -->',
    '# Generated developer reference',
    '',
    'Generated from package scripts and manifest ownership. Run `npm run docs:generate` to refresh.',
    'These are registered commands and checks, not evidence that they passed.',
    '',
    '## Commands',
    '',
    '| Command | Implementation |',
    '| --- | --- |',
    ...Object.entries(pkg.scripts)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, command]) => `| npm run ${cell(name)} | ${cell(command)} |`),
    '',
    '## Structural checks',
    '',
    '| Check | Rule or bar | Due | Implementation |',
    '| --- | --- | --- | --- |',
    ...manifest.checks.map(
      (check) =>
        `| ${cell(check.id)} | ${cell(check.ruleId ?? check.barId)} | ${cell(check.dueAt)} | ${check.module ? `[${cell(check.module)}](../../${check.module})` : 'Unimplemented'} |`,
    ),
    '',
    '## Invariant owners',
    '',
    '| Invariant | Production owners | Registered checks |',
    '| --- | --- | --- |',
    ...(manifest.invariants ?? []).map(
      (item) =>
        `| ${cell(item.id)} | ${item.owners.map((owner) => `[${cell(owner.anchor)}](../../${owner.path})`).join(', ')} | ${item.checks.map(cell).join(', ')} |`,
    ),
    '',
  ].join('\n');
}
export function refreshReference(root, { check = false } = {}) {
  const expected = generatedReference(
    JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')),
    JSON.parse(readFileSync(resolve(root, 'scripts/manifest.json'), 'utf8')),
  );
  if (!check) writeFileSync(resolve(root, referencePath), expected);
  else {
    let actual;
    try {
      actual = readFileSync(resolve(root, referencePath), 'utf8');
    } catch {
      /* Report repair below. */
    }
    if (actual !== expected)
      throw Error(`${referencePath}: generated reference is stale; run npm run docs:generate`);
  }
  return expected;
}
