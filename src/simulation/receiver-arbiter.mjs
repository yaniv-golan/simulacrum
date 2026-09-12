import { DT } from '../model/tick.mjs';
import { immutableCopy } from '../model/observation.mjs';

const fail = () => {
  throw Error('INVALID_RECEIVER_CONTROL');
};
const exact = (value, keys) =>
  value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join(',') === keys.split(',').sort().join(',');
const node = (n) => Number.isSafeInteger(n) && n >= 0;
const ratio = (n) => Number.isFinite(n) && Math.abs(n) <= 1;
const modes = ['manual', 'automatic', 'learned', 'off'];
const reasons = ['OK', 'OPERATOR_OFF', 'SUSPENDED', 'INVALID_SENSOR', 'NO_REGULATOR'];
const clamp = (n, lower, upper) => Math.max(lower, Math.min(upper, n));

/** Session-owned arbitration. Controller programs never receive this operator input path. */
export function createReceiverArbiter(input) {
  const config = immutableCopy(input);
  if (!Array.isArray(config) || config.length > 8192) fail();
  const nodes = new Set(),
    regulators = new Set();
  for (const c of config) {
    if (
      !exact(
        c,
        'node,duty' +
          (c.regulator ? ',regulator' : '') +
          (Object.hasOwn(c, 'learning') ? ',learning' : '') +
          (Object.hasOwn(c, 'program') ? ',program' : ''),
      ) ||
      (Object.hasOwn(c, 'learning') && c.learning !== true) ||
      (Object.hasOwn(c, 'program') && c.program !== true) ||
      !node(c.node) ||
      nodes.has(c.node) ||
      !ratio(c.duty)
    )
      fail();
    nodes.add(c.node);
    if (!c.regulator) continue;
    const r = c.regulator;
    if (
      !exact(
        r,
        'node,sensor,target,minTarget,maxTarget,proportionalGain,dampingGain,polarity,neutral,maxRate,enabled',
      ) ||
      !node(r.node) ||
      !(node(r.sensor) || r.sensor === -1) ||
      regulators.has(r.node) ||
      ![r.target, r.minTarget, r.maxTarget, r.proportionalGain, r.dampingGain, r.maxRate].every(
        Number.isFinite,
      ) ||
      r.minTarget < 0.08 ||
      r.maxTarget > 0.4 ||
      r.minTarget >= r.maxTarget ||
      r.target < r.minTarget ||
      r.target > r.maxTarget ||
      r.proportionalGain < 0 ||
      r.dampingGain < 0 ||
      r.maxRate <= 0 ||
      ![-1, 1].includes(r.polarity) ||
      !ratio(r.neutral) ||
      typeof r.enabled !== 'boolean'
    )
      fail();
    regulators.add(r.node);
  }
  let state = {
    tick: 0,
    receivers: config.map((c) => ({
      node: c.node,
      mode: 'manual',
      duty: c.duty,
      reason: 'OK',
      target: c.regulator?.target ?? null,
    })),
  };
  function validateState(next) {
    if (
      !exact(next, 'tick,receivers') ||
      !Number.isSafeInteger(next.tick) ||
      next.tick < 0 ||
      !Array.isArray(next.receivers) ||
      next.receivers.length !== config.length
    )
      fail();
    next.receivers.forEach((r, i) => {
      const c = config[i];
      if (
        !exact(r, 'node,mode,duty,reason,target') ||
        r.node !== c.node ||
        !modes.includes(r.mode) ||
        !ratio(r.duty) ||
        !reasons.includes(r.reason) ||
        (r.mode === 'off' ? r.duty !== 0 || r.reason === 'OK' : r.reason !== 'OK') ||
        (r.mode === 'automatic' && !c.regulator?.enabled && !c.program) ||
        (r.mode === 'learned' && !c.learning) ||
        (c.regulator
          ? !Number.isFinite(r.target) ||
            r.target < c.regulator.minTarget ||
            r.target > c.regulator.maxTarget
          : r.target !== null)
      )
        fail();
    });
  }
  return Object.freeze({
    snapshot: () => immutableCopy(state),
    restore(inputState) {
      const next = immutableCopy(inputState);
      validateState(next);
      state = structuredClone(next);
    },
    step(tick, inputSample, inputEvents) {
      const sample = immutableCopy(inputSample),
        events = immutableCopy(inputEvents);
      if (
        !Number.isSafeInteger(tick) ||
        tick !== state.tick + 1 ||
        !exact(sample, 'tick,readings') ||
        !Number.isSafeInteger(sample.tick) ||
        sample.tick < 0 ||
        !Array.isArray(sample.readings) ||
        !Array.isArray(events) ||
        events.filter((e) => e?.type !== 'suspend').length > 64 ||
        events.filter((e) => e?.type === 'suspend').length > 1
      )
        fail();
      const readings = new Map();
      for (const r of sample.readings) {
        if (
          !exact(r, 'node,valid,length,speed') ||
          !node(r.node) ||
          readings.has(r.node) ||
          typeof r.valid !== 'boolean' ||
          !Number.isFinite(r.length) ||
          !Number.isFinite(r.speed) ||
          r.length < 0
        )
          fail();
        readings.set(r.node, r);
      }
      for (const e of events) {
        if (exact(e, 'type') && e.type === 'suspend') continue;
        if (!nodes.has(e.node)) fail();
        if (e.type === 'mode' && exact(e, 'type,node,mode') && modes.includes(e.mode)) continue;
        if (
          ['manual', 'program', 'release'].includes(e.type) &&
          exact(
            e,
            'type,node,duty' + (e.type === 'program' && Object.hasOwn(e, 'valid') ? ',valid' : ''),
          ) &&
          (!Object.hasOwn(e, 'valid') || typeof e.valid === 'boolean') &&
          ratio(e.duty)
        )
          continue;
        if (
          e.type === 'learned' &&
          exact(e, 'type,node,duty,valid') &&
          ratio(e.duty) &&
          typeof e.valid === 'boolean'
        )
          continue;
        const r = config.find((c) => c.node === e.node)?.regulator;
        if (
          e.type === 'target' &&
          exact(e, 'type,node,target') &&
          r &&
          Number.isFinite(e.target) &&
          e.target >= r.minTarget &&
          e.target <= r.maxTarget
        )
          continue;
        fail();
      }
      const next = structuredClone(state);
      next.tick = tick;
      for (const [i, c] of config.entries()) {
        const r = next.receivers[i];
        let own = events.filter((e) => e.node === c.node);
        const target = own.findLast((e) => e.type === 'target');
        if (target) r.target = target.target;
        const off = (reason) => {
          r.mode = 'off';
          r.duty = 0;
          r.reason = reason;
        };
        if (own.some((e) => e.type === 'mode' && e.mode === 'off')) {
          off('OPERATOR_OFF');
          continue;
        }
        const suspendedAt = events.findLastIndex((e) => e.type === 'suspend');
        if (suspendedAt >= 0) {
          if (r.mode === 'automatic' || r.mode === 'learned') off('SUSPENDED');
          else if (r.mode === 'manual') r.duty = 0;
          // Suspension cancels already queued held input. Fresh input after it
          // remains ordered and can explicitly take ownership or rearm.
          own = events.slice(suspendedAt + 1).filter((e) => e.node === c.node);
        }
        const manual = own.findLast((e) => e.type === 'manual');
        if (manual) {
          const released = own
            .slice(own.lastIndexOf(manual) + 1)
            .findLast((e) => e.type === 'release');
          r.mode = 'manual';
          r.duty = released?.duty ?? manual.duty;
          r.reason = 'OK';
          continue;
        }
        const requested = own.findLast((e) => e.type === 'mode');
        if (requested) {
          r.mode = requested.mode;
          r.reason = 'OK';
        }
        if (r.mode === 'learned') {
          const learned = own.findLast((e) => e.type === 'learned');
          if (!c.learning || !learned?.valid) off('INVALID_SENSOR');
          else r.duty = learned.duty;
          continue;
        }
        if (r.mode === 'automatic' && c.program) {
          const program = own.findLast((e) => e.type === 'program');
          if (!program || program.valid === false) off('INVALID_SENSOR');
          else r.duty = program.duty;
          continue;
        }
        if (r.mode !== 'automatic') {
          const program = own.findLast((e) => ['program', 'release'].includes(e.type));
          if (r.mode === 'manual' && program && (!c.program || program.type === 'release'))
            r.duty = program.duty;
          continue;
        }
        const controller = c.regulator;
        if (!controller?.enabled) {
          off('NO_REGULATOR');
          continue;
        }
        const reading = readings.get(controller.sensor);
        if (sample.tick !== tick - 1 || !reading?.valid) {
          off('INVALID_SENSOR');
          continue;
        }
        const demand = clamp(
          controller.neutral +
            controller.polarity *
              (controller.proportionalGain * (r.target - reading.length) -
                controller.dampingGain * reading.speed),
          -1,
          1,
        );
        const delta = controller.maxRate * DT;
        r.duty = clamp(demand, Math.max(-1, r.duty - delta), Math.min(1, r.duty + delta));
      }
      validateState(next);
      state = next;
      return immutableCopy(state.receivers.map((r) => ({ ...r, enabled: r.mode !== 'off' })));
    },
  });
}

