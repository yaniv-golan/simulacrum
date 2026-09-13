import { NodeFeedbackStore } from './playtest/feedback-node.mjs';
import {
  feedbackEndpoint,
  feedbackId,
  feedbackRate,
  feedbackPage,
} from './playtest/feedback-common.mjs';
import { feedbackLimits } from '../src/application/feedback-protocol.mjs';
// M3b: private, bounded remote playtest capture. Receipts order completed uploads at the server.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import {
  validateEventEnvelope,
  admission,
  readBounded,
  safeId,
  mediaTypes,
} from './playtest/protocol.mjs';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import {
  mkdirSync,
  realpathSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  truncateSync,
  unlinkSync,
  rmSync,
  renameSync,
} from 'node:fs';
import {
  appendFile,
  writeFile,
  stat,
  realpath,
  readFile,
  rename,
  open,
  rm,
} from 'node:fs/promises';
import { resolve, relative, sep, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};
const digest = (data) => createHash('sha256').update(data).digest('hex');
const inside = (root, path) => {
  const r = relative(root, path);
  return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !r.startsWith(sep));
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const completedResponses = new WeakSet();
function send(res, status, value) {
  if (completedResponses.has(res) || res.destroyed || res.writableEnded) return;
  completedResponses.add(res);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(value));
}
async function syncPath(path) {
  const handle = await open(path, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
async function body(req, limit) {
  if (Number(req.headers['content-length']) > limit) throw fail(413, 'Request too large');
  return Buffer.from(await readBounded(Readable.toWeb(req), limit));
}
function json(bytes) {
  try {
    const value = JSON.parse(bytes.length ? bytes.toString('utf8') : '{}');
    if (!value || Array.isArray(value) || typeof value !== 'object') throw Error();
    return value;
  } catch {
    throw fail(400, 'Expected a JSON object');
  }
}

const processWriteAdmission = admission();
const stalledWrites = new Set();

export function createPlaytestServer({
  publicDir = process.env.PLAYTEST_PUBLIC_DIR,
  dataDir = process.env.PLAYTEST_DATA_DIR,
  token = process.env.PLAYTEST_TOKEN,
  optionalVideo = process.env.PLAYTEST_OPTIONAL_VIDEO === 'true',
  adminToken = process.env.PLAYTEST_ADMIN_TOKEN,
  feedbackEnabled = process.env.PLAYTEST_FEEDBACK_ENABLED !== 'false',
  feedbackStorageBytes = Number(process.env.PLAYTEST_FEEDBACK_STORAGE_BYTES || 128 * 1024 ** 2),
  maxRequestBytes = 10 * 1024 * 1024,
  maxSessionBytes = 1024 ** 3,
  maxSessions = 20,
  persistenceResponseMs = 40000,
} = {}) {
  if (!publicDir || !dataDir || !token || token.length < 32)
    throw Error(
      'PLAYTEST_PUBLIC_DIR, PLAYTEST_DATA_DIR and PLAYTEST_TOKEN (at least 32 characters) are required',
    );
  for (const n of [maxRequestBytes, maxSessionBytes, maxSessions])
    if (!Number.isSafeInteger(n) || n < 1) throw Error('Limits must be positive integers');
  if (
    !Number.isSafeInteger(persistenceResponseMs) ||
    persistenceResponseMs < 1 ||
    persistenceResponseMs > 40000
  )
    throw Error('Invalid persistence response deadline');
  const publicRoot = realpathSync(resolve(publicDir));
  // Resolve before creation so the server never creates its private store under public assets.
  if (inside(publicRoot, resolve(dataDir)))
    throw Error('Private data must be outside the public root');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const privateRoot = realpathSync(resolve(dataDir));
  if (inside(publicRoot, privateRoot) || inside(privateRoot, publicRoot))
    throw Error('Public and private roots must be separate');
  for (const name of readdirSync(privateRoot))
    if (/^\.[a-f0-9]{32}\.creating$/.test(name))
      rmSync(join(privateRoot, name), { recursive: true, force: true });
  let sessionCount = readdirSync(privateRoot, { withFileTypes: true }).filter(
    (x) => x.isDirectory() && /^[a-f0-9]{32}$/.test(x.name),
  ).length;
  const cookieValue = randomBytes(32).toString('hex');
  const sessions = new Map();
  for (const entry of readdirSync(privateRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue;
    const dir = join(privateRoot, entry.name);
    let saved;
    try {
      saved = JSON.parse(readFileSync(join(dir, 'session.json'), 'utf8'));
    } catch (error) {
      // Preserve old incomplete creations without hiding a corrupt recording journal.
      if (
        !(error instanceof SyntaxError || error.code === 'ENOENT') ||
        readdirSync(dir).some((file) => file !== 'session.json')
      )
        throw error;
      renameSync(dir, join(privateRoot, '.incomplete-' + entry.name));
      continue;
    }
    const session = {
      dir,
      bytes: 0,
      sequence: 0,
      writes: new Map(),
      protocolVersion: saved.protocolVersion || 1,
      requestId: saved.requestId,
      requestHash: saved.requestHash,
      recordingMode: saved.metadata?.recordingMode ?? 'video',
    };
    const log = join(dir, 'events.ndjson');
    let bytes = Buffer.alloc(0);
    try {
      bytes = readFileSync(log);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const boundary = bytes.lastIndexOf(10) + 1;
    // A receipt is issued only after the whole newline-terminated record is flushed.
    // Preserve a torn suffix separately, validate the committed prefix, then repair
    // only that suffix. A malformed complete record is never silently discarded.
    const committed = bytes.subarray(0, boundary);
    for (const line of committed.toString('utf8').split('\n').filter(Boolean)) {
      const record = JSON.parse(line);
      const key = record.media
        ? `media:${record.media.kind}:${record.media.clip}:${record.media.seq}`
        : `event:${record.event.id}`;
      if (!record.uploadHash || record.receipt.sequence !== session.sequence + 1)
        throw Error('Invalid capture journal');
      if (record.media) {
        if (!/^[A-Za-z0-9_-]+\.bin$/.test(record.media.file))
          throw Error('Invalid capture journal media');
        const mediaBytes = readFileSync(join(dir, record.media.file));
        if (mediaBytes.length !== record.media.bytes || digest(mediaBytes) !== record.media.sha256)
          throw Error('Invalid capture journal media');
      }
      session.sequence = record.receipt.sequence;
      session.writes.set(key, { hash: record.uploadHash, receipt: record.receipt });
    }
    if (boundary !== bytes.length) {
      const tail = bytes.subarray(boundary);
      writeFileSync(join(dir, `journal-incomplete-${digest(tail)}.bin`), tail, {
        mode: 0o600,
        flush: true,
      });
      truncateSync(log, boundary);
    }
    // These files have not been renamed into place or journaled; no receipt can
    // refer to them. A retry supplies the complete bytes again.
    for (const file of readdirSync(dir)) {
      if (/^(screen|voice)-[A-Za-z0-9_-]+-[0-9]+\.bin\.pending$/.test(file))
        unlinkSync(join(dir, file));
      else session.bytes += statSync(join(dir, file)).size;
    }
    sessions.set(entry.name, session);
  }
  if (maxRequestBytes > 10 * 1024 ** 2) throw Error('Request limit exceeds write admission budget');
  const writes = processWriteAdmission;
  let queue = Promise.resolve();
  const serialized = (fn) => {
    const result = queue.then(fn);
    queue = result.catch(() => {});
    return result;
  };
  const feedback = new NodeFeedbackStore(privateRoot, {
    budget: feedbackStorageBytes,
    generation: digest(token),
    reference: ({ sessionId }) => {
      if (!sessions.has(sessionId)) throw fail(404, 'Unknown referenced session');
    },
  });
  const feedbackAdmission = feedbackRate();
  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cross-origin-resource-policy', 'same-origin');
    let release;
    const acquireWrite = (size) => {
      if (stalledWrites.size) throw fail(503, 'Storage unavailable');
      const dispose = writes.acquire(size),
        id = {};
      const timer = setTimeout(() => {
        stalledWrites.add(id);
        send(res, 503, { error: 'Storage response deadline; retry later' });
      }, persistenceResponseMs);
      return () => {
        clearTimeout(timer);
        stalledWrites.delete(id);
        dispose();
      };
    };
    try {
      const rawPath = req.url.split('?')[0];
      let decoded;
      try {
        decoded = decodeURIComponent(rawPath);
      } catch {
        throw fail(400, 'Invalid path');
      }
      if (
        decoded.includes('\\') ||
        decoded.includes('\0') ||
        decoded.split('/').some((x) => x === '..' || x.startsWith('.'))
      )
        throw fail(404, 'Not found');
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/join' && req.method === 'GET') {
        const candidate = Buffer.from(url.searchParams.get('token') || '');
        const expected = Buffer.from(token);
        if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected))
          throw fail(401, 'Invalid invitation');
        res.setHeader(
          'set-cookie',
          `playtest=${cookieValue}; Path=/; HttpOnly; SameSite=Lax${req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`,
        );
        res.writeHead(303, { location: '/' });
        res.end();
        return;
      }
      const isFeedbackAdmin = url.pathname.startsWith('/admin/playtest/feedback');
      if (isFeedbackAdmin) {
        const supplied = Buffer.from(req.headers.authorization || '');
        const expected = Buffer.from(`Bearer ${adminToken || ''}`);
        if (
          !adminToken ||
          adminToken.length < 32 ||
          supplied.length !== expected.length ||
          !timingSafeEqual(supplied, expected)
        )
          throw fail(403, 'Admin required');
      }
      if (
        !isFeedbackAdmin &&
        !String(req.headers.cookie || '')
          .split(';')
          .some((x) => x.trim() === `playtest=${cookieValue}`)
      )
        throw fail(401, 'Invitation required');
      if (req.headers['sec-fetch-site'] === 'cross-site')
        throw fail(403, 'Cross-site request denied');
      if (req.headers.origin) {
        let origin;
        try {
          origin = new URL(req.headers.origin);
        } catch {
          throw fail(403, 'Invalid origin');
        }
        if (origin.host !== req.headers.host) throw fail(403, 'Cross-site request denied');
      }
      if (url.pathname === '/api/playtest/config' && req.method === 'GET') {
        send(res, 200, {
          enabled: true,
          protocolVersion: 2,
          supportedProtocols: [1, 2],
          optionalVideo,
          feedback: { enabled: feedbackEnabled, protocolVersion: 1 },
          accountingVersion: 'node-filesystem-v1',
          storageUnavailable: stalledWrites.size > 0,
          limits: {
            eventBytes: Math.min(maxRequestBytes, 2 * 1024 * 1024),
            mediaBytes: maxRequestBytes,
            sessionBytes: maxSessionBytes,
            sessions: maxSessions,
          },
        });
        return;
      }
      if (isFeedbackAdmin) {
        if (url.pathname === '/admin/playtest/feedback' && req.method === 'GET') {
          send(res, 200, feedback.list(feedbackPage(url)));
          return;
        }
        const match = /^\/admin\/playtest\/feedback\/([^/]+)\/(export|delete)$/.exec(url.pathname);
        if (!match || !feedbackId.test(match[1])) throw fail(404, 'Not found');
        if (match[2] === 'export' && req.method === 'GET') {
          send(res, 200, await serialized(() => feedback.export(match[1])));
          return;
        }
        if (match[2] === 'delete' && req.method === 'POST') {
          release = acquireWrite(0);
          await serialized(() => feedback.delete(match[1]));
          send(res, 202, { deleted: true });
          return;
        }
        throw fail(404, 'Not found');
      }
      if (url.pathname === feedbackEndpoint && req.method === 'POST') {
        if (!feedbackEnabled) throw fail(503, 'Feedback disabled');
        if (String(req.headers['content-type'] || '').split(';')[0] !== 'application/json')
          throw fail(415, 'Expected JSON');
        feedbackAdmission();
        release = acquireWrite(feedbackLimits.submissionBytes);
        const bytes = await body(req, feedbackLimits.submissionBytes);
        const result = await serialized(async () => {
          await feedback.cleanup();
          return feedback.submit(bytes);
        });
        send(res, result.status, result.receipt);
        return;
      }
      const v2 = url.pathname.startsWith('/api/playtest/v2/');
      if (
        ['/api/playtest/session', '/api/playtest/v2/session'].includes(url.pathname) &&
        req.method === 'POST'
      ) {
        release = acquireWrite(Math.min(maxRequestBytes, 64 * 1024));
        const raw = await body(req, Math.min(maxRequestBytes, 64 * 1024));
        const input = json(raw),
          metadata = v2 ? input.metadata : input;
        if (
          v2 &&
          (!safeId.test(input.requestId || '') ||
            !metadata ||
            typeof metadata !== 'object' ||
            Array.isArray(metadata))
        )
          throw fail(400, 'Invalid creation identity');
        const recordingMode = metadata.recordingMode ?? 'data';
        if (!['data', 'video'].includes(recordingMode) || (metadata.captureSchema ?? 1) !== 1)
          throw fail(400, 'Invalid recording mode or capture schema');
        const admittedMetadata = { ...metadata, recordingMode, captureSchema: 1 };
        const requestHash = digest(raw);
        await serialized(async () => {
          if (v2) {
            const prior = [...sessions.entries()].find(([, s]) => s.requestId === input.requestId);
            if (prior) {
              if (prior[1].requestHash !== requestHash)
                throw fail(409, 'Creation identity conflict');
              await syncPath(prior[1].dir);
              await syncPath(privateRoot);
              send(res, 200, {
                sessionId: prior[0],
                protocolVersion: 2,
                requestId: input.requestId,
                requestHash,
              });
              return;
            }
          }
          if (recordingMode === 'video' && !optionalVideo)
            throw fail(403, 'Video capture disabled');
          if (sessionCount >= maxSessions) throw fail(429, 'Session limit reached');
          const sessionId = randomBytes(16).toString('hex');
          const dir = join(privateRoot, sessionId);
          const record = JSON.stringify({
            sessionId,
            receivedAt: new Date().toISOString(),
            metadata: admittedMetadata,
            ...(v2 ? { protocolVersion: 2, requestId: input.requestId, requestHash } : {}),
          });
          if (Buffer.byteLength(record) > maxSessionBytes)
            throw fail(413, 'Session storage limit reached');
          const staging = join(privateRoot, `.${sessionId}.creating`);
          mkdirSync(staging, { mode: 0o700 });
          try {
            await writeFile(join(staging, 'session.json'), record, {
              flag: 'wx',
              mode: 0o600,
              flush: true,
            });
            await syncPath(staging);
            await rename(staging, dir);
          } catch (error) {
            await rm(staging, { recursive: true, force: true });
            throw error;
          }
          // Register immediately after atomic publication. A failed directory sync
          // is retried before any receipt; it cannot allocate a second v2 identity.
          sessions.set(sessionId, {
            dir,
            bytes: Buffer.byteLength(record),
            sequence: 0,
            writes: new Map(),
            recordingMode,
            protocolVersion: v2 ? 2 : 1,
            ...(v2 ? { requestId: input.requestId, requestHash } : {}),
          });
          sessionCount++;
          await syncPath(privateRoot);
          send(res, 201, {
            sessionId,
            ...(v2 ? { protocolVersion: 2, requestId: input.requestId, requestHash } : {}),
          });
        });
        return;
      }
      const match = /^\/api\/playtest\/(?:v2\/)?([a-f0-9]{32})\/(event|media)$/.exec(url.pathname);
      if (match && req.method === 'POST') {
        const session = sessions.get(match[1]);
        if (!session) throw fail(404, 'Unknown session');
        if ((session.protocolVersion === 2) !== v2) throw fail(409, 'Capture protocol mismatch');
        let key, event, media;
        if (match[2] === 'media') {
          const kind = url.searchParams.get('kind');
          if (kind === 'screen' && session.recordingMode === 'data')
            throw fail(403, 'Screen media not admitted for data session');
          const clip = url.searchParams.get('clip');
          const seq = url.searchParams.get('seq');
          if (
            !['screen', 'voice'].includes(kind) ||
            !safeId.test(clip || '') ||
            !/^(0|[1-9][0-9]{0,8})$/.test(seq || '')
          )
            throw fail(400, 'Invalid media identity');
          const mime = String(
            req.headers['content-type'] || 'application/octet-stream',
          ).toLowerCase();
          if (!mediaTypes.has(mime.split(';')[0].trim()) || mime.length > 200)
            throw fail(415, 'Unsupported media type');
          key = `media:${kind}:${clip}:${seq}`;
          media = { kind, clip, seq: Number(seq), mime, file: `${kind}-${clip}-${seq}.bin` };
        }
        release = acquireWrite(
          match[2] === 'event' ? Math.min(maxRequestBytes, 2 * 1024 ** 2) : maxRequestBytes,
        );
        const bytes = await body(
          req,
          match[2] === 'event' ? Math.min(maxRequestBytes, 2 * 1024 * 1024) : maxRequestBytes,
        );
        if (!media) {
          event = json(bytes);
          validateEventEnvelope(event);
          key = `event:${event.id}`;
        }
        const hash = digest(Buffer.concat([Buffer.from(media ? media.mime : ''), bytes]));
        await serialized(async () => {
          if (session.failed) throw fail(503, 'Capture journal needs recovery');
          const prior = session.writes.get(key);
          if (prior) {
            if (prior.hash !== hash) throw fail(409, 'Identity already has different content');
            send(res, 200, prior.receipt);
            return;
          }
          const receipt = {
            sequence: session.sequence + 1,
            receivedAt: new Date().toISOString(),
            ...(v2
              ? { protocolVersion: 2, sessionId: match[1], logicalKey: key, uploadHash: hash }
              : {}),
          };
          if (media) {
            media.bytes = bytes.length;
            media.sha256 = digest(bytes);
          }
          const line =
            JSON.stringify({ receipt, uploadHash: hash, ...(media ? { media } : { event }) }) +
            '\n';
          const mediaPath = media && join(session.dir, media.file);
          let existing = null;
          if (media) {
            try {
              existing = await readFile(mediaPath);
            } catch (error) {
              if (error.code !== 'ENOENT') throw error;
            }
          }
          // No journal key means these bytes were never acknowledged. Reuse an
          // exact orphan, or atomically replace a partial uncommitted file. Credit
          // its existing bytes so recovery cannot charge the same chunk twice.
          const added =
            Buffer.byteLength(line) + (media ? bytes.length - (existing?.length ?? 0) : 0);
          if (session.bytes + added > maxSessionBytes)
            throw fail(413, 'Session storage limit reached');
          try {
            if (media && (!existing || !existing.equals(bytes))) {
              await writeFile(`${mediaPath}.pending`, bytes, { mode: 0o600, flush: true });
              await rename(`${mediaPath}.pending`, mediaPath);
            }
            // Persist the media rename before the journal can commit a receipt.
            if (media && existing?.equals(bytes)) await syncPath(mediaPath);
            await syncPath(session.dir);
            await appendFile(join(session.dir, 'events.ndjson'), line, {
              mode: 0o600,
              flush: true,
            });
            await syncPath(session.dir);
          } catch (error) {
            // An append may have completed partly or fully. Never append another
            // record using stale in-memory sequence/accounting: restart validates
            // the journal prefix and reconciles unacknowledged media first.
            session.failed = true;
            throw error;
          }
          session.bytes += added;
          session.sequence++;
          session.writes.set(key, { hash, receipt });
          send(res, 201, receipt);
        });
        return;
      }
      if (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method))
        throw fail(404, 'Not found');
      const filePath = resolve(publicRoot, '.' + (decoded === '/' ? '/index.html' : decoded));
      if (!inside(publicRoot, filePath)) throw fail(404, 'Not found');
      let actual, info;
      try {
        actual = await realpath(filePath);
        info = await stat(actual);
      } catch {
        throw fail(404, 'Not found');
      }
      if (!inside(publicRoot, actual) || !info.isFile()) throw fail(404, 'Not found');
      // Built assets only: no dotfiles, source maps, source files or arbitrary secrets.
      const type = types[extname(actual)];
      if (!type) throw fail(404, 'Not found');
      const content = req.method === 'HEAD' ? null : await readFile(actual);
      res.writeHead(200, { 'content-type': type, 'content-length': info.size });
      res.end(content);
    } catch (error) {
      if (!res.headersSent && [408, 413, 429].includes(error.status)) {
        res.setHeader('connection', 'close');
        if (error.status === 429) res.setHeader('retry-after', '3');
        res.once?.('finish', () => req.destroy());
      }
      if (!res.headersSent)
        send(res, error.status || 500, { error: error.status ? error.message : 'Capture failed' });
      else res.end();
    } finally {
      release?.();
    }
  });
  const feedbackCleanup = setInterval(() => {
    void serialized(() => feedback.cleanup()).catch(() => {});
  }, 60000);
  feedbackCleanup.unref();
  server.on('close', () => clearInterval(feedbackCleanup));
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  server.maxHeadersCount = 40;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createPlaytestServer();
  const port = Number(process.env.PLAYTEST_PORT || 4180);
  server.listen(port, '127.0.0.1', () =>
    process.stdout.write(`Private playtest server listening on 127.0.0.1:${port}\n`),
  );
}
