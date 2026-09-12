/** Convex dual of the nonlinear unilateral Kelvin element. Numeric SI only.
 * Cartesian segment impulses preserve slack and account for transverse motion.
 * Block coordinate descent minimizes a strongly convex energy; no pose writes. */
export function ropeVectorImpulses({
  vectors,
  stiffnesses,
  dampings,
  extensions,
  restLengths,
  mobility,
  dt,
  positionFactor = 5 / 8,
}) {
  const n = vectors?.length;
  if (
    !Number.isInteger(n) ||
    n < 1 ||
    n > 64 ||
    !Number.isFinite(dt) ||
    dt <= 0 ||
    !Number.isFinite(positionFactor) ||
    positionFactor < 0.5 ||
    positionFactor > 1 ||
    !vectors.every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) ||
    ![stiffnesses, dampings, extensions, restLengths].every(
      (v) => Array.isArray(v) && v.length === n && v.every(Number.isFinite),
    ) ||
    stiffnesses.some((v) => v <= 0) ||
    dampings.some((v) => v < 0) ||
    restLengths.some((v) => v <= 0) ||
    !Array.isArray(mobility) ||
    mobility.length !== 3 * n ||
    mobility.some(
      (r) => !Array.isArray(r) || r.length !== 3 * n || r.some((v) => !Number.isFinite(v)),
    )
  )
    throw RangeError('rope vector domain');
  const scale = Math.max(1, ...mobility.flat().map(Math.abs));
  if (
    mobility.some(
      (r, i) => r[i] < 0 || r.some((v, j) => Math.abs(v - mobility[j][i]) > 1e-12 * scale),
    )
  )
    throw RangeError('rope mobility domain');
  const m = 3 * n,
    a = stiffnesses.map((k, i) => dt * k + dampings[i]);
  const radii = restLengths.map((l, i) => l + (dampings[i] * Math.max(0, extensions[i])) / a[i]);
  const b = vectors.flat(),
    H = mobility.map((r, i) =>
      r.map((v, j) => positionFactor * dt * v + (i === j ? 1 / a[Math.floor(i / 3)] : 0)),
    );
  if (
    n < 1 ||
    n > 64 ||
    b.some((v) => !Number.isFinite(v)) ||
    H.length !== m ||
    H.some((r) => r.length !== m || r.some((v) => !Number.isFinite(v)))
  )
    throw RangeError('rope vector domain');
  // Independent numeric components can be solved separately without changing physics.
  const groups = [],
    seen = new Set();
  for (let root = 0; root < n; root++)
    if (!seen.has(root)) {
      const group = [root];
      seen.add(root);
      for (let c = 0; c < group.length; c++)
        for (let j = 0; j < n; j++)
          if (
            !seen.has(j) &&
            [0, 1, 2].some((k) =>
              [0, 1, 2].some((l) => mobility[group[c] * 3 + k][j * 3 + l] !== 0),
            )
          ) {
            seen.add(j);
            group.push(j);
          }
      groups.push(group);
    }
  if (groups.length > 1) {
    const impulses = Array(n);
    let iterations = 0,
      residual = 0;
    for (const group of groups) {
      const idx = group.flatMap((i) => [i * 3, i * 3 + 1, i * 3 + 2]);
      const r = ropeVectorImpulses({
        vectors: group.map((i) => vectors[i]),
        stiffnesses: group.map((i) => stiffnesses[i]),
        dampings: group.map((i) => dampings[i]),
        extensions: group.map((i) => extensions[i]),
        restLengths: group.map((i) => restLengths[i]),
        mobility: idx.map((i) => idx.map((j) => mobility[i][j])),
        dt,
        positionFactor,
      });
      group.forEach((v, i) => (impulses[v] = r.impulses[i]));
      iterations = Math.max(iterations, r.iterations);
      residual = Math.max(residual, r.residual);
    }
    return { impulses, iterations, residual };
  }
  const y = Array(m).fill(0),
    gradient = b.map((v) => -v);
  const solve = (h, q, t) => {
    const A = h.map((r, i) => [...r.map((v, j) => v + (i === j ? t : 0)), q[i]]);
    for (let i = 0; i < 3; i++) {
      const d = A[i][i];
      for (let j = i; j < 4; j++) A[i][j] /= d;
      for (let k = 0; k < 3; k++)
        if (k !== i) {
          const c = A[k][i];
          for (let j = i; j < 4; j++) A[k][j] -= c * A[i][j];
        }
    }
    return A.map((r) => r[3]);
  };
  for (let iteration = 0; iteration < 128; iteration++) {
    for (let i = 0; i < n; i++) {
      const off = 3 * i,
        h = H.slice(off, off + 3).map((r) => r.slice(off, off + 3));
      const q = gradient
        .slice(off, off + 3)
        .map((g, k) => -g + h[k].reduce((s, v, j) => s + v * y[off + j], 0));
      let next = [0, 0, 0];
      const qnorm = Math.hypot(...q);
      if (
        qnorm > radii[i] &&
        h.every((r, k) =>
          r.every((v, j) => Math.abs(v - (k === j ? h[0][0] : 0)) < 1e-12 * h[0][0]),
        )
      )
        next = q.map((v) => (v * (1 - radii[i] / qnorm)) / h[0][0]);
      else if (qnorm > radii[i]) {
        let low = 0,
          high = Math.hypot(...solve(h, q, 0));
        for (let k = 0; k < 40; k++) {
          const mid = (low + high) / 2,
            v = solve(h, q, radii[i] / mid);
          if (Math.hypot(...v) > mid) low = mid;
          else high = mid;
        }
        next = solve(h, q, radii[i] / ((low + high) / 2));
      }
      for (let k = 0; k < 3; k++) {
        const d = next[k] - y[off + k];
        y[off + k] = next[k];
        if (d !== 0) for (let j = 0; j < m; j++) gradient[j] += H[j][off + k] * d;
      }
    }
    let residual = 0;
    for (let i = 0; i < n; i++) {
      const off = i * 3,
        v = y.slice(off, off + 3),
        norm = Math.hypot(...v),
        g = gradient.slice(off, off + 3);
      residual = Math.max(
        residual,
        norm > 1e-15
          ? Math.hypot(...g.map((x, k) => x + (radii[i] * v[k]) / norm))
          : Math.max(0, Math.hypot(...g) - radii[i]),
      );
    }
    if (residual < 1e-10)
      return {
        impulses: Array.from({ length: n }, (_, i) => y.slice(i * 3, i * 3 + 3)),
        iterations: iteration + 1,
        residual,
      };
    // Once active blocks are known, damped Newton resolves long-chain coupling.
    const active = [];
    for (let i = 0; i < n; i++)
      if (Math.hypot(...y.slice(i * 3, i * 3 + 3)) > 1e-14)
        active.push(i * 3, i * 3 + 1, i * 3 + 2);
    const count = active.length;
    if (count) {
      const B = active.map((i) => active.map((j) => H[i][j])),
        g = active.map((i) => gradient[i]);
      for (let u = 0; u < count; u += 3) {
        const off = active[u],
          v = y.slice(off, off + 3),
          norm = Math.hypot(...v),
          L = radii[Math.floor(off / 3)];
        for (let k = 0; k < 3; k++) {
          g[u + k] += (L * v[k]) / norm;
          for (let j = 0; j < 3; j++)
            B[u + k][u + j] += (L / norm) * ((k === j ? 1 : 0) - (v[k] * v[j]) / (norm * norm));
        }
      }
      const x = Array(count).fill(0),
        r = g.map((v) => -v),
        z = r.map((v, i) => v / B[i][i]);
      let p = [...z],
        rz = r.reduce((s, v, i) => s + v * z[i], 0);
      for (let it = 0; it < count * 2 && rz > 1e-28; it++) {
        const Ap = B.map((row) => row.reduce((s, v, j) => s + v * p[j], 0)),
          den = p.reduce((s, v, i) => s + v * Ap[i], 0);
        if (!(den > 0)) break;
        const alpha = rz / den;
        for (let i = 0; i < count; i++) {
          x[i] += alpha * p[i];
          r[i] -= alpha * Ap[i];
          z[i] = r[i] / B[i][i];
        }
        const next = r.reduce((s, v, i) => s + v * z[i], 0),
          beta = next / rz;
        for (let i = 0; i < count; i++) p[i] = z[i] + beta * p[i];
        rz = next;
      }
      const direction = Array(m).fill(0);
      active.forEach((v, i) => (direction[v] = x[i]));
      const Hd = H.map((row) => row.reduce((s, v, j) => s + v * direction[j], 0)),
        slope = g.reduce((sum, v, i) => sum + v * x[i], 0);
      let fraction = 1;
      for (let line = 0; line < 40; line++, fraction /= 2) {
        let change =
          fraction * gradient.reduce((sum, v, i) => sum + v * direction[i], 0) +
          0.5 * fraction * fraction * direction.reduce((sum, v, i) => sum + v * Hd[i], 0);
        for (let i = 0; i < n; i++)
          change +=
            radii[i] *
            (Math.hypot(
              ...y.slice(i * 3, i * 3 + 3).map((v, k) => v + fraction * direction[i * 3 + k]),
            ) -
              Math.hypot(...y.slice(i * 3, i * 3 + 3)));
        if (change <= 1e-4 * fraction * slope) {
          for (let i = 0; i < m; i++) {
            y[i] += fraction * direction[i];
            gradient[i] += fraction * Hd[i];
          }
          break;
        }
      }
    }
  }
  throw RangeError('rope nonlinear convergence limit');
}

