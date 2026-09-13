import test from 'node:test';
import assert from 'node:assert/strict';
import { hashNativeState } from '../scripts/native-state-probe.mjs';
const checkpoint = (backend, payload = [0, 255, 3, 127]) => {
  const meta = new TextEncoder().encode(
    JSON.stringify({
      version: 6,
      backend,
      reactions: { tick: 1, impulses: [null] },
      handles: [0],
      configuration: { joints: [] },
    }),
  );
  const bytes = new Uint8Array(12 + meta.length + payload.length),
    view = new DataView(bytes.buffer);
  view.setUint32(0, 1234);
  view.setUint32(4, meta.length);
  bytes.set(meta, 12);
  bytes.set(payload, 12 + meta.length);
  return { tick: 1, physics: Array.from(bytes), sensorSnapshot: { tick: 0 } };
};
test('native normalization rebuilds different-length backend envelopes without discarding physical bytes or checkpoint evidence', () => {
  const old = checkpoint('0.20.0-simulacrum.spring.9.f64'),
    newer = checkpoint('0.20.0-simulacrum.spring.10.f64');
  const original = structuredClone(newer);
  assert.equal(hashNativeState(old), hashNativeState(newer));
  assert.deepEqual(newer, original);
  assert.notEqual(
    hashNativeState(old),
    hashNativeState(checkpoint('0.20.0-simulacrum.spring.10.f64', [0, 254, 3, 127])),
  );
  assert.notEqual(hashNativeState(old), hashNativeState({ ...newer, sensorSnapshot: { tick: 2 } }));
  assert.throws(() => hashNativeState(checkpoint('0.20.0-simulacrum.spring.11.f64')));
});
