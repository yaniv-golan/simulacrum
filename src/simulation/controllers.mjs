import { createLearningDispatcher } from './learning-controllers.mjs';
import { admitSensorReading } from '../model/sensors.mjs';
import { immutableCopy } from '../model/observation.mjs';
// M3 host-side test doubles only. This dispatcher restricts passed capabilities;
// trusted callbacks still execute in the host and are NOT a sandbox or fuel gate.
const fail = (code) => {
  throw new Error(code);
};
const node = (value) => Number.isSafeInteger(value) && value >= 0;
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Reflect.ownKeys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
function data(value, code) {
  try {
    return immutableCopy(value);
  } catch {
    fail(code);
  }
}
export function createControllerDispatcher(powerConfig, programs) {
  const code = 'INVALID_CONTROLLER_CONFIGURATION';
  if (
    !powerConfig ||
    !['controllers', 'receivers', 'sensors', 'signalWires'].every(
      (key) => Array.isArray(powerConfig[key]) && powerConfig[key].length <= 8192,
    )
  )
    fail(code);
  const config = data(
    {
      controllers: powerConfig.controllers,
      receivers: powerConfig.receivers,
      sensors: powerConfig.sensors,
      signalWires: powerConfig.signalWires,
    },
    code,
  );
  const declared = new Map();
  for (const kind of ['controllers', 'receivers', 'sensors'])
    for (const item of config[kind]) {
      if (!item || !node(item.node) || declared.has(item.node)) fail(code);
      declared.set(item.node, kind);
    }
  const wires = new Set();
  for (const wire of config.signalWires) {
    if (
      !Array.isArray(wire) ||
      wire.length !== 2 ||
      !wire.every(node) ||
      wire[0] === wire[1] ||
      wires.has(`${wire[0]}:${wire[1]}`)
    )
      fail(code);
    wires.add(`${wire[0]}:${wire[1]}`);
  }
  if (!Array.isArray(programs) || programs.length > config.controllers.length)
    fail('INVALID_CONTROLLER_PROGRAM');
  const used = new Set();
  const compiled = programs.map((program) => {
    if (
      !exact(
        program,
        program.snapshot
          ? ['node', 'run', 'snapshot', 'restore', ...(program.inspect ? ['inspect'] : [])]
          : ['node', 'run'],
      ) ||
      declared.get(program.node) !== 'controllers' ||
      config.controllers.some((c) => c.node === program.node && c.learning) ||
      used.has(program.node) ||
      typeof program.run !== 'function'
    )
      fail('INVALID_CONTROLLER_PROGRAM');
    used.add(program.node);
    return {
      node: program.node,
      snapshot: program.snapshot,
      restore: program.restore,
      inspect: program.inspect,
      run: program.run,
      bindings: config.controllers.find((c) => c.node === program.node)?.program?.inputs,
      inputs: config.sensors
        .filter((sensor) => wires.has(`${sensor.node}:${program.node}`))
        .map((sensor) => sensor.node),
      outputs: new Set(
        config.receivers
          .filter((receiver) => wires.has(`${program.node}:${receiver.node}`))
          .map((receiver) => receiver.node),
      ),
    };
  });
  const learned = createLearningDispatcher(powerConfig);
  const api = {
    inspect() {
      return immutableCopy(
        compiled.filter((p) => p.inspect).map((p) => ({ node: p.node, ...p.inspect() })),
      );
    },
    snapshot() {
      return immutableCopy(
        compiled.filter((p) => p.snapshot).map((p) => ({ node: p.node, values: p.snapshot() })),
      );
    },
    restore(rows) {
      const programs = compiled.filter((p) => p.snapshot),
        before = programs.map((p) => p.snapshot());
      if (!Array.isArray(rows) || rows.length !== programs.length)
        fail('INVALID_CONTROLLER_CHECKPOINT');
      try {
        rows.forEach((r, i) => {
          if (!exact(r, ['node', 'values']) || r.node !== programs[i].node)
            fail('INVALID_CONTROLLER_CHECKPOINT');
          programs[i].restore(r.values);
        });
      } catch (error) {
        programs.forEach((p, i) => p.restore(before[i]));
        throw error;
      }
    },
    run(snapshot) {
      const previous = data(snapshot, 'INVALID_CONTROLLER_SNAPSHOT');
      if (
        !exact(previous, ['tick', 'readings']) ||
        !Number.isSafeInteger(previous.tick) ||
        previous.tick < 0 ||
        !Array.isArray(previous.readings) ||
        previous.readings.length > config.sensors.length
      )
        fail('INVALID_CONTROLLER_SNAPSHOT');
      const readings = new Map();
      for (const reading of previous.readings) {
        if (
          (!reading.channels && !exact(reading, ['node', 'speed'])) ||
          declared.get(reading.node) !== 'sensors' ||
          (!reading.channels && !Number.isFinite(reading.speed)) ||
          readings.has(reading.node)
        )
          fail('INVALID_CONTROLLER_SNAPSHOT');
        if (reading.channels) {
          admitSensorReading(reading, config.sensors.find((s) => s.node === reading.node).kind);
          if (reading.tick !== previous.tick) fail('INVALID_CONTROLLER_SNAPSHOT');
        }
        readings.set(reading.node, reading);
      }
      const views = compiled.map((program) => {
        if (program.inputs.some((input) => !readings.has(input)))
          fail('INVALID_CONTROLLER_SNAPSHOT');
        return data(
          {
            ...(previous.readings.some((r) => r.channels) ? {} : { tick: previous.tick }),
            inputs: program.inputs.map((input) => {
              const r = readings.get(input);
              return r.channels
                ? {
                    node: input,
                    channels: program.bindings
                      ? Object.fromEntries(
                          program.bindings
                            .filter((b) => b.node === input)
                            .map((b) => [b.channel, r.channels[b.channel]]),
                        )
                      : r.channels,
                  }
                : { node: input, speed: r.speed };
            }),
          },
          'INVALID_CONTROLLER_SNAPSHOT',
        );
      });
      const result = [],
        written = new Set();
      for (const [index, program] of compiled.entries()) {
        const output = data(
          Reflect.apply(program.run, undefined, [views[index]]),
          'INVALID_CONTROLLER_OUTPUT',
        );
        if (!Array.isArray(output) || output.length > program.outputs.size)
          fail('INVALID_CONTROLLER_OUTPUT');
        for (const command of output) {
          if (
            !exact(
              command,
              Object.hasOwn(command, 'valid') ? ['node', 'duty', 'valid'] : ['node', 'duty'],
            ) ||
            (Object.hasOwn(command, 'valid') && typeof command.valid !== 'boolean') ||
            !program.outputs.has(command.node) ||
            written.has(command.node) ||
            !Number.isFinite(command.duty) ||
            Math.abs(command.duty) > 1
          )
            fail('INVALID_CONTROLLER_OUTPUT');
          written.add(command.node);
          result.push({
            node: command.node,
            duty: command.duty,
            ...(Object.hasOwn(command, 'valid') ? { valid: command.valid } : {}),
          });
        }
      }
      return immutableCopy(result);
    },
    dispatch(snapshot) {
      return immutableCopy([
        ...api.run(snapshot).map((o) => ({ type: 'program-receiver', ...o })),
        ...learned.run(snapshot.readings).map((o) => ({ type: 'learned-receiver', ...o })),
      ]);
    },
  };
  return Object.freeze(api);
}
