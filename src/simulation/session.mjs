import { DT, PHASES } from '../model/tick.mjs';
import { createObservationStore, immutableCopy } from '../model/observation.mjs';
import { createControllerDispatcher } from './controllers.mjs';
import { createPowerNetwork } from './power.mjs';
import { createPhysicsWorld } from './physics/world.mjs';
let sessionSequence = 0;
const physicalConfig = ({ gravity, bodies, joints }) => ({ gravity, bodies, joints });
const rotate = (q, v) => {
  const [x, y, z, w] = q,
    [a, b, c] = v;
  const t = [2 * (y * c - z * b), 2 * (z * a - x * c), 2 * (x * b - y * a)];
  return [
    a + w * t[0] + y * t[2] - z * t[1],
    b + w * t[1] + z * t[0] - x * t[2],
    c + w * t[2] + x * t[1] - y * t[0],
  ];
};
function admitConfiguration(input) {
  const c = immutableCopy(input);
  if (Object.keys(c).sort().join(',') !== 'bodies,gravity,joints,power')
    throw Error('INVALID_CONFIGURATION');
  const power = createPowerNetwork(c.power);
  const nodes = [
    ...c.power.cells,
    ...c.power.motors,
    ...c.power.receivers,
    ...c.power.controllers,
    ...c.power.sensors,
  ].map((x) => x.node);
  if (
    new Set(nodes).size !== nodes.length ||
    nodes.some((n) => n >= c.bodies.length) ||
    [...c.power.wires, ...c.power.signalWires].some((edge) =>
      edge.some((n) => n >= c.bodies.length),
    )
  )
    throw Error('INVALID_CONFIGURATION');
  for (const m of c.power.motors)
    if (
      m.body !== m.node ||
      m.body >= c.bodies.length ||
      m.rotor >= c.bodies.length ||
      m.joint >= c.joints.length ||
      (m.joint >= 0 &&
        (c.joints[m.joint].kind !== 'revolute' ||
          c.joints[m.joint].a !== m.body ||
          c.joints[m.joint].b !== m.rotor ||
          m.axis.some((v, i) => Math.abs(v - c.joints[m.joint].axisA[i]) > 1e-12)))
    )
      throw Error('INVALID_CONFIGURATION');
  for (const m of c.power.motors)
    if (
      m.positionControl &&
      m.joint >= 0 &&
      (c.joints[m.joint].limits?.[0] !== m.positionControl.lowerLimit ||
        c.joints[m.joint].limits?.[1] !== m.positionControl.upperLimit)
    )
      throw Error('INVALID_CONFIGURATION');
  for (const joint of c.joints) {
    if (
      !Number.isInteger(joint.a) ||
      !Number.isInteger(joint.b) ||
      joint.a < 0 ||
      joint.b < 0 ||
      joint.a >= c.bodies.length ||
      joint.b >= c.bodies.length
    )
      throw Error('INVALID_CONFIGURATION');
  }
  for (const sensor of c.power.sensors)
    if (
      !Number.isInteger(sensor.body) ||
      sensor.body !== sensor.node ||
      sensor.body >= c.bodies.length
    )
      throw Error('INVALID_CONFIGURATION');
  return { config: c, power };
}
function sampleSensors(tick, bodies, powerConfig) {
  return {
    tick,
    bodies,
    readings: powerConfig.sensors.map((s) => ({
      node: s.node,
      speed: rotate(bodies[s.body].rotation, s.axis).reduce(
        (sum, v, i) => sum + v * bodies[s.body].angularVelocity[i],
        0,
      ),
    })),
  };
}
const finiteTree = (value) =>
  typeof value === 'number'
    ? Number.isFinite(value)
    : value && typeof value === 'object'
      ? Object.values(value).every(finiteTree)
      : true;
