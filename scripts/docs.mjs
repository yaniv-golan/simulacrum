import { assertRuntime } from './runtime-preflight.mjs';
import { readFileSync } from 'node:fs';
import { check, documentationReport } from './check-documentation.mjs';
import { reviewSection, reviewSections } from './documentation.mjs';
import { refreshReference } from './development-reference.mjs';
const [mode, ...args] = process.argv.slice(2);
const usage =
  'Use docs:prepare, docs:check, docs:impact, docs:generate, or docs:review -- <file> <section-id> <updated|still accurate> "technical rationale"; or docs:review -- --batch <decisions.json>';
try {
  assertRuntime();
  if (['check', 'impact', 'generate', 'prepare'].includes(mode) && args.length === 0) {
    if (mode === 'generate' || mode === 'prepare') {
      refreshReference(process.cwd());
      if (mode === 'generate')
        console.log(
          'Refreshed generated developer reference. Authored explanations still require review.',
        );
    }
    if (mode === 'check') console.log(JSON.stringify(await check(), null, 2));
    if (mode === 'impact' || mode === 'prepare') {
      const { analysis, value } = await documentationReport();
      console.log(
        JSON.stringify(
          {
            analysis,
            errors: value.errors,
            sections: value.documentation.sections.map((section) => ({
              file: section.file,
              id: section.id,
              stale: section.stale,
              dependencyCount: Object.keys(section.dependencies).length,
              changedDependencies: Object.keys({
                ...section.reviewDependencies,
                ...section.dependencies,
              }).filter(
                (path) => section.reviewDependencies?.[path] !== section.dependencies[path],
              ),
              scopeNotes: section.scopeNotes,
            })),
          },
          null,
          2,
        ),
      );
      if (value.errors.length) process.exitCode = 1;
    }
  } else if (mode === 'review' && args.length === 2 && args[0] === '--batch') {
    const rows = JSON.parse(readFileSync(args[1], 'utf8'));
    reviewSections(process.cwd(), rows);
    console.log(`Recorded ${rows.length} individual section reviews. Run npm run docs:check.`);
  } else if (mode === 'review' && args.length === 4) {
    const [file, id, disposition, rationale] = args;
    reviewSection(process.cwd(), file, id, { disposition, rationale });
    console.log(
      `Recorded current technical review for ${file}#${id}. This is not proof of semantic correctness. Run npm run docs:check.`,
    );
  } else throw Error(usage);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
