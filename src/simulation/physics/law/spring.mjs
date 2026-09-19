/** Semi-implicit Kelvin-Voigt impulse: elastic kick, implicit relative damping.
 * v'=(v-dt*w*k*x)/(1+dt*w*c), x'=x+dt*v'. Numeric inputs only.
 * At c=0 the modified oscillator energy E - dt*k*x*v/2 is conserved;
 * admission requires dt*sqrt(k*w)<=0.3. Numerical delta is signed, not heat.
 */
export function springImpulse({ extension, speed, stiffness, damping, inverseMass, dt }) {
  if (
    ![extension, speed, stiffness, damping, inverseMass, dt].every(Number.isFinite) ||
    stiffness < 0 ||
    damping < 0 ||
    inverseMass < 0 ||
    dt <= 0
  )
    throw new RangeError('invalid spring law inputs');
  if (dt * Math.sqrt(stiffness * inverseMass) > 0.3)
    throw new RangeError('spring exceeds validated frequency range');
  if (inverseMass < 1e-12) return { impulse: 0, dampingWorkJ: 0, numericalDeltaJ: 0 };
  const impulse =
    (-dt * (stiffness * extension + damping * speed)) / (1 + dt * damping * inverseMass);
  const next = speed + inverseMass * impulse;
  return {
    impulse,
    dampingWorkJ: damping * dt * next * next,
    numericalDeltaJ: 0.5 * stiffness * (dt * next) ** 2 - 0.5 * inverseMass * impulse * impulse,
  };
}

/** Symmetric positive-semidefinite mobility, then the averaged factor used by the solve.
 * Duplicated from the gear island admission so this law stays numeric-only.
 */
function admitSpringMobility(mobility, n) {
  const scale = Math.max(1, ...mobility.flat().map(Math.abs)),
    tolerance = 1e-10 * scale;
  if (mobility.some((row, i) => row.some((x, j) => Math.abs(x - mobility[j][i]) > tolerance)))
    throw new RangeError('asymmetric spring mobility');
  const m = mobility.map((r, i) => r.map((x, j) => (x + mobility[j][i]) / 2));
  const positive = m.map((r) => [...r]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++) if (positive[j][j] > positive[pivot][pivot]) pivot = j;
    [positive[i], positive[pivot]] = [positive[pivot], positive[i]];
    for (const row of positive) [row[i], row[pivot]] = [row[pivot], row[i]];
    if (positive[i][i] < -tolerance) throw new RangeError('negative spring mobility');
    if (positive[i][i] <= tolerance) {
      if (positive.slice(i).some((r) => r.slice(i).some((x) => Math.abs(x) > tolerance)))
        throw new RangeError('indefinite spring mobility');
      break;
    }
    for (let j = i + 1; j < n; j++)
      for (let k = i + 1; k < n; k++)
        positive[j][k] -= (positive[j][i] * positive[i][k]) / positive[i][i];
  }
  return m;
}

/** Simultaneous implicit damping through the full symmetric island mobility.
 * (I + dt C W) J = -dt (K x + C v). At most eight rows in production.
 */
export function coupledSpringImpulses({ extensions, speeds, stiffnesses, dampings, mobility, dt }) {
  const n = extensions.length;
  if (
    !n ||
    n > 8 ||
    ![speeds, stiffnesses, dampings, mobility].every((a) => a.length === n) ||
    !Number.isFinite(dt) ||
    dt <= 0 ||
    ![extensions, speeds, stiffnesses, dampings].every((a) => a.every(Number.isFinite)) ||
    stiffnesses.some((x) => x < 0) ||
    dampings.some((x) => x < 0) ||
    !mobility.every((row) => row.length === n && row.every(Number.isFinite))
  )
    throw new RangeError('invalid coupled spring inputs');
  if (n === 1) {
    const result = springImpulse({
      extension: extensions[0],
      speed: speeds[0],
      stiffness: stiffnesses[0],
      damping: dampings[0],
      inverseMass: Math.max(0, mobility[0][0]),
      dt,
    });
    return {
      impulses: [result.impulse],
      nextSpeeds: [speeds[0] + mobility[0][0] * result.impulse],
      dampingWorkJ: result.dampingWorkJ,
    };
  }
  const admitted = admitSpringMobility(mobility, n);
  const matrix = admitted.map((row, i) => [
    ...row.map((w, j) => (i === j ? 1 : 0) + dt * dampings[i] * w),
    -dt * (stiffnesses[i] * extensions[i] + dampings[i] * speeds[i]),
  ]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col])) pivot = row;
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    if (Math.abs(matrix[col][col]) < 1e-12) throw new RangeError('singular spring solve');
    const scale = matrix[col][col];
    for (let j = col; j <= n; j++) matrix[col][j] /= scale;
    for (let row = 0; row < n; row++)
      if (row !== col) {
        const factor = matrix[row][col];
        for (let j = col; j <= n; j++) matrix[row][j] -= factor * matrix[col][j];
      }
  }
  const impulses = matrix.map((row) => row[n]),
    nextSpeeds = admitted.map(
      (row, i) => speeds[i] + row.reduce((sum, w, j) => sum + w * impulses[j], 0),
    );
  return {
    impulses,
    nextSpeeds,
    dampingWorkJ: nextSpeeds.reduce((sum, v, i) => sum + dt * dampings[i] * v * v, 0),
  };
}
