import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlacementLifecycle } from '../src/presentation/placement-lifecycle.mjs';
test('placement commits valid previews once, rejects stale completions and cancels pointer ownership', () => {
  const s = createPlacementLifecycle(),
    proposal = { id: 'ordinary candidate' };
  s.begin(true);
  s.assess(null);
  s.pointer(false);
  assert.equal(s.read().kind, 'blocked');
  assert.equal(s.read().pointerHeld, false);
  assert.equal(s.commit(), null);
  s.assess(proposal);
  const token = s.commit();
  assert.equal(s.commit(), null);
  // A geometry refresh must not reopen a command already in flight.
  s.assess(proposal);
  assert.equal(s.read().kind, 'committing');
  s.cancel();
  s.begin(false);
  s.assess(proposal);
  assert.equal(s.settle(token, true), false);
  assert.equal(s.read().kind, 'preview');
  const second = s.commit();
  assert.equal(s.settle(second, false), true);
  assert.equal(s.read().proposal, null);
  s.begin(true);
  s.cancel();
  assert.deepEqual(s.read(), { kind: 'idle', pointerHeld: false, proposal: null });
});
