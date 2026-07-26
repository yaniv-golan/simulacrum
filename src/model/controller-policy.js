// Shared executable policy consumed by model, compiler, editor, and runtime.
export const CONTROLLER_POLICY_VERSION = "control-wasm-v1-bindings";

export const CONTROLLER_CHANNELS = Object.freeze([
  "command",
  "throttle",
  "steering",
  "collective",
  "armed",
  "abort",
  "gimbal_x",
  "gimbal_z",
  "brake",
  "lights",
  "yaw",
  "pitch",
  "release",
  "roll",
  "alt_hold",
  "gait_speed",
  "stride",
  "balance",
  "crouch",
  "linear_target",
  "linear_velocity",
  "linear_force",
  "joint_target",
  "inflate",
  "position",
  "target_altitude",
  "target_x",
  "target_z",
]);

export const CONTROLLER_LIMITS = Object.freeze({
  sourceBytes: 32 * 1024,
  compiledBytes: 64 * 1024,
  irNodes: 2048,
  irDepth: 64,
  functions: 32,
  globals: 32,
  parametersPerFunction: 16,
  localsPerFunction: 64,
  outputsPerTick: 64,
  fuelPerTick: 10_000,
});

export function assertControllerSourceSize(source, label = "source") {
  if (typeof source !== "string") throw new TypeError(`${label} must be text`);
  if (
    new TextEncoder().encode(source).byteLength > CONTROLLER_LIMITS.sourceBytes
  )
    throw new Error(`${label} exceeds 32 KB`);
}
