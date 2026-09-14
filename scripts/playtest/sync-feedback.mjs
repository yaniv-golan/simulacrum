// Read-only, idempotent local sync of hosted feedback with its media, context and referenced
// recording exports. Every run lists all committed feedback (the server orders by UUID, so a
// persisted cursor would miss later ids), exports what is missing locally through the existing
// private download tools, and never issues anything but GET requests. The filesystem is the
// index: a feedback is complete when its final directory exists; a recording export is complete
// when `recordings/<session>/cutoff-<sequence>/session.json` exists.
import {
  mkdir,
  readdir,
  rm,
  rename,
  writeFile,
  readFile,
  stat,
  open,
  unlink,
} from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { downloadFeedback } from './download-feedback.mjs';
import { downloadCapture } from './download.mjs';
import { readFeedbackExports } from './feedback-export.mjs';
import { feedbackReferences } from './feedback-common.mjs';

export const SYNC_LABEL = 'build.simulacrum.feedback-sync';
const LOCK_STALE_MS = 6 * 3600000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sessionIdPattern = /^[a-f0-9]{32}$/;
const transientCodes = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EAI_AGAIN',
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receivedAtPattern = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const alive = (pid) => {
  if (!pid || pid === process.pid) return pid === process.pid;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};
const classified = (message, code, status) => Object.assign(Error(message), { code, status });

// Wraps a fetch: bounded retries for transport failures, 429 and 503 (honouring retry-after);
// 404/410 and 401/403 become typed errors so callers classify them without parsing messages;
// every other response is returned for the caller to judge.
export function withRetry(fetcher, { attempts = 4, delayMs = 250, attemptMs = 15000 } = {}) {
  return async (url, init = {}) => {
    let wait = 0;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt) await sleep(wait);
      const signal = AbortSignal.timeout(attemptMs);
      let response;
      try {
        response = await fetcher(url, { ...init, signal });
      } catch (error) {
        const transient =
          ['AbortError', 'TimeoutError'].includes(error?.name) ||
          transientCodes.has(error?.cause?.code) ||
          transientCodes.has(error?.code);
        if (!transient || attempt === attempts - 1) throw error;
        wait = delayMs * 2 ** attempt;
        continue;
      }
      if (response.status === 404 || response.status === 410)
        throw classified(`resource gone (${response.status})`, 'GONE', response.status);
      if (response.status === 401 || response.status === 403)
        throw classified(`authorization failed (${response.status})`, 'AUTH', response.status);
      if ((response.status === 429 || response.status === 503) && attempt < attempts - 1) {
        const header = Number(response.headers.get('retry-after'));
        wait = Number.isFinite(header) && header >= 0 ? header * 1000 : delayMs * 2 ** attempt;
        continue;
      }
      return response;
    }
    throw Error('unreachable');
  };
}

export async function loadSyncConfig(path, { home = homedir(), env = process.env } = {}) {
  const info = await stat(path);
  if (!info.isFile() || info.mode & 0o077)
    throw Error(`Config file mode must be 0600 with no group/other bits: ${path}`);
  const value = JSON.parse(await readFile(path, 'utf8'));
  const origin = value.origin;
  if (typeof origin !== 'string' || !origin.startsWith('https://'))
    throw Error('Config origin must use HTTPS');
  if (new URL(origin).origin !== origin)
    throw Error(
      'Config origin must be exactly scheme://host[:port] with no path or trailing slash',
    );
  const adminToken = value.adminToken ?? env.PLAYTEST_ADMIN_TOKEN;
  if (typeof adminToken !== 'string' || adminToken.length < 32)
    throw Error(
      'Config adminToken (or PLAYTEST_ADMIN_TOKEN) must be an admin token of at least 32 characters',
    );
  if (typeof value.directory !== 'string' || !value.directory.startsWith('/'))
    throw Error('Config directory must be an absolute path');
  const directory = resolve(value.directory);
  const privateHome = join(resolve(home), '.simulacrum-private') + sep;
  if (!directory.startsWith(privateHome) && !directory.split(sep).includes('.playtest-private'))
    throw Error(
      'Config private directory must be under ~/.simulacrum-private/ or a .playtest-private/ path',
    );
  return { origin, adminToken, directory };
}

