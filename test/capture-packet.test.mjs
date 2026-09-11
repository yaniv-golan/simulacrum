import test from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'fflate';
import { packCapturePacket, unpackCapturePacket } from '../src/application/capture-packet.mjs';
const packet = (text) => ({
  id: 'packet-1',
  kind: 'capture-batch',
  data: { schema: 1, events: [{ id: 'event-1', kind: 'sample', data: { text } }] },
});
test('capture packets compress only profitable payloads and preserve exact events', () => {
  const small = packet('small');
  assert.deepEqual(packCapturePacket(small), small);
  const large = packet('repeated observation '.repeat(10000));
  const wire = packCapturePacket(large);
  assert.equal(wire.data.encoding, 'gzip-base64');
  assert.ok(JSON.stringify(wire).length < JSON.stringify(large).length / 10);
  assert.deepEqual(unpackCapturePacket(wire), large);
  assert.deepEqual(packCapturePacket(large), wire);
});
test('capture packets reject malformed, excessive and noncanonical compression', () => {
  const large = packet('repeated observation '.repeat(1000));
  const wire = packCapturePacket(large);
  for (const change of [
    { uncompressedBytes: 1 },
    { uncompressedBytes: 3 * 1024 ** 2 },
    { encoding: 'unknown' },
    { payload: '!' },
    { events: [] },
  ])
    assert.throws(() => unpackCapturePacket({ ...wire, data: { ...wire.data, ...change } }));
  const bytes = Uint8Array.from(atob(wire.data.payload), (c) => c.charCodeAt(0));
  bytes[bytes.length - 8] ^= 1;
  assert.throws(() =>
    unpackCapturePacket({
      ...wire,
      data: { ...wire.data, payload: Buffer.from(bytes).toString('base64') },
    }),
  );
  const bomb = gzipSync(new Uint8Array(3 * 1024 ** 2), { level: 1, mtime: 0 });
  assert.throws(() =>
    unpackCapturePacket({
      ...wire,
      data: {
        ...wire.data,
        uncompressedBytes: 2 * 1024 ** 2,
        payload: Buffer.from(bomb).toString('base64'),
      },
    }),
  );
  assert.throws(() => packCapturePacket(packet('x'.repeat(3 * 1024 ** 2))));
});

test('capture compression rejects optional headers, trailing members and truncation', () => {
  const wire = packCapturePacket(packet('test '.repeat(3000)));
  const bytes = Buffer.from(wire.data.payload, 'base64');
  for (const bad of [
    Buffer.concat([bytes, bytes]),
    bytes.subarray(0, bytes.length - 1),
    Buffer.from(bytes),
  ]) {
    if (bad.length === bytes.length) bad[3] = 8;
    assert.throws(() =>
      unpackCapturePacket({ ...wire, data: { ...wire.data, payload: bad.toString('base64') } }),
    );
  }
});

test('indexed compressed review fits a bounded heap for large expanded histories', async () => {
  const { execFileSync } = await import('node:child_process');
  const codec = new URL('../src/application/capture-stream.mjs', import.meta.url).href;
  const packets = new URL('../src/application/capture-packet.mjs', import.meta.url).href;
  execFileSync(
    process.execPath,
    [
      '--max-old-space-size=96',
      '--input-type=module',
      '-e',
      `
 import {createCaptureReviewIndex} from ${JSON.stringify(codec)};
 import {packCapturePacket} from ${JSON.stringify(packets)};
 const wire=[];
 for(let seq=1;seq<=900;seq++)wire.push(packCapturePacket({id:'p'+seq,kind:'capture-batch',data:{schema:1,events:[{id:'e'+seq,seq,timeMs:seq*100,kind:seq===1?'session-start':seq===900?'session-end':'sample',data:{},contextFrame:{schema:1,kind:'keyframe',base:null,value:{seq,padding:'x'.repeat(128*1024)}}}]}}));
 const index=createCaptureReviewIndex(wire);
 if(index.status!=='complete'||index.readEvent(899).context.seq!==900)throw Error(index.error||'review mismatch');
 wire[0].data.payload='invalid';
 if(index.readEvent(0).context.seq!==1)throw Error('mutable source affected index');
 `,
    ],
    { stdio: 'pipe', timeout: 25000 },
  );
});

test('indexed review rejects interleaved packets but accepts reordered whole batches', async () => {
  const { createCaptureReviewIndex } = await import('../src/application/capture-stream.mjs');
  const events = Array.from({ length: 4 }, (_, i) => ({
    id: `event-${i + 1}`,
    seq: i + 1,
    timeMs: i * 100,
    kind: i === 0 ? 'session-start' : i === 3 ? 'session-end' : 'sample',
    data: {},
    contextFrame: {
      schema: 1,
      kind: 'keyframe',
      base: null,
      value: { seq: i + 1, padding: 'x'.repeat(8192) },
    },
  }));
  const batch = (id, rows) =>
    packCapturePacket({ id, kind: 'capture-batch', data: { schema: 1, events: rows } });
  const reordered = createCaptureReviewIndex([
    batch('later', events.slice(2)),
    batch('earlier', events.slice(0, 2)),
  ]);
  assert.equal(reordered.status, 'complete');
  assert.deepEqual(
    [0, 1, 2, 3].map((i) => reordered.readEvent(i).context.seq),
    [1, 2, 3, 4],
  );
  const hostile = createCaptureReviewIndex([
    batch('odd', [events[0], events[2]]),
    batch('even', [events[1], events[3]]),
  ]);
  assert.equal(hostile.status, 'invalid');
  assert.match(hostile.error, /interleaved packets/);
  assert.equal(hostile.events.length, 0);
});
