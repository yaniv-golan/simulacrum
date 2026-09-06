// M3b: private, bounded remote playtest capture. Receipts order completed uploads at the server.
import { createServer } from 'node:http';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { mkdirSync, realpathSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { appendFile, writeFile, stat, realpath, readFile, unlink } from 'node:fs/promises';
import { resolve, relative, sep, extname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const safeId = /^[A-Za-z0-9_-]{1,80}$/;
const mediaTypes = new Set(['video/webm', 'audio/webm', 'audio/mp4', 'video/mp4', 'application/octet-stream']);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
const digest = data => createHash('sha256').update(data).digest('hex');
const inside = (root, path) => { const r = relative(root, path); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !r.startsWith(sep)); };
const fail = (status, message) => Object.assign(new Error(message), { status });
function send(res, status, value) { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); }
async function body(req, limit) {
  if (Number(req.headers['content-length']) > limit) { req.resume(); throw fail(413, 'Request too large'); }
  const chunks = []; let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) { size += chunk.length; if (size > limit) { req.resume(); throw fail(413, 'Request too large'); } chunks.push(chunk); }
  return Buffer.concat(chunks);
}
function json(bytes) { try { const value = JSON.parse(bytes.length ? bytes.toString('utf8') : '{}'); if (!value || Array.isArray(value) || typeof value !== 'object') throw Error(); return value; } catch { throw fail(400, 'Expected a JSON object'); } }

