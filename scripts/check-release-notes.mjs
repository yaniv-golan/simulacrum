import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

/** Newest date a note may carry: HEAD's commit date or today (local, matching git's
 * short committer date), whichever is later, so a note written before its commit on a
 * fresh day still validates locally. */
export function latestNoteDate(root = process.cwd()) {
  const today = new Date().toLocaleDateString('sv');
  try {
    const head = execFileSync('git', ['log', '-1', '--format=%cs'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return head > today ? head : today;
  } catch {
    return today;
  }
}

function markdownNotes(root) {
  const hits = [];
  if (existsSync(join(root, 'docs', 'release-notes'))) hits.push('docs/release-notes/');
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (/release-notes.*\.md$/i.test(entry)) hits.push(path.slice(root.length + 1));
    }
  };
  walk(join(root, 'src'));
  return hits;
}

/** Tracked release notes bind to this build: markdown is excluded from the app
 * fingerprint, so notes live in the imported module and must reference features,
 * parts and dates that exist here. */
export async function checkReleaseNotes(root = process.cwd()) {
  const markdown = markdownNotes(root);
  if (markdown.length)
    throw Error(
      `release notes must live in src/application/release-notes.mjs: markdown is excluded from the app fingerprint and would not change the build id (${markdown.join(', ')})`,
    );
  // Literal specifiers keep the module graph exact for selection and scope tools; the
  // root only scopes the markdown scan and the commit date.
  const [{ RELEASE_NOTES, validateReleaseNotes }, { UI_FEATURES }, { CATALOG }] =
    await Promise.all([
      import('../src/application/release-notes.mjs'),
      import('../src/model/features.mjs'),
      import('../src/model/catalog.mjs'),
    ]);
  const errors = validateReleaseNotes(RELEASE_NOTES, {
    featureKeys: Object.keys(UI_FEATURES),
    partTypes: Object.keys(CATALOG),
    latestDate: latestNoteDate(root),
  });
  if (errors.length) throw Error(`release notes:\n${errors.join('\n')}`);
}