/** Work of raw constant rope forces, evaluated over completed COM displacements.
 * Damping/numerical terms belong to a completed-geometry implicit Kelvin reference;
 * signed split work compensates its mismatch with the force actually submitted.
 * These are mechanical model terms, not measurements of thermal heating. */
export function ropeWorkLedger(segments, dt) {
  if (!Array.isArray(segments) || !Number.isFinite(dt) || dt <= 0)
    throw TypeError('invalid rope work inputs');
  const result = {
    ropeWorkJ: 0,
    ropeElasticDeltaJ: 0,
    ropeDampingWorkJ: 0,
    ropeNumericalLossJ: 0,
    ropeSplitWorkJ: 0,
  };
  for (const { before, after, impulse, restLength, stiffness: k, damping: c } of segments) {
    if (
      ![before, after, impulse].every(
        (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite),
      ) ||
      ![restLength, k, c].every(Number.isFinite) ||
      restLength <= 0 ||
      k <= 0 ||
      c < 0
    )
      throw TypeError('invalid rope work segment');
    const l0 = Math.hypot(...before),
      l1 = Math.hypot(...after),
      e0 = Math.max(0, l0 - restLength),
      e1 = Math.max(0, l1 - restLength),
      de = e1 - e0,
      delta = after.map((v, i) => v - before[i]),
      reference = Math.max(0, k * e1 + (c * de) / dt),
      work = -impulse.reduce((s, v, i) => s + (v * delta[i]) / dt, 0),
      elastic = 0.5 * k * de * (e1 + e0),
      D = reference > 0 ? (c * de * de) / dt : -k * e1 * de,
      // max(L,l0)-n1.dot(d0), evaluated without cancelling near-parallel lengths.
      geometric =
        reference === 0
          ? 0
          : Math.max(0, restLength - l0) +
            (l0 === 0
              ? 0
              : 0.5 * l0 * after.reduce((sum, v, i) => sum + (v / l1 - before[i] / l0) ** 2, 0)),
      N = 0.5 * k * de * de + reference * geometric;
    if (![work, elastic, D, N].every(Number.isFinite) || D < 0 || N < 0)
      throw RangeError('invalid rope work accounting');
    result.ropeWorkJ += work;
    result.ropeElasticDeltaJ += elastic;
    result.ropeDampingWorkJ += D;
    result.ropeNumericalLossJ += N;
  }
  // Split work is the dependent aggregate. Summing per-segment split values can
  // lose closure when opposing work cancels; derive it from the retained terms.
  result.ropeSplitWorkJ =
    result.ropeWorkJ +
    result.ropeElasticDeltaJ +
    result.ropeDampingWorkJ +
    result.ropeNumericalLossJ;
  if (!Object.values(result).every(Number.isFinite))
    throw RangeError('invalid aggregate rope work accounting');
  return result;
}
