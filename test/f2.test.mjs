import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateF2 } from '../scripts/qualify-workshop.mjs';
const valid = () =>
  Array.from({ length: 10 }, (_, index) => ({
    cycle: index + 1,
    machine: `machine-${index + 1}`,
    metrics: ['place', 'place', 'place', 'connect', 'connect', 'run', 'run-first-tick'].map(
      (kind) => ({
        kind,
        machine: `machine-${index + 1}`,
        buildId: 'app-frozen',
        timestampSource: 'input-event',
        eventType: 'click',
        inputTime: 10,
        completedAt: 30,
        durationMs: 20,
        ...(kind === 'run-first-tick'
          ? { outcome: 'completed', startTick: 0, tick: 1 }
          : { superseded: false }),
      }),
    ),
  }));
test('complete seventy-event protocol passes with exact percentile and stall result', () => {
  const result = evaluateF2(valid(), { build: 'app-frozen' });
  assert.equal(result.samples, 70);
  assert.equal(result.p95Ms, 20);
  assert.equal(result.maxMs, 20);
});
test('missing, null, superseded, cancelled and non-input samples never disappear from F2', () => {
  const changes = [
    (cycles) => cycles.pop(),
    (cycles) => cycles[0].metrics.pop(),
    (cycles) => (cycles[0].metrics[0].durationMs = null),
    (cycles) => (cycles[0].metrics[0].superseded = true),
    (cycles) => (cycles[0].metrics[6].outcome = 'cancelled'),
    (cycles) => (cycles[0].metrics[0].timestampSource = 'callback'),
    (cycles) => (cycles[0].metrics[0].buildId = 'different'),
    (cycles) => (cycles[0].metrics[0].kind = 'run'),
  ];
  for (const change of changes) {
    const cycles = valid();
    change(cycles);
    assert.throws(() => evaluateF2(cycles, { build: 'app-frozen' }));
  }
});
test('a single stall above 500 ms refuses even when p95 is fast', () => {
  const cycles = valid();
  cycles[9].metrics[6].durationMs = 500.01;
  cycles[9].metrics[6].completedAt = 510.01;
  assert.throws(() => evaluateF2(cycles, { build: 'app-frozen' }), /stall/);
  cycles[9].metrics[6].durationMs = 500;
  cycles[9].metrics[6].completedAt = 510;
  assert.equal(evaluateF2(cycles, { build: 'app-frozen' }).maxMs, 500);
});
test('declared duration cannot conceal a larger measured elapsed time', () => {
  const cycles = valid();
  cycles[0].metrics[0].durationMs = 1;
  cycles[0].metrics[0].completedAt = 1010;
  assert.throws(() => evaluateF2(cycles, { build: 'app-frozen' }), /duration/);
});
test('F2 initializes the shared session before collecting errors and reaches browser launch', async () => {
  const { qualifyWorkshop } = await import('../scripts/qualify-workshop.mjs');
  await assert.rejects(
    qualifyWorkshop(undefined, {
      createEvidence: () => ({
        errors: [],
        launch: async () => {
          throw Error('controlled launch boundary');
        },
      }),
    }),
    /controlled launch boundary/,
  );
});
