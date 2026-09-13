import { CAMERA } from '../model/camera.mjs';
import { immutableCopy } from '../model/observation.mjs';
const fresh = (node) => ({
  version: CAMERA.version,
  node,
  sampleTick: 0,
  powered: false,
  owner: '',
  armed: false,
  manualId: 0,
  serial: 0,
  busySerial: 0,
  pending: null,
  result: null,
});
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
export function createCameraState(nodes) {
  let rows = nodes.map(fresh);
  const api = {
    request(node, id) {
      const r = rows.find((r) => r.node === node);
      if (!r || !integer(id) || id === 0) return 'unavailable';
      if (id <= r.manualId) return 'duplicate';
      if (r.pending) return 'busy';
      r.manualId = id;
      r.pending = { id, source: 'manual' };
      return 'accepted';
    },
    step(tick, inputs) {
      for (const r of rows) {
        const input = inputs.find((i) => i.node === r.node),
          powered = input?.powered === true;
        const owner = input?.owner ?? '',
          high = (input?.level ?? 0) > 0;
        if (!powered || owner !== r.owner) r.armed = false;
        if (powered && !high) r.armed = true;
        if (powered && high && r.armed) {
          r.armed = false;
          if (!r.pending) r.pending = { id: 0, source: 'controller' };
          else r.busySerial++;
        }
        r.owner = owner;
        r.powered = powered;
        if (tick % CAMERA.period !== 0) continue;
        r.sampleTick = tick;
        if (r.pending) {
          r.serial++;
          r.result = { ...r.pending, tick, status: powered ? 'ok' : 'no-power' };
          r.pending = null;
        }
      }
    },
    read() {
      return immutableCopy(rows);
    },
    restore(input, tick) {
      const candidate = structuredClone(immutableCopy(input));
      const exact = (a, b) => Object.keys(a).sort().join() === Object.keys(b).sort().join();
      if (!Array.isArray(candidate) || candidate.length !== nodes.length)
        throw Error('INVALID_CAMERA_CHECKPOINT');
      for (const [i, r] of candidate.entries()) {
        if (
          !exact(r, fresh(nodes[i])) ||
          r.version !== CAMERA.version ||
          r.node !== nodes[i] ||
          !integer(r.sampleTick) ||
          r.sampleTick !== Math.floor(tick / CAMERA.period) * CAMERA.period ||
          r.sampleTick % CAMERA.period !== 0 ||
          typeof r.powered !== 'boolean' ||
          typeof r.armed !== 'boolean' ||
          typeof r.owner !== 'string' ||
          r.owner.length > 32 ||
          !integer(r.manualId) ||
          !integer(r.serial) ||
          !integer(r.busySerial) ||
          (r.serial === 0) !== (r.result === null)
        )
          throw Error('INVALID_CAMERA_CHECKPOINT');
        for (const [k, v] of [
          ['pending', r.pending],
          ['result', r.result],
        ])
          if (v !== null) {
            if (
              !exact(
                v,
                k === 'pending' ? { id: 0, source: 0 } : { id: 0, source: 0, tick: 0, status: 0 },
              ) ||
              !integer(v.id) ||
              !['manual', 'controller'].includes(v.source) ||
              (v.source === 'manual' ? v.id === 0 || v.id > r.manualId : v.id !== 0) ||
              (k === 'result' &&
                (!integer(v.tick) ||
                  v.tick > r.sampleTick ||
                  v.tick % CAMERA.period !== 0 ||
                  !['ok', 'no-power'].includes(v.status)))
            )
              throw Error('INVALID_CAMERA_CHECKPOINT');
          }
        if (
          r.pending?.source === 'manual' &&
          (r.pending.id !== r.manualId ||
            (r.result?.source === 'manual' && r.pending.id <= r.result.id))
        )
          throw Error('INVALID_CAMERA_CHECKPOINT');
      }
      rows = candidate;
    },
  };
  return Object.freeze(api);
}
