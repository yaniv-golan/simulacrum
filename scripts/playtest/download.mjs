// Private authenticated export. Capability is read from the environment, never argv or URL.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from './protocol.mjs';
export async function downloadCapture({
  origin,
  sessionId,
  directory,
  token = process.env.PLAYTEST_ADMIN_TOKEN,
  fetcher = fetch,
  allowLocal = false,
}) {
  if (
    (!/^https:\/\//.test(origin) &&
      !(allowLocal && /^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(origin))) ||
    !/^[a-f0-9]{32}$/.test(sessionId) ||
    !token ||
    token.length < 32
  )
    throw Error('HTTPS origin, session ID and PLAYTEST_ADMIN_TOKEN required');
  const root = resolve(directory);
  await mkdir(root, { mode: 0o700 });
  const get = async (path) => {
    const response = await fetcher(new URL(path, origin), {
      headers: { authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw Error(`Private export failed: ${response.status}`);
    return response;
  };
  let cutoff,
    after = 0,
    session;
  const records = [];
  do {
    const page = await (
      await get(
        `/admin/playtest/${sessionId}/snapshot?after=${after}${cutoff === undefined ? '' : `&cutoff=${cutoff}`}`,
      )
    ).json();
    cutoff ??= page.cutoff;
    session ??= page.session;
    if (page.cutoff !== cutoff || page.session.sessionId !== sessionId)
      throw Error('Export identity mismatch');
    if (!page.uploads.length && after < cutoff) throw Error('Missing journal sequence');
    for (const row of page.uploads) {
      if (
        row.receipt.sequence !== after + 1 ||
        row.sessionId !== sessionId ||
        !/^[a-f0-9]{32}$/.test(row.objectKey)
      )
        throw Error('Invalid export pointer');
      const bytes = new Uint8Array(
        await (await get(`/admin/playtest/${sessionId}/object?key=${row.objectKey}`)).arrayBuffer(),
      );
      if (bytes.length !== row.bytes || (await digest(bytes)) !== row.sha256)
        throw Error('Export checksum mismatch');
      if (row.media) {
        if (!/^[A-Za-z0-9_-]+\.bin$/.test(row.media.file)) throw Error('Invalid media filename');
        await writeFile(join(root, row.media.file), bytes, { mode: 0o600, flag: 'wx' });
      }
      const rawFile = `event-${row.receipt.sequence}.json`;
      if (!row.media) await writeFile(join(root, rawFile), bytes, { mode: 0o600, flag: 'wx' });
      records.push({
        receipt: row.receipt,
        uploadHash: row.uploadHash,
        ...(row.media
          ? { media: { ...row.media, bytes: row.bytes, sha256: row.sha256 } }
          : {
              event: JSON.parse(new TextDecoder().decode(bytes)),
              rawEvent: { file: rawFile, bytes: row.bytes, sha256: row.sha256 },
            }),
      });
      after = row.receipt.sequence;
    }
  } while (after < cutoff);
  await writeFile(
    join(root, 'session.json'),
    JSON.stringify({ ...session, exportCutoff: cutoff, completion: 'not proven' }),
    { mode: 0o600, flag: 'wx' },
  );
  await writeFile(
    join(root, 'events.ndjson'),
    records.map((r) => JSON.stringify(r) + '\n').join(''),
    { mode: 0o600, flag: 'wx' },
  );
  return { directory: root, cutoff, completion: 'not proven' };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [origin, sessionId, directory] = process.argv.slice(2);
  if (!directory)
    throw Error('Usage: playtest:download -- <https-origin> <session-id> <new-private-directory>');
  console.log(await downloadCapture({ origin, sessionId, directory }));
}
