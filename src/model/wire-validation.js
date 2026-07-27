import { DomainValidationError, stableStringify } from "./primitives.js";
import { EXTENSION_NAMESPACE_PATTERN, WIRE_LIMITS } from "./wire-limits.js";

const encoder = new TextEncoder();
const extensionNamespace = new RegExp(EXTENSION_NAMESPACE_PATTERN);

const FORMAT_CONTRACTS = Object.freeze({
  blueprint: Object.freeze({
    format: "simulacrum-blueprint",
    version: 1,
    bytes: WIRE_LIMITS.blueprintBytes,
    versionCode: "UNSUPPORTED_BLUEPRINT_VERSION",
  }),
  workspace: Object.freeze({
    format: "simulacrum-workspace",
    version: 1,
    bytes: WIRE_LIMITS.workspaceBytes,
    versionCode: "UNSUPPORTED_WORKSPACE_VERSION",
  }),
  subassembly: Object.freeze({
    format: "simulacrum-subassembly",
    version: 1,
    bytes: WIRE_LIMITS.portableAssetBytes,
    versionCode: "UNSUPPORTED_SUBASSEMBLY_VERSION",
  }),
  "share-package": Object.freeze({
    format: "simulacrum-share-package",
    version: 1,
    bytes: WIRE_LIMITS.portableAssetBytes,
    versionCode: "UNSUPPORTED_SHARE_VERSION",
  }),
  proof: Object.freeze({
    format: null,
    versionField: "proofVersion",
    version: 1,
    bytes: WIRE_LIMITS.portableAssetBytes,
    versionCode: "UNSUPPORTED_PROOF_VERSION",
  }),
  "run-configuration": Object.freeze({
    format: "simulacrum-run-configuration",
    version: 1,
    bytes: WIRE_LIMITS.runConfigurationBytes,
    versionCode: "UNSUPPORTED_RUN_CONFIGURATION_VERSION",
  }),
  "input-trace": Object.freeze({
    format: "simulacrum-input-trace",
    version: 1,
    bytes: WIRE_LIMITS.inputTraceBytes,
    versionCode: "UNSUPPORTED_INPUT_TRACE_VERSION",
  }),
  checkpoint: Object.freeze({
    format: "simulacrum-checkpoint",
    version: 1,
    bytes: WIRE_LIMITS.checkpointBytes,
    versionCode: "UNSUPPORTED_CHECKPOINT_VERSION",
  }),
  experiment: Object.freeze({
    format: "simulacrum-experiment",
    version: 1,
    bytes: WIRE_LIMITS.experimentBytes,
    versionCode: "UNSUPPORTED_EXPERIMENT_VERSION",
  }),
  "telemetry-playback": Object.freeze({
    format: "simulacrum-telemetry-playback",
    version: 1,
    bytes: WIRE_LIMITS.telemetryPlaybackBytes,
    versionCode: "UNSUPPORTED_TELEMETRY_PLAYBACK_VERSION",
  }),
  "failure-evidence": Object.freeze({
    format: "simulacrum-failure-evidence",
    version: 1,
    bytes: WIRE_LIMITS.failureEvidenceBytes,
    nodes: WIRE_LIMITS.failureEvidenceNodes,
    versionCode: "UNSUPPORTED_FAILURE_EVIDENCE_VERSION",
  }),
  "mechanism-authored-component": Object.freeze({
    format: "simulacrum-authored-mechanism-component",
    version: 1,
    bytes: WIRE_LIMITS.mechanismAuthoredComponentBytes,
    versionCode: "UNSUPPORTED_MECHANISM_COMPONENT_VERSION",
  }),
});

function issue(code, message, path = [], details = null) {
  return new DomainValidationError(code, message, { path, details });
}

function inspectTree(value, maximumNodes = WIRE_LIMITS.maxNodes) {
  const stack = [{ value, depth: 0, path: [], exit: false }];
  const ancestors = new WeakSet();
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    if (current.exit) {
      ancestors.delete(current.value);
      continue;
    }
    nodes++;
    if (nodes > maximumNodes)
      throw issue(
        "WIRE_NODE_LIMIT",
        `Wire value exceeds ${maximumNodes} nodes`,
        current.path,
      );
    if (current.depth > WIRE_LIMITS.maxDepth)
      throw issue(
        "WIRE_DEPTH_LIMIT",
        `Wire value exceeds nesting depth ${WIRE_LIMITS.maxDepth}`,
        current.path,
      );
    if (typeof current.value === "number" && !Number.isFinite(current.value))
      throw issue(
        "INVALID_FINITE_NUMBER",
        "Wire numbers must be finite",
        current.path,
      );
    if (!current.value || typeof current.value !== "object") continue;
    if (ancestors.has(current.value))
      throw issue(
        "CYCLIC_WIRE_VALUE",
        "Wire values cannot contain cycles",
        current.path,
      );
    ancestors.add(current.value);
    stack.push({ ...current, exit: true });
    for (const [key, child] of Object.entries(current.value))
      stack.push({
        value: child,
        depth: current.depth + 1,
        path: [...current.path, key],
        exit: false,
      });
  }
  return nodes;
}

