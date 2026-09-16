import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPlacementLifecycle,
  placementPresentation,
} from '../src/presentation/placement-lifecycle.mjs';
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
test('one vocabulary names both homes of the same placement act', () => {
  const preview = { kind: 'preview', pointerHeld: false, proposal: { id: 'ordinary' } },
    held = { ...preview, pointerHeld: true },
    choosing = { kind: 'choosing', pointerHeld: false, proposal: null };
  // The strip over the bench: no face and no rotation, so it borrows neither word.
  const strip = placementPresentation(preview, { free: true });
  assert.deepEqual(
    [strip.control, strip.label, strip.instruction],
    ['Place part', 'Preview · not placed', 'Click Place part'],
  );
  assert.equal(placementPresentation(choosing, { free: true }).label, 'Preview · not placed');
  for (const word of ['face', 'surface', 'attach', 'turn'])
    assert.equal(`${strip.label} ${strip.instruction}`.toLowerCase().includes(word), false);
  // The surface panel owns faces and turning, and says so in its own words.
  const attach = placementPresentation(preview);
  assert.deepEqual(
    [attach.control, attach.label, attach.instruction],
    ['Attach', 'Preview · not attached', 'Click Attach'],
  );
  const positionOnly = placementPresentation(preview, { attach: false });
  assert.deepEqual(
    [positionOnly.control, positionOnly.label, positionOnly.instruction],
    ['Place only', 'Preview · position only', 'Click Place only'],
  );
  const adjusting = placementPresentation(preview, { adjusting: true });
  assert.deepEqual(
    [adjusting.control, adjusting.label, adjusting.instruction],
    ['Apply mount', 'Preview · mount adjustment', 'Click Apply mount'],
  );
  assert.equal(placementPresentation(choosing).label, 'Choose a surface');
  assert.equal(
    placementPresentation(held, { free: true }).instruction,
    'Release mouse button to place',
  );
  assert.equal(placementPresentation(held).instruction, 'Release mouse button to attach');
  // Neither home invents a state word of its own.
  for (const options of [{ free: true }, {}, { attach: false }, { adjusting: true }]) {
    assert.equal(placementPresentation({ ...preview, kind: 'idle' }, options).label, '');
    assert.equal(
      placementPresentation({ ...preview, kind: 'blocked' }, options).label,
      'Blocked · not placed',
    );
    assert.equal(
      placementPresentation({ ...preview, kind: 'committing' }, options).label,
      'Applying placement',
    );
  }
});
