import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewTimeline,
  seekReview,
  sceneParts,
  safeMedia,
} from '../src/presentation/capture-review-model.mjs';
test('sampled review seeks only observed states and preserves terminal honesty', () => {
  const first = { timeMs: 10, kind: 'state', context: { observation: { physics: [] } } },
    last = { timeMs: 30, kind: 'state', context: { observation: { physics: [] } } };
  const timeline = reviewTimeline({ events: [first, last], status: 'unfinished', gaps: [] });
  assert.equal(seekReview(timeline, 9), null);
  assert.equal(seekReview(timeline, 29), first);
  assert.equal(seekReview(timeline, 30), last);
  assert.equal(timeline.status, 'unfinished');
});
test('review rejects oversized/hostile geometry and remote media', () => {
  assert.throws(() => sceneParts({ metadata: { blueprint: { parts: Array(513).fill({}) } } }));
  assert.throws(() =>
    sceneParts({ metadata: { blueprint: { parts: [{ id: 'bad', type: '__proto__' }] } } }),
  );
  assert.equal(safeMedia('https://host/clip.webm'), false);
  assert.equal(safeMedia('../clip.webm'), false);
  assert.equal(safeMedia('screen-abc.webm'), true);
});
import { createPart } from '../src/model/blueprint.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
test('geometry follows captured physics rather than original placement', () => {
  const part = createPart('beam', 'a', [9, 9, 9]);
  const [shown] = sceneParts({
    metadata: { blueprint: { parts: [part] } },
    physics: [{ position: [1, 2, 3], rotation: [0, 0, 0, 1] }],
  });
  assert.deepEqual(shown.position, [1, 2, 3]);
  assert.ok(shown.primitives.length);
});
test('offline exporter escapes hostile text and supports an unfinished no-video legacy session', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-review-'));
  try {
    writeFileSync(
      join(dir, 'events.ndjson'),
      JSON.stringify({
        receipt: { sequence: 1 },
        event: { id: 'start', seq: 1, timeMs: 0, kind: 'session-start', data: {}, context: null },
      }) +
        '\n' +
        JSON.stringify({
          event: {
            id: 'x',
            seq: 2,
            timeMs: 0,
            kind: 'feedback-text',
            data: { text: '</script><script>window.pwned=true</script>' },
            context: { observation: { physics: [], metadata: { blueprint: { parts: [] } } } },
          },
        }) +
        '\n',
    );
    execFileSync(process.execPath, ['scripts/export-playtest.mjs', dir]);
    const html = readFileSync(join(dir, 'review.html'), 'utf8');
    assert.ok(html.includes('Sampled reconstruction'));
    assert.ok(html.includes('\\u003c/script>'));
    assert.ok(!html.includes('<script>window.pwned'));
    assert.ok(html.includes('connect-src'));
    assert.match(html, /"legacyProvenance":true/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('seeking within a known missing interval does not present prior state as that interval', () => {
  const timeline = reviewTimeline({
    events: [
      { timeMs: 10, context: { observation: {} } },
      { timeMs: 30, context: { observation: {} } },
    ],
    gaps: [{ fromTimeMs: 11, toTimeMs: 30 }],
  });
  assert.equal(seekReview(timeline, 20), null);
  assert.equal(seekReview(timeline, 30).timeMs, 30);
});

import { createHash } from 'node:crypto';
test('export refuses symlink output and inconsistent authenticated raw event evidence', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-export-security-'));
  try {
    const event = {
      id: 'start',
      seq: 1,
      timeMs: 0,
      kind: 'session-start',
      context: null,
      data: {},
    };
    const raw = JSON.stringify(event);
    writeFileSync(join(dir, 'event-1.json'), raw);
    const row = {
      receipt: { sequence: 1 },
      event,
      rawEvent: {
        file: 'event-1.json',
        bytes: Buffer.byteLength(raw),
        sha256: createHash('sha256').update(raw).digest('hex'),
      },
    };
    writeFileSync(join(dir, 'events.ndjson'), JSON.stringify(row));
    writeFileSync(join(dir, 'victim'), 'unchanged');
    symlinkSync(join(dir, 'victim'), join(dir, 'review.html'));
    assert.throws(() =>
      execFileSync(process.execPath, ['scripts/export-playtest.mjs', dir], { stdio: 'pipe' }),
    );
    assert.equal(readFileSync(join(dir, 'victim'), 'utf8'), 'unchanged');
    rmSync(join(dir, 'review.html'));
    row.event = { ...event, context: { forged: true } };
    writeFileSync(join(dir, 'events.ndjson'), JSON.stringify(row));
    assert.throws(
      () => execFileSync(process.execPath, ['scripts/export-playtest.mjs', dir], { stdio: 'pipe' }),
      /Embedded event disagrees/,
    );
    row.event = event;
    writeFileSync(join(dir, 'events.ndjson'), JSON.stringify(row));
    execFileSync(process.execPath, ['scripts/export-playtest.mjs', dir]);
    assert.ok(readFileSync(join(dir, 'review.html'), 'utf8').includes('wireEvents'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('unavailable latest sample blocks stale display through the next keyframe', () => {
  const timeline = reviewTimeline({
    events: [
      { seq: 1, timeMs: 100, available: true },
      { seq: 3, timeMs: 300, available: false },
      { seq: 4, timeMs: 400, available: true },
    ],
    gaps: [{ fromTimeMs: 100, toTimeMs: 300 }],
  });
  assert.equal(seekReview(timeline, 350), null);
  assert.equal(seekReview(timeline, 400).seq, 4);
  const unfinished = reviewTimeline({ events: timeline.events.slice(0, 2), gaps: timeline.gaps });
  assert.equal(seekReview(unfinished, 500), null);
});

test('marked raw-evidence archives reject legacy receipt journals without raw files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'capture-legacy-receipt-'));
  try {
    writeFileSync(
      join(dir, 'events.ndjson'),
      JSON.stringify({
        receipt: { sequence: 1 },
        event: { id: 'e1', seq: 1, timeMs: 0, kind: 'session-start', context: null, data: {} },
      }),
    );
    writeFileSync(join(dir, 'session.json'), JSON.stringify({ rawEventEvidence: 1 }));
    assert.throws(
      () => execFileSync(process.execPath, ['scripts/export-playtest.mjs', dir], { stdio: 'pipe' }),
      /missing raw evidence/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
