/**
 * Canonical fixed-step Cannon solver authority used by workshop runs.
 *
 * `iterations` is the maximum Gauss-Seidel sweep budget; the pinned solver can
 * exit early when its aggregate impulse correction falls below `tolerance`.
 * This records the established workshop discretization in one runtime and
 * artifact authority. Constraint canonicalization must preserve numerical
 * conditioning rather than tuning this budget around one scenario.
 */
export const WORKSHOP_CANNON_SOLVER_PROFILE = Object.freeze({
  fixedDt: 1 / 120,
  iterations: 30,
  tolerance: 2e-4,
});
