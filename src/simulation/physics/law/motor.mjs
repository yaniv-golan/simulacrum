/** First-order split DC drive allocation; numeric SI inputs only.
 * Reserve voltage at the endpoint of the discrete angular kick. The physics
 * door measures that kick before contacts and gravity are integrated. This is
 * a finite-step approximation, not a coupled continuous-current solver.
 */
export function motorStep(voltage, speed, torqueConstant, resistance, currentLimit, inertia, dt) {
  if (
    ![voltage, speed, torqueConstant, resistance, currentLimit, dt].every(Number.isFinite) ||
    torqueConstant <= 0 ||
    resistance <= 0 ||
    currentLimit < 0 ||
    !(Number.isFinite(inertia) || inertia === Infinity) ||
    inertia <= 0 ||
    dt <= 0
  )
    throw new RangeError('invalid motor numbers');
  let current =
    (voltage - torqueConstant * speed) / (resistance + (torqueConstant ** 2 * dt) / inertia);
  // This driver does not regenerate or actively brake with power disconnected.
  if (voltage === 0 || current * voltage < 0) current = 0;
  current = Math.sign(current) * Math.min(Math.abs(current), currentLimit);
  const torque = torqueConstant * current,
    nextSpeed = speed + (torque * dt) / inertia;
  const electricalEnergy = voltage * current * dt;
  const mechanicalEnergy = (torque * (speed + nextSpeed) * dt) / 2;
  // Includes winding heat and dissipation in the current limiting driver.
  const heatEnergy = electricalEnergy - mechanicalEnergy;
  return { current, torque, nextSpeed, electricalEnergy, mechanicalEnergy, heatEnergy };
}

