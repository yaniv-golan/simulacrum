import { compileAssemblyFromIssuedRoots } from "./assembly-compiler.js";
import { AssemblyModel } from "./assembly-model.js";
import { TYPES } from "./component-catalog.js";
import { isPhysicalConnectionKind } from "./connection-contracts.js";
import { validateBlueprintWire } from "./generated/portable-machine-wire-validators.js";
import { canonicalQuaternion, DomainValidationError } from "./primitives.js";
import { decodeMechanismAuthoredComponentOrThrow } from "./mechanism-authored-components.js";
import { isMechanismComponentType } from "./mechanism-component-definitions.js";
import { portDefinition, validatePortConnection } from "./ports.js";
import { validateRemoteActionBindings } from "./remote-actions.js";
import {
  validateVisualProgram,
  VISUAL_PROGRAM_VERSION,
} from "./visual-logic.js";
import { validateWireInput, wireResult } from "./wire-validation.js";
import { WIRE_LIMITS } from "./wire-limits.js";
import { controllerBindingManifest } from "./controller-bindings.js";
import { validateFlexibleLineConfig } from "./flexible-line-materials.js";

const encoder = new TextEncoder();

function error(code, message, path = [], details = null) {
  throw new DomainValidationError(code, message, { path, details });
}

function uniqueIds(values, path, code) {
  const seen = new Set();
  for (const [index, value] of values.entries()) {
    if (seen.has(value.id))
      error(code, `Duplicate ID ${value.id}`, [...path, index, "id"], {
        id: value.id,
      });
    seen.add(value.id);
  }
  return seen;
}

function validateController(part, path) {
  if (part.type !== "computer") return;
  for (const language of ["typescript", "wat"])
    if (
      encoder.encode(part.scriptSources[language]).byteLength >
      WIRE_LIMITS.maxScriptBytes
    )
      error(
        "SCRIPT_SIZE_LIMIT",
        `${language} source exceeds ${WIRE_LIMITS.maxScriptBytes} bytes`,
        [...path, "scriptSources", language],
      );
  if (part.scriptSources.visual?.version !== VISUAL_PROGRAM_VERSION)
    error(
      "UNSUPPORTED_VISUAL_PROGRAM_VERSION",
      `Visual program version must be ${VISUAL_PROGRAM_VERSION}`,
      [...path, "scriptSources", "visual", "version"],
    );
}

function validatePart(part, index) {
  const path = ["parts", index];
  canonicalQuaternion(part.orientation, { path: [...path, "orientation"] });
  if (isMechanismComponentType(part.type)) {
    const decoded = decodeMechanismAuthoredComponentOrThrow(part.mechanism);
    if (decoded.wire.componentType !== part.type)
      error(
        "MECHANISM_COMPONENT_TYPE_MISMATCH",
        "Part type must match mechanism.componentType",
        [...path, "mechanism", "componentType"],
      );
  }
  if (part.type === "battery") {
    if (part.storedEnergyWh > part.config.capacityWh)
      error(
        "BATTERY_CHARGE_EXCEEDS_CAPACITY",
        "storedEnergyWh cannot exceed config.capacityWh",
        [...path, "storedEnergyWh"],
      );
  }
  if (TYPES[part.type]?.flexibleLine)
    validateFlexibleLineConfig(part.config, [...path, "config"]);
  validateController(part, path);
}

function validateConnections(wire, partIds) {
  uniqueIds(wire.connections, ["connections"], "DUPLICATE_CONNECTION_ID");
  const partById = new Map(wire.parts.map((part) => [part.id, part]));
  const accepted = [];
  for (const [index, connection] of wire.connections.entries()) {
    const path = ["connections", index];
    if (connection.a === connection.b)
      error(
        "SELF_CONNECTION",
        "A connection cannot join a part to itself",
        path,
      );
    if (!partIds.has(connection.a) || !partIds.has(connection.b))
      error(
        "DANGLING_CONNECTION",
        "Connection endpoints must reference existing parts",
        path,
      );
    const left = partById.get(connection.a),
      right = partById.get(connection.b),
      physical = isPhysicalConnectionKind(connection.kind);
    if (connection.releaseCouplerPartId != null) {
      const coupler = partById.get(connection.releaseCouplerPartId);
      if (physical)
        error(
          "BREAKAWAY_PHYSICAL_CONNECTION_FORBIDDEN",
          "Only power, signal, or resource umbilicals may declare a release coupler",
          [...path, "releaseCouplerPartId"],
        );
      if (!coupler)
        error(
          "UNKNOWN_RELEASE_COUPLER",
          "Breakaway umbilical must reference an existing release coupler",
          [...path, "releaseCouplerPartId"],
        );
      if (
        coupler?.mechanism?.config?.releaseLaw?.kind !==
        "electromechanical-latch-v1"
      )
        error(
          "INVALID_RELEASE_COUPLER_REFERENCE",
          "Breakaway umbilical reference must identify an authored release coupler",
          [...path, "releaseCouplerPartId"],
        );
    }
    if (physical && !connection.capacity)
      error(
        "MISSING_CONNECTION_CAPACITY",
        "Physical connections require force and torque capacity",
        [...path, "capacity"],
      );
    if (!physical && connection.capacity)
      error(
        "NETWORK_CAPACITY_FORBIDDEN",
        "Power and signal edges cannot carry structural capacity",
        [...path, "capacity"],
      );
    const leftPort = portDefinition(left, connection.portA),
      rightPort = portDefinition(right, connection.portB);
    validatePortConnection(
      left,
      connection.portA,
      right,
      connection.portB,
      accepted,
      TYPES,
      connection,
    );
    if (leftPort.kind !== connection.kind || rightPort.kind !== connection.kind)
      error(
        "CONNECTION_KIND_MISMATCH",
        "Connection kind must match both endpoint ports",
        [...path, "kind"],
      );
    const leftNeedsAnchor = leftPort.behavior === "structural-surface";
    const rightNeedsAnchor = rightPort.behavior === "structural-surface";
    if (leftNeedsAnchor !== Boolean(connection.anchorA))
      error(
        leftNeedsAnchor
          ? "MISSING_SURFACE_ANCHOR"
          : "UNEXPECTED_SURFACE_ANCHOR",
        leftNeedsAnchor
          ? "Structural-surface endpoint requires anchorA"
          : "anchorA is only valid for a structural surface",
        [...path, "anchorA"],
      );
    if (rightNeedsAnchor !== Boolean(connection.anchorB))
      error(
        rightNeedsAnchor
          ? "MISSING_SURFACE_ANCHOR"
          : "UNEXPECTED_SURFACE_ANCHOR",
        rightNeedsAnchor
          ? "Structural-surface endpoint requires anchorB"
          : "anchorB is only valid for a structural surface",
        [...path, "anchorB"],
      );
    accepted.push(connection);
  }
}

