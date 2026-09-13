import { immutableCopy } from '../model/observation.mjs';
import { LAMP_LIMIT, LAMP_WATTS, LAMP_EFFICACY, LAMP_NOMINAL_VOLTAGE } from '../model/lamps.mjs';
import { CAMERA } from '../model/camera.mjs';
import { CONTROLLER_LIMITS } from '../model/controller-authoring.mjs';
import { SENSOR_SUPPLY, SENSOR_LIMITS } from '../model/sensors.mjs';
import { admitLearningBindings } from '../model/learning-bindings.mjs';
import { motorStep, sharedPowerStep, sampledPositionDuty } from './physics/law/motor.mjs';
import { receiverControlConfiguration } from './receiver-arbiter.mjs';
const clone = (x) => structuredClone(x);
const fail = (code) => {
  throw Object.assign(new Error(code), { reasonCode: code, path: 'power' });
};
const finite = (...values) => values.every(Number.isFinite);
// Float32 solver roundoff allowance, in joules plus relative per-step scale.
export const ENERGY_ABSOLUTE_TOLERANCE = 1e-9;
export const ENERGY_RELATIVE_TOLERANCE = 32 * 2 ** -23;
export function createPowerNetwork(configuration) {
  const config = clone(configuration);
  const exact = (value, keys) =>
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === keys.split(',').sort().join(',');
  const node = (n) => Number.isSafeInteger(n) && n >= 0;
  const array = (key) => Array.isArray(config[key]) && config[key].length <= 8192;
  if (
    !exact(
      config,
      'cells,motors,wires,signalWires,receivers,controllers,sensors' +
        (Object.hasOwn(config, 'regulators') ? ',regulators' : '') +
        (Object.hasOwn(config, 'couplers') ? ',couplers' : '') +
        (Object.hasOwn(config, 'lamps') ? ',lamps' : ''),
    ) ||
    (Object.hasOwn(config, 'regulators') && !array('regulators')) ||
    (Object.hasOwn(config, 'couplers') && !array('couplers')) ||
    (Object.hasOwn(config, 'lamps') && (!array('lamps') || config.lamps.length > LAMP_LIMIT)) ||
    !['cells', 'motors', 'wires', 'signalWires', 'receivers', 'controllers', 'sensors'].every(
      array,
    ) ||
    config.sensors.length > SENSOR_LIMITS.count ||
    config.controllers.length > CONTROLLER_LIMITS.count
  )
    fail('INVALID_POWER_CONFIGURATION');
  const couplers = config.couplers ?? [];
  for (const c of couplers)
    if (
      !exact(c, 'node,joint,resistance,minVoltage,energyJ') ||
      !node(c.node) ||
      !Number.isInteger(c.joint) ||
      c.joint < -1 ||
      !finite(c.resistance, c.minVoltage, c.energyJ) ||
      c.resistance < 1 ||
      c.minVoltage <= 0 ||
      c.energyJ <= 0
    )
      fail('INVALID_POWER_CONFIGURATION');
  if (
    new Set(couplers.filter((c) => c.joint >= 0).map((c) => c.joint)).size !==
    couplers.filter((c) => c.joint >= 0).length
  )
    fail('INVALID_POWER_CONFIGURATION');
  const lamps = config.lamps ?? [];
  for (const lamp of lamps)
    if (
      !exact(lamp, 'node,brightness,color,beamSpread') ||
      !node(lamp.node) ||
      !finite(lamp.brightness, lamp.color, lamp.beamSpread) ||
      lamp.brightness < 0 ||
      lamp.brightness > 1 ||
      !Number.isInteger(lamp.color) ||
      lamp.color < 0 ||
      lamp.color > 0xffffff ||
      lamp.beamSpread < 0.1 ||
      lamp.beamSpread > 1.2
    )
      fail('INVALID_POWER_CONFIGURATION');
  for (const cell of config.cells)
    if (
      !exact(cell, 'node,voltage,capacityJ,initialJ,resistance,currentLimit') ||
      !node(cell.node) ||
      !finite(cell.voltage, cell.capacityJ, cell.initialJ, cell.resistance, cell.currentLimit) ||
      cell.voltage <= 0 ||
      cell.capacityJ <= 0 ||
      cell.initialJ < 0 ||
      cell.initialJ > cell.capacityJ ||
      cell.resistance <= 0 ||
      cell.currentLimit <= 0
    )
      fail('INVALID_POWER_CONFIGURATION');
  for (const motor of config.motors)
    if (
      !exact(
        motor,
        'node,body,rotor,joint,axis,torqueConstant,resistance,currentLimit,defaultDuty' +
          (Object.hasOwn(motor, 'positionControl') ? ',positionControl' : '') +
          (Object.hasOwn(motor, 'coordinate') ? ',coordinate,maxSpeed' : '') +
          (Object.hasOwn(motor, 'inputPolarity') ? ',inputPolarity' : ''),
      ) ||
      (Object.hasOwn(motor, 'coordinate') &&
        (motor.coordinate !== 'linear' ||
          motor.positionControl ||
          !finite(motor.maxSpeed) ||
          motor.maxSpeed <= 0 ||
          motor.maxSpeed > 0.5)) ||
      (Object.hasOwn(motor, 'inputPolarity') && ![-1, 1].includes(motor.inputPolarity)) ||
      !node(motor.node) ||
      !node(motor.body) ||
      !Number.isSafeInteger(motor.rotor) ||
      motor.rotor < -1 ||
      !Number.isSafeInteger(motor.joint) ||
      motor.joint < -1 ||
      !Array.isArray(motor.axis) ||
      motor.axis.length !== 3 ||
      !motor.axis.every(Number.isFinite) ||
      Math.abs(Math.hypot(...motor.axis) - 1) > 1e-9 ||
      !finite(motor.defaultDuty, motor.torqueConstant, motor.resistance, motor.currentLimit) ||
      Math.abs(motor.defaultDuty) > 1 ||
      motor.torqueConstant <= 0 ||
      motor.resistance <= 0 ||
      motor.currentLimit <= 0
    )
      fail('INVALID_POWER_CONFIGURATION');
  for (const motor of config.motors)
    if (Object.hasOwn(motor, 'positionControl')) {
      const p = motor.positionControl;
      if (
        !exact(
          p,
          'lowerLimit,upperLimit,proportionalGain,dampingGain' +
            (Object.hasOwn(p, 'integralGain') ? ',integralGain' : ''),
        ) ||
        !finite(p.lowerLimit, p.upperLimit, p.proportionalGain, p.dampingGain) ||
        p.lowerLimit >= 0 ||
        p.upperLimit <= 0 ||
        p.lowerLimit < -3 ||
        p.upperLimit > 3 ||
        p.proportionalGain <= 0 ||
        p.dampingGain < 0 ||
        (Object.hasOwn(p, 'integralGain') && (!finite(p.integralGain) || p.integralGain < 0))
      )
        fail('INVALID_POWER_CONFIGURATION');
    }
  for (const source of [...config.receivers, ...config.controllers])
    if (
      !exact(
        source,
        'node,duty' +
          (Object.hasOwn(source, 'learning') && config.controllers.includes(source)
            ? ',learning'
            : '') +
          (Object.hasOwn(source, 'program') && config.controllers.includes(source)
            ? ',program'
            : ''),
      ) ||
      !node(source.node) ||
      !finite(source.duty) ||
      Math.abs(source.duty) > 1
    )
      fail('INVALID_POWER_CONFIGURATION');
  for (const edges of [config.wires, config.signalWires])
    for (const edge of edges)
      if (!Array.isArray(edge) || edge.length !== 2 || !edge.every(node) || edge[0] === edge[1])
        fail('INVALID_POWER_CONFIGURATION');
  for (const entries of [
    lamps,
    config.cells,
    config.motors,
    config.receivers,
    config.controllers,
    config.sensors,
    config.regulators ?? [],
    couplers,
  ])
    if (new Set(entries.map((e) => e.node)).size !== entries.length)
      fail('INVALID_POWER_CONFIGURATION');
  for (const entry of config.sensors) {
    const { supply, ...sensor } = entry;
    if (
      supply &&
      (!exact(supply, 'resistance,minVoltage') ||
        !finite(supply.resistance, supply.minVoltage) ||
        supply.resistance < 1 ||
        supply.resistance > 1e9 ||
        supply.minVoltage <= 0 ||
        supply.minVoltage > 100)
    )
      fail('INVALID_POWER_CONFIGURATION');
    if (sensor.kind === 'loadCell') {
      if (
        !exact(sensor, 'node,kind,body,joint,support,sign') ||
        !node(sensor.node) ||
        sensor.body !== sensor.node ||
        ![sensor.joint, sensor.support].every((x) => Number.isSafeInteger(x) && x >= -1) ||
        ![-1, 1].includes(sensor.sign) ||
        (sensor.joint >= 0 && sensor.joint === sensor.support)
      )
        fail('INVALID_POWER_CONFIGURATION');
    } else if (sensor.kind === 'camera') {
      if (!exact(sensor, 'node,body,kind') || !node(sensor.node) || sensor.body !== sensor.node)
        fail('INVALID_POWER_CONFIGURATION');
    } else if (sensor.kind === 'travel') {
      if (
        !exact(sensor, 'node,kind,joint') ||
        !node(sensor.node) ||
        !Number.isSafeInteger(sensor.joint) ||
        sensor.joint < -1
      )
        fail('INVALID_POWER_CONFIGURATION');
    } else if (['range', 'linearMotion', 'tilt', 'jointAngle', 'contact'].includes(sensor.kind)) {
      const keys = {
        range: 'node,kind,body,origin,axis,range',
        linearMotion: 'node,kind,body,origin',
        tilt: 'node,kind,body',
        jointAngle: 'node,kind,body,joint,zero,sign',
        contact: 'node,kind,body,origin,axis,halfWidth,halfHeight',
      }[sensor.kind];
      if (!exact(sensor, keys) || !node(sensor.node) || sensor.body !== sensor.node)
        fail('INVALID_POWER_CONFIGURATION');
      for (const key of ['origin', 'axis'])
        if (
          sensor[key] &&
          (!Array.isArray(sensor[key]) ||
            sensor[key].length !== 3 ||
            !sensor[key].every(Number.isFinite))
        )
          fail('INVALID_POWER_CONFIGURATION');
      if (sensor.axis && Math.abs(Math.hypot(...sensor.axis) - 1) > 1e-9)
        fail('INVALID_POWER_CONFIGURATION');
      if (
        sensor.kind === 'range' &&
        (!finite(sensor.range) || sensor.range < 0.1 || sensor.range > 100)
      )
        fail('INVALID_POWER_CONFIGURATION');
      if (
        sensor.kind === 'jointAngle' &&
        (!Number.isSafeInteger(sensor.joint) ||
          sensor.joint < -1 ||
          !finite(sensor.zero) ||
          Math.abs(sensor.zero) > Math.PI ||
          ![-1, 1].includes(sensor.sign))
      )
        fail('INVALID_POWER_CONFIGURATION');
      if (
        sensor.kind === 'contact' &&
        (![sensor.halfWidth, sensor.halfHeight].every(
          (v) => Number.isFinite(v) && v > 0 && v <= 1,
        ) ||
          sensor.axis.some((v, i) => v !== [0, 0, 1][i]))
      )
        fail('INVALID_POWER_CONFIGURATION');
    } else if (sensor.kind === 'target') {
      if (
        !exact(sensor, 'node,kind,body,target,range') ||
        !node(sensor.node) ||
        sensor.body !== sensor.node ||
        !Number.isInteger(sensor.target) ||
        sensor.target < -1 ||
        sensor.target === sensor.node ||
        !Number.isFinite(sensor.range) ||
        sensor.range < 0.1 ||
        sensor.range > 100
      )
        fail('INVALID_POWER_CONFIGURATION');
    } else if (
      !exact(sensor, 'node,body,axis') ||
      !node(sensor.node) ||
      !node(sensor.body) ||
      !Array.isArray(sensor.axis) ||
      sensor.axis.length !== 3 ||
      !sensor.axis.every(Number.isFinite) ||
      Math.abs(Math.hypot(...sensor.axis) - 1) > 1e-9
    )
      fail('INVALID_POWER_CONFIGURATION');
  }
  admitLearningBindings(config);
  receiverControlConfiguration(config);
  const sources = config.receivers;
  const parent = new Map();
  const root = (n) => {
    if (!parent.has(n)) parent.set(n, n);
    if (parent.get(n) !== n) parent.set(n, root(parent.get(n)));
    return parent.get(n);
  };
  for (const [a, b] of config.wires) parent.set(root(a), root(b));
  for (const cell of config.cells) root(cell.node);
  for (const motor of config.motors) root(motor.node);
  const cellsFor = (m) => config.cells.filter((c) => root(c.node) === root(m.node));
  for (const motor of config.motors)
    if (cellsFor(motor).length > 1) fail('UNSUPPORTED_POWER_TOPOLOGY');
  for (const cell of config.cells)
    if (config.cells.filter((c) => root(c.node) === root(cell.node)).length > 1)
      fail('UNSUPPORTED_POWER_TOPOLOGY');
  const signalFor = (m) =>
    config.signalWires
      .filter((edge) => edge[1] === m.node)
      .map((edge) => sources.find((source) => source.node === edge[0]));
  for (const motor of [...config.motors, ...couplers, ...lamps]) {
    const signals = signalFor(motor);
    if (signals.length > 1 || signals.some((s) => !s)) fail('UNSUPPORTED_SIGNAL_TOPOLOGY');
  }
  if (config.sensors.filter((s) => s.kind === 'camera').length > CAMERA.maxParts)
    fail('CAMERA_LIMIT');
  for (const camera of config.sensors.filter((s) => s.kind === 'camera')) {
    const signals = signalFor(camera);
    if (signals.length > 1 || signals.some((s) => !s)) fail('UNSUPPORTED_SIGNAL_TOPOLOGY');
  }
  const sensorSupply = (sensor) => sensor.supply ?? SENSOR_SUPPLY;
  const lampCommand = (lamp, sources) => {
    const source = signalFor(lamp)[0];
    const live = source && sources.find((s) => s.node === source.node);
    return { command: live ? live.duty : 1, enabled: live?.enabled !== false };
  };
  let state = {
    ...(couplers.length
      ? {
          couplers: couplers.map((c) => ({
            node: c.node,
            joint: c.joint,
            progressJ: 0,
            heatJ: 0,
            current: 0,
            voltage: 0,
            ready: false,
            opened: false,
            reasonCode: c.joint < 0 ? 'NO_LATCH' : 'OFF',
          })),
        }
      : {}),
    ...(lamps.length
      ? {
          lamps: lamps.map((l) => ({
            node: l.node,
            steps: 0,
            command: 0,
            enabled: true,
            requestedW: 0,
            deliveredW: 0,
            current: 0,
            voltage: 0,
            luminousFluxLm: 0,
            deliveredEnergyJ: 0,
            color: l.color,
            beamSpread: l.beamSpread,
            reasonCode: 'OFF',
          })),
        }
      : {}),
    ...(config.sensors.length
      ? {
          sensors: config.sensors.map((s) => ({
            node: s.node,
            current: 0,
            voltage: 0,
            heatJ: 0,
            powered: false,
          })),
        }
      : {}),
    cells: config.cells.map((c) => ({ node: c.node, energyJ: c.initialJ, heatJ: 0 })),
    sources: sources.map((s) => ({ node: s.node, duty: s.duty })),
    motors: config.motors.map((m) => ({
      node: m.node,
      heatJ: 0,
      driverHeatJ: 0,
      shaftWorkJ: 0,
      mechanicalEnergy: 0,
      energyResidualJ: 0,
      current: 0,
      torque: 0,
      electricalEnergy: 0,
      reasonCode: 'OFF',
      ...(m.positionControl
        ? {
            position: {
              targetAngle:
                m.defaultDuty *
                (m.inputPolarity ?? 1) *
                (m.defaultDuty * (m.inputPolarity ?? 1) >= 0
                  ? m.positionControl.upperLimit
                  : -m.positionControl.lowerLimit),
              angle: 0,
              controlDuty: 0,
              integralDuty: 0,
            },
          }
        : {}),
    })),
  };
  function driveDuty(motor, command) {
    return motor.coordinate === 'linear'
      ? Math.sign(command) *
          Math.min(
            Math.abs(command),
            (motor.torqueConstant * motor.maxSpeed) / (cellsFor(motor)[0]?.voltage ?? 1),
          )
      : command;
  }
  function validateState(candidate, { settled = true, trustedShape = false } = {}) {
    if (
      !candidate ||
      (!trustedShape &&
        Object.keys(candidate).sort().join(',') !==
          [
            'cells',
            'motors',
            'sources',
            ...(config.sensors.length ? ['sensors'] : []),
            ...(couplers.length ? ['couplers'] : []),
            ...(lamps.length ? ['lamps'] : []),
          ]
            .sort()
            .join(',')) ||
      !Array.isArray(candidate.cells) ||
      !Array.isArray(candidate.sources) ||
      !Array.isArray(candidate.motors) ||
      candidate.cells.length !== config.cells.length ||
      candidate.sources.length !== sources.length ||
      candidate.motors.length !== config.motors.length
    )
      fail('INVALID_POWER_CHECKPOINT');
    if (couplers.length) {
      if (!Array.isArray(candidate.couplers) || candidate.couplers.length !== couplers.length)
        fail('INVALID_POWER_CHECKPOINT');
      for (const [i, c] of candidate.couplers.entries()) {
        const d = couplers[i];
        if (
          (d.joint < 0 &&
            (c.progressJ !== 0 || c.ready || c.opened || c.reasonCode !== 'NO_LATCH')) ||
          c.progressJ > c.heatJ + ENERGY_ABSOLUTE_TOLERANCE + ENERGY_RELATIVE_TOLERANCE * c.heatJ ||
          (c.reasonCode === 'OPEN') !== c.opened ||
          ['READY', 'RELEASE_SUPPORT_BLOCKED'].includes(c.reasonCode) !== c.ready ||
          (c.reasonCode === 'NO_LATCH') !== d.joint < 0 ||
          (c.reasonCode === 'ACTUATING') !== (c.progressJ > 0 && c.progressJ < d.energyJ) ||
          (c.opened &&
            c.heatJ + ENERGY_ABSOLUTE_TOLERANCE + ENERGY_RELATIVE_TOLERANCE * c.heatJ <
              d.energyJ) ||
          (!trustedShape &&
            !exact(c, 'node,joint,progressJ,heatJ,current,voltage,ready,opened,reasonCode')) ||
          c.node !== d.node ||
          c.joint !== d.joint ||
          !finite(c.progressJ, c.heatJ, c.current, c.voltage) ||
          Math.min(c.progressJ, c.heatJ, c.current, c.voltage) < 0 ||
          c.progressJ > d.energyJ ||
          typeof c.ready !== 'boolean' ||
          typeof c.opened !== 'boolean' ||
          c.ready !== (c.progressJ === d.energyJ && !c.opened) ||
          (c.opened && (c.progressJ !== 0 || c.reasonCode !== 'OPEN')) ||
          ![
            'NO_LATCH',
            'OFF',
            'NO_POWER',
            'LOW_VOLTAGE',
            'ACTUATING',
            'READY',
            'OPEN',
            'RELEASE_SUPPORT_BLOCKED',
          ].includes(c.reasonCode)
        )
          fail('INVALID_POWER_CHECKPOINT');
      }
    }
    if (lamps.length) {
      if (!Array.isArray(candidate.lamps) || candidate.lamps.length !== lamps.length)
        fail('INVALID_POWER_CHECKPOINT');
      candidate.lamps.forEach((l, i) => {
        const c = lamps[i],
          cell = cellsFor(c)[0],
          source = lampCommand(c, candidate.sources);
        const initial = l.steps === 0;
        const reason =
          l.requestedW === 0
            ? 'OFF'
            : !cell
              ? 'NO_POWER'
              : l.deliveredW === 0 &&
                  candidate.cells.find((e) => e.node === cell.node)?.energyJ === 0
                ? 'DEPLETED'
                : l.deliveredW < l.requestedW * (1 - 1e-9)
                  ? 'LIMITED'
                  : 'OK';
        if (
          !exact(
            l,
            'node,steps,command,enabled,requestedW,deliveredW,current,voltage,luminousFluxLm,deliveredEnergyJ,color,beamSpread,reasonCode',
          ) ||
          !Number.isSafeInteger(l.steps) ||
          l.steps < 0 ||
          (initial
            ? l.command !== 0 ||
              l.requestedW !== 0 ||
              l.deliveredEnergyJ !== 0 ||
              l.deliveredW !== 0 ||
              l.voltage !== 0 ||
              l.enabled !== true
            : l.command !== source.command || l.enabled !== source.enabled) ||
          l.voltage > (cell?.voltage ?? 0) ||
          l.current > (cell?.currentLimit ?? 0) + 1e-10 ||
          l.deliveredEnergyJ > (cell?.initialJ ?? 0) + 1e-9 ||
          l.deliveredEnergyJ > (l.steps * LAMP_WATTS) / 120 + 1e-8 ||
          l.reasonCode !== reason ||
          l.node !== c.node ||
          l.color !== c.color ||
          l.beamSpread !== c.beamSpread ||
          typeof l.enabled !== 'boolean' ||
          !finite(
            l.command,
            l.requestedW,
            l.deliveredW,
            l.current,
            l.voltage,
            l.luminousFluxLm,
            l.deliveredEnergyJ,
          ) ||
          Math.abs(l.command) > 1 ||
          Math.min(
            l.requestedW,
            l.deliveredW,
            l.current,
            l.voltage,
            l.luminousFluxLm,
            l.deliveredEnergyJ,
          ) < 0 ||
          l.requestedW !==
            LAMP_WATTS * c.brightness * Math.max(0, l.command) * (l.enabled ? 1 : 0) ||
          l.deliveredW > l.requestedW + 1e-10 ||
          l.luminousFluxLm !== l.deliveredW * LAMP_EFFICACY ||
          Math.abs(l.deliveredW - l.current * l.voltage) > 1e-10 ||
          !['OFF', 'OK', 'NO_POWER', 'DEPLETED', 'LIMITED'].includes(l.reasonCode) ||
          (['OFF', 'NO_POWER', 'DEPLETED'].includes(l.reasonCode) && l.deliveredW !== 0) ||
          (l.reasonCode === 'OFF' && l.requestedW !== 0)
        )
          fail('INVALID_POWER_CHECKPOINT');
      });
      // Reconcile the complete circuit ledger, including peers: a lamp restore
      // cannot invent energy while leaving its cell and other loads untouched.
      for (const cell of settled ? config.cells : []) {
        const own = candidate.cells.find((e) => e.node === cell.node);
        const same = (entry) => root(entry.node) === root(cell.node);
        const lampEnergy = candidate.lamps.filter(same).reduce((n, l) => n + l.deliveredEnergyJ, 0);
        const sensorEnergy = (candidate.sensors ?? [])
          .filter(same)
          .reduce((n, l) => n + l.heatJ, 0);
        const motorEnergy = candidate.motors
          .filter(same)
          .reduce((n, m) => n + m.heatJ + m.driverHeatJ + m.shaftWorkJ + m.energyResidualJ, 0);
        const used = cell.initialJ - own.energyJ,
          accounted =
            own.heatJ +
            lampEnergy +
            sensorEnergy +
            motorEnergy +
            (candidate.couplers ?? []).filter(same).reduce((n, c) => n + c.heatJ, 0);
        if (
          Math.abs(used - accounted) >
          ENERGY_ABSOLUTE_TOLERANCE +
            ENERGY_RELATIVE_TOLERANCE * Math.max(Math.abs(used), Math.abs(accounted)) +
            // Repeated subtraction from a large f64 charge loses low bits.
            4 * Number.EPSILON * cell.initialJ * Math.max(1, ...candidate.lamps.map((l) => l.steps))
        )
          fail('INVALID_POWER_CHECKPOINT');
      }
    }
    if (config.sensors.length) {
      if (!Array.isArray(candidate.sensors) || candidate.sensors.length !== config.sensors.length)
        fail('INVALID_POWER_CHECKPOINT');
      candidate.sensors.forEach((s, i) => {
        if (
          (!trustedShape && !exact(s, 'node,current,voltage,heatJ,powered')) ||
          s.node !== config.sensors[i].node ||
          !finite(s.current, s.voltage, s.heatJ) ||
          Math.min(s.current, s.voltage, s.heatJ) < 0 ||
          typeof s.powered !== 'boolean' ||
          s.powered !== (s.voltage >= sensorSupply(config.sensors[i]).minVoltage && s.current > 0)
        )
          fail('INVALID_POWER_CHECKPOINT');
      });
    }
    candidate.cells.forEach((c, i) => {
      if (
        (!trustedShape && Object.keys(c).sort().join(',') !== 'energyJ,heatJ,node') ||
        c.node !== config.cells[i].node ||
        !finite(c.energyJ, c.heatJ) ||
        c.heatJ < 0 ||
        c.energyJ < 0 ||
        c.energyJ > config.cells[i].capacityJ
      )
        fail('INVALID_POWER_CHECKPOINT');
    });
    candidate.sources.forEach((s, i) => {
      if (
        (!trustedShape &&
          !exact(s, 'duty,node' + (Object.hasOwn(s, 'enabled') ? ',enabled' : ''))) ||
        (Object.hasOwn(s, 'enabled') && s.enabled !== false) ||
        s.node !== sources[i].node ||
        !finite(s.duty) ||
        Math.abs(s.duty) > 1
      )
        fail('INVALID_POWER_CHECKPOINT');
    });
    candidate.motors.forEach((m, i) => {
      const control = config.motors[i].positionControl;
      if (
        control &&
        ((!trustedShape && !exact(m.position, 'targetAngle,angle,controlDuty,integralDuty')) ||
          !finite(
            m.position.targetAngle,
            m.position.angle,
            m.position.controlDuty,
            m.position.integralDuty,
          ) ||
          m.position.targetAngle < control.lowerLimit ||
          m.position.targetAngle > control.upperLimit ||
          Math.abs(m.position.controlDuty) > 1 ||
          Math.abs(m.position.integralDuty) > 1 ||
          Math.abs(m.position.angle) > Math.PI)
      )
        fail('INVALID_POWER_CHECKPOINT');
      if (
        (!trustedShape &&
          Object.keys(m).sort().join(',') !==
            [
              'current',
              'driverHeatJ',
              'electricalEnergy',
              'energyResidualJ',
              'heatJ',
              'mechanicalEnergy',
              'node',
              'reasonCode',
              'shaftWorkJ',
              'torque',
              ...(config.motors[i].positionControl ? ['position'] : []),
            ]
              .sort()
              .join(',')) ||
        m.node !== config.motors[i].node ||
        !finite(
          m.heatJ,
          m.driverHeatJ,
          m.shaftWorkJ,
          m.mechanicalEnergy,
          m.energyResidualJ,
          m.current,
          m.torque,
          m.electricalEnergy,
        ) ||
        m.driverHeatJ < 0 ||
        m.heatJ < 0 ||
        m.electricalEnergy < 0 ||
        !['OFF', 'OK', 'NO_POWER', 'NO_SHAFT', 'DEPLETED'].includes(m.reasonCode)
      )
        fail('INVALID_POWER_CHECKPOINT');
    });
    // Completed lamps share a source bus. Cumulative energy alone cannot validate
    // their instantaneous readings: source droop and driver bounds must also hold.
    for (const cell of lamps.length ? config.cells : []) {
      const sameCircuit = (entry) => root(entry.node) === root(cell.node);
      const connected = candidate.lamps.filter(sameCircuit).filter((l) => l.steps > 0);
      if (!connected.length) continue;
      const knownCurrent =
        connected.reduce((sum, l) => sum + l.current, 0) +
        (candidate.couplers ?? []).filter(sameCircuit).reduce((sum, c) => sum + c.current, 0) +
        (candidate.sensors ?? [])
          .filter(sameCircuit)
          .reduce((sum, sensor) => sum + sensor.current, 0);
      const voltageTolerance = 1e-9 * Math.max(1, cell.voltage);
      const currentTolerance = 1e-10 * Math.max(1, cell.currentLimit);
      const motors = config.motors.filter(sameCircuit);
      const hasMotor = motors.length > 0;
      const motorCurrent = motors.reduce((sum, motor) => {
        const record = candidate.motors.find((m) => m.node === motor.node);
        const signal = signalFor(motor)[0];
        const source = signal && candidate.sources.find((s) => s.node === signal.node);
        const duty =
          source?.enabled === false
            ? 0
            : motor.positionControl
              ? record.position.controlDuty
              : driveDuty(
                  motor,
                  (source ? source.duty : motor.defaultDuty) * (motor.inputPolarity ?? 1),
                );
        return sum + duty * record.current;
      }, 0);
      const totalCurrent = knownCurrent + motorCurrent;
      const busUpperBound = cell.voltage - cell.resistance * totalCurrent;
      const remaining = candidate.cells.find((c) => c.node === cell.node).energyJ;
      const unbounded =
        remaining > 4 * Number.EPSILON * Math.max(1, cell.initialJ) &&
        totalCurrent < cell.currentLimit - currentTolerance;
      if (motorCurrent < -currentTolerance || totalCurrent > cell.currentLimit + currentTolerance)
        fail('INVALID_POWER_CHECKPOINT');
      if (settled && !hasMotor && !couplers.some(sameCircuit)) {
        // Stateless passive circuits have no unknown pre-step latch transition or
        // mechanical response. Reconstruct their
        // pre-step charge from completed source draw and validate its actual
        // limited solution, not merely readings below an upper bound.
        const sensors = (candidate.sensors ?? []).filter(sameCircuit);
        const records = [...sensors, ...connected];
        const charge =
          candidate.cells.find((c) => c.node === cell.node).energyJ +
          (cell.voltage * knownCurrent) / 120;
        const loads = records.map((record, index) => {
          const resistance =
            index < sensors.length
              ? sensorSupply(config.sensors.find((sensor) => sensor.node === record.node))
                  .resistance
              : record.requestedW > 0
                ? Math.max(LAMP_NOMINAL_VOLTAGE, cell.voltage) ** 2 / record.requestedW
                : 1;
          return {
            cell: 0,
            duty: 1,
            speed: 0,
            inertia: Infinity,
            k: 0,
            active: charge > 0 && (index < sensors.length || record.requestedW > 0),
            resistance,
            limit: cell.voltage / resistance,
            load: true,
          };
        });
        const expected = sharedPowerStep(
          [
            {
              voltage: cell.voltage,
              resistance: cell.resistance,
              limit: cell.currentLimit,
              energy: charge,
            },
          ],
          loads,
          [],
          1 / 120,
        );
        if (
          !expected ||
          records.some(
            (record, index) =>
              Math.abs(record.current - expected.currents[index]) > currentTolerance,
          ) ||
          connected.some((l) => Math.abs(l.voltage - expected.voltages[0]) > voltageTolerance)
        )
          fail('INVALID_POWER_CHECKPOINT');
      }
      for (const l of connected) {
        const driverCurrent =
          (l.voltage * l.requestedW) / Math.max(LAMP_NOMINAL_VOLTAGE, cell.voltage) ** 2;
        if (
          l.voltage > busUpperBound + voltageTolerance ||
          Math.abs(l.voltage - busUpperBound) > voltageTolerance ||
          Math.abs(l.voltage - connected[0].voltage) > voltageTolerance ||
          l.current > driverCurrent + currentTolerance ||
          (unbounded && Math.abs(l.current - driverCurrent) > currentTolerance)
        )
          fail('INVALID_POWER_CHECKPOINT');
      }
    }
  }
  validateState(state);
  let pending = null;
  return Object.freeze({
    step(dt, speeds, commands = [], inertias = [], coupling = [], releaseResults = []) {
      if (pending) fail('POWER_STEP_PENDING');
      if (dt !== 1 / 120) fail('INVALID_POWER_STEP');
      const next = clone(state);
      if (
        !Array.isArray(releaseResults) ||
        new Set(releaseResults.map((r) => r.joint)).size !== releaseResults.length
      )
        fail('INVALID_RELEASE_RESULT');
      for (const r of releaseResults) {
        const c = next.couplers?.find((c) => c.joint === r.joint);
        if (
          !exact(r, 'joint,reasonCode') ||
          !c?.ready ||
          !['OK', 'RELEASE_SUPPORT_BLOCKED'].includes(r.reasonCode)
        )
          fail('INVALID_RELEASE_RESULT');
        if (r.reasonCode === 'OK') {
          c.opened = true;
          c.ready = false;
          c.progressJ = 0;
          c.reasonCode = 'OPEN';
        } else c.reasonCode = r.reasonCode;
      }
      const predicted = new Map(speeds.map((s) => [s.node, s.speed]));
      const responses = new Map();
      if (!Array.isArray(coupling)) fail('INVALID_MOTOR_INERTIA');
      for (const edge of coupling) {
        if (
          !exact(edge, 'source,target,response') ||
          !Number.isInteger(edge.source) ||
          !Number.isInteger(edge.target) ||
          edge.source < 0 ||
          edge.target <= edge.source ||
          edge.target >= config.motors.length ||
          !finite(edge.response)
        )
          fail('INVALID_MOTOR_INERTIA');
        if (!responses.has(edge.source)) responses.set(edge.source, []);
        if (responses.get(edge.source).some((e) => e.target === edge.target))
          fail('INVALID_MOTOR_INERTIA');
        responses.get(edge.source).push(edge);
      }
      const seen = new Set();
      for (const command of commands) {
        const source = next.sources.find((s) => s.node === command.node);
        if (
          !source ||
          seen.has(command.node) ||
          !exact(command, 'duty,node' + (Object.hasOwn(command, 'enabled') ? ',enabled' : '')) ||
          (Object.hasOwn(command, 'enabled') && typeof command.enabled !== 'boolean') ||
          !finite(command.duty) ||
          Math.abs(command.duty) > 1
        )
          fail('INVALID_SIGNAL_COMMAND');
        seen.add(command.node);
        source.duty = command.duty;
        if (command.enabled === false) source.enabled = false;
        else delete source.enabled;
      }
      const controls = config.motors.map((motor, i) => {
        const source = signalFor(motor)[0];
        const disabled =
          source && next.sources.find((s) => s.node === source.node).enabled === false;
        if (disabled) {
          if (motor.positionControl) {
            const sample = speeds.find((s) => s.node === motor.node);
            if (!sample || !finite(sample.angle, sample.speed) || Math.abs(sample.angle) > Math.PI)
              fail('INVALID_MOTOR_SAMPLE');
            next.motors[i].position = {
              ...state.motors[i].position,
              angle: sample.angle,
              controlDuty: 0,
              integralDuty: 0,
            };
          }
          return { duty: 0 };
        }
        const command =
          (source ? next.sources.find((s) => s.node === source.node).duty : motor.defaultDuty) *
          (motor.inputPolarity ?? 1);
        if (!motor.positionControl) return { duty: driveDuty(motor, command) };
        const p = motor.positionControl,
          sample = speeds.find((s) => s.node === motor.node);
        if (!sample || !finite(sample.angle, sample.speed) || Math.abs(sample.angle) > Math.PI)
          fail('INVALID_MOTOR_SAMPLE');
        const targetAngle = command * (command >= 0 ? p.upperLimit : -p.lowerLimit);
        const previous = state.motors[i].position;
        let integralDuty = previous.targetAngle === targetAngle ? previous.integralDuty : 0;
        const error = targetAngle - sample.angle;
        if (integralDuty * error < 0) integralDuty = 0;
        const raw = p.proportionalGain * error - p.dampingGain * sample.speed + integralDuty;
        const cell = cellsFor(motor)[0],
          available =
            cell &&
            next.cells.find((c) => c.node === cell.node).energyJ > 0 &&
            motor.joint >= 0 &&
            motor.rotor >= 0;
        if (!available) integralDuty = 0;
        else if (
          Math.abs(
            sampledPositionDuty(
              targetAngle,
              sample.angle,
              sample.speed,
              p.proportionalGain,
              p.dampingGain,
              integralDuty,
              inertias.find((s) => s.node === motor.node)?.inertia,
              motor.torqueConstant,
              cell.voltage,
              motor.resistance,
              dt,
            ),
          ) < 1 ||
          Math.sign(raw) * error < 0
        )
          integralDuty = Math.max(
            -1,
            Math.min(1, integralDuty + (p.integralGain ?? 3) * error * dt),
          );
        const duty = available
          ? sampledPositionDuty(
              targetAngle,
              sample.angle,
              sample.speed,
              p.proportionalGain,
              p.dampingGain,
              integralDuty,
              inertias.find((s) => s.node === motor.node)?.inertia,
              motor.torqueConstant,
              cell.voltage,
              motor.resistance,
              dt,
            )
          : 0;
        next.motors[i].position = {
          targetAngle,
          angle: sample.angle,
          controlDuty: duty,
          integralDuty,
        };
        return { duty };
      });
      const latchActive = couplers.map((c, i) => {
        const r = next.couplers[i],
          source = signalFor(c)[0],
          command = source && next.sources.find((s) => s.node === source.node);
        return (
          !r.opened && !r.ready && c.joint >= 0 && command?.enabled !== false && command?.duty > 0
        );
      });
      const lampControls = lamps.map((l) => {
        const { command, enabled } = lampCommand(l, next.sources);
        const requestedW = LAMP_WATTS * l.brightness * Math.max(0, command) * (enabled ? 1 : 0);
        const cell = cellsFor(l)[0];
        return {
          command,
          enabled,
          requestedW,
          resistance:
            requestedW > 0
              ? Math.max(LAMP_NOMINAL_VOLTAGE, cell?.voltage ?? LAMP_NOMINAL_VOLTAGE) ** 2 /
                requestedW
              : 1,
        };
      });
      const shared =
        lamps.length > 0 ||
        couplers.length > 0 ||
        config.sensors.length > 0 ||
        config.cells.some(
          (c) => config.motors.filter((m) => root(m.node) === root(c.node)).length > 1,
        );
      let sharedResult;
      if (shared) {
        const entries = config.motors.map((m, i) => {
          const cell = cellsFor(m)[0],
            source = signalFor(m)[0];
          const duty = controls[i].duty;
          const speed = predicted.get(m.node),
            inertia = inertias.find((s) => s.node === m.node)?.inertia;
          const active =
            m.rotor >= 0 &&
            m.joint >= 0 &&
            cell &&
            next.cells.find((c) => c.node === cell.node).energyJ > 0 &&
            duty !== 0;
          if (!finite(speed, duty)) fail('INVALID_MOTOR_SAMPLE');
          if (active && ((!finite(inertia) && inertia !== Infinity) || inertia <= 0))
            fail('INVALID_MOTOR_INERTIA');
          return {
            cell: config.cells.indexOf(cell),
            duty,
            speed,
            inertia,
            active: Boolean(active),
            k: m.torqueConstant,
            resistance: m.resistance,
            limit: m.currentLimit,
          };
        });
        for (const sensor of config.sensors) {
          const cell = cellsFor(sensor)[0],
            supply = sensorSupply(sensor);
          entries.push({
            cell: config.cells.indexOf(cell),
            duty: 1,
            speed: 0,
            inertia: Infinity,
            active: Boolean(cell && state.cells[config.cells.indexOf(cell)].energyJ > 0),
            k: 0,
            resistance: supply.resistance,
            limit: cell ? cell.voltage / supply.resistance : 0,
            load: true,
          });
        }
        for (const [i, c] of couplers.entries()) {
          const cell = cellsFor(c)[0];
          entries.push({
            cell: config.cells.indexOf(cell),
            duty: 1,
            speed: 0,
            inertia: Infinity,
            active: Boolean(
              latchActive[i] && cell && next.cells[config.cells.indexOf(cell)].energyJ > 0,
            ),
            k: 0,
            resistance: c.resistance,
            limit: cell ? cell.voltage / c.resistance : 0,
            load: true,
          });
        }
        for (const [i, lamp] of lamps.entries()) {
          const cell = cellsFor(lamp)[0],
            control = lampControls[i];
          entries.push({
            cell: config.cells.indexOf(cell),
            duty: 1,
            speed: 0,
            inertia: Infinity,
            active: Boolean(
              cell && state.cells[config.cells.indexOf(cell)].energyJ > 0 && control.requestedW > 0,
            ),
            k: 0,
            resistance: control.resistance,
            limit: cell ? cell.voltage / control.resistance : 0,
            load: true,
          });
        }
        sharedResult = sharedPowerStep(
          config.cells.map((c, i) => ({
            voltage: c.voltage,
            resistance: c.resistance,
            limit: c.currentLimit,
            energy: next.cells[i].energyJ,
          })),
          entries,
          coupling,
          dt,
        );
        if (!sharedResult) fail('ENERGY_INVARIANT');
        for (const [i, c] of config.cells.entries()) {
          next.cells[i].energyJ = Math.max(
            0,
            next.cells[i].energyJ - c.voltage * sharedResult.totals[i] * dt,
          );
          next.cells[i].heatJ += c.resistance * sharedResult.totals[i] ** 2 * dt;
        }
      }
      for (const [i, sensor] of config.sensors.entries()) {
        const record = next.sensors[i],
          cell = cellsFor(sensor)[0],
          supply = sensorSupply(sensor),
          current = sharedResult.currents[config.motors.length + i];
        const voltage = current * supply.resistance;
        record.current = current;
        record.voltage = voltage;
        record.powered = current > 0 && voltage >= supply.minVoltage;
        // All terminal energy becomes sensor/limiter heat; source heat is counted once above.
        if (cell) record.heatJ += sharedResult.voltages[config.cells.indexOf(cell)] * current * dt;
      }
      for (const [i, c] of couplers.entries()) {
        const r = next.couplers[i],
          cell = cellsFor(c)[0],
          current = sharedResult.currents[config.motors.length + config.sensors.length + i];
        r.current = current;
        r.voltage = current * c.resistance;
        if (cell) r.heatJ += sharedResult.voltages[config.cells.indexOf(cell)] * current * dt;
        if (r.opened || r.ready) continue;
        const powered = latchActive[i] && r.voltage >= c.minVoltage && current > 0;
        r.progressJ = powered
          ? Math.min(c.energyJ, r.progressJ + current * current * c.resistance * dt)
          : 0;
        r.ready = r.progressJ === c.energyJ;
        r.reasonCode =
          c.joint < 0
            ? 'NO_LATCH'
            : !latchActive[i]
              ? 'OFF'
              : !cell
                ? 'NO_POWER'
                : !powered
                  ? 'LOW_VOLTAGE'
                  : r.ready
                    ? 'READY'
                    : 'ACTUATING';
      }
      for (const [i, lamp] of lamps.entries()) {
        const record = next.lamps[i],
          cell = cellsFor(lamp)[0],
          control = lampControls[i];
        const current =
          sharedResult.currents[config.motors.length + config.sensors.length + couplers.length + i];
        const voltage = cell ? sharedResult.voltages[config.cells.indexOf(cell)] : 0;
        const deliveredW = voltage * current;
        Object.assign(record, {
          steps: record.steps + 1,
          command: control.command,
          enabled: control.enabled,
          requestedW: control.requestedW,
          current,
          voltage,
          deliveredW,
          luminousFluxLm: deliveredW * LAMP_EFFICACY,
          deliveredEnergyJ: record.deliveredEnergyJ + deliveredW * dt,
          reasonCode:
            control.requestedW === 0
              ? 'OFF'
              : !cell
                ? 'NO_POWER'
                : state.cells[config.cells.indexOf(cell)].energyJ === 0
                  ? 'DEPLETED'
                  : deliveredW < control.requestedW * (1 - 1e-9)
                    ? 'LIMITED'
                    : 'OK',
        });
      }
      const torques = [],
        allocations = [];
      for (const [i, motor] of config.motors.entries()) {
        const record = next.motors[i],
          cell = cellsFor(motor)[0],
          energy = cell && next.cells.find((c) => c.node === cell.node),
          source = signalFor(motor)[0];
        const duty = controls[i].duty;
        const sample = { speed: predicted.get(motor.node) },
          inertiaSample = inertias.find((s) => s.node === motor.node);
        const inertia = inertiaSample?.inertia;
        if (!sample || !finite(sample.speed) || !finite(duty) || Math.abs(duty) > 1)
          fail('INVALID_MOTOR_SAMPLE');
        let result = { current: 0, torque: 0, heatEnergy: 0, electricalEnergy: 0 },
          reasonCode = 'OK';
        if (motor.rotor < 0 || motor.joint < 0) reasonCode = 'NO_SHAFT';
        else if (!cell) reasonCode = 'NO_POWER';
        else if (
          (sharedResult ? state.cells.find((c) => c.node === cell.node).energyJ : energy.energyJ) <=
          0
        )
          reasonCode = 'DEPLETED';
        else if (duty === 0) reasonCode = 'OFF';
        else {
          if ((!finite(inertia) && inertia !== Infinity) || inertia <= 0)
            fail('INVALID_MOTOR_INERTIA');
          const voltage = cell.voltage * duty,
            resistance = motor.resistance + cell.resistance * duty * duty;
          const limit = Math.min(
            motor.currentLimit,
            cell.currentLimit / Math.abs(duty),
            energy.energyJ / (Math.abs(voltage) * dt),
          );
          result = sharedResult
            ? {
                current: sharedResult.currents[i],
                torque: motor.torqueConstant * sharedResult.currents[i],
                electricalEnergy: voltage * sharedResult.currents[i] * dt,
              }
            : motorStep(
                voltage,
                sample.speed,
                motor.torqueConstant,
                resistance,
                limit,
                inertia,
                dt,
              );
          if (!sharedResult) {
            energy.energyJ = Math.max(0, energy.energyJ - result.electricalEnergy);
            const cellHeat = cell.resistance * (result.current * duty) ** 2 * dt;
            energy.heatJ += cellHeat;
          }
        }
        Object.assign(record, {
          current: result.current,
          torque: result.torque,
          electricalEnergy: result.electricalEnergy,
          mechanicalEnergy: 0,
          reasonCode,
        });
        allocations.push({
          speed: sample.speed,
          current: result.current,
          torque: result.torque,
          electricalEnergy: result.electricalEnergy,
          cellHeat: cell
            ? cell.resistance *
              (result.current * duty) *
              (sharedResult
                ? sharedResult.totals[config.cells.indexOf(cell)]
                : result.current * duty) *
              dt
            : 0,
          copperHeat: motor.resistance * result.current ** 2 * dt,
        });
        for (const edge of responses.get(i) ?? []) {
          const node = config.motors[edge.target].node;
          predicted.set(node, predicted.get(node) + edge.response * result.torque * dt);
        }
        torques.push({
          body: motor.body,
          rotor: motor.rotor,
          joint: motor.joint,
          axis: [...motor.axis],
          value: result.torque,
        });
      }
      // Shape and static identity came from construction/restore; validate numerical
      // updates without sorting every unchanged record schema each tick. Circuit
      // ledger reconciliation applies to settled (constructed or restored) state.
      validateState(next, { settled: false, trustedShape: true });
      pending = { dt, next, allocations };
      return { torques };
    },
    completeStep(dt, receipts) {
      if (!pending || dt !== pending.dt) fail('INVALID_POWER_STEP');
      if (
        !Array.isArray(receipts) ||
        receipts.length !== config.motors.length ||
        new Set(receipts.map((s) => s.node)).size !== config.motors.length
      )
        fail('INVALID_MOTOR_SAMPLE');
      // Only motors change in completion. Keep pending records untouched until
      // every receipt and accumulated value passes, so a late failure can retry.
      const next = { ...pending.next, motors: [...pending.next.motors] };
      for (const [i, motor] of config.motors.entries()) {
        const sample = receipts.find((s) => s.node === motor.node);
        if (
          !sample ||
          !exact(
            sample,
            'node,speedBefore,speedAfter,workJ,kineticDeltaJ,kineticBeforeJ,kineticAfterJ' +
              (Object.hasOwn(sample, 'constraintWorkJ') ? ',constraintWorkJ' : '') +
              (motor.positionControl ? ',angle' : ''),
          ) ||
          !finite(
            sample.speedBefore,
            sample.speedAfter,
            sample.workJ,
            sample.kineticDeltaJ,
            sample.kineticBeforeJ,
            sample.kineticAfterJ,
            Object.hasOwn(sample, 'constraintWorkJ') ? sample.constraintWorkJ : 0,
          ) ||
          (motor.positionControl && (!finite(sample.angle) || Math.abs(sample.angle) > Math.PI)) ||
          sample.kineticBeforeJ < 0 ||
          sample.kineticAfterJ < 0
        )
          fail('INVALID_MOTOR_SAMPLE');
        const allocation = pending.allocations[i],
          record = { ...next.motors[i] };
        if (motor.positionControl) record.position = { ...record.position };
        // The physics door measures the discrete kick before contacts/gravity.
        // Full-inertia KE agrees with funded motor work plus independently
        // measured signed work of regularized constraint reactions.
        const work = sample.workJ,
          expectedWork = (allocation.torque * (sample.speedBefore + sample.speedAfter) * dt) / 2;
        const workTolerance =
          ENERGY_ABSOLUTE_TOLERANCE +
          ENERGY_RELATIVE_TOLERANCE *
            Math.max(Math.abs(work), Math.abs(expectedWork), allocation.electricalEnergy);
        const receiptTolerance =
          ENERGY_ABSOLUTE_TOLERANCE +
          ENERGY_RELATIVE_TOLERANCE *
            Math.max(
              Math.abs(work),
              Math.abs(sample.kineticDeltaJ),
              sample.kineticBeforeJ,
              sample.kineticAfterJ,
              allocation.electricalEnergy,
            );
        if (
          Math.abs(sample.kineticDeltaJ - (sample.kineticAfterJ - sample.kineticBeforeJ)) >
            receiptTolerance ||
          Math.abs(work - expectedWork) > workTolerance ||
          Math.abs(work + (sample.constraintWorkJ ?? 0) - sample.kineticDeltaJ) >
            receiptTolerance ||
          Math.abs(sample.speedBefore - allocation.speed) >
            ENERGY_RELATIVE_TOLERANCE * Math.max(1, Math.abs(allocation.speed))
        )
          fail('ENERGY_INVARIANT');
        const residual =
          allocation.electricalEnergy - allocation.cellHeat - allocation.copperHeat - work;
        const tolerance =
          ENERGY_ABSOLUTE_TOLERANCE +
          ENERGY_RELATIVE_TOLERANCE *
            Math.max(
              Math.abs(allocation.electricalEnergy),
              Math.abs(work),
              allocation.cellHeat + allocation.copperHeat,
            );
        // The driver cannot supply extra voltage at either measured endpoint, even
        // when its averaged heat is positive. Express headroom in joules to use the
        // same explicit Float32 error budget at the kick endpoint. Later contact
        // redistribution belongs to the integration ledger, not the driver.
        const endpointWork = allocation.torque * sample.speedAfter * dt;
        const headroom =
          allocation.electricalEnergy - allocation.cellHeat - allocation.copperHeat - endpointWork;
        const endpointTolerance =
          ENERGY_ABSOLUTE_TOLERANCE +
          ENERGY_RELATIVE_TOLERANCE *
            Math.max(
              Math.abs(allocation.electricalEnergy),
              Math.abs(endpointWork),
              allocation.cellHeat + allocation.copperHeat,
            );
        if (
          !finite(work, residual, headroom) ||
          residual < -tolerance ||
          headroom < -endpointTolerance
        )
          fail('ENERGY_INVARIANT');
        if (motor.positionControl) record.position.angle = sample.angle;
        record.heatJ += allocation.copperHeat;
        record.mechanicalEnergy = work;
        record.shaftWorkJ += work;
        if (residual >= 0) record.driverHeatJ += residual;
        else record.energyResidualJ += residual; // Explicit signed numerical remainder.
        next.motors[i] = record;
      }
      // The pending shape is already validated. After all receipts, validate the
      // completed values and close the settled circuit ledger (lamp circuits need the
      // completed motor work), preserving failure precedence and late-failure retry.
      validateState(next, { trustedShape: true });
      state = next;
      pending = null;
      return clone(state);
    },
    read: () => immutableCopy(state),
    snapshot() {
      if (pending) fail('POWER_STEP_PENDING');
      return clone(state);
    },
    restore(snapshot) {
      const next = clone(snapshot);
      validateState(next);
      state = next;
      pending = null;
    },
  });
}