// Solve shared source droop against the ordered discrete motor kicks. The
// current limiter derates every winding's rating by the same fraction, so a
// source's charge/current budget is never consumed by whichever motor is first.
// Coordinate roots are bounded; failure returns null instead of unpaid work.
export function sharedPowerStep(cells, motors, coupling, dt) {
  const parent = motors.map((_, i) => i);
  const root = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const join = (a, b) => {
    parent[root(b)] = root(a);
  };
  const first = new Map();
  for (const [i, m] of motors.entries())
    if (m.cell >= 0) {
      if (first.has(m.cell)) join(first.get(m.cell), i);
      else first.set(m.cell, i);
    }
  // Inactive motors still receive mechanical speed changes and must stay in
  // their physical island. Preserve the authored sequential kick order.
  for (const edge of coupling) join(edge.source, edge.target);
  const groups = new Map();
  for (let i = 0; i < motors.length; i++) {
    const key = root(i);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  if (groups.size <= 1) return solveSharedIsland(cells, motors, coupling, dt);
  const merged = {
    currents: motors.map(() => 0),
    speeds: motors.map((m) => m.speed),
    totals: cells.map(() => 0),
    voltages: cells.map((c) => c.voltage),
  };
  for (const indices of groups.values()) {
    const motorIndex = new Map(indices.map((original, local) => [original, local]));
    const cellIndices = [...new Set(indices.map((i) => motors[i].cell).filter((i) => i >= 0))].sort(
      (a, b) => a - b,
    );
    const cellIndex = new Map(cellIndices.map((original, local) => [original, local]));
    const result = solveSharedIsland(
      cellIndices.map((i) => cells[i]),
      indices.map((i) => ({
        ...motors[i],
        cell: motors[i].cell < 0 ? -1 : cellIndex.get(motors[i].cell),
      })),
      coupling
        .filter((e) => motorIndex.has(e.source))
        .map((e) => ({ ...e, source: motorIndex.get(e.source), target: motorIndex.get(e.target) })),
      dt,
    );
    if (!result) return null;
    indices.forEach((original, local) => {
      merged.currents[original] = result.currents[local];
      merged.speeds[original] = result.speeds[local];
    });
    cellIndices.forEach((original, local) => {
      merged.totals[original] = result.totals[local];
      merged.voltages[original] = result.voltages[local];
    });
  }
  return merged;
}

function solveSharedIsland(cells, motors, coupling, dt) {
  const voltages = cells.map((c) => c.voltage),
    caps = cells.map(() => 1);
  function evaluate() {
    const speeds = motors.map((m) => m.speed),
      currents = [],
      totals = cells.map(() => 0);
    for (let i = 0; i < motors.length; i++) {
      const m = motors[i];
      const current = m.active
        ? m.load
          ? (voltages[m.cell] / m.resistance) * caps[m.cell]
          : motorStep(
              voltages[m.cell] * m.duty,
              speeds[i],
              m.k,
              m.resistance,
              m.limit * caps[m.cell],
              m.inertia,
              dt,
            ).current
        : 0;
      currents.push(current);
      if (m.cell >= 0) totals[m.cell] += m.duty * current;
      for (const e of coupling)
        if (e.source === i) speeds[e.target] += e.response * m.k * current * dt;
    }
    return { currents, totals, speeds };
  }
  function busRoot(index, cap) {
    caps[index] = cap;
    const cell = cells[index];
    if (!motors.some((m) => m.cell === index && m.active)) {
      voltages[index] = cell.voltage;
      return 0;
    }
    let low = 0,
      high = cell.voltage;
    for (let n = 0; n < 48; n++) {
      voltages[index] = (low + high) / 2;
      const current = evaluate().totals[index];
      if (voltages[index] + cell.resistance * current > cell.voltage) high = voltages[index];
      else low = voltages[index];
    }
    voltages[index] = low;
    return evaluate().totals[index];
  }
  let previous = evaluate();
  for (let sweep = 0; sweep < 64; sweep++) {
    for (let index = 0; index < cells.length; index++) {
      const cell = cells[index],
        limit = Math.min(cell.limit, cell.energy / (cell.voltage * dt)) * (1 - 1e-12);
      if (busRoot(index, 1) > limit) {
        // At the binding source-current limit the bus voltage is known.
        // Solve only the common cap fraction, not another bus root per trial.
        voltages[index] = cell.voltage - cell.resistance * limit;
        const weights = motors
          .filter((m) => m.active && m.cell === index && m.duty !== 0)
          .map((m) => Math.abs(m.duty) * (m.load ? voltages[index] / m.resistance : m.limit));
        let low = 0,
          high = Math.min(1, limit / Math.min(...weights));
        // Scale the bracket to the available charge. An absolute [0,1] bracket
        // cannot resolve a positive sub-ulp current fraction near depletion.
        for (let n = 0; n < 48; n++) {
          const middle = (low + high) / 2;
          caps[index] = middle;
          if (evaluate().totals[index] > limit) high = middle;
          else low = middle;
        }
        caps[index] = low;
      }
    }
    const result = evaluate();
    const stable = result.currents.every(
      (v, i) => Math.abs(v - previous.currents[i]) <= 1e-12 * Math.max(1, Math.abs(v)),
    );
    const funded = cells.every(
      (c, i) =>
        result.totals[i] <= Math.min(c.limit, c.energy / (c.voltage * dt)) &&
        Math.abs(voltages[i] + c.resistance * result.totals[i] - c.voltage) <=
          1e-10 * Math.max(1, c.voltage),
    );
    if (stable && funded) return { ...result, voltages };
    previous = result;
  }
  return null;
}

/** Implicit speed feedback and midpoint angle prediction for one fixed-step DC drive.
 * A=kV/R, B=k²/R, omegaNext=omega+dt(Au-Bomega)/(I+Bdt).
 * Substitute omegaNext and theta+dt(omega+omegaNext)/2 into authored PI-D feedback.
 * This predicts a duty only; the actual shared power solve still owns funded torque.
 */
export function sampledPositionDuty(
  target,
  angle,
  speed,
  kp,
  kd,
  trim,
  inertia,
  k,
  voltage,
  resistance,
  dt,
) {
  if (
    ![target, angle, speed, kp, kd, trim, k, voltage, resistance, dt].every(Number.isFinite) ||
    kp <= 0 ||
    kd < 0 ||
    !(Number.isFinite(inertia) || inertia === Infinity) ||
    inertia <= 0 ||
    k <= 0 ||
    voltage <= 0 ||
    resistance <= 0 ||
    dt !== 1 / 120
  )
    throw new RangeError('invalid sampled position drive numbers');
  const a = (k * voltage) / resistance,
    b = (k * k) / resistance,
    h = dt / (inertia + b * dt),
    feedback = ((kp * dt) / 2 + kd) * h;
  const duty =
    (kp * (target - angle) - (kp * dt + kd) * speed + trim + feedback * b * speed) /
    (1 + feedback * a);
  return Math.max(-1, Math.min(1, duty));
}
