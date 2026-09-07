import { pathToFileURL } from 'node:url';
import { inspectChange, parseChangeInspectionArgs } from './change-inspection.mjs';

export async function runInspectionCLI(
  args,
  { inspect = inspectChange, write = console.log } = {},
) {
  const files = parseChangeInspectionArgs(args);
  const report = await inspect(process.cwd(), { files });
  write(JSON.stringify(report, null, 2));
  return report.value.parseErrors.length || report.value.documentation.errors.length ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await runInspectionCLI(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
