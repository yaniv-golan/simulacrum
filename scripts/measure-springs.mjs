import { createSession } from '../src/simulation/session.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
const body = (x, y, fixed = false) => ({
  shape: 'box',
  position: [x, y, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  mass: 1,
  halfExtents: [0.01, 0.01, 0.01],
  fixed,
  friction: 0,
  restitution: 0,
});
const cases = [];
for (const count of [0, 1, 8, 32])
  for (const dense of [false, true]) {
    const bodies = [],
      joints = [];
    if (dense) bodies.push(body(0, 0, true));
    for (let i = 0; i < count; i++) {
      const a = dense ? 0 : bodies.push(body(i, 0, true)) - 1,
        b = bodies.push(body(i, 0.35)) - 1;
      joints.push({
        kind: 'spring',
        a,
        b,
        anchorA: dense ? [i, 0, 0] : [0, 0, 0],
        anchorB: [0, 0, 0],
        axisA: [0, 1, 0],
        axisB: [0, 1, 0],
        limits: [0.08, 0.4],
        restLength: 0.3,
        stiffness: 20,
        damping: 2,
      });
    }
    let session;
    try {
      session = await createSession({
        gravity: [0, -9.81, 0],
        bodies,
        joints,
        power: {
          cells: [],
          motors: [],
          wires: [],
          signalWires: [],
          receivers: [],
          controllers: [],
          sensors: [],
        },
      });
    } catch (error) {
      cases.push({ count, dense, rejected: error.message });
      continue;
    }
    try {
      const times = [],
        phases = {};
      for (let i = 0; i < 150; i++) {
        const start = performance.now();
        session.step(1);
        times.push(performance.now() - start);
        const f = session.observe().frames[0];
        for (const [p, ms] of Object.entries(f.phaseTimings)) (phases[p] ??= []).push(ms);
      }
      const quantile = (a, p) => [...a].sort((a, b) => a - b)[Math.floor((a.length - 1) * p)];
      cases.push({
        count,
        dense,
        stiffness: 20,
        tickMedianMs: quantile(times, 0.5),
        tickP95Ms: quantile(times, 0.95),
        phaseP95Ms: Object.fromEntries(
          Object.entries(phases).map(([k, v]) => [k, quantile(v, 0.95)]),
        ),
      });
    } finally {
      session.dispose();
    }
  }
mkdirSync('artifacts/springs', { recursive: true });
writeFileSync(
  'artifacts/springs/performance.json',
  JSON.stringify(
    { source: sourceIdentity(), runtime: process.version, cpu: cpus()[0].model, cases },
    null,
    2,
  ),
);
console.log(
  cases.map(({ count, dense, tickMedianMs, tickP95Ms }) => ({
    count,
    dense,
    tickMedianMs,
    tickP95Ms,
  })),
);
