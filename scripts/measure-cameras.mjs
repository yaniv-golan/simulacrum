import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform } from 'node:os';
import { createPart, createEmptyBlueprint } from '../src/model/blueprint.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { CAMERA } from '../src/model/camera.mjs';
const p95 = (a) => [...a].sort((a, b) => a - b)[Math.ceil(a.length * 0.95) - 1];
const out = 'artifacts/camera-performance';
mkdirSync(out, { recursive: true });
const trials = [];
function fixture(count) {
  const bp = createEmptyBlueprint('camera-load', 'Camera load');
  bp.parts = [createPart('powerCell', 'cell', [0, 0.05, 0])];
  for (let i = 0; i < 32; i++) {
    const part = createPart(i < count ? 'camera' : 'spacerBlock', `body-${i}`, [
      (i % 8) * 0.15 + 1,
      0.02,
      Math.floor(i / 8) * 0.15,
    ]);
    bp.parts.push(part);
    if (i < count)
      bp.connections.push({
        id: `wire-${i}`,
        kind: 'power',
        a: { part: 'cell', port: 'power' },
        b: { part: part.id, port: 'power' },
      });
  }
  return compileAssembly(bp).configuration;
}
for (let trial = 0; trial < 3; trial++)
  for (const count of trial % 2 ? [CAMERA.maxParts, 1, 0] : [0, 1, CAMERA.maxParts]) {
    const s = await createSession(fixture(count));
    try {
      s.step(240);
      const total = [],
        phases = {};
      for (let i = 0; i < 480; i++) {
        const start = performance.now();
        s.step(1);
        total.push(performance.now() - start);
        const f = s.observe().frames[0];
        for (const [p, v] of Object.entries(f.phaseTimings)) (phases[p] ??= []).push(v);
        assert.equal(f.cameras?.length ?? 0, count);
      }
      trials.push({
        trial,
        count,
        totalP95: p95(total),
        phaseP95: Object.fromEntries(Object.entries(phases).map(([p, v]) => [p, p95(v)])),
        raw: { total, phases },
      });
    } finally {
      s.dispose();
    }
  }
const report = {
  source: sourceIdentity(),
  hardware: { cpu: cpus()[0].model, platform: platform(), node: process.version },
  fixture:
    '33 ordinary separate floor-contact bodies; zero, one and eight powered cameras; this does not qualify arbitrary assemblies',
  thresholds: { wholeTickMs: 10 / 3, actuatorsMs: 2, integrationMs: 2 },
  trials,
};
writeFileSync(`${out}/simulation.json`, JSON.stringify(report, null, 2));
for (const t of trials) {
  assert.ok(t.totalP95 <= 10 / 3, `camera ${t.count} tick ${t.totalP95} exceeds 3.333 ms`);
  assert.ok(t.phaseP95['integration-contacts'] <= 2);
  assert.ok(t.phaseP95['actuators-constraints'] <= 2);
}
await assert.rejects(() => createSession(fixture(CAMERA.maxParts + 1)), /CAMERA_LIMIT/);
console.log(
  trials.map(({ trial, count, totalP95, phaseP95 }) => ({ trial, count, totalP95, phaseP95 })),
);
