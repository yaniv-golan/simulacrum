import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeSnapshot } from './analysis-snapshot.mjs';
import { buildModuleGraph } from './module-graph.mjs';
import { queryNavigation } from './navigation.mjs';
import { inspectDocumentation } from './documentation.mjs';
import { refreshReference } from './development-reference.mjs';

// The normal structural gate runs this afresh. Reports are outputs, never cached
// permissions to skip analysis; the enclosing verification context binds source.
export async function documentationReport(root = process.cwd()) {
  return analyzeSnapshot(
    root,
    { format: 'developer-documentation/v1', options: { query: 'src/' } },
    () => {
      const graph = buildModuleGraph(root, { purpose: 'test-selection' });
      const navigation = queryNavigation(graph, 'src/');
      const documentation = inspectDocumentation(root);
      const errors = [...documentation.errors];
      const currentRecords = new Set(
        documentation.sections.map((section) => section.review?.dependencies),
      );
      for (const file of graph.files.filter((path) =>
        path.startsWith('docs/development/.reviews/'),
      )) {
        if (!currentRecords.has(file))
          errors.push(
            `${file}: orphaned review metadata; remove the record if its explanation was removed, or repair its section receipt`,
          );
      }
      try {
        refreshReference(root, { check: true });
      } catch (error) {
        errors.push(error.message);
      }
      return { graph, value: { ...navigation, documentation, errors } };
    },
  );
}
export async function check(root = process.cwd()) {
  const report = await documentationReport(root);
  mkdirSync(resolve(root, 'artifacts'), { recursive: true });
  writeFileSync(
    resolve(root, 'artifacts/developer-documentation.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  if (report.value.errors.length) throw Error(report.value.errors.join('\n'));
  return { analysis: report.analysis, sections: report.value.documentation.sections.length };
}
