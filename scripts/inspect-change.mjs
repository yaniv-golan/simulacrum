import { pathToFileURL } from 'node:url';
import {
  inspectChange,
  parseChangeInspectionArgs,
  summarizeChangeInspection,
} from './change-inspection.mjs';

export async function runInspectionCLI(
  args,
  { inspect = inspectChange, write = console.log } = {},
) {
  if (args.filter((arg) => arg === '--json').length > 1) throw Error('duplicate option: --json');
  const json = args.includes('--json');
  const files = parseChangeInspectionArgs(args.filter((arg) => arg !== '--json'));
  const report = await inspect(process.cwd(), { files });
  write(json ? JSON.stringify(report, null, 2) : summarizeChangeInspection(report));
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