const basicTime = (iso) => iso.replace(/[-:.]/g, '');
const voiceExtension = (mime) =>
  ({ 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' })[mime.split(';')[0]] ?? 'bin';
const writeJson = async (path, value) => {
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(tmp, path);
};
async function acquireLock(directory, now) {
  const path = join(directory, 'sync.lock');
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(path, 'wx', 0o600);
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, startedAt: new Date(now()).toISOString() }),
      );
      await handle.close();
      return () => unlink(path).catch(() => {});
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let startedAt = 0;
      try {
        startedAt = Date.parse(JSON.parse(await readFile(path, 'utf8')).startedAt) || 0;
      } catch {
        /* unreadable lock counts as stale */
      }
      if (now() - startedAt < LOCK_STALE_MS) return null;
      await unlink(path).catch(() => {});
    }
  }
  return null;
}
async function removeTemp(directory) {
  for (const name of await readdir(directory).catch(() => []))
    if (name.startsWith('.tmp-')) await rm(join(directory, name), { recursive: true, force: true });
}
async function listAll(fetchJson, origin, pageSize) {
  const rows = [];
  let after = '';
  for (;;) {
    const page = await fetchJson(
      `${origin}/admin/playtest/feedback?limit=${pageSize}${after ? `&after=${after}` : ''}`,
    );
    if (!Array.isArray(page)) throw Error('Feedback listing is not an array');
    for (const row of page) {
      if (!uuid.test(row.submissionId) || typeof row.receivedAt !== 'string')
        throw Error('Invalid feedback listing row');
      rows.push(row);
    }
    if (page.length < pageSize) return rows;
    after = page.at(-1).submissionId;
  }
}
async function localFeedback(feedbackRoot) {
  const byId = new Map();
  for (const name of await readdir(feedbackRoot).catch(() => []))
    if (!name.startsWith('.') && uuid.test(name.slice(-36)))
      byId.set(name.slice(-36), join(feedbackRoot, name));
  return byId;
}
async function writeAttachments(dir, envelope) {
  await writeFile(join(dir, 'text.txt'), envelope.text ?? '', { mode: 0o600 });
  if (envelope.voice)
    await writeFile(
      join(dir, `voice.${voiceExtension(envelope.voice.mime)}`),
      Buffer.from(envelope.voice.base64, 'base64'),
      { mode: 0o600 },
    );
  if (envelope.image) {
    const match = /^data:image\/(jpeg|png|webp);base64,(.*)$/.exec(envelope.image.dataUrl);
    if (match)
      await writeFile(join(dir, `image.${match[1]}`), Buffer.from(match[2], 'base64'), {
        mode: 0o600,
      });
  }
  if (envelope.context) await writeJson(join(dir, 'context.json'), envelope.context);
  const sessions = [...new Set(feedbackReferences(envelope).map((ref) => ref.sessionId))];
  await writeJson(
    join(dir, 'references.json'),
    sessions.map((sessionId) => ({ sessionId, exported: false })),
  );
}
async function localCutoffs(sessionRoot) {
  return (await readdir(sessionRoot).catch(() => []))
    .map((name) => /^cutoff-(\d+)$/.exec(name))
    .filter(Boolean)
    .map((m) => Number(m[1]))
    .filter((n) => existsSync(join(sessionRoot, `cutoff-${n}`, 'session.json')));
}

