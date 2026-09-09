import { readFileSync, writeFileSync, statSync, lstatSync, existsSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createCaptureReviewIndex } from '../src/application/capture-stream.mjs';
const dir = resolve(process.argv[2] ?? '');
function safeWrite(file, bytes) {
  const target = join(dir, file);
  if (existsSync(target) && !lstatSync(target).isFile()) throw Error('Refusing non-regular output');
  writeFileSync(target, bytes, {
    flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW,
  });
}
if (!process.argv[2]) throw Error('Usage: node scripts/export-playtest.mjs <session-directory>');
// Reject an unusable destination before building the offline player. The final
// write still uses O_NOFOLLOW so this preflight is not the security boundary.
const reviewTarget = join(dir, 'review.html');
try {
  if (!lstatSync(reviewTarget).isFile()) throw Error('Refusing non-regular output');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
if (statSync(join(dir, 'events.ndjson')).size > 128 * 1024 * 1024)
  throw Error('Review input exceeds 128 MiB limit');
const records = readFileSync(join(dir, 'events.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      if (Buffer.byteLength(line) > 3 * 1024 * 1024) throw Error('Review row limit exceeded');
      return JSON.parse(line);
    }),
  clips = new Map();
let legacyProvenance = false;
let rawEvidenceRequired = records.some((row) => row.rawEvent);
const sessionFile = join(dir, 'session.json');
if (existsSync(sessionFile)) {
  const info = lstatSync(sessionFile);
  if (!info.isFile() || info.size > 2 * 1024 * 1024) throw Error('Invalid session manifest');
  const manifest = JSON.parse(
    readFileSync(sessionFile, {
      encoding: 'utf8',
      flag: constants.O_RDONLY | constants.O_NOFOLLOW,
    }),
  );
  rawEvidenceRequired ||= manifest.rawEventEvidence === 1;
}
for (const row of records) {
  if (!row.event) continue;
  if (!row.rawEvent) {
    if (rawEvidenceRequired) throw Error('Receipt event is missing raw evidence');
    legacyProvenance = true;
    continue;
  }
  const raw = row.rawEvent;
  if (
    !/^[A-Za-z0-9_-]+\.json$/.test(raw.file) ||
    !Number.isSafeInteger(raw.bytes) ||
    raw.bytes < 0 ||
    raw.bytes > 2 * 1024 * 1024
  )
    throw Error('Invalid raw event metadata');
  const target = join(dir, raw.file),
    info = lstatSync(target);
  if (!info.isFile() || info.size !== raw.bytes) throw Error('Invalid raw event file');
  const bytes = readFileSync(target, { flag: constants.O_RDONLY | constants.O_NOFOLLOW });
  if (createHash('sha256').update(bytes).digest('hex') !== raw.sha256)
    throw Error('Raw event checksum mismatch');
  const event = JSON.parse(bytes.toString('utf8'));
  if (JSON.stringify(event) !== JSON.stringify(row.event))
    throw Error('Embedded event disagrees with raw evidence');
  row.event = event;
}
for (const row of records) {
  if (!row.media) continue;
  if (
    !['screen', 'voice'].includes(row.media.kind) ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(String(row.media.clip)) ||
    !Number.isSafeInteger(row.media.seq) ||
    row.media.seq < 0 ||
    typeof row.media.mime !== 'string'
  )
    throw Error('Invalid media metadata');
  const m = row.media,
    key = `${m.kind}-${m.clip}`;
  if (!clips.has(key)) clips.set(key, []);
  clips.get(key).push(m);
}
const media = [];
for (const [key, chunks] of clips) {
  if (chunks.reduce((sum, c) => sum + c.bytes, 0) > 512 * 1024 * 1024)
    throw Error('Review media clip exceeds 512 MiB');
  chunks.sort((a, b) => a.seq - b.seq);
  const gaps = chunks.some((c, i) => c.seq !== i);
  const extension = chunks[0].mime.includes('mp4') ? 'mp4' : 'webm',
    file = `${key}.${extension}`;
  safeWrite(
    file,
    Buffer.concat(
      chunks.map((c) => {
        if (!/^[a-zA-Z0-9_-]+\.bin$/.test(c.file)) throw Error('Invalid media path');
        const info = lstatSync(join(dir, c.file));
        if (
          !info.isFile() ||
          !Number.isSafeInteger(c.bytes) ||
          c.bytes < 0 ||
          c.bytes > 32 * 1024 * 1024 ||
          info.size !== c.bytes
        )
          throw Error('Invalid media file size or type');
        const bytes = readFileSync(join(dir, c.file));
        if (
          bytes.length !== c.bytes ||
          createHash('sha256').update(bytes).digest('hex') !== c.sha256
        )
          throw Error('Media checksum mismatch; export incomplete');
        return bytes;
      }),
    ),
  );
  media.push({ file, kind: chunks[0].kind, clip: chunks[0].clip, gaps });
}

const payload = JSON.stringify({
  wireEvents: records.filter((r) => r.event).map((r) => r.event),
  media,
  legacyProvenance,
}).replaceAll('<', '\\u003c');
const bundle = await build({
  stdin: {
    contents: `import {createCaptureReviewIndex} from ${JSON.stringify(fileURLToPath(new URL('../src/application/capture-stream.mjs', import.meta.url)))};import {mountCaptureReview} from ${JSON.stringify(fileURLToPath(new URL('../src/presentation/capture-review.mjs', import.meta.url)))};const data=JSON.parse(document.querySelector('#recording').textContent);mountCaptureReview(data,createCaptureReviewIndex(data.wireEvents));`,
    resolveDir: dir,
    loader: 'js',
  },
  bundle: true,
  write: false,
  format: 'iife',
  minify: true,
});
const javascript = bundle.outputFiles[0].text.replaceAll('</script', '<\\/script');
safeWrite(
  'review.html',
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; media-src 'self' file:; connect-src 'none'"><title>Workshop session review</title><style>body{background:#162730;color:#eef;font:16px system-ui;margin:24px}button{padding:8px;margin:4px}pre{white-space:pre-wrap;overflow-wrap:anywhere}canvas,video,img{max-width:100%;height:auto}section{margin:16px 0}input{width:70%}</style><h1>Workshop session review</h1><p>Sampled reconstruction of observed state, not original pixels or a simulation replay. Seeking holds the last available sample; gaps and uncaptured transients cannot be reconstructed. Raw server receipt order remains in events.ndjson. This export does not prove human acceptance or continuous capture.</p><p id="status" role="status"></p><button id="play">Play</button><input aria-label="Session time" id="seek" type="range" min="0" value="0" step="1"><p id="time"></p><div id="scene"></div><p id="unsupported"></p><details><summary>Observed UI, camera and state</summary><pre id="context"></pre></details><h2>Feedback</h2><div id="comments"></div><h2>Optional tab video</h2><p id="video-note"></p><video controls hidden id="screen"></video><details><summary>Event timeline and gaps (state is decoded on seek)</summary><pre id="timeline"></pre></details><script type="application/json" id="recording">${payload}</script><script>${javascript}</script></html>`,
);
console.log(join(dir, 'review.html'));
