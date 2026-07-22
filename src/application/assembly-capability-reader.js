import { compileAssembly } from "../model/assembly-compiler.js";
import {
  componentControlContract,
  componentPropulsion,
  componentReadings,
} from "../model/component-contracts.js";
import { compiledAssemblyCapabilities } from "../model/compiled-assembly-capabilities.js";

const HUMANOID_ROLES = Object.freeze(
  "pelvis torso footL footR hipL hipR kneeL kneeR ankleL ankleR".split(" "),
);

/**
 * Creates one revision-aware capability reader for editor previews and live
 * simulation. Capabilities derive from parts, ports, constraints, and runtime
 * state; demo identity is intentionally absent.
 */
export function createAssemblyCapabilityReader({
  assembly,
  catalog,
  editor,
  runtime,
}) {
  let cachedRevision = -1;
  let cached =
    /** @type {Readonly<{wheels: boolean, articulation: boolean, commandChannelsByPart:Map<unknown,readonly string[]>}>} */ (
      Object.freeze({
        wheels: false,
        articulation: false,
        commandChannelsByPart: new Map(),
      })
    );

  function compiled() {
    if (cachedRevision === assembly.revision()) return cached;
    const result = compileAssembly(assembly.snapshot(), catalog);
    cachedRevision = assembly.revision();
    cached = compiledAssemblyCapabilities(result, catalog);
    return cached;
  }

  function hasWheels() {
    const active = runtime.multibody();
    return editor.running() && active ? active.hasWheels() : compiled().wheels;
  }

  function hasHumanoidLayout() {
    const parts = editor.parts();
    return (
      HUMANOID_ROLES.every((role) =>
        parts.some((part) => part.rigRole === role),
      ) &&
      parts.some((part) => componentReadings(part).includes("imu_roll_deg")) &&
      parts.some(
        (part) => componentControlContract(part) === "reaction-wheel-v1",
      )
    );
  }

  function hasPoweredFlight() {
    const thrusterIds = new Set(
      editor
        .parts()
        .filter(
          (part) => componentPropulsion(part)?.kind === "pressure-nozzle-v1",
        )
        .map((part) => part.id),
    );
    return (
      thrusterIds.size > 0 &&
      editor
        .connections()
        .some(
          (connection) =>
            connection.kind === "mechanical" &&
            !connection.failed &&
            (thrusterIds.has(connection.a) || thrusterIds.has(connection.b)),
        )
    );
  }

  return Object.freeze({
    hasWheels,
    hasArticulation: () => compiled().articulation,
    hasHumanoidLayout,
    hasPoweredFlight,
    commandChannels(partId) {
      return compiled().commandChannelsByPart.get(partId) || Object.freeze([]);
    },
  });
}
