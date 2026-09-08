import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const dir = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw Error('Usage: node scripts/export-playtest.mjs <session-directory>');
const records = readFileSync(join(dir, 'events.ndjson'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(JSON.parse),
  clips = new Map();
for (const row of records) {
  if (!row.media) continue;
  const m = row.media,
    key = `${m.kind}-${m.clip}`;
  if (!clips.has(key)) clips.set(key, []);
  clips.get(key).push(m);
}
const media = [];
for (const [key, chunks] of clips) {
  chunks.sort((a, b) => a.seq - b.seq);
  const gaps = chunks.some((c, i) => c.seq !== i);
  const extension = chunks[0].mime.includes('mp4') ? 'mp4' : 'webm',
    file = `${key}.${extension}`;
  writeFileSync(
    join(dir, file),
    Buffer.concat(
      chunks.map((c) => {
        if (!/^[a-zA-Z0-9_-]+\.bin$/.test(c.file)) throw Error('Invalid media path');
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
  events: records.filter((r) => r.event).map((r) => r.event),
  media,
}).replaceAll('<', '\\u003c');
writeFileSync(
  join(dir, 'review.html'),
  `<!doctype html><meta charset="utf-8"><title>Workshop playtest review</title><style>body{background:#162730;color:#eef;font:16px system-ui;margin:24px}video{width:65vw}button{padding:8px;margin:4px}pre{white-space:pre-wrap}img{max-width:65vw}</style><h1>Workshop session</h1><p>Comments seek the recorded tab to their anchor. Raw events retain exact state and server receipt order in events.ndjson. Media with gaps is marked incomplete. Continuous capture and final completion are not proven by this export.</p><video controls id="screen"></video><div id="comments"></div><details><summary>Full event timeline</summary><pre id="timeline"></pre></details><script>const data=${payload};const screen=document.querySelector('#screen');screen.src=data.media.find(m=>m.kind==='screen')?.file??'';document.querySelector('#timeline').textContent=JSON.stringify(data.events,null,2);for(const e of data.events.filter(e=>['feedback-text','voice-start'].includes(e.kind))){const anchor=data.events.find(a=>a.kind==='feedback-anchor'&&a.data.id===e.data.anchorId);const row=document.createElement('section'),button=document.createElement('button');button.textContent=(anchor?.timeMs/1000).toFixed(1)+'s — '+(e.kind==='feedback-text'?e.data.text:'Voice comment');button.onclick=()=>{screen.currentTime=(anchor?.timeMs??e.timeMs)/1000;};row.append(button);if(e.kind==='voice-start'){const audio=document.createElement('audio');audio.controls=true;audio.src=data.media.find(m=>m.kind==='voice'&&m.clip===e.data.clip)?.file??'';row.append(audio);}document.querySelector('#comments').append(row);}for(const m of data.media.filter(m=>m.gaps)){const p=document.createElement('p');p.textContent='Incomplete media: '+m.file;document.body.prepend(p);}</script>`,
);
console.log(join(dir, 'review.html'));
