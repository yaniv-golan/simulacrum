import { TYPES } from "./component-catalog.js";
import {
  componentControlContract,
  componentDefinition,
  componentElectricalContract,
  componentElectricalSource,
} from "./component-contracts.js";

const range = (minimum, maximum, options = {}) =>
  Object.freeze({
    minimum,
    maximum,
    failsafe: options.failsafe ?? 0,
    unit: options.unit || "normalized",
    fanout: Boolean(options.fanout),
  });

// The ordinary command receiver is the scalar relay boundary shared by remote
// and restricted-controller commands. Producers must either stay within this
// envelope or expose any lossy encoding explicitly.
export const COMMAND_SINK_SCALAR_LIMIT = 1_000_000;

/**
 * Component-level command contract. A command is valid only for the addressed
 * component type; fanout is deliberate and remains target/controller scoped.
 */
export const ACTUATOR_CHANNELS = Object.freeze({
  "command-sink-v1": Object.freeze({
    command: range(-COMMAND_SINK_SCALAR_LIMIT, COMMAND_SINK_SCALAR_LIMIT, {
      unit: "scalar",
    }),
  }),
  "rotary-drive-v1": Object.freeze({
    throttle: range(-1, 1, { fanout: true }),
    brake: range(0, 1, { fanout: true, unit: "ratio" }),
    collective: range(0, 1, { fanout: true, unit: "ratio" }),
  }),
  "rotary-position-v1": Object.freeze({
    joint_target: range(-1, 1, { unit: "normalized angle" }),
    steering: range(-1, 1, { fanout: true, unit: "normalized angle" }),
    yaw: range(-1, 1, { fanout: true, unit: "normalized angle" }),
    pitch: range(-1, 1, { fanout: true, unit: "normalized angle" }),
    roll: range(-1, 1, { fanout: true, unit: "normalized angle" }),
  }),
  "linear-position-v1": Object.freeze({
    linear_target: range(0, 1, { unit: "normalized stroke" }),
    linear_velocity: range(-1, 1, { unit: "normalized speed" }),
    linear_force_n: range(
      -COMMAND_SINK_SCALAR_LIMIT,
      COMMAND_SINK_SCALAR_LIMIT,
      { unit: "N" },
    ),
  }),
  "reaction-wheel-v1": Object.freeze({
    yaw: range(-1, 1, { fanout: true }),
    pitch: range(-1, 1, { fanout: true }),
    roll: range(-1, 1, { fanout: true }),
  }),
  "luminaire-v1": Object.freeze({
    lights: range(0, 1, { fanout: true, unit: "enabled" }),
  }),
  "pressure-nozzle-v1": Object.freeze({
    throttle: range(0, 1, { fanout: true, unit: "ratio" }),
    collective: range(0, 1, { fanout: true, unit: "ratio" }),
    gimbal_x: range(-1, 1, { fanout: true, unit: "normalized angle" }),
    gimbal_z: range(-1, 1, { fanout: true, unit: "normalized angle" }),
  }),
  "release-coupler-v1": Object.freeze({
    release: range(0, 1, { unit: "trigger" }),
  }),
  "air-compressor-v1": Object.freeze({
    inflate: range(0, 1, { fanout: true, unit: "ratio" }),
  }),
  "three-way-pneumatic-valve-v1": Object.freeze({
    position: range(-1, 1, {
      fanout: true,
      unit: "vent / hold / supply",
    }),
  }),
  "controller-target-v1": Object.freeze({
    armed: range(0, 1, { unit: "enabled" }),
    target_altitude: range(0, 1_000_000, { unit: "m" }),
    target_x: range(-1_000_000, 1_000_000, { unit: "m" }),
    target_z: range(-1_000_000, 1_000_000, { unit: "m" }),
    abort: range(0, 1, { unit: "hold" }),
    alt_hold: range(0, 1, { unit: "enabled" }),
  }),
});

/** @param {any} part @param {string} channel @param {Record<string, any>} [catalog] */
export function actuatorChannel(part, channel, catalog = TYPES) {
  const contractId = componentControlContract(part, catalog);
  return (contractId && ACTUATOR_CHANNELS[contractId]?.[channel]) || null;
}

/** @param {any} part @param {string} channel @param {Record<string, any>} [catalog] */
export function acceptsActuatorChannel(part, channel, catalog = TYPES) {
  return Boolean(actuatorChannel(part, channel, catalog));
}

