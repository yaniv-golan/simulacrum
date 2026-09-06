export const DT = 1 / 120;
export const PHASES = Object.freeze([
  'sensor-snapshot',
  'controller-commands',
  'power-signals',
  'actuators-constraints',
  'environment-forces',
  'integration-contacts',
  'structure-failure',
  'thermal-ablation',
  'telemetry',
]);
export const REASON_CODES = Object.freeze([
  'OK',
  'INVALID_CONFIGURATION',
  'UNSUPPORTED_ACTUATOR_COUPLING',
  'ENERGY_INVARIANT',
  'INVALID_COMMAND',
  'INVALID_BODY',
  'INVALID_VECTOR',
  'INVALID_CHECKPOINT',
  'SESSION_FAILED',
  'SESSION_DISPOSED',
  'REPLACEMENT_PENDING',
  'NON_FINITE_STATE',
  'INPUT_LIMIT',
  'INVARIANT_VIOLATION',
  'PHYSICS_FAILURE',
  'INVALID_PREDICATE',
  'INVALID_TICK_COUNT',
  'INVALID_ELAPSED_TIME',
]);
export function deterministicProjection(frame) {
  return {
    tick: frame.tick,
    physics: frame.physics,
    energy: frame.energy,
    power: frame.power,
    sensors: frame.sensors,
    status: frame.status,
  };
}