/** Only explicit signal wiring selects a regulator; names and assembly membership carry no authority. */
export function receiverControlConfiguration(power) {
  const regulators = power.regulators ?? [];
  // Validate even unwired regulators before configuration admission succeeds.
  for (const r of regulators) {
    createReceiverArbiter([{ node: r.node, duty: 0, regulator: r }]);
    const incoming = power.signalWires.filter((edge) => edge[1] === r.node);
    if (
      incoming.length > 1 ||
      r.sensor !== (incoming[0]?.[0] ?? -1) ||
      (r.sensor >= 0 && !power.sensors.some((s) => s.node === r.sensor && s.kind === 'travel'))
    )
      fail();
  }
  return power.receivers.map((receiver) => {
    const inputs = power.signalWires.filter((edge) => edge[1] === receiver.node);
    if (inputs.length > 1) fail();
    const regulator = regulators.find((r) => r.node === inputs[0]?.[0]);
    const learning = power.controllers?.some((c) => c.node === inputs[0]?.[0] && c.learning?.model);
    return {
      ...receiver,
      ...(power.controllers?.some((c) => c.node === inputs[0]?.[0] && c.program)
        ? { program: true }
        : {}),
      ...(regulator ? { regulator } : {}),
      ...(learning ? { learning: true } : {}),
    };
  });
}