export async function syncFeedback({
  origin,
  token,
  directory,
  fetcher = fetch,
  home = homedir(),
  scriptHead = null,
  pageSize = 1000,
  now = Date.now,
  retry = {},
}) {
  const startedAt = new Date(now()).toISOString();
  const summary = {
    startedAt,
    finishedAt: null,
    scriptHead,
    listed: 0,
    new: 0,
    saved: 0,
    gone: [],
    failed: [],
    exit: 0,
    error: null,
  };
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const release = await acquireLock(directory, now);
  if (!release) return { ...summary, exit: 3, error: 'another sync holds the lock' };
  const feedbackRoot = join(directory, 'feedback'),
    recordingsRoot = join(directory, 'recordings');
  const retrying = withRetry(fetcher, retry);
  const headers = { authorization: `Bearer ${token}` };
  const fetchJson = async (url) => {
    const response = await retrying(url, { headers, redirect: 'error' });
    if (!response.ok) throw Error(`Private listing failed: ${response.status}`);
    return response.json();
  };
  try {
    await mkdir(feedbackRoot, { recursive: true, mode: 0o700 });
    await mkdir(recordingsRoot, { recursive: true, mode: 0o700 });
    await removeTemp(feedbackRoot);
    for (const name of await readdir(recordingsRoot)) await removeTemp(join(recordingsRoot, name));
    await writeFile(
      join(directory, 'README.md'),
      renderReadme({
        config: { origin, directory },
        configPath: null,
        script: fileURLToPath(import.meta.url),
      }),
      { mode: 0o600 },
    );
    const rows = await listAll(fetchJson, origin, pageSize);
    summary.listed = rows.length;
    const existing = await localFeedback(feedbackRoot);
    for (const row of rows) {
      const id = row.submissionId.toLowerCase();
      if (existing.has(id)) continue;
      summary.new++;
      const tmp = join(feedbackRoot, `.tmp-${id}`);
      await rm(tmp, { recursive: true, force: true });
      try {
        await downloadFeedback({
          origin,
          submissionId: id,
          directory: tmp,
          token,
          fetcher: retrying,
        });
        const [entry] = await readFeedbackExports(tmp);
        if (!entry || entry.envelope.id.toLowerCase() !== id)
          throw Error('Feedback export identity mismatch');
        await writeAttachments(tmp, entry.envelope);
        const final = join(feedbackRoot, `${basicTime(row.receivedAt)}-${id}`);
        await rename(tmp, final);
        existing.set(id, final);
        summary.saved++;
      } catch (error) {
        await rm(tmp, { recursive: true, force: true });
        if (error?.code === 'AUTH') throw error;
        if (error?.code === 'GONE') summary.gone.push(id);
        else summary.failed.push({ id, kind: 'feedback', error: String(error?.message ?? error) });
      }
    }
    await syncRecordings({ origin, token, fetcher, fetchJson, existing, recordingsRoot, summary });
  } catch (error) {
    summary.exit = 1;
    summary.error = String(error?.message ?? error);
  } finally {
    if (summary.exit !== 1) summary.exit = summary.failed.length ? 2 : 0;
    summary.finishedAt = new Date(now()).toISOString();
    await writeJson(join(directory, 'status.json'), summary).catch(() => {});
    await release();
  }
  return summary;
}

async function syncRecordings({
  origin,
  token,
  fetcher,
  fetchJson,
  existing,
  recordingsRoot,
  summary,
}) {
  const referencing = new Map();
  for (const dir of existing.values()) {
    const refs = JSON.parse(await readFile(join(dir, 'references.json'), 'utf8').catch(() => '[]'));
    for (const ref of refs) {
      if (!sessionIdPattern.test(ref.sessionId)) continue;
      if (!referencing.has(ref.sessionId)) referencing.set(ref.sessionId, []);
      referencing.get(ref.sessionId).push(dir);
    }
  }
  if (!referencing.size) return;
  const sessions = new Map(
    (await fetchJson(`${origin}/admin/playtest/sessions`)).map((s) => [s.id, s]),
  );
  for (const [sessionId, dirs] of referencing) {
    const sessionRoot = join(recordingsRoot, sessionId);
    await mkdir(sessionRoot, { recursive: true, mode: 0o700 });
    const session = sessions.get(sessionId);
    const cutoffs = await localCutoffs(sessionRoot);
    const latest = cutoffs.length ? Math.max(...cutoffs) : -1;
    if (session && Number.isSafeInteger(session.sequence) && session.sequence > latest) {
      const tmp = join(sessionRoot, `.tmp-${session.sequence}`);
      await rm(tmp, { recursive: true, force: true });
      try {
        await downloadCapture({ origin, sessionId, directory: tmp, token, fetcher });
        await rename(tmp, join(sessionRoot, `cutoff-${session.sequence}`));
        cutoffs.push(session.sequence);
      } catch (error) {
        await rm(tmp, { recursive: true, force: true });
        if (error?.code === 'AUTH') throw error;
        summary.failed.push({
          id: sessionId,
          kind: 'recording',
          error: String(error?.message ?? error),
        });
      }
    } else if (!session && !cutoffs.length) summary.gone.push(sessionId);
    const exported = cutoffs.length > 0;
    const entries = [];
    for (const dir of dirs) {
      const refs = JSON.parse(await readFile(join(dir, 'references.json'), 'utf8'));
      await writeJson(
        join(dir, 'references.json'),
        refs.map((r) => (r.sessionId === sessionId ? { ...r, exported } : r)),
      );
      entries.push(...(await readFeedbackExports(dir)));
    }
    for (const n of cutoffs)
      await writeJson(join(sessionRoot, `cutoff-${n}`, 'feedback.json'), entries);
  }
}

