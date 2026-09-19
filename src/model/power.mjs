export const POWER_REASON_CODES = Object.freeze([
  'INVALID_POWER_CONFIGURATION',
  'CAMERA_LIMIT',
  'UNSUPPORTED_POWER_TOPOLOGY',
  'UNSUPPORTED_SIGNAL_TOPOLOGY',
  'INVALID_POWER_CHECKPOINT',
  'POWER_STEP_PENDING',
  'INVALID_POWER_STEP',
  'INVALID_SIGNAL_COMMAND',
  'INVALID_MOTOR_SAMPLE',
  'INVALID_MOTOR_INERTIA',
  'ENERGY_INVARIANT',
  'POWER_STEP_MISSING',
  'COUPLER_SPRING_ACTIVATION',
]);
/** Compiled electrical/signal graph only. Names, roles and demo identity are ignored. */
export function admitCompiledPowerTopology(power) {
  const fail = (reasonCode) => {
    throw Object.assign(Error(reasonCode), { reasonCode, path: 'connections' });
  };
  const parent = new Map();
  const root = (n) => {
    if (!parent.has(n)) parent.set(n, n);
    if (parent.get(n) !== n) parent.set(n, root(parent.get(n)));
    return parent.get(n);
  };
  for (const [a, b] of power.wires ?? []) parent.set(root(a), root(b));
  for (const cell of power.cells ?? []) root(cell.node);
  for (const motor of power.motors ?? []) root(motor.node);
  const cellsFor = (m) => (power.cells ?? []).filter((c) => root(c.node) === root(m.node));
  for (const motor of power.motors ?? [])
    if (cellsFor(motor).length > 1) fail('UNSUPPORTED_POWER_TOPOLOGY');
  for (const cell of power.cells ?? [])
    if ((power.cells ?? []).filter((c) => root(c.node) === root(cell.node)).length > 1)
      fail('UNSUPPORTED_POWER_TOPOLOGY');
  const sources = power.receivers ?? [];
  const signalFor = (node) =>
    (power.signalWires ?? [])
      .filter((edge) => edge[1] === node)
      .map((edge) => sources.find((source) => source.node === edge[0]));
  for (const item of [...(power.motors ?? []), ...(power.couplers ?? []), ...(power.lamps ?? [])]) {
    const signals = signalFor(item.node);
    if (signals.length > 1 || signals.some((s) => !s)) fail('UNSUPPORTED_SIGNAL_TOPOLOGY');
  }
  for (const camera of (power.sensors ?? []).filter((s) => s.kind === 'camera')) {
    const signals = signalFor(camera.node);
    if (signals.length > 1 || signals.some((s) => !s)) fail('UNSUPPORTED_SIGNAL_TOPOLOGY');
  }
}
export const CONTROLLER_REASON_CODES = Object.freeze([
  'INVALID_CONTROLLER_CONFIGURATION',
  'INVALID_CONTROLLER_PROGRAM',
  'INVALID_CONTROLLER_SNAPSHOT',
  'INVALID_CONTROLLER_OUTPUT',
  'MISSING_CONTROLLER_EXECUTOR',
]);
