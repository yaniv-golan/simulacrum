import test from 'node:test';
import assert from 'node:assert/strict';
import { createClock } from '../src/application/clock.mjs';

test('external display clock advances and reflects before drawing without owning another RAF', () => {
  const events = [];
  const clock = createClock(
    { advanceTime: (ms) => events.push(['step', ms]) },
    {
      externalFrames: true,
      requestFrame: () => assert.fail('second RAF owner'),
      cancelFrame: () => assert.fail('no scheduled frame'),
      render: () => events.push(['reflect']),
    },
  );
  clock.start();
  clock.frame(10);
  events.push(['draw']);
  clock.frame(35);
  events.push(['draw']);
  clock.pause();
  clock.frame(50);
  clock.start();
  clock.frame(100);
  assert.deepEqual(events, [
    ['reflect'],
    ['draw'],
    ['step', 25],
    ['reflect'],
    ['draw'],
    ['reflect'],
  ]);
});