export function renderPlist({
  configPath,
  config,
  execPath = process.execPath,
  script = fileURLToPath(import.meta.url),
}) {
  const string = (v) => `<string>${v.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</string>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>${string(SYNC_LABEL)}
  <key>ProgramArguments</key>
  <array>
    ${string(execPath)}
    ${string(script)}
    ${string(configPath)}
  </array>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>Nice</key><integer>10</integer>
  <key>StandardOutPath</key>${string(join(config.directory, 'launchd.log'))}
  <key>StandardErrorPath</key>${string(join(config.directory, 'launchd.log'))}
</dict>
</plist>
`;
}

export function renderReadme({ configPath, config, script = fileURLToPath(import.meta.url) }) {
  const domain = 'gui/$(id -u)';
  return `# Simulacrum feedback sync

This directory is written by an hourly, read-only job that copies every feedback submitted on
${config.origin} to this Mac, with its text, voice comment, workshop image, context snapshot and
the recording sessions it references. Nothing is ever deleted or changed on the server; the job
only issues GET requests. Local copies stay until you delete them.

- Job label: ${SYNC_LABEL} (launchd user agent, runs every hour and once at login)
- Script: ${script}
- Config (origin, admin token, this directory): ${configPath ?? '<the config passed on the command line>'}
- Data directory: ${config.directory}

## Layout

- feedback/<receivedAt>-<id>/ — feedback.json (validated export), text.txt, voice.*, image.*,
  context.json, references.json (referenced recording sessions and whether they were exported)
- recordings/<sessionId>/cutoff-<sequence>/ — one recording export per observed upload sequence
  (session.json, events.ndjson, event-*.json, media *.bin) plus a derived feedback.json listing
  every feedback that references the session, so the existing review tooling can combine them
- status.json — the last run: counts, ids that were gone or failed, exit code (0 ok, 1 config/auth
  failure, 2 partial, 3 another run held the lock)
- launchd.log — stdout/stderr of the scheduled runs; sync.lock exists only while a run is active

## Check, run, stop

- Status: launchctl print ${domain}/${SYNC_LABEL} | grep -E 'state|last exit'
- Run once now: launchctl kickstart -k ${domain}/${SYNC_LABEL}
  (or by hand: node ${script} <config>)
- Pause without uninstalling: launchctl disable ${domain}/${SYNC_LABEL}; resume with enable
- Stop the job (keeps all data): launchctl bootout ${domain}/${SYNC_LABEL}
- Uninstall completely: run the stop command, then delete ~/Library/LaunchAgents/${SYNC_LABEL}.plist;
  delete this directory by hand if you no longer want the local copies
- Reinstall: node ${script} --print-plist <config> > ~/Library/LaunchAgents/${SYNC_LABEL}.plist,
  then launchctl bootstrap ${domain} ~/Library/LaunchAgents/${SYNC_LABEL}.plist

The server keeps feedback and recordings for 30 days; anything synced here outlives that. The job
never deletes server data, so a missed hour is simply caught up on the next run.
`;
}

function scriptHeadOf(script) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: dirname(script),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const flag = args.find((a) => a.startsWith('--'));
  const configPath = args.find((a) => !a.startsWith('--'));
  if (!configPath)
    throw Error(
      'Usage: node scripts/playtest/sync-feedback.mjs <private-config.json> [--print-plist | --print-readme]',
    );
  const config = await loadSyncConfig(resolve(configPath));
  const script = fileURLToPath(import.meta.url);
  if (flag === '--print-plist')
    process.stdout.write(renderPlist({ configPath: resolve(configPath), config, script }));
  else if (flag === '--print-readme')
    process.stdout.write(renderReadme({ configPath: resolve(configPath), config, script }));
  else if (flag) throw Error(`Unknown option ${flag}`);
  else {
    const summary = await syncFeedback({
      origin: config.origin,
      token: config.adminToken,
      directory: config.directory,
      scriptHead: scriptHeadOf(script),
    });
    const { failed, gone, ...rest } = summary;
    console.log(JSON.stringify({ ...rest, gone: gone.length, failed: failed.length }));
    process.exitCode = summary.exit;
  }
}