export function createPlaytestServer({ publicDir = process.env.PLAYTEST_PUBLIC_DIR, dataDir = process.env.PLAYTEST_DATA_DIR, token = process.env.PLAYTEST_TOKEN, maxRequestBytes = 10 * 1024 * 1024, maxSessionBytes = 1024 ** 3, maxSessions = 20 } = {}) {
  if (!publicDir || !dataDir || !token || token.length < 32) throw Error('PLAYTEST_PUBLIC_DIR, PLAYTEST_DATA_DIR and PLAYTEST_TOKEN (at least 32 characters) are required');
  for (const n of [maxRequestBytes, maxSessionBytes, maxSessions]) if (!Number.isSafeInteger(n) || n < 1) throw Error('Limits must be positive integers');
  const publicRoot = realpathSync(resolve(publicDir));
  // Resolve before creation so the server never creates its private store under public assets.
  if (inside(publicRoot, resolve(dataDir))) throw Error('Private data must be outside the public root');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const privateRoot = realpathSync(resolve(dataDir));
  if (inside(publicRoot, privateRoot) || inside(privateRoot, publicRoot)) throw Error('Public and private roots must be separate');
  let sessionCount = readdirSync(privateRoot, { withFileTypes: true }).filter(x => x.isDirectory()).length;
  const cookieValue = randomBytes(32).toString('hex');
  const sessions = new Map();
  for (const entry of readdirSync(privateRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^[a-f0-9]{32}$/.test(entry.name)) continue;
    const dir = join(privateRoot, entry.name);
    const session = { dir, bytes: 0, sequence: 0, writes: new Map() };
    for (const file of readdirSync(dir)) session.bytes += statSync(join(dir, file)).size;
    const log = join(dir, 'events.ndjson');
    let content = ''; try { content = readFileSync(log, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const line of content.split('\n').filter(Boolean)) {
      const record = JSON.parse(line);
      const key = record.media ? `media:${record.media.kind}:${record.media.clip}:${record.media.seq}` : `event:${record.event.id}`;
      if (!record.uploadHash || record.receipt.sequence !== session.sequence + 1) throw Error('Invalid capture journal');
      session.sequence = record.receipt.sequence;
      session.writes.set(key, { hash: record.uploadHash, receipt: record.receipt });
    }
    sessions.set(entry.name, session);
  }
  let queue = Promise.resolve();
  const serialized = fn => { const result = queue.then(fn); queue = result.catch(() => {}); return result; };
  const server = createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store'); res.setHeader('x-content-type-options', 'nosniff'); res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('cross-origin-resource-policy', 'same-origin');
    try {
      const rawPath = req.url.split('?')[0];
      let decoded; try { decoded = decodeURIComponent(rawPath); } catch { throw fail(400, 'Invalid path'); }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(x => x === '..' || x.startsWith('.'))) throw fail(404, 'Not found');
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/join' && req.method === 'GET') {
        const candidate = Buffer.from(url.searchParams.get('token') || ''); const expected = Buffer.from(token);
        if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) throw fail(401, 'Invalid invitation');
        res.setHeader('set-cookie', `playtest=${cookieValue}; Path=/; HttpOnly; SameSite=Lax${req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}`);
        res.writeHead(303, { location: '/' }); res.end(); return;
      }
      if (!String(req.headers.cookie || '').split(';').some(x => x.trim() === `playtest=${cookieValue}`)) throw fail(401, 'Invitation required');
      if (req.headers['sec-fetch-site'] === 'cross-site') throw fail(403, 'Cross-site request denied');
      if (req.headers.origin) { let origin; try { origin = new URL(req.headers.origin); } catch { throw fail(403, 'Invalid origin'); } if (origin.host !== req.headers.host) throw fail(403, 'Cross-site request denied'); }
      if (url.pathname === '/api/playtest/config' && req.method === 'GET') { send(res, 200, { enabled: true, limits: { eventBytes: Math.min(maxRequestBytes, 2 * 1024 * 1024), mediaBytes: maxRequestBytes, sessionBytes: maxSessionBytes, sessions: maxSessions } }); return; }
      if (url.pathname === '/api/playtest/session' && req.method === 'POST') {
        const metadata = json(await body(req, Math.min(maxRequestBytes, 64 * 1024)));
        await serialized(async () => {
          if (sessionCount >= maxSessions) throw fail(429, 'Session limit reached');
          const sessionId = randomBytes(16).toString('hex'); const dir = join(privateRoot, sessionId);
          const record = JSON.stringify({ sessionId, receivedAt: new Date().toISOString(), metadata });
          if (Buffer.byteLength(record) > maxSessionBytes) throw fail(413, 'Session storage limit reached');
          mkdirSync(dir, { mode: 0o700 }); await writeFile(join(dir, 'session.json'), record, { flag: 'wx', mode: 0o600 });
          sessions.set(sessionId, { dir, bytes: Buffer.byteLength(record), sequence: 0, writes: new Map() }); sessionCount++;
          send(res, 201, { sessionId });
        }); return;
      }
      const match = /^\/api\/playtest\/([a-f0-9]{32})\/(event|media)$/.exec(url.pathname);
      if (match && req.method === 'POST') {
        const session = sessions.get(match[1]); if (!session) throw fail(404, 'Unknown session');
        let key, event, media;
        if (match[2] === 'media') {
          const kind = url.searchParams.get('kind'); const clip = url.searchParams.get('clip'); const seq = url.searchParams.get('seq');
          if (!['screen', 'voice'].includes(kind) || !safeId.test(clip || '') || !/^(0|[1-9][0-9]{0,8})$/.test(seq || '')) throw fail(400, 'Invalid media identity');
          const mime = String(req.headers['content-type'] || 'application/octet-stream').toLowerCase();
          if (!mediaTypes.has(mime.split(';')[0].trim()) || mime.length > 200) throw fail(415, 'Unsupported media type');
          key = `media:${kind}:${clip}:${seq}`; media = { kind, clip, seq: Number(seq), mime, file: `${kind}-${clip}-${seq}.bin` };
        }
        const bytes = await body(req, match[2] === 'event' ? Math.min(maxRequestBytes, 2 * 1024 * 1024) : maxRequestBytes);
        if (!media) { event = json(bytes); if (!safeId.test(event.id || '')) throw fail(400, 'Event id required'); key = `event:${event.id}`; }
        const hash = digest(Buffer.concat([Buffer.from(media ? media.mime : ''), bytes]));
        await serialized(async () => {
          const prior = session.writes.get(key);
          if (prior) { if (prior.hash !== hash) throw fail(409, 'Identity already has different content'); send(res, 200, prior.receipt); return; }
          const receipt = { sequence: session.sequence + 1, receivedAt: new Date().toISOString() };
          if (media) { media.bytes = bytes.length; media.sha256 = digest(bytes); }
          const line = JSON.stringify({ receipt, uploadHash: hash, ...(media ? { media } : { event }) }) + '\n';
          const added = Buffer.byteLength(line) + (media ? bytes.length : 0);
          if (session.bytes + added > maxSessionBytes) throw fail(413, 'Session storage limit reached');
          if (media) await writeFile(join(session.dir, media.file), bytes, { flag: 'wx', mode: 0o600 });
          try { await appendFile(join(session.dir, 'events.ndjson'), line, { mode: 0o600 }); }
          catch (error) { if (media) await unlink(join(session.dir, media.file)); throw error; }
          session.bytes += added; session.sequence++; session.writes.set(key, { hash, receipt }); send(res, 201, receipt);
        }); return;
      }
      if (url.pathname.startsWith('/api/') || !['GET', 'HEAD'].includes(req.method)) throw fail(404, 'Not found');
      const filePath = resolve(publicRoot, '.' + (decoded === '/' ? '/index.html' : decoded));
      if (!inside(publicRoot, filePath)) throw fail(404, 'Not found');
      let actual, info; try { actual = await realpath(filePath); info = await stat(actual); } catch { throw fail(404, 'Not found'); }
      if (!inside(publicRoot, actual) || !info.isFile()) throw fail(404, 'Not found');
      // Built assets only: no dotfiles, source maps, source files or arbitrary secrets.
      const type = types[extname(actual)]; if (!type) throw fail(404, 'Not found');
      const content = req.method === 'HEAD' ? null : await readFile(actual);
      res.writeHead(200, { 'content-type': type, 'content-length': info.size }); res.end(content);
    } catch (error) { if (!res.headersSent) send(res, error.status || 500, { error: error.status ? error.message : 'Capture failed' }); else res.end(); }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 15_000; server.maxHeadersCount = 40;
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const server = createPlaytestServer();
  const port = Number(process.env.PLAYTEST_PORT || 4180);
  server.listen(port, '127.0.0.1', () => process.stdout.write(`Private playtest server listening on 127.0.0.1:${port}\n`));
}
