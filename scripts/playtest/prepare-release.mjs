import { sourceIdentity } from '../source-identity.mjs';
import { assertPackageVerification, verificationHash } from './package-verification.mjs';
// One frozen verification and package path shared by local and CI releases.
import { readFile, writeFile, mkdir, readdir, copyFile, lstat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, cwd) =>
  execFileSync(command, args, { cwd, stdio: 'inherit', env: process.env });
const text = (command, args, cwd = process.cwd()) =>
  execFileSync(command, args, { cwd, encoding: 'utf8' }).trim();
async function inventory(root) {
  const result = {};
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw Error('Release symlinks forbidden');
      if (entry.isDirectory()) await visit(path);
      else result[relative(root, path).replaceAll('\\', '/')] = sha(await readFile(path));
    }
  }
  await visit(root);
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
export async function prepareRelease(destination) {
  const root = process.cwd(),
    out = resolve(destination);
  if (!relative(root, out).startsWith('.release-private/'))
    throw Error('Prepare destination must be a new .release-private/<release> directory');
  const head = text('git', ['rev-parse', 'HEAD']);
  const paths = text('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
    .sort();
  if (paths.some((path) => /(^|\/)(\.env(?:\.|$)|\.dev\.vars|secrets?\.)/.test(path)))
    throw Error('Review secret-like source paths before packaging');
  const source = {};
  for (const path of paths) {
    const info = await lstat(path).catch(() => null);
    if (!info) continue;
    if (!info.isFile()) throw Error(`Unsupported source input: ${path}`);
    source[path] = sha(await readFile(path));
  }
  await mkdir(resolve(out, '..'), { recursive: true, mode: 0o700 });
  await mkdir(out, { recursive: false, mode: 0o700 });
  // Keep Spotlight off the frozen snapshot: the marker sits at the release root, outside the
  // `source` map and the snapshot's identity.
  await writeFile(join(out, '.metadata_never_index'), '', { mode: 0o600, flag: 'wx' });
  const snapshot = join(out, 'source');
  run('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', root, snapshot]);
  for (const path of Object.keys(source)) {
    const target = join(snapshot, path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await copyFile(join(root, path), target);
  }
  await writeFile(join(out, 'source.json'), JSON.stringify({ head, source }, null, 2), {
    mode: 0o600,
  });
  const timings = {};
  const timed = (id, command, args) => {
    const start = performance.now();
    try {
      return run(command, args, snapshot);
    } finally {
      timings[id] = performance.now() - start;
    }
  };
  timed('install', 'npm', ['ci']);
  timed('format', 'npm', ['run', 'format:check']);
  // Qualification exit 2 is acceptable for release automation only when its report
  // confirms automation passed; human acceptance is never invented by deployment.
  try {
    timed('verification', 'npm', ['run', 'verify:final']);
  } catch (error) {
    const report = JSON.parse(
      await readFile(join(snapshot, 'artifacts', 'verification-final.json'), 'utf8'),
    );
    if (error.status !== 2 || report.outcome?.automation?.status !== 'PASS') throw error;
  }
  const verification = JSON.parse(
    await readFile(join(snapshot, 'artifacts/verification-final.json'), 'utf8'),
  );
  if (verification.outcome?.automation?.status !== 'PASS')
    throw Error('Complete release automation must pass');
  if (JSON.stringify(verification.source) !== JSON.stringify(sourceIdentity()))
    throw Error('Verification source does not match frozen candidate');
  const verifiedAssets = await inventory(join(snapshot, 'dist'));
  const payload = join(out, 'payload');
  await mkdir(payload);
  await mkdir(join(payload, 'assets'));
  const assets = await inventory(join(snapshot, 'dist'));
  for (const path of Object.keys(assets)) {
    if (path.startsWith('.') || path.endsWith('.map')) continue;
    const target = join(payload, 'assets', path);
    await mkdir(resolve(target, '..'), { recursive: true });
    await copyFile(join(snapshot, 'dist', path), target);
  }
  timed('bundle', 'npx', [
    '--no-install',
    'wrangler',
    'deploy',
    '--dry-run',
    '--outdir',
    join(payload, 'backend'),
  ]);
  if (JSON.stringify(await inventory(join(snapshot, 'dist'))) !== JSON.stringify(verifiedAssets))
    throw Error('Verified assets changed while packaging backend');
  for (const [path, hash] of Object.entries(source))
    if (sha(await readFile(join(snapshot, path))) !== hash)
      throw Error('Frozen source changed during release preparation');
  // Source drift outside the frozen copy is also a rejection, never a silent selection.
  for (const [path, hash] of Object.entries(source))
    if (sha(await readFile(join(root, path))) !== hash)
      throw Error('Source changed during release preparation');
  const current = text('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
    .split('\0')
    .filter(Boolean)
    .sort();
  if (JSON.stringify(paths) !== JSON.stringify(current))
    throw Error('Source input list changed during preparation');
  const files = await inventory(payload),
    artifact = sha(JSON.stringify(files));
  const manifest = {
    verification: {
      artifact,
      sourceHash: sha(JSON.stringify(source)),
      build: verification.build,
      results: verification.results.map(({ id, ok, result }) => ({
        id,
        ok,
        ...(id === 'gate'
          ? {
              result: {
                failed: result.failed,
                unmet: result.unmet,
                dueBarCount: result.dueBarCount,
                bars: result.bars,
              },
            }
          : {}),
      })),
      automation: verification.outcome.automation,
      humanAcceptance: verification.outcome.humanAcceptance,
      source: verification.source,
      runtime: verification.runtime,
      checks: verification.checks,
      timings,
      bundleCoverage:
        'Backend source is checked by the full suite; Wrangler bundles that same frozen source after verification. Hosted smoke checks the deployed bundle. Local bundle execution is not claimed.',
    },
    schema: 1,
    protocolVersion: 2,
    createOnlyPayloads: true,
    artifact,
    files,
    head,
    sourceHash: sha(JSON.stringify(source)),
    origin: process.env.GITHUB_ACTIONS === 'true' ? 'github' : 'local',
    appBuild: /<meta[^>]+name="build-id"[^>]+content="([^"]+)"/.exec(
      await readFile(join(payload, 'assets/index.html'), 'utf8'),
    )?.[1],
    created: Date.now(),
    expires: Date.now() + 14 * 86400000,
  };
  manifest.verificationHash = verificationHash(manifest.verification);
  assertPackageVerification(manifest);
  await writeFile(join(out, 'release.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ directory: out, artifact }));
  return manifest;
}