function inspectExtensions(value, path = []) {
  if (!value || typeof value !== "object") return;
  if (Object.hasOwn(value, "extensions")) {
    const extensions = value.extensions;
    for (const [namespace, extension] of Object.entries(extensions)) {
      if (!extensionNamespace.test(namespace))
        throw issue(
          "INVALID_EXTENSION_NAMESPACE",
          `Extension key ${namespace} is not a reverse-DNS namespace`,
          [...path, "extensions", namespace],
        );
      const serialized = stableStringify(extension);
      if (encoder.encode(serialized).byteLength > WIRE_LIMITS.extensionBytes)
        throw issue(
          "EXTENSION_BYTE_LIMIT",
          `Extension ${namespace} exceeds ${WIRE_LIMITS.extensionBytes} bytes`,
          [...path, "extensions", namespace],
        );
      const stack = [{ value: extension, depth: 0 }];
      let nodes = 0;
      while (stack.length) {
        const current = stack.pop();
        nodes++;
        if (nodes > WIRE_LIMITS.extensionNodes)
          throw issue(
            "EXTENSION_NODE_LIMIT",
            `Extension ${namespace} exceeds ${WIRE_LIMITS.extensionNodes} nodes`,
            [...path, "extensions", namespace],
          );
        if (current.depth > WIRE_LIMITS.extensionDepth)
          throw issue(
            "EXTENSION_DEPTH_LIMIT",
            `Extension ${namespace} exceeds nesting depth ${WIRE_LIMITS.extensionDepth}`,
            [...path, "extensions", namespace],
          );
        if (current.value && typeof current.value === "object")
          for (const child of Object.values(current.value))
            stack.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  if (Array.isArray(value))
    value.forEach((entry, index) => inspectExtensions(entry, [...path, index]));
  else
    for (const [key, child] of Object.entries(value))
      if (key !== "extensions") inspectExtensions(child, [...path, key]);
}

function ajvPath(error) {
  const path = String(error.instancePath || "")
    .split("/")
    .slice(1)
    .map((part) =>
      /^(?:0|[1-9]\d*)$/.test(part)
        ? Number(part)
        : part.replaceAll("~1", "/").replaceAll("~0", "~"),
    );
  if (error.keyword === "required") path.push(error.params.missingProperty);
  if (error.keyword === "additionalProperties")
    path.push(error.params.additionalProperty);
  if (error.keyword === "unevaluatedProperties")
    path.push(error.params.unevaluatedProperty);
  return path;
}

function mapAjvError(error, kind) {
  const path = ajvPath(error),
    message = (() => {
      switch (error.keyword) {
        case "required":
          return "is required";
        case "additionalProperties":
        case "unevaluatedProperties":
          return "is not an allowed field";
        case "type":
          return `must be ${error.params.type}`;
        case "const":
          return `must equal ${JSON.stringify(error.params.allowedValue)}`;
        case "enum":
          return "must be one of the supported values";
        case "minimum":
        case "exclusiveMinimum":
          return `must be ${error.params.comparison} ${error.params.limit}`;
        case "maximum":
        case "exclusiveMaximum":
          return `must be ${error.params.comparison} ${error.params.limit}`;
        case "minLength":
          return `must contain at least ${error.params.limit} characters`;
        case "maxLength":
          return `must contain at most ${error.params.limit} characters`;
        case "minItems":
          return `must contain at least ${error.params.limit} items`;
        case "maxItems":
          return `must contain at most ${error.params.limit} items`;
        case "pattern":
          return "has an invalid character pattern";
        case "uniqueItems":
          return "must not contain duplicate items";
        default:
          return `failed the ${error.keyword} schema rule`;
      }
    })();
  return issue(
    "WIRE_SCHEMA_VIOLATION",
    `${kind} ${path.length ? path.join(".") : "document"} ${message}`,
    path,
    { keyword: error.keyword, params: error.params },
  );
}

export function validateWireInput(input, kind, validator) {
  const contract = FORMAT_CONTRACTS[kind];
  if (!contract) throw new TypeError(`Unknown wire contract ${kind}`);
  let parsed = input;
  try {
    if (typeof input === "string") parsed = JSON.parse(input);
  } catch (error) {
    throw issue("INVALID_WIRE_JSON", `${kind} is not valid JSON`, [], {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw issue("INVALID_WIRE_DOCUMENT", `${kind} must be an object`);
  const versionField = contract.versionField || "version";
  if (parsed[versionField] !== contract.version)
    throw issue(
      contract.versionCode,
      `${kind} version ${String(parsed[versionField])} is unsupported; expected ${contract.version}`,
      [versionField],
      { actual: parsed[versionField] ?? null, expected: contract.version },
    );
  if (contract.format && parsed.format !== contract.format)
    throw issue("UNSUPPORTED_WIRE_FORMAT", `Expected ${contract.format}`, [
      "format",
    ]);
  const nodes = inspectTree(parsed, contract.nodes);
  let serialized;
  try {
    serialized = typeof input === "string" ? input : JSON.stringify(parsed);
  } catch (error) {
    throw issue(
      "INVALID_WIRE_JSON",
      `${kind} cannot be represented as JSON`,
      [],
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }
  const bytes = encoder.encode(serialized).byteLength;
  if (bytes > contract.bytes)
    throw issue(
      "WIRE_BYTE_LIMIT",
      `${kind} exceeds ${contract.bytes} bytes`,
      [],
      {
        bytes,
        limit: contract.bytes,
      },
    );
  if (!validator(parsed)) throw mapAjvError(validator.errors[0], kind);
  inspectExtensions(parsed);
  return Object.freeze({ value: structuredClone(parsed), bytes, nodes });
}

export function wireResult(operation) {
  try {
    return { ok: true, value: operation(), errors: [] };
  } catch (error) {
    const domainError =
      error instanceof DomainValidationError
        ? error
        : issue(
            "WIRE_DECODE_FAILED",
            error instanceof Error ? error.message : String(error),
          );
    return { ok: false, value: null, errors: [domainError.toJSON()] };
  }
}
