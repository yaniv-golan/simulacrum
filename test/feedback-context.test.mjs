import test from 'node:test';
import assert from 'node:assert/strict';
import { captureFeedbackContext } from '../src/application/feedback-context.mjs';
import { feedbackLimits } from '../src/application/feedback-protocol.mjs';

test('feedback context preserves authored programs and current UI without replay checkpoint bytes', () => {
  const project = { parts: [{ id: 'controller', program: 'player-authored source' }] };
  const state = { cursor: { tick: 12 }, ui: { selected: 'controller' }, mode: 'build' };
  let checkpointReads = 0;
  const workshop = {
    save: () => structuredClone(project),
    checkpoint: () => {
      checkpointReads++;
      return { metadata: { blueprint: project }, physics: Array(300000).fill(1) };
    },
  };
  const snapshot = captureFeedbackContext(workshop, () => state);
  assert.equal(checkpointReads, 0, 'feedback must not read private replay state');
  assert.deepEqual(snapshot, { project, workshop: state });
  assert.ok(Buffer.byteLength(JSON.stringify(snapshot)) < feedbackLimits.contextBytes);
  state.cursor.tick = 13;
  assert.equal(captureFeedbackContext(workshop, () => state).workshop.cursor.tick, 13);
});
