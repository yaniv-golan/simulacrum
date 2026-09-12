/** Simultaneous backward-Euler compliant mesh. Numeric SI inputs only.
 * (I + dt (dt K+C) M) p = -dt (K x + (dt K+C) v).
 * For symmetric positive semidefinite mobility, kinetic + elastic energy
 * decreases by physical damping plus numerical backward-Euler dissipation.
 * Native regularized reaction work is separate from this isolated law proof.
 */
export function coupledGearImpulses({ extensions, speeds, stiffnesses, dampings, mobility, dt }) {
  const n = Array.isArray(extensions) ? extensions.length : 0;
  if (
    !n ||
    n > 8 ||
    !Number.isFinite(dt) ||
    dt <= 0 ||
    ![extensions, speeds, stiffnesses, dampings].every(
      (a) => Array.isArray(a) && a.length === n && a.every(Number.isFinite),
    ) ||
    stiffnesses.some((x) => x < 0) ||
    dampings.some((x) => x < 0) ||
    !Array.isArray(mobility) ||
    mobility.length !== n ||
    !mobility.every((r) => Array.isArray(r) && r.length === n && r.every(Number.isFinite))
  )
    throw new RangeError('invalid coupled gear inputs');
  const scale = Math.max(1, ...mobility.flat().map(Math.abs)),
    tolerance = 1e-10 * scale;
  if (mobility.some((row, i) => row.some((x, j) => Math.abs(x - mobility[j][i]) > tolerance)))
    throw new RangeError('asymmetric gear mobility');
  const m = mobility.map((r, i) => r.map((x, j) => (x + mobility[j][i]) / 2));
  // Pivoted Schur complements admit semidefinite mobility, reject active input.
  const positive = m.map((r) => [...r]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) if (positive[j][j] > positive[pivot][pivot]) pivot = j;
    [positive[i], positive[pivot]] = [positive[pivot], positive[i]];
    for (const row of positive) [row[i], row[pivot]] = [row[pivot], row[i]];
    if (positive[i][i] < -tolerance) throw new RangeError('negative gear mobility');
    if (positive[i][i] <= tolerance) {
      if (positive.slice(i).some((r) => r.slice(i).some((x) => Math.abs(x) > tolerance)))
        throw new RangeError('indefinite gear mobility');
      break;
    }
    for (let j = i + 1; j < n; j++)
      for (let k = i + 1; k < n; k++)
        positive[j][k] -= (positive[j][i] * positive[i][k]) / positive[i][i];
  }
  const matrix = m.map((row, i) => [
    ...row.map((w, j) => (i === j ? 1 : 0) + dt * (dt * stiffnesses[i] + dampings[i]) * w),
    -dt * (stiffnesses[i] * extensions[i] + (dt * stiffnesses[i] + dampings[i]) * speeds[i]),
  ]);
  if (!matrix.flat().every(Number.isFinite))
    throw new RangeError('gear solve exceeds numeric range');
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    if (Math.abs(matrix[col][col]) < 1e-12) throw new RangeError('singular gear solve');
    const divisor = matrix[col][col];
    for (let j = col; j <= n; j++) matrix[col][j] /= divisor;
    for (let row = 0; row < n; row++)
      if (row !== col) {
        const factor = matrix[row][col];
        for (let j = col; j <= n; j++) matrix[row][j] -= factor * matrix[col][j];
      }
  }
  const impulses = matrix.map((r) => r[n]),
    delta = m.map((r) => r.reduce((s, w, j) => s + w * impulses[j], 0)),
    nextSpeeds = speeds.map((v, i) => v + delta[i]),
    nextExtensions = extensions.map((x, i) => x + dt * nextSpeeds[i]),
    dampingWorkJ = nextSpeeds.reduce((s, v, i) => s + dt * dampings[i] * v * v, 0),
    numericalLossJ =
      0.5 * impulses.reduce((s, p, i) => s + p * delta[i], 0) +
      0.5 * nextSpeeds.reduce((s, v, i) => s + stiffnesses[i] * (dt * v) ** 2, 0);
  if (
    ![...impulses, ...nextSpeeds, ...nextExtensions, dampingWorkJ, numericalLossJ].every(
      Number.isFinite,
    )
  )
    throw new RangeError('gear solve exceeds numeric range');
  return {
    impulses,
    nextSpeeds,
    extensions: nextExtensions,
    dampingWorkJ,
    numericalLossJ: Math.max(0, numericalLossJ),
  };
}
