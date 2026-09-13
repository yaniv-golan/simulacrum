import assert from 'node:assert/strict';
import { cpus, platform } from 'node:os';
import { sourceIdentity } from './source-identity.mjs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createSession } from '../src/simulation/session.mjs';
const profile = process.argv[3] ?? 'independent';
const profiles = {
  independent: { segments: [8, 8, 8, 8], length: 0.27, diameter: 0.02, coupled: false },
  coupled: { segments: [8, 8, 8, 8], length: 0.4, diameter: 0.02, coupled: true },
  'two-long-wide': { segments: [16, 16], length: 4, diameter: 0.04, coupled: true },
  'two-long-thin': { segments: [16, 16], length: 4, diameter: 0.01, coupled: false },
  'four-short-thin': { segments: [8, 8, 8, 8], length: 0.25, diameter: 0.01, coupled: false },
  'four-short-wide': { segments: [8, 8, 8, 8], length: 0.25, diameter: 0.04, coupled: false },
  'mixed-long': { segments: [16, 8, 4, 4], length: 4, diameter: 0.02, coupled: true },
  'odd-long': { segments: [9, 9, 9, 5], length: 4, diameter: 0.02, coupled: true },
};
assert.ok(Object.hasOwn(profiles, profile), 'unknown capacity profile');
const { segments, length, diameter, coupled } = profiles[profile];
const ticks = Number(process.argv[2] ?? 120);
assert.ok(
  Number.isSafeInteger(ticks) && ticks > 0 && ticks <= 72000,
  'bounded positive tick count',
);
const identity = sourceIdentity();
const bp = createEmptyBlueprint('capacity', 'Capacity');
for (let r = 0; r < segments.length; r++) {
  const x = coupled ? 0 : r * 0.8;
  if (!coupled || r === 0)
    bp.parts.push(
      createPart('beam', 'a' + r, [x, 0.32, 0]),
      ...[0.05, 0.15, 0.25].map((y, i) => createPart('powerCell', 'c' + r + '-' + i, [x, y, 0])),
    );
  bp.parts.push(
    createPart('spacerBlock', 'b' + r, [x + 0.2, 0.055, coupled ? (r - 1.5) * 0.1 : 0]),
  );
  bp.connections.push({
    id: 'r' + r,
    kind: 'rope',
    a: { part: 'b' + r, surface: { region: 'top', u: 0, v: 0, twist: 0 } },
    b: { part: 'a' + (coupled ? 0 : r), surface: { region: 'right', u: 0, v: 0, twist: 0 } },
    rope: { restLength: length, diameter, segments: segments[r], material: 'nylon' },
  });
}
const s = await createSession(compileAssembly(bp).configuration);
let completed = 0;
const times = [],
  samples = [];
let contactTicks = 0,
  peakStrain = 0;
const start = performance.now();
try {
  for (; completed < ticks; completed++) {
    s.step(1);
    const f = s.observe().frames.at(-1);
    times.push(f.phaseTimings['integration-contacts']);
    assert.equal(f.ropes.length, 32);
    if (
      f.contacts.rows.some(
        (r) => r.available && Array.isArray(r.normalImpulse) && Math.hypot(...r.normalImpulse) > 0,
      )
    )
      contactTicks++;
    peakStrain = Math.max(peakStrain, ...f.ropes.map((r) => r.strain));
    samples.push({
      tick: f.tick,
      ...f.tickTiming,
      integrationMs: f.phaseTimings['integration-contacts'],
    });
  }
  console.log(
    JSON.stringify(
      {
        identity,
        hardware: { platform: platform(), cpu: cpus()[0]?.model },
        profile,
        authored: profiles[profile],
        coupled,
        contactTicks,
        peakStrain,
        samples,
        ticks: completed,
        wallMs: performance.now() - start,
        integrationMs: {
          mean: times.reduce((a, b) => a + b, 0) / times.length,
          p95: [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.95)],
          max: Math.max(...times),
        },
        frame: s.observe().frames.at(-1),
      },
      null,
      2,
    ),
  );
} finally {
  s.dispose();
}
