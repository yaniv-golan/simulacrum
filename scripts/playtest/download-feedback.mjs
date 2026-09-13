// Admin-only private export. Never put credentials in a URL or command argument.
import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readBounded } from './protocol.mjs';
import { validateFeedbackExport } from './feedback-export.mjs';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export async function downloadFeedback({
  origin,
  submissionId,
  sessionId,
  directory,
  appendToCapture = false,
  token = process.env.PLAYTEST_ADMIN_TOKEN,
  fetcher = fetch,
  allowLocal = false,
}) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw Error('Valid export origin required');
  }
  if (
    url.origin !== origin ||
    (url.protocol !== 'https:' &&
      !(
        allowLocal &&
        url.protocol === 'http:' &&
        ['127.0.0.1', 'localhost'].includes(url.hostname)
      )) ||
    !token ||
    token.length < 32 ||
    (submissionId && !uuid.test(submissionId)) ||
    (sessionId && !/^[a-f0-9]{32}$/.test(sessionId)) ||
    (!submissionId && !sessionId) ||
    (submissionId && sessionId)
  )
    throw Error('Export origin, one feedback/session identity, and PLAYTEST_ADMIN_TOKEN required');
  const root = resolve(directory);
  if (appendToCapture) {
    if (
      !sessionId ||
      !(await lstat(root)).isDirectory() ||
      JSON.parse(await readFile(join(root, 'session.json'), 'utf8')).sessionId !== sessionId
    )
      throw Error('Capture directory identity mismatch');
  } else await mkdir(root, { mode: 0o700 });
  async function get(path) {
    const response = await fetcher(new URL(path, origin), {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw Error(`Private feedback export failed: ${response.status}`);
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await readBounded(response.body, 16 * 1024 ** 2),
      ),
    );
  }
  const output = [],
    identities = new Set();
  let total = 0;
  async function read(id) {
    if (!uuid.test(id) || identities.has(id))
      throw Error('Invalid or repeated feedback export identity');
    const entry = await validateFeedbackExport(await get(`/admin/playtest/feedback/${id}/export`));
    if (entry.envelope.id !== id) throw Error('Feedback export identity mismatch');
    if (
      sessionId &&
      ![
        entry.envelope.reference,
        entry.envelope.image?.reference,
        entry.envelope.context?.reference,
      ].some((ref) => ref?.sessionId === sessionId)
    )
      throw Error('Feedback export session reference mismatch');
    total += Buffer.byteLength(JSON.stringify(entry));
    if (total > 128 * 1024 ** 2 || output.length >= 1000)
      throw Error('Feedback export exceeds bounded archive size');
    identities.add(id);
    output.push(entry);
  }
  if (submissionId) await read(submissionId);
  else {
    let after = '';
    while (true) {
      const page = await get(
        `/admin/playtest/feedback?limit=100&sessionId=${sessionId}${after ? `&after=${after}` : ''}`,
      );
      if (!Array.isArray(page) || page.length > 100) throw Error('Invalid feedback export page');
      for (const row of page) {
        if (typeof row.submissionId !== 'string' || row.submissionId <= after)
          throw Error('Invalid feedback export ordering');
        await read(row.submissionId);
        after = row.submissionId;
      }
      if (page.length < 100) break;
    }
  }
  await writeFile(join(root, 'feedback.json'), JSON.stringify(output), { mode: 0o600, flag: 'wx' });
  return { directory: root, submissions: output.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [origin, identity, directory, option] = process.argv.slice(2);
  if (!directory)
    throw Error(
      'Usage: node scripts/playtest/download-feedback.mjs <https-origin> <feedback-id|session:session-id> <private-directory> [--append-to-capture]',
    );
  if (option && option !== '--append-to-capture') throw Error('Unknown export option');
  console.log(
    await downloadFeedback({
      origin,
      directory,
      ...(identity.startsWith('session:')
        ? { sessionId: identity.slice(8) }
        : { submissionId: identity }),
      appendToCapture: option === '--append-to-capture',
    }),
  );
}
