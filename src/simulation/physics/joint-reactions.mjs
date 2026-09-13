/** Numeric completed joint reactions. Native and prepared impulses act on endpoint a;
 * public copied receipts act on b. Measurement never writes physical state. */
export function createJointReactions(joints) {
  const neighbours = new Map();
  joints.forEach((j, i) => {
    for (const [a, b] of [
      [j.a, j.b],
      [j.b, j.a],
    ]) {
      if (!neighbours.has(a)) neighbours.set(a, []);
      neighbours.get(a).push([b, i]);
    }
  });
  const supported = joints.map((j, index) => {
    if (j.kind !== 'fixed') return false;
    const seen = new Set([j.a]),
      queue = [j.a];
    for (let k = 0; k < queue.length; k++)
      for (const [b, edge] of neighbours.get(queue[k]) ?? [])
        if (edge !== index && !seen.has(b)) {
          seen.add(b);
          queue.push(b);
        }
    return !seen.has(j.b);
  });
  const zeros = () => joints.map(() => [0, 0, 0]);
  let tick = 0,
    dirty = false,
    pending = zeros(),
    completed = joints.map(() => null);
  const vector = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  const index = (i) => {
    if (!Number.isInteger(i) || i < 0 || i >= joints.length)
      throw TypeError('invalid reaction joint');
  };
  function validate(state) {
    if (
      !state ||
      Object.keys(state).sort().join() !== 'impulses,tick' ||
      !Number.isSafeInteger(state.tick) ||
      state.tick < 0 ||
      !Array.isArray(state.impulses) ||
      state.impulses.length !== joints.length ||
      state.impulses.some((v, i) => v !== null && (!supported[i] || state.tick === 0 || !vector(v)))
    )
      throw TypeError('invalid reaction snapshot');
    return structuredClone(state);
  }
  return Object.freeze({
    supported(i) {
      index(i);
      return supported[i];
    },
    add(indices, impulses, scale = 1) {
      if (
        !Array.isArray(indices) ||
        !Array.isArray(impulses) ||
        impulses.length !== indices.length * 3 ||
        !impulses.every(Number.isFinite) ||
        !Number.isFinite(scale)
      )
        throw TypeError('invalid reaction contribution');
      indices.forEach(index);
      if (indices.length) dirty = true;
      for (let k = 0; k < indices.length; k++) {
        const i = indices[k];
        for (let a = 0; a < 3; a++) pending[i][a] -= impulses[k * 3 + a] * scale;
      }
    },
    complete(native) {
      if (!Number.isSafeInteger(tick + 1)) throw RangeError('reaction tick overflow');
      const next = joints.map((_, i) => {
        if (!supported[i]) return null;
        const applied = native(i);
        if (!vector(applied)) return null;
        const result = pending[i].map((x, k) => x - applied[k]);
        return result.every(Number.isFinite) ? result.map((x) => (x === 0 ? 0 : x)) : null;
      });
      completed = next;
      pending = zeros();
      dirty = false;
      tick++;
    },
    read(i) {
      index(i);
      return !supported[i]
        ? { tick, status: 'unavailable' }
        : tick === 0
          ? { tick, status: 'initializing' }
          : completed[i]
            ? { tick, status: 'ok', impulse: [...completed[i]] }
            : { tick, status: 'unavailable' };
    },
    snapshot: () => {
      if (dirty) throw Error('reaction snapshot requires completed step');
      return { tick, impulses: structuredClone(completed) };
    },
    validate,
    restore(state) {
      const admitted = validate(state);
      tick = admitted.tick;
      completed = admitted.impulses;
      pending = zeros();
      dirty = false;
    },
  });
}
