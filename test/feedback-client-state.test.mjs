import test from 'node:test';
import assert from 'node:assert/strict';
import {
  feedbackFailureMessage,
  feedbackVoiceDuration,
} from '../src/application/feedback-client.mjs';
test('validation rejection does not promise automatic retry', () => {
  assert.match(feedbackFailureMessage(400), /rejected|invalid|validation/i);
  assert.doesNotMatch(feedbackFailureMessage(400), /retry automatically|waiting to send/i);
  assert.match(feedbackFailureMessage(503), /retry automatically/i);
});
test('voice admission uses stop-request elapsed time without clamping a long clip', () => {
  assert.equal(feedbackVoiceDuration(1000, 60000), 59000);
  assert.equal(feedbackVoiceDuration(1000, 61000), 60000);
  assert.throws(() => feedbackVoiceDuration(1000, 61001), /60|limit/i);
  assert.throws(() => feedbackVoiceDuration(1000, 91000), /60|limit/i);
  assert.throws(() => feedbackVoiceDuration(1000, 1000), /duration/i);
  assert.throws(() => feedbackVoiceDuration(1000, Infinity), /duration/i);
});