function validateRemoteProfiles(wire) {
  if (
    wire.defaultRemoteProfile !== null &&
    !Object.hasOwn(wire.remoteProfiles, wire.defaultRemoteProfile)
  )
    error(
      "UNKNOWN_DEFAULT_REMOTE_PROFILE",
      "defaultRemoteProfile must name an existing profile",
      ["defaultRemoteProfile"],
    );
  for (const [profileId, profile] of Object.entries(wire.remoteProfiles)) {
    const controlIds = new Set();
    for (const [index, control] of profile.controls.entries()) {
      const path = ["remoteProfiles", profileId, "controls", index];
      if (controlIds.has(control.id))
        error("DUPLICATE_CONTROL_ID", `Duplicate control ID ${control.id}`, [
          ...path,
          "id",
        ]);
      controlIds.add(control.id);
      if (control.type === "range") {
        if (![control.min, control.max, control.step].every(Number.isFinite))
          error(
            "INVALID_RANGE_CONTROL",
            "Range controls require min, max, and step",
            path,
          );
        if (
          control.min > control.defaultValue ||
          control.defaultValue > control.max
        )
          error(
            "CONTROL_DEFAULT_OUT_OF_RANGE",
            "Range defaultValue must be within min and max",
            [...path, "defaultValue"],
          );
      } else {
        if (control.min != null || control.max != null || control.step != null)
          error(
            "UNEXPECTED_RANGE_FIELDS",
            "Only range controls may define min, max, or step",
            path,
          );
        if (control.type === "toggle" && ![0, 1].includes(control.defaultValue))
          error(
            "INVALID_TOGGLE_DEFAULT",
            "Toggle defaultValue must be 0 or 1",
            [...path, "defaultValue"],
          );
        if (
          ["hold", "pulse"].includes(control.type) &&
          control.defaultValue !== 0
        )
          error(
            "INVALID_MOMENTARY_DEFAULT",
            "Hold and pulse controls require defaultValue 0",
            [...path, "defaultValue"],
          );
      }
    }
    validateRemoteActionBindings(profile, ["remoteProfiles", profileId]);
  }
}

function decode(input) {
  const envelope = validateWireInput(input, "blueprint", validateBlueprintWire),
    wire = envelope.value;
  if (wire.name !== wire.name.trim())
    error("INVALID_BLUEPRINT_NAME", "Blueprint name must be trimmed", ["name"]);
  if (
    wire.created != null &&
    (!Number.isFinite(Date.parse(wire.created)) ||
      new Date(wire.created).toISOString() !== wire.created)
  )
    error(
      "INVALID_BLUEPRINT_TIMESTAMP",
      "created must be a canonical ISO timestamp",
      ["created"],
    );
  const partIds = uniqueIds(wire.parts, ["parts"], "DUPLICATE_PART_ID");
  wire.parts.forEach(validatePart);
  validateConnections(wire, partIds);
  for (const [index, controller] of wire.parts.entries()) {
    if (controller.type !== "computer") continue;
    const manifest = controllerBindingManifest(
      controller,
      wire.parts,
      wire.connections,
      TYPES,
    );
    try {
      validateVisualProgram(controller.scriptSources.visual, manifest);
    } catch (cause) {
      error(
        "INVALID_VISUAL_PROGRAM",
        cause instanceof Error ? cause.message : String(cause),
        ["parts", index, "scriptSources", "visual"],
      );
    }
  }
  validateRemoteProfiles(wire);

  const model = new AssemblyModel({ parts: wire.parts, connections: [] });
  for (const connection of wire.connections) model.addConnection(connection);
  const assembly = model.snapshot(),
    compilation = compileAssemblyFromIssuedRoots(assembly, TYPES);
  if (compilation.stats.errorCount)
    error(
      "ASSEMBLY_COMPILE_FAILED",
      "Blueprint topology could not be compiled",
      ["connections"],
      {
        diagnostics: compilation.diagnostics.filter(
          (item) => item.severity === "error",
        ),
      },
    );
  return Object.freeze({
    wire: structuredClone(wire),
    assembly,
    extensions: structuredClone(wire.extensions || {}),
    diagnostics: compilation.diagnostics,
    envelope: Object.freeze({ bytes: envelope.bytes, nodes: envelope.nodes }),
  });
}

/** Total strict decoder used at every blueprint acquisition boundary. */
export function decodeBlueprint(input) {
  return wireResult(() => decode(input));
}

export function decodeBlueprintOrThrow(input) {
  const result = decodeBlueprint(input);
  if (result.ok) return result.value;
  const first = result.errors[0];
  throw new DomainValidationError(first.code, first.message, {
    path: first.path,
    details: first.details,
  });
}
