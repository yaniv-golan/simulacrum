// Private calibration transport. Only an explicitly pinned manifest can select local files.
import { readFile, writeFile, mkdir, rename, rm, lstat } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { readCalibrationEvidence } from './calibration-evidence.mjs';
const sha = (b) => createHash('sha256').update(b).digest('hex');
const maxFile = 32 * 1024 ** 2,
  maxTotal = 512 * 1024 ** 2;
function admitManifest(manifest) {
  if (
    manifest.schema !== 1 ||
    !Array.isArray(manifest.files) ||
    !manifest.files.length ||
    manifest.files.length > 2100
  )
    throw Error('Calibration bundle bounds');
  const seen = new Set();
  let total = 0;
  for (const row of manifest.files) {
    if (
      typeof row.path !== 'string' ||
      row.path.length > 160 ||
      !row.path.split('/').every((p) => /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(p)) ||
      seen.has(row.path)
    )
      throw Error('Calibration bundle path');
    seen.add(row.path);
    if (
      !Number.isSafeInteger(row.bytes) ||
      row.bytes < 1 ||
      row.bytes > maxFile ||
      !/^[a-f0-9]{64}$/.test(row.sha256 ?? '')
    )
      throw Error('Calibration bundle file bounds');
    total += row.bytes;
  }
  if (!seen.has('comparison.json') || total > maxTotal) throw Error('Calibration bundle bounds');
}
async function responseBytes(response, limit) {
  if (!response.ok || !response.body) throw Error('Private calibration download unavailable');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw Error('Calibration download bounds');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function retrieveCalibrationBundle(
  reference,
  directory,
  { request = fetch, token = process.env.CALIBRATION_BUNDLE_TOKEN } = {},
) {
  let url;
  try {
    url = new URL(reference?.url);
  } catch {
    throw Error('Private calibration HTTPS URL required');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.endsWith('/manifest.json')
  )
    throw Error('Private calibration HTTPS manifest URL required');
  if (!/^[a-f0-9]{64}$/.test(reference?.sha256 ?? '') || typeof token !== 'string' || !token)
    throw Error('Pinned private calibration digest and credential required');
  const get = async (url, limit) =>
    responseBytes(
      await request(url, {
        headers: { authorization: `Bearer ${token}` },
        redirect: 'error',
        signal: AbortSignal.timeout(60000),
      }),
      limit,
    );
  const bytes = await get(url, 512 * 1024);
  if (sha(bytes) !== reference.sha256) throw Error('Calibration manifest integrity');
  const manifest = JSON.parse(bytes);
  admitManifest(manifest);
  const temp = `${directory}-${randomUUID()}.partial`;
  await mkdir(dirname(directory), { recursive: true, mode: 0o700 });
  await mkdir(temp, { mode: 0o700 });
  try {
    for (const row of manifest.files) {
      const data = await get(new URL(row.path, url), row.bytes);
      if (data.length !== row.bytes || sha(data) !== row.sha256)
        throw Error('Calibration file integrity');
      const target = join(temp, row.path);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, data, { flag: 'wx', mode: 0o600 });
    }
    await rename(temp, directory);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
  return join(directory, 'comparison.json');
}
export async function packCalibrationBundle(profile, comparison, directory) {
  const report = await readCalibrationEvidence(profile, comparison);
  const root = dirname(comparison);
  const corpus = JSON.parse(await readFile(join(root, 'corpus/corpus.json'), 'utf8'));
  const paths = [
    'comparison.json',
    ...report.cases.map((c) => c.file),
    'capacity.json',
    'corpus/corpus.json',
    'corpus/events.json',
    ...corpus.media.map((r) => `corpus/${r.file}`),
  ];
  const files = [];
  for (const path of paths) {
    const target = path === 'comparison.json' ? comparison : join(root, path);
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxFile)
      throw Error('Calibration export file bounds');
    const bytes = await readFile(target);
    files.push({ path, bytes: bytes.length, sha256: sha(bytes) });
  }
  const manifest = { schema: 1, files };
  admitManifest(manifest);
  await mkdir(directory, { mode: 0o700 });
  for (const row of files) {
    const bytes = await readFile(
      row.path === 'comparison.json' ? comparison : join(root, row.path),
    );
    if (sha(bytes) !== row.sha256) throw Error('Calibration changed during export');
    await mkdir(dirname(join(directory, row.path)), { recursive: true, mode: 0o700 });
    await writeFile(join(directory, row.path), bytes, { flag: 'wx', mode: 0o600 });
  }
  const bytes = JSON.stringify(manifest);
  await writeFile(join(directory, 'manifest.json'), bytes, { flag: 'wx', mode: 0o600 });
  return { sha256: sha(bytes), files: files.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [command, profile, comparison, directory] = process.argv.slice(2);
  if (
    command !== 'pack' ||
    !directory ||
    !resolve(directory).startsWith(resolve('.release-private') + '/')
  )
    throw Error(
      'Usage: calibration-bundle.mjs pack <profile.json> <comparison.json> <new .release-private/directory>',
    );
  console.log(
    JSON.stringify(
      await packCalibrationBundle(
        JSON.parse(await readFile(profile, 'utf8')),
        comparison,
        directory,
      ),
    ),
  );
}
