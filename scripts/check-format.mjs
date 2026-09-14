import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The every-commit format gate: the same `prettier --check` the hosted CI job runs, so a layout
 * defect cannot reach main through a local tier that never looked. Prettier's own cache keeps the
 * steady-state cost near a second; the first run of a fresh candidate pays the full scan. The
 * cache lives under artifacts/, never under node_modules: a candidate's installed dependencies are
 * digested byte for byte before and after the tier, and a cache file there would read as drift.
 * artifacts/ is not captured into a candidate clone, so every candidate tier pays the cold scan
 * (about 3 s); the cache only speeds direct tiers in a worktree. */
export const FORMAT_TARGETS = Object.freeze(['src', 'scripts', 'test']);
export function checkFormat(root = process.cwd(), { timeoutMs = 60000 } = {}) {
  const bin = join(root, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
  if (!existsSync(bin)) throw Error('prettier is not installed in this tree');
  const targets = FORMAT_TARGETS.filter((dir) => existsSync(join(root, dir)));
  try {
    execFileSync(
      process.execPath,
      [
        bin,
        '--check',
        '--cache',
        '--cache-location',
        join(root, 'artifacts', 'format-gate', 'prettier-cache'),
        ...targets,
      ],
      { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs },
    );
  } catch (error) {
    const flagged = `${error.stdout ?? ''}${error.stderr ?? ''}`
      .split('\n')
      .filter((line) => line.startsWith('[warn] ') && !/Code style issues|Run Prettier/.test(line))
      .map((line) => line.slice('[warn] '.length).trim());
    throw Error(
      flagged.length
        ? `format: ${flagged.length} file(s) not in prettier layout: ${flagged.join(', ')}`
        : `format: prettier --check failed: ${error.message}`,
    );
  }
  return { targets };
}
