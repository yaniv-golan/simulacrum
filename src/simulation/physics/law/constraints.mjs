/** Mass-metric orthogonal projection of bilateral constraint impulses.
 * Numeric inputs only. Redundant rows are removed by two-pass orthogonalization.
 * No forces, poses, engine state or contact identities are available here.
 */
export function createConstraintProjection(inverseMass, rows) {
  const n = inverseMass.length;
  if (
    !n ||
    !inverseMass.every((r) => r.length === n && r.every(Number.isFinite)) ||
    !rows.every((r) => r.length === n && r.every(Number.isFinite))
  )
    throw new RangeError('invalid constraint matrix');
  const dot = (a, b) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += a[i] * b[i];
    return s;
  };
  const sparse = inverseMass.map((row) => {
    const out = [];
    for (let i = 0; i < n; i++) if (row[i] !== 0) out.push([i, row[i]]);
    return out;
  });
  const mul = (v) => {
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) for (const [j, x] of sparse[i]) out[i] += x * v[j];
    return out;
  };
  const basis = [];
  for (const original of rows) {
    const q = Float64Array.from(original);
    for (let pass = 0; pass < 2; pass++)
      for (const p of basis) {
        const d = dot(q, p.response);
        for (let i = 0; i < n; i++) q[i] -= d * p.row[i];
      }
    const response = mul(q),
      square = dot(q, response);
    if (square < 1e-20) continue;
    const norm = Math.sqrt(square);
    for (let i = 0; i < n; i++) {
      q[i] /= norm;
      response[i] /= norm;
    }
    basis.push({ row: q, response });
  }
  function project(v) {
    const impulse = new Float64Array(n),
      velocity = new Float64Array(n);
    for (const p of basis) {
      const d = dot(p.row, v);
      for (let i = 0; i < n; i++) {
        impulse[i] -= d * p.row[i];
        velocity[i] -= d * p.response[i];
      }
    }
    return { impulse: Array.from(impulse), velocity: Array.from(velocity) };
  }
  return {
    rank: basis.length,
    project,
    response(f) {
      const free = mul(f),
        correction = project(free);
      return {
        impulse: correction.impulse.map((x, i) => x + f[i]),
        velocity: correction.velocity.map((x, i) => x + free[i]),
      };
    },
    residual(v) {
      let largest = 0;
      for (const r of rows) largest = Math.max(largest, Math.abs(dot(r, v)));
      return largest;
    },
  };
}