/** The complete authored command surface for one resolved component. */
export function actuatorChannels(part, catalog = TYPES) {
  const contractId = componentControlContract(part, catalog);
  return Object.freeze(
    Object.keys((contractId && ACTUATOR_CHANNELS[contractId]) || {}).sort(),
  );
}

/** @param {any} part @param {string} channel @param {unknown} value @param {Record<string, any>} [catalog] */
export function clampActuatorCommand(part, channel, value, catalog = TYPES) {
  const contract = actuatorChannel(part, channel, catalog);
  if (!contract) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return contract.failsafe;
  if (
    channel === "linear_force_n" &&
    (number < contract.minimum || number > contract.maximum)
  )
    return contract.failsafe;
  return Math.max(contract.minimum, Math.min(contract.maximum, number));
}

/**
 * Absolute effort demands fail closed instead of hiding excess by clipping.
 * @param {any} part
 * @param {string} channel
 * @param {unknown} value
 * @param {Record<string, any>} [catalog]
 */
export function actuatorCommandValueIsAdmissible(
  part,
  channel,
  value,
  catalog = TYPES,
) {
  const contract = actuatorChannel(part, channel, catalog),
    number = Number(value);
  if (!contract || !Number.isFinite(number)) return false;
  if (channel !== "linear_force_n") return true;
  return number >= contract.minimum && number <= contract.maximum;
}

/** Reads one addressed channel and applies its declared conflict failsafe. */
export function readActuatorCommand(
  commandBus,
  part,
  channel,
  fallback = undefined,
) {
  const contract = actuatorChannel(part, channel),
    safeValue = contract?.failsafe ?? 0,
    result = commandBus.read(
      part.id,
      channel,
      fallback === undefined ? safeValue : fallback,
    );
  return result.conflict ? { ...result, value: safeValue } : result;
}

/** @param {string} channel @param {Record<string, any>} [catalog] */
export function targetTypesForChannel(channel, catalog = TYPES) {
  return Object.freeze(
    Object.keys(catalog).filter((type) =>
      actuatorChannel({ type }, channel, catalog),
    ),
  );
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function powerContract(part, catalog = TYPES) {
  const base = componentElectricalContract(part, catalog);
  if (!base) return null;
  let requestW;
  if (base.kind === "fixed-load-v1") requestW = base.requestW;
  else if (
    base.kind === "configured-kilowatts-v1" ||
    base.kind === "configured-watts-v1"
  ) {
    const configured = Number(
      part.config?.[base.configField] ??
        componentDefinition(part, catalog)?.[base.configField],
    );
    if (!Number.isFinite(configured)) return null;
    requestW =
      configured * (base.kind === "configured-kilowatts-v1" ? 1000 : 1);
  } else if (base.kind === "mechanism-actuator-v1") {
    const law =
      part.mechanism?.config?.actuation?.powerLaw ||
      part.mechanism?.config?.powerLaw;
    if (!law) return null;
    requestW =
      law.maximumMechanicalMotoringPowerW / law.electricalMotoringEfficiency +
      law.idlePowerW;
  } else if (base.kind === "release-actuator-v1") {
    const law = part.mechanism?.config?.releaseLaw;
    if (!law) return null;
    requestW = law.maximumElectricalPowerW;
  } else return null;
  requestW = Math.max(1, Number(requestW));
  return Object.freeze({
    requestW,
    minimumW: Math.min(requestW, base.minimumW),
    baselineW: Math.min(requestW, base.baselineW),
    efficiency: Math.max(
      0.01,
      Math.min(1, Number(part.config?.electricalEfficiency ?? 0.92)),
    ),
  });
}

/** @param {any} part @param {Record<string, any>} [catalog] */
export function sourcePowerContract(part, catalog = TYPES) {
  const contract = componentElectricalSource(part, catalog);
  if (!contract) return null;
  const capacityWh = Math.max(
    0,
    Number(part.config?.[contract.capacityField] ?? 0),
  );
  return Object.freeze({
    maxOutputW: Math.max(
      0,
      Number(
        part.config?.[contract.maximumOutputField] ??
          Math.max(1000, capacityWh * 500),
      ),
    ),
    efficiency: Math.max(
      0.01,
      Math.min(1, Number(part.config?.dischargeEfficiency ?? 0.96)),
    ),
  });
}