const copy = (value) => structuredClone(value);
export async function createSession(
  configuration,
  identity = {},
  metadata = {},
  hostPrograms = [],
) {
  metadata = immutableCopy(metadata);
  let { config, power } = admitConfiguration(configuration),
    world = await createPhysicsWorld(physicalConfig(config));
  identity = copy(identity);
  let dispatcher = createControllerDispatcher(config.power, hostPrograms);
  let tick = 0,
    accumulator = 0,
    sequence = 0,
    pending = [],
    history = [],
    status = 'ready',
    failure = null;
  let initial = world.read();
  let sensors = sampleSensors(0, copy(initial), config.power);
  let torques = [],
    receipts = [];
  const hasSprings = () => config.joints.some((j) => j.kind === 'spring');
  const emptyEnergy = (mechanical = world.mechanicalEnergy()) => ({
    ...mechanical,
    ...(mechanical.springPotentialJ !== undefined ? { dampingWorkJ: 0 } : {}),
    actuatorWorkJ: 0,
    externalWorkJ: 0,
    integrationDeltaJ: 0,
    constraintDissipationJ: 0,
    balanceResidualJ: 0,
  });
  let energy = emptyEnergy();
  const total = (e) => e.kineticJ + e.potentialJ + (e.springPotentialJ ?? 0);
  function priorSpringLength(j, bodies) {
    const a = bodies[j.a],
      b = bodies[j.b],
      axis = rotate(a.rotation, j.axisA);
    const pa = rotate(a.rotation, j.anchorA).map((x, i) => x + a.position[i]),
      pb = rotate(b.rotation, j.anchorB).map((x, i) => x + b.position[i]);
    return axis.reduce((sum, x, i) => sum + x * (pb[i] - pa[i]), 0);
  }
  function springReadings(
    candidate = world,
    previous = sensors.bodies,
    configuration = config,
    initialFrame = tick === 0,
  ) {
    return candidate.springs().map((reading) => ({
      ...reading,
      endpointVelocity: reading.speed,
      speed: initialFrame
        ? 0
        : (reading.length - priorSpringLength(configuration.joints[reading.index], previous)) / DT,
    }));
  }
  const frame = (physics, timings = {}) => ({
    tick,
    status,
    physics,
    springs: springReadings(),
    metadata,
    energy: copy(energy),
    power: power.read(),
    sensors: copy(sensors),
    phaseTimings: timings,
    phaseStatus: Object.fromEntries(
      PHASES.map((p) => [
        p,
        [
          'sensor-snapshot',
          'controller-commands',
          'power-signals',
          'actuators-constraints',
          'environment-forces',
          'integration-contacts',
          'structure-failure',
          'thermal-ablation',
          'telemetry',
        ].includes(p)
          ? 'active'
          : 'inactive-no-components',
      ]),
    ),
  });
  const observations = createObservationStore(frame(initial), {
    sessionId: `session-${++sessionSequence}`,
    clock: () => performance.now(),
  });
  function checkpoint() {
    if (status === 'failed') throw Error('SESSION_FAILED');
    return copy({
      version: 2,
      tick,
      accumulator,
      sequence,
      pending,
      sensors,
      energy,
      power: power.snapshot(),
      physics: Array.from(world.snapshot()),
      configuration: config,
      identity,
      metadata,
    });
  }
  let anchor = checkpoint(),
    previousInterval = null;
  function publish() {
    observations.publish(frame(world.read()));
  }
  function validCommand(command) {
    if (!command || typeof command !== 'object') return false;
    const keys = Object.keys(command).sort().join(',');
    if (command.type === 'impulse')
      return (
        keys === 'body,type,value' &&
        Number.isInteger(command.body) &&
        command.body >= 0 &&
        command.body < config.bodies.length &&
        Array.isArray(command.value) &&
        command.value.length === 3 &&
        command.value.every(Number.isFinite)
      );
    return (
      command.type === 'receiver' &&
      keys === 'duty,node,type' &&
      config.power.receivers.some((r) => r.node === command.node) &&
      Number.isFinite(command.duty) &&
      Math.abs(command.duty) <= 1
    );
  }
  function act(command) {
    const no = (reasonCode) => ({ ok: false, reasonCode, path: 'command' });
    if (status === 'failed') return no('SESSION_FAILED');
    if (!validCommand(command)) return no('INVALID_COMMAND');
    if (pending.length >= 64 || sequence >= Number.MAX_SAFE_INTEGER) return no('INPUT_LIMIT');
    const event = { tick: tick + 1, sequence: sequence++, command: copy(command) };
    pending.push(event);
    history.push(event);
    publish();
    return { ok: true, reasonCode: 'OK', path: '' };
  }
  function step(count = 1) {
    if (
      !Number.isSafeInteger(count) ||
      count < 0 ||
      count > 28800 ||
      tick + count > Number.MAX_SAFE_INTEGER
    )
      throw Error('INVALID_TICK_COUNT');
    if (status === 'failed') throw Error('SESSION_FAILED');
    for (let n = 0; n < count; n++) {
      const startedAt = performance.now(),
        timings = {},
        next = tick + 1;
      const startEnergy = world.mechanicalEnergy();
      let actuatorWorkJ = 0,
        externalWorkJ = 0,
        integrationDeltaJ = 0,
        constraintDissipationJ = 0,
        springReceipt = { dampingWorkJ: 0, kineticDeltaJ: 0 };
      try {
        for (const phase of PHASES) {
          const start = performance.now();
          switch (phase) {
            case 'sensor-snapshot':
              sensors = sampleSensors(tick, world.read(), config.power);
              break;
            case 'controller-commands': {
              for (const output of dispatcher.run({
                tick: sensors.tick,
                readings: sensors.readings,
              })) {
                if (pending.length >= 64) throw Error('INPUT_LIMIT');
                const event = {
                  tick: next,
                  sequence: sequence++,
                  command: { type: 'receiver', ...output },
                };
                pending.push(event);
                history.push(event);
              }
              break;
            }
            case 'power-signals': {
              world.prepareConstraints();
              const coupling = [];
              for (const [i, m] of config.power.motors.entries()) {
                if (m.joint < 0) continue;
                for (let j = 0; j < i; j++) {
                  const other = config.power.motors[j];
                  if (other.joint < 0) continue;
                  const response = world.torquePairResponse(
                    m.body,
                    m.rotor,
                    rotate(sensors.bodies[m.body].rotation, m.axis),
                    other.body,
                    other.rotor,
                    rotate(sensors.bodies[other.body].rotation, other.axis),
                  );
                  if (response !== 0) coupling.push({ source: j, target: i, response });
                }
              }
              const states = config.power.motors.map((m) =>
                m.joint < 0
                  ? { speed: 0, angle: 0, effectiveInverseInertia: 0 }
                  : world.jointState(m.joint),
              );
              const commands = new Map(
                pending
                  .filter((e) => e.command.type === 'receiver')
                  .map((e) => [e.command.node, { node: e.command.node, duty: e.command.duty }]),
              );
              torques = power.step(
                DT,
                config.power.motors.map((m, i) => ({
                  node: m.node,
                  speed: states[i].speed,
                  ...(m.positionControl ? { angle: states[i].angle } : {}),
                })),
                [...commands.values()],
                config.power.motors.map((m, i) => ({
                  node: m.node,
                  inertia:
                    states[i].effectiveInverseInertia > 0
                      ? 1 / states[i].effectiveInverseInertia
                      : Infinity,
                })),
                coupling,
              ).torques;
              break;
            }
            case 'actuators-constraints':
              constraintDissipationJ = world.applyPreparedConstraints();
              if (hasSprings()) springReceipt = world.applySprings();
              receipts = torques.map((torque, i) => {
                const r =
                  torque.joint < 0
                    ? {
                        speedBefore: 0,
                        speedAfter: 0,
                        workJ: 0,
                        kineticDeltaJ: 0,
                        kineticBeforeJ: 0,
                        kineticAfterJ: 0,
                      }
                    : world.applyTorquePair(
                        torque.body,
                        torque.rotor,
                        rotate(sensors.bodies[torque.body].rotation, torque.axis),
                        torque.value,
                      );
                actuatorWorkJ += r.workJ;
                return { node: config.power.motors[i].node, ...r };
              });
              break;
            case 'environment-forces': {
              const before = world.mechanicalEnergy();
              for (const event of pending)
                if (event.command.type === 'impulse')
                  world.applyImpulse(event.command.body, event.command.value);
              externalWorkJ = total(world.mechanicalEnergy()) - total(before);
              break;
            }
            case 'integration-contacts': {
              const before = world.mechanicalEnergy();
              world.step();
              integrationDeltaJ =
                total(world.mechanicalEnergy()) -
                total(before) +
                springReceipt.kineticDeltaJ +
                springReceipt.dampingWorkJ;
              break;
            }
            case 'structure-failure': {
              const bodies = world.read();
              if (!finiteTree(bodies)) throw Error('NON_FINITE_STATE');
              if (
                bodies.length !== initial.length ||
                bodies.some((body, i) => body.mass !== initial[i].mass)
              )
                throw Error('INVARIANT_VIOLATION');
              break;
            }
            case 'thermal-ablation':
              power.completeStep(
                DT,
                receipts.map((r, i) =>
                  config.power.motors[i].positionControl
                    ? {
                        ...r,
                        angle:
                          config.power.motors[i].joint < 0
                            ? 0
                            : world.jointState(config.power.motors[i].joint).angle,
                      }
                    : r,
                ),
              );
              break;
            case 'telemetry':
              energy = {
                ...world.mechanicalEnergy(),
                ...(hasSprings() ? { dampingWorkJ: springReceipt.dampingWorkJ } : {}),
                actuatorWorkJ,
                externalWorkJ,
                integrationDeltaJ,
                constraintDissipationJ,
                balanceResidualJ:
                  total(world.mechanicalEnergy()) -
                  total(startEnergy) -
                  actuatorWorkJ -
                  externalWorkJ -
                  integrationDeltaJ +
                  constraintDissipationJ +
                  springReceipt.dampingWorkJ,
              };
              tick = next;
              pending = [];
              break;
          }
          timings[phase] = performance.now() - start;
        }
        // Prepare the next replay anchor inside the measured tick, but retain
        // the old interval until the completed observation has been admitted.
        let nextAnchor,
          checkpointMs = 0;
        if (tick % 1200 === 0) {
          const start = performance.now();
          nextAnchor = checkpoint();
          checkpointMs = performance.now() - start;
        }
        observations.publish(frame(world.read(), timings), {
          timing: {
            startedAt,
            phaseMs: Object.values(timings).reduce((sum, value) => sum + value, 0),
            checkpointMs,
          },
        });
        if (nextAnchor) {
          previousInterval = { anchor, inputs: history };
          anchor = nextAnchor;
          history = [];
        }
      } catch (error) {
        status = 'failed';
        failure = copy({
          version: 1,
          identity,
          anchor: previousInterval?.anchor ?? anchor,
          inputs: [...(previousInterval?.inputs ?? []), ...history],
          failedTick: next,
          reasonCode: ['NON_FINITE_STATE', 'INVARIANT_VIOLATION', 'ENERGY_INVARIANT'].includes(
            error.message,
          )
            ? error.message
            : 'PHYSICS_FAILURE',
          completed: observations.observe().frames.at(-1),
        });
        observations.publish({
          ...failure.completed,
          status: 'failed',
          failure: { tick: next, reasonCode: failure.reasonCode },
        });
        throw error;
      }
    }
    return observations.observe();
  }
  function advanceTime(milliseconds) {
    if (status === 'failed') throw Error('SESSION_FAILED');
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw Error('INVALID_ELAPSED_TIME');
    const total = accumulator + milliseconds;
    const count = Math.floor((total + 1e-9) / (DT * 1000));
    if (!Number.isSafeInteger(count) || count > 28800 || tick + count > Number.MAX_SAFE_INTEGER)
      throw Error('INVALID_ELAPSED_TIME');
    accumulator = total - count * DT * 1000;
    if (Math.abs(accumulator) < 1e-9) accumulator = 0;
    return step(count);
  }
  function runUntil(predicate, maxTicks) {
    if (!Number.isSafeInteger(maxTicks) || maxTicks < 0 || maxTicks > 28800)
      throw Error('INVALID_TICK_COUNT');
    if (
      !predicate ||
      typeof predicate !== 'object' ||
      !['gte', 'lte'].includes(predicate.operator) ||
      !Number.isFinite(predicate.value)
    )
      throw Error('INVALID_PREDICATE');
    const p = copy(predicate),
      clock = p.quantity === 'tick';
    const keys = clock
      ? ['operator', 'quantity', 'value']
      : ['axis', 'body', 'operator', 'quantity', 'value'];
    if (
      Object.keys(p).sort().join(',') !== keys.join(',') ||
      (!clock &&
        (!['position', 'velocity'].includes(p.quantity) ||
          !Number.isInteger(p.body) ||
          p.body < 0 ||
          p.body >= config.bodies.length ||
          !Number.isInteger(p.axis) ||
          p.axis < 0 ||
          p.axis > 2))
    )
      throw Error('INVALID_PREDICATE');
    if (status === 'failed') throw Error('SESSION_FAILED');
    const matched = () => {
      const f = observations.observe().frames[0],
        value = clock ? f.tick : f.physics[p.body][p.quantity][p.axis];
      return p.operator === 'gte' ? value >= p.value : value <= p.value;
    };
    let ticks = 0;
    while (!matched() && ticks < maxTicks) {
      step(1);
      ticks++;
    }
    return { matched: matched(), ticks, observation: observations.observe() };
  }
  let replacing = false,
    disposed = false;
  function setMetadata(input) {
    if (disposed) throw Error('SESSION_DISPOSED');
    const nextMetadata = immutableCopy(input);
    observations.publish({ ...frame(world.read()), metadata: nextMetadata });
    metadata = nextMetadata;
    return observations.observe();
  }
  async function replaceConfiguration(configuration, inputMetadata) {
    if (disposed) throw Error('SESSION_DISPOSED');
    if (replacing) throw Error('REPLACEMENT_PENDING');
    const nextMetadata = immutableCopy(inputMetadata),
      admitted = admitConfiguration(configuration),
      nextConfig = admitted.config,
      nextPower = admitted.power,
      nextDispatcher = createControllerDispatcher(nextConfig.power, hostPrograms);
    replacing = true;
    let candidate;
    try {
      candidate = await createPhysicsWorld(physicalConfig(nextConfig));
      if (disposed) throw Error('SESSION_DISPOSED');
      const nextInitial = immutableCopy(candidate.read()),
        nextSensors = sampleSensors(0, copy(nextInitial), nextConfig.power);
      const nextFrame = {
        ...frame(nextInitial),
        springs: springReadings(candidate, nextSensors.bodies, nextConfig, true),
        tick: 0,
        status: 'ready',
        metadata: nextMetadata,
        sensors: nextSensors,
        energy: emptyEnergy(candidate.mechanicalEnergy()),
        power: nextPower.read(),
      };
      const nextAnchor = copy({
        version: 2,
        tick: 0,
        accumulator: 0,
        sequence: 0,
        pending: [],
        sensors: nextSensors,
        energy: emptyEnergy(candidate.mechanicalEnergy()),
        power: nextPower.snapshot(),
        physics: Array.from(candidate.snapshot()),
        configuration: nextConfig,
        identity,
        metadata: nextMetadata,
      });
      // Publication validates the complete replacement before any owner changes.
      // No callbacks run between this publication and the synchronous owner swap.
      observations.publish(nextFrame, { restored: true });
      const previous = world;
      world = candidate;
      candidate = null;
      config = nextConfig;
      power = nextPower;
      dispatcher = nextDispatcher;
      torques = [];
      receipts = [];
      energy = emptyEnergy();
      initial = nextInitial;
      metadata = nextMetadata;
      tick = 0;
      accumulator = 0;
      sequence = 0;
      pending = [];
      history = [];
      status = 'ready';
      failure = null;
      sensors = nextSensors;
      anchor = nextAnchor;
      previousInterval = null;
      previous.dispose();
      return observations.observe();
    } finally {
      candidate?.dispose();
      replacing = false;
    }
  }
  function restore(input) {
    const invalid = () => {
      throw Error('INVALID_CHECKPOINT');
    };
    let cp;
    try {
      cp = copy(immutableCopy(input));
    } catch {
      invalid();
    }
    const exact = (value, keys) =>
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join(',') === keys.sort().join(',');
    let restoredMetadata;
    try {
      restoredMetadata = immutableCopy(cp.metadata);
    } catch {
      invalid();
    }
    const vector = (v, n) => Array.isArray(v) && v.length === n && v.every(Number.isFinite);
    if (
      !exact(cp, [
        'version',
        'tick',
        'accumulator',
        'sequence',
        'pending',
        'sensors',
        'energy',
        'power',
        'physics',
        'configuration',
        'identity',
        'metadata',
      ]) ||
      cp.version !== 2 ||
      !Number.isSafeInteger(cp.tick) ||
      cp.tick < 0 ||
      cp.tick === Number.MAX_SAFE_INTEGER ||
      !Number.isFinite(cp.accumulator) ||
      cp.accumulator < 0 ||
      cp.accumulator >= DT * 1000 ||
      !Number.isSafeInteger(cp.sequence) ||
      cp.sequence < 0 ||
      !Array.isArray(cp.physics) ||
      cp.physics.length > 32 * 1024 * 1024 ||
      !cp.physics.every((x) => Number.isInteger(x) && x >= 0 && x <= 255) ||
      !Array.isArray(cp.pending) ||
      cp.pending.length > 64 ||
      JSON.stringify(cp.configuration) !== JSON.stringify(config) ||
      JSON.stringify(cp.identity) !== JSON.stringify(identity)
    )
      invalid();
    if (
      !exact(cp.energy, [
        'kineticJ',
        'potentialJ',
        'actuatorWorkJ',
        'externalWorkJ',
        'integrationDeltaJ',
        'constraintDissipationJ',
        'balanceResidualJ',
        ...(hasSprings() ? ['springPotentialJ', 'dampingWorkJ'] : []),
      ]) ||
      !Object.values(cp.energy).every(Number.isFinite) ||
      cp.energy.constraintDissipationJ < 0 ||
      (hasSprings() && (cp.energy.springPotentialJ < 0 || cp.energy.dampingWorkJ < 0))
    )
      invalid();
    if (
      !exact(cp.sensors, ['tick', 'bodies', 'readings']) ||
      cp.sensors.tick !== Math.max(0, cp.tick - 1) ||
      !Array.isArray(cp.sensors.bodies) ||
      cp.sensors.bodies.length !== initial.length
    )
      invalid();
    // Completed Float32 physics rotations permit ordinary library roundoff,
    // never arbitrary finite quaternions that overflow sensor calculations.
    for (const [index, body] of cp.sensors.bodies.entries())
      if (
        !exact(body, ['position', 'rotation', 'velocity', 'angularVelocity', 'mass']) ||
        !vector(body.position, 3) ||
        !vector(body.rotation, 4) ||
        Math.abs(Math.hypot(...body.rotation) - 1) > 1e-5 ||
        !vector(body.velocity, 3) ||
        !vector(body.angularVelocity, 3) ||
        body.mass !== initial[index].mass
      )
        invalid();
    const expectedReadings = sampleSensors(
      cp.sensors.tick,
      cp.sensors.bodies,
      config.power,
    ).readings;
    if (
      !Array.isArray(cp.sensors.readings) ||
      cp.sensors.readings.length !== expectedReadings.length
    )
      invalid();
    for (const [index, reading] of cp.sensors.readings.entries())
      if (
        !exact(reading, ['node', 'speed']) ||
        !Number.isFinite(reading.speed) ||
        !Number.isFinite(expectedReadings[index].speed) ||
        reading.node !== expectedReadings[index].node ||
        reading.speed !== expectedReadings[index].speed
      )
        invalid();
    for (const [index, event] of cp.pending.entries())
      if (
        !exact(event, ['tick', 'sequence', 'command']) ||
        event.tick !== cp.tick + 1 ||
        event.sequence !== cp.sequence - cp.pending.length + index ||
        event.sequence < 0 ||
        !validCommand(event.command)
      )
        invalid();
    const candidatePower = createPowerNetwork(config.power);
    candidatePower.restore(cp.power);
    // All session-owned fields are admitted before the physics door validates and
    // atomically swaps its opaque snapshot. The resulting frame contains only
    // validated finite values, so publication cannot discover a late schema error.
    world.restore(
      Uint8Array.from(cp.physics),
      {
        kineticJ: cp.energy.kineticJ,
        potentialJ: cp.energy.potentialJ,
        ...(hasSprings() ? { springPotentialJ: cp.energy.springPotentialJ } : {}),
      },
      config.power.motors.flatMap((m, i) =>
        m.positionControl && m.joint >= 0
          ? [{ joint: m.joint, angle: cp.power.motors[i].position.angle }]
          : [],
      ),
      config.joints.flatMap((j, index) =>
        j.kind === 'spring'
          ? [{ joint: index, length: priorSpringLength(j, cp.sensors.bodies) }]
          : [],
      ),
    );
    power = candidatePower;
    torques = [];
    receipts = [];
    energy = copy(cp.energy);
    metadata = restoredMetadata;
    tick = cp.tick;
    accumulator = cp.accumulator;
    sequence = cp.sequence;
    pending = cp.pending;
    sensors = cp.sensors;
    status = 'ready';
    failure = null;
    history = [];
    previousInterval = null;
    anchor = checkpoint();
    observations.publish(frame(world.read()), { restored: true });
  }
  return Object.freeze({
    act,
    step,
    advanceTime,
    runUntil,
    checkpoint,
    restore,
    replaceConfiguration,
    setMetadata,
    observe: observations.observe,
    failureBundle: () => copy(failure),
    dispose: () => {
      disposed = true;
      world.dispose();
    },
  });
}
