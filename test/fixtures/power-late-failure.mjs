import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
// Inject only at the existing session-to-power receipt boundary; the first motor
// retains its genuine physics receipt and the second gets a forged work value.
let injected = 0;
const mode = process.argv[2] ?? 'failure';
registerHooks({
  load(url, context, next) {
    const loaded = next(url, context);
    if (url.endsWith('/src/simulation/power.mjs') && process.env.POWER_BASELINE_SOURCE)
      return { ...loaded, source: readFileSync(process.env.POWER_BASELINE_SOURCE, 'utf8') };
    if (!url.endsWith('/src/simulation/session.mjs')) return loaded;
    const source = String(loaded.source);
    const marker = '              power.completeStep(\n';
    assert.ok(source.includes(marker), 'session completion seam must still exist');
    return {
      ...loaded,
      source: source.replace(
        marker,
        `
              if (globalThis.__latePowerFailure) globalThis.__latePowerFailure(receipts);
${marker}`,
      ),
    };
  },
});
globalThis.__latePowerFailure = (receipts) => {
  assert.equal(receipts.length, 2);
  assert.ok(receipts[0].workJ > 0, 'first receipt must reach a nonzero motor update');
  assert.ok(receipts[1].workJ > 0);
  injected++;
  if (mode === 'failure') receipts[1].workJ += 1;
};
const { createSession } = await import('../../src/simulation/session.mjs');
const body = (x) => ({
  position: [x, 0, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  mass: 1,
  shape: 'box',
  halfExtents: [0.1, 0.1, 0.1],
  fixed: false,
  friction: 0,
  restitution: 0,
});
const config = {
  gravity: [0, 0, 0],
  bodies: [body(0), body(0), body(10), body(10), body(20)],
  joints: [0, 2].map((a) => ({
    kind: 'revolute',
    a,
    b: a + 1,
    anchorA: [0, 0, 0],
    anchorB: [0, 0, 0],
    axisA: [1, 0, 0],
    axisB: [1, 0, 0],
  })),
  power: {
    cells: [
      { node: 4, voltage: 12, capacityJ: 1000, initialJ: 1000, resistance: 1, currentLimit: 2 },
    ],
    motors: [0, 2].map((node, joint) => ({
      node,
      body: node,
      rotor: node + 1,
      joint,
      axis: [1, 0, 0],
      torqueConstant: 0.1,
      resistance: 1,
      currentLimit: 2,
      defaultDuty: 1,
    })),
    wires: [
      [4, 0],
      [4, 2],
    ],
    signalWires: [],
    receivers: [],
    controllers: [],
    sensors: [],
  },
};
const session = await createSession(config, { build: 'power-failure-comparison' });
try {
  const before = session.observe().frames.at(-1).power;
  if (mode === 'failure') {
    assert.throws(() => session.step(1), /ENERGY_INVARIANT/);
    assert.equal(session.failureBundle().reasonCode, 'ENERGY_INVARIANT');
    assert.deepEqual(session.observe().frames.at(-1).power, before);
    assert.deepEqual(session.failureBundle().completed.power, before);
  } else {
    session.step(1);
    assert.equal(session.failureBundle(), null);
    assert.ok(
      session
        .observe()
        .frames.at(-1)
        .power.motors.every((m) => m.heatJ > 0),
    );
  }
  assert.equal(injected, 1);
  process.stdout.write(
    JSON.stringify({
      power: session.observe().frames.at(-1).power,
      failureBundle: session.failureBundle(),
    }) + '\n',
  );
} finally {
  session.dispose();
  delete globalThis.__latePowerFailure;
}
