import {
  assertControllerSourceSize,
  CONTROLLER_LIMITS,
  CONTROLLER_POLICY_VERSION,
} from "../model/controller-policy.js";
import {
  controllerBindingManifestIdentity,
  validateControllerBindingManifest,
} from "../model/controller-bindings.js";
import {
  COMMAND_SINK_SCALAR_LIMIT,
  POINT_CONTACT_WRENCH_HOST_ABI_VERSION,
  pointContactWrenchControllerOutputCount,
  validatePointContactWrenchControllerResult,
  validatePointContactWrenchControllerSpec,
} from "../model/point-contact-wrench-controller-contract.js";
import { finiteOr } from "../model/finite-or.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../model/plain-data-contract.js";

let wabtRuntimePromise;
const loadWabtRuntime = () => {
  wabtRuntimePromise ||= import("wabt").then((module) => module.default());
  return wabtRuntimePromise;
};

async function sha256Identity(value) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return `sim-sha256-${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

const RESERVED_PREFIX = "__sim_";
const DECLARATION_FORMS = new Set(["export", "param", "result", "local"]);
const FORBIDDEN_FORMS = new Set([
  "memory",
  "table",
  "start",
  "elem",
  "data",
  "tag",
  "type",
  "loop",
  "call_indirect",
  "return_call",
  "return_call_indirect",
  "call_ref",
  "return_call_ref",
]);

const atom = (value, line = null, column = null) => ({
  kind: "atom",
  value: String(value),
  line,
  column,
});
const stringToken = (value) => ({
  kind: "string",
  value,
  raw: JSON.stringify(value),
  line: null,
  column: null,
});
const isAtom = (value, expected = null) =>
  value?.kind === "atom" && (expected === null || value.value === expected);
const head = (list) =>
  Array.isArray(list) && isAtom(list[0]) ? list[0].value : null;

function sourcePosition(source, index) {
  const prefix = source.slice(0, index),
    line = prefix.split("\n").length;
  return { line, column: index - prefix.lastIndexOf("\n") };
}

function policyError(value, message) {
  const token = Array.isArray(value) ? value[0] : value,
    suffix = token?.line ? ` (${token.line}:${token.column})` : " (1:1)";
  return new Error(`${message}${suffix}`);
}

function tokenizeWat(source) {
  const tokens = [];
  let index = 0;
  const error = (message) => {
    const { line, column } = sourcePosition(source, index);
    throw new Error(`${message} (${line}:${column})`);
  };
  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) {
      index++;
      continue;
    }
    if (source.startsWith(";;", index)) {
      const next = source.indexOf("\n", index + 2);
      index = next < 0 ? source.length : next + 1;
      continue;
    }
    if (source.startsWith("(;", index)) {
      let depth = 1;
      index += 2;
      while (index < source.length && depth) {
        if (source.startsWith("(;", index)) {
          depth++;
          index += 2;
        } else if (source.startsWith(";)", index)) {
          depth--;
          index += 2;
        } else index++;
      }
      if (depth) error("unterminated block comment");
      continue;
    }
    if (character === "(" || character === ")") {
      tokens.push(character);
      index++;
      continue;
    }
    if (character === '"') {
      const start = index++;
      let escaped = false;
      while (index < source.length) {
        const next = source[index++];
        if (!escaped && next === '"') break;
        if (!escaped && next === "\\") escaped = true;
        else escaped = false;
      }
      if (source[index - 1] !== '"') error("unterminated string");
      const raw = source.slice(start, index);
      if (/\\/.test(raw))
        error("escaped WAT strings are not allowed in control modules");
      tokens.push({
        kind: "string",
        value: raw.slice(1, -1),
        raw,
        ...sourcePosition(source, start),
      });
      continue;
    }
    const start = index;
    while (
      index < source.length &&
      !/\s|\(|\)/.test(source[index]) &&
      !source.startsWith(";;", index) &&
      !source.startsWith("(;", index)
    )
      index++;
    if (start === index) error("invalid WAT token");
    const position = sourcePosition(source, start);
    tokens.push(
      atom(source.slice(start, index), position.line, position.column),
    );
    if (tokens.length > CONTROLLER_LIMITS.irNodes * 8)
      error("WAT token budget exceeded");
  }
  return tokens;
}

function parseWat(source) {
  const tokens = tokenizeWat(source);
  let index = 0;
  const parseList = (depth = 0) => {
    if (depth > CONTROLLER_LIMITS.irDepth)
      throw policyError(tokens[index], "WAT nesting depth exceeded");
    if (tokens[index++] !== "(")
      throw policyError(tokens[index - 1], "expected WAT list");
    const list = [];
    while (index < tokens.length && tokens[index] !== ")") {
      if (tokens[index] === "(") list.push(parseList(depth + 1));
      else if (tokens[index] === ")")
        throw policyError(list, "unexpected WAT close token");
      else list.push(tokens[index++]);
    }
    if (tokens[index++] !== ")")
      throw policyError(list, "unterminated WAT list");
    return list;
  };
  if (tokens[0] !== "(")
    throw policyError(tokens[0], "WAT source must contain one module");
  const module = parseList();
  if (index !== tokens.length)
    throw policyError(tokens[index], "WAT source has trailing tokens");
  if (head(module) !== "module")
    throw policyError(module, "WAT source must begin with module");
  return module;
}

function serializeWat(value) {
  if (Array.isArray(value)) return `(${value.map(serializeWat).join(" ")})`;
  return value.kind === "string" ? value.raw : value.value;
}

function walk(value, visitor, parent = null) {
  visitor(value, parent);
  if (Array.isArray(value))
    for (const child of value) walk(child, visitor, value);
}

function declarationTypes(form) {
  return form
    .slice(1)
    .filter((value) => isAtom(value) && !value.value.startsWith("$"))
    .map((value) => value.value);
}

function functionSignature(form) {
  return {
    parameters: form
      .filter((value) => head(value) === "param")
      .flatMap(declarationTypes),
    results: form
      .filter((value) => head(value) === "result")
      .flatMap(declarationTypes),
  };
}

function identifierOfFunction(form) {
  return isAtom(form[1]) && form[1].value.startsWith("$")
    ? form[1].value
    : null;
}

function assignFunctionIdentifier(form, name) {
  if (!identifierOfFunction(form)) form.splice(1, 0, atom(name));
  return identifierOfFunction(form);
}

function assignGlobalIdentifier(form, name) {
  if (!(isAtom(form[1]) && form[1].value.startsWith("$")))
    form.splice(1, 0, atom(name));
  return form[1].value;
}

function collectCalls(value, calls = []) {
  if (!Array.isArray(value)) return calls;
  for (let index = 0; index < value.length; index++) {
    if (isAtom(value[index], "call")) {
      const target = value[index + 1];
      if (!isAtom(target) || !target.value.startsWith("$"))
        throw policyError(
          value[index],
          "control WAT calls must use named functions",
        );
      calls.push(target.value);
    }
    if (Array.isArray(value[index])) collectCalls(value[index], calls);
  }
  return calls;
}

function functionCost(form) {
  let cost = 0;
  const start = form.findIndex(
    (value, index) =>
      index > 0 &&
      !(isAtom(value) && value.value.startsWith("$")) &&
      !(Array.isArray(value) && DECLARATION_FORMS.has(head(value))),
  );
  for (const value of form.slice(Math.max(1, start)))
    walk(value, (entry) => {
      if (
        isAtom(entry) &&
        !entry.value.startsWith("$") &&
        !/^[+-]?(?:\d|\.)(?:[\w.+-]*)$/.test(entry.value)
      )
        cost++;
    });
  return Math.max(1, cost);
}

function instrumentFunction(form, cost) {
  let insertion = identifierOfFunction(form) ? 2 : 1;
  while (
    insertion < form.length &&
    Array.isArray(form[insertion]) &&
    DECLARATION_FORMS.has(head(form[insertion]))
  )
    insertion++;
  form.splice(insertion, 0, [
    atom("call"),
    atom("$__sim_consume_fuel"),
    [atom("i32.const"), atom(cost)],
  ]);
}

function validateAndInstrument(
  module,
  { allowPointContactWrench = false } = {},
) {
  let childStart = 1;
  if (isAtom(module[1]) && module[1].value.startsWith("$")) childStart = 2;
  const children = module.slice(childStart),
    imports = [],
    functions = [],
    globals = [];
  walk(module, (value) => {
    if (
      Array.isArray(value) &&
      head(value) === "import" &&
      !children.includes(value)
    )
      throw policyError(value, "inline and nested imports are disabled");
    if (isAtom(value) && value.value.includes(RESERVED_PREFIX))
      throw policyError(
        value,
        `names beginning with ${RESERVED_PREFIX} are reserved`,
      );
    if (!isAtom(value)) return;
    const opcode = value.value;
    if (
      FORBIDDEN_FORMS.has(opcode) ||
      /^(?:memory|table)\./.test(opcode) ||
      /\.(?:load|store)(?:\d+)?$/.test(opcode) ||
      /^(?:ref\.|v128\.|i8x16\.|i16x8\.|i32x4\.|i64x2\.|f32x4\.|f64x2\.)/.test(
        opcode,
      )
    )
      throw policyError(value, `${opcode} is disabled in the control tier`);
  });
  for (const child of children) {
    const kind = head(child);
    if (kind === "import") imports.push(child);
    else if (kind === "func") functions.push(child);
    else if (kind === "global") globals.push(child);
    else if (["export"].includes(kind)) continue;
    else if (kind)
      throw policyError(
        child,
        `${kind} module declarations are disabled in the control tier`,
      );
    else throw policyError(child, "malformed WAT module declaration");
  }
  if (functions.length > CONTROLLER_LIMITS.functions)
    throw policyError(module, "WAT module has too many functions");
  if (globals.length > CONTROLLER_LIMITS.globals)
    throw policyError(module, "WAT module has too many globals");
  const mutableGlobalExports = [];
  for (const [index, global] of globals.entries()) {
    const identifier = assignGlobalIdentifier(
        global,
        `$__sim_state_global_${index}`,
      ),
      typeIndex = 2,
      type = global[typeIndex],
      mutable = Array.isArray(type) && head(type) === "mut",
      valueType = mutable ? type[1]?.value : type?.value;
    if (
      !isAtom(mutable ? type[1] : type) ||
      !["f32", "f64"].includes(valueType)
    )
      throw policyError(
        global,
        "controller globals must use f32 or f64 numeric state",
      );
    if (mutable)
      mutableGlobalExports.push({
        name: `__sim_state_${mutableGlobalExports.length}`,
        identifier,
      });
  }

  const importNames = new Map();
  for (const [index, entry] of imports.entries()) {
    const moduleName = entry[1]?.value,
      fieldName = entry[2]?.value,
      descriptor = entry[3];
    if (
      entry[1]?.kind !== "string" ||
      entry[2]?.kind !== "string" ||
      moduleName !== "env" ||
      ![
        "read_binding",
        "read_binding_valid",
        "write_binding",
        ...(allowPointContactWrench ? ["point_contact_wrench_output"] : []),
      ].includes(fieldName) ||
      head(descriptor) !== "func"
    )
      throw policyError(
        entry,
        "only env.read_binding, env.read_binding_valid, env.write_binding, and declared point-contact wrench controller imports are allowed",
      );
    if (importNames.has(fieldName))
      throw policyError(entry, `duplicate ${fieldName} import`);
    const identifier = assignFunctionIdentifier(
        descriptor,
        `$__sim_user_import_${index}`,
      ),
      signature = functionSignature(descriptor);
    if (
      ["read_binding", "read_binding_valid"].includes(fieldName) &&
      (signature.parameters.join(",") !== "i32" ||
        !["f32", "f64"].includes(signature.results.join(",")))
    )
      throw policyError(
        descriptor,
        `${fieldName} must have signature (i32) -> f32 or f64`,
      );
    if (
      fieldName === "write_binding" &&
      (signature.parameters.length !== 2 ||
        signature.parameters[0] !== "i32" ||
        !["f32", "f64"].includes(signature.parameters[1]) ||
        signature.results.length)
    )
      throw policyError(
        descriptor,
        "write_binding must have signature (i32, f32/f64) -> void",
      );
    if (
      fieldName === "point_contact_wrench_output" &&
      (signature.parameters.join(",") !== "i32,i32" ||
        !["f32", "f64"].includes(signature.results.join(",")))
    )
      throw policyError(
        descriptor,
        "point_contact_wrench_output must have signature (i32, i32) -> f32 or f64",
      );
    importNames.set(fieldName, identifier);
  }

  const functionNames = new Map();
  for (const [index, fn] of functions.entries()) {
    const identifier = assignFunctionIdentifier(fn, `$__sim_function_${index}`);
    if (functionNames.has(identifier))
      throw policyError(fn, `duplicate WAT function ${identifier}`);
    functionNames.set(identifier, fn);
  }
  const exportNames = [];
  for (const child of children) {
    if (head(child) === "export") {
      if (child[1]?.kind !== "string" || head(child[2]) !== "func")
        throw policyError(child, "only the tick function may be exported");
      exportNames.push({ name: child[1].value, target: child[2][1]?.value });
    }
  }
  for (const fn of functions)
    for (const item of fn)
      if (head(item) === "export") {
        if (item[1]?.kind !== "string")
          throw policyError(item, "malformed function export");
        exportNames.push({
          name: item[1].value,
          target: identifierOfFunction(fn),
        });
      }
  if (exportNames.length !== 1 || exportNames[0].name !== "tick")
    throw policyError(module, "module must export exactly tick(f32/f64)");
  const tick = functionNames.get(exportNames[0].target);
  if (!tick)
    throw policyError(module, "tick export must reference a defined function");
  const tickSignature = functionSignature(tick);
  if (
    tickSignature.parameters.length !== 1 ||
    !["f32", "f64"].includes(tickSignature.parameters[0]) ||
    tickSignature.results.length
  )
    throw policyError(tick, "tick must have signature (f32/f64) -> void");

  const knownFunctions = new Set([
      ...functionNames.keys(),
      ...importNames.values(),
    ]),
    graph = new Map();
  for (const [name, fn] of functionNames) {
    const calls = collectCalls(fn).filter(
      (target) => target !== "$__sim_consume_fuel",
    );
    for (const target of calls)
      if (!knownFunctions.has(target))
        throw policyError(fn, `call targets unknown function ${target}`);
    graph.set(
      name,
      calls.filter((target) => functionNames.has(target)),
    );
  }
  const active = new Set(),
    complete = new Set();
  const visit = (name) => {
    if (active.has(name))
      throw policyError(
        functionNames.get(name),
        `recursive WAT call cycle includes ${name}`,
      );
    if (complete.has(name)) return;
    active.add(name);
    for (const target of graph.get(name) || []) visit(target);
    active.delete(name);
    complete.add(name);
  };
  for (const name of functionNames.keys()) visit(name);

  for (const fn of functions) {
    const cost = functionCost(fn);
    if (cost > CONTROLLER_LIMITS.fuelPerTick)
      throw policyError(fn, "WAT function exceeds the per-tick fuel budget");
    instrumentFunction(fn, cost);
  }
  const lastImportIndex = module.reduce(
    (last, child, index) => (head(child) === "import" ? index : last),
    childStart - 1,
  );
  module.splice(lastImportIndex + 1, 0, [
    atom("import"),
    stringToken("env"),
    stringToken("consume_fuel"),
    [atom("func"), atom("$__sim_consume_fuel"), [atom("param"), atom("i32")]],
  ]);
  for (const state of mutableGlobalExports)
    module.push([
      atom("export"),
      stringToken(state.name),
      [atom("global"), atom(state.identifier)],
    ]);
  return module;
}

function controllerSensorValid(sensors, bindingId) {
  const validity = sensors?.__validity?.[bindingId],
    value = sensors?.[bindingId];
  return (
    (validity === true || validity === 1) &&
    typeof value === "number" &&
    Number.isFinite(value)
  );
}

function controllerSensorValue(sensors, bindingId) {
  return controllerSensorValid(sensors, bindingId)
    ? Number(sensors[bindingId])
    : 0;
}

function pointContactAllocatorInput(spec, sensors) {
  const tick = sensors?.__snapshotTick,
    tickValid = Number.isSafeInteger(tick) && tick >= 0,
    targetBindings = [
      ...spec.targetWrenchBindings.forceN,
      ...spec.targetWrenchBindings.momentNm,
    ],
    targetValid =
      tickValid &&
      targetBindings.every((bindingId) =>
        controllerSensorValid(sensors, bindingId),
      );
  return {
    tick: tickValid ? tick : 0,
    targetFrame: spec.targetFrame,
    targetWrenchFrame: {
      valid: targetValid,
      forceN: spec.targetWrenchBindings.forceN.map((bindingId) =>
        controllerSensorValue(sensors, bindingId),
      ),
      momentNm: spec.targetWrenchBindings.momentNm.map((bindingId) =>
        controllerSensorValue(sensors, bindingId),
      ),
    },
    contacts: spec.contacts.map((contact) => {
      const pointValid = contact.pointWorldBindings.every((bindingId) =>
          controllerSensorValid(sensors, bindingId),
        ),
        normalValues = contact.normalWorldBindings.map((bindingId) =>
          controllerSensorValue(sensors, bindingId),
        ),
        normalMagnitude = Math.hypot(...normalValues),
        normalValid =
          contact.normalWorldBindings.every((bindingId) =>
            controllerSensorValid(sensors, bindingId),
          ) &&
          Number.isFinite(normalMagnitude) &&
          Math.abs(normalMagnitude - 1) <= 2 ** -20,
        frictionValue = controllerSensorValue(
          sensors,
          contact.frictionCoefficientBinding,
        ),
        frictionValid =
          controllerSensorValid(sensors, contact.frictionCoefficientBinding) &&
          frictionValue >= 0;
      return {
        contactId: contact.contactId,
        tick: tickValid ? tick : 0,
        geometryValid: tickValid && pointValid && normalValid,
        frictionValid: tickValid && frictionValid,
        limitValid: true,
        pointWorldM: pointValid
          ? contact.pointWorldBindings.map((bindingId) =>
              controllerSensorValue(sensors, bindingId),
            )
          : [0, 0, 0],
        normalWorld: normalValid ? normalValues : [0, 1, 0],
        frictionCoefficient: frictionValid ? frictionValue : 0,
        normalForceLimitN: contact.normalForceLimitN,
        tangentialForceLimitN: contact.tangentialForceLimitN,
      };
    }),
    acceptance: spec.acceptance,
    solver: spec.solver,
  };
}

function numericalAllocationFailure() {
  return {
    authorityValid: false,
    solverConverged: false,
    accepted: false,
    reason: "numeric-range-error-v1",
    residualWrenchFrame: { forceNormN: 0, momentNormNm: 0 },
    saturated: false,
  };
}

function pointContactOutput(result, outputIndex) {
  if (outputIndex === 0) return result.authorityValid ? 1 : 0;
  if (outputIndex === 1) return result.solverConverged ? 1 : 0;
  if (outputIndex === 2) return result.accepted ? 1 : 0;
  if (outputIndex === 3)
    return (
      {
        "accepted-v1": 0,
        "invalid-authority-v1": 1,
        "solver-budget-exhausted-v1": 2,
        "residual-tolerance-exceeded-v1": 3,
      }[result.reason] ?? 4
    );
  if (outputIndex === 4)
    return Math.min(
      result.residualWrenchFrame.forceNormN,
      COMMAND_SINK_SCALAR_LIMIT,
    );
  if (outputIndex === 5)
    return Math.min(
      result.residualWrenchFrame.momentNormNm,
      COMMAND_SINK_SCALAR_LIMIT,
    );
  if (outputIndex === 6) return result.saturated ? 1 : 0;
  if (outputIndex === 7)
    return result.residualWrenchFrame.forceNormN > COMMAND_SINK_SCALAR_LIMIT ||
      result.residualWrenchFrame.momentNormNm > COMMAND_SINK_SCALAR_LIMIT
      ? 1
      : 0;
  const forceIndex = outputIndex - 8,
    contactIndex = Math.floor(forceIndex / 3),
    axis = forceIndex % 3;
  return result.accepted
    ? result.allocations[contactIndex].forceWorldN[axis]
    : 0;
}

function createPreparedRuntime(
  module,
  language,
  bindingManifest,
  programIdentity,
  pointContactWrenchSpecs,
  pointContactWrenchHost,
) {
  const bindings = validateControllerBindingManifest(bindingManifest),
    bindingManifestIdentity = controllerBindingManifestIdentity(bindings),
    hostAbiIdentity = pointContactWrenchSpecs.length
      ? pointContactWrenchHost.identity
      : null;
  return Object.freeze({
    language,
    policyVersion: CONTROLLER_POLICY_VERSION,
    bindingManifest: bindings,
    bindingManifestIdentity,
    programIdentity,
    hostAbiIdentity,
    instantiate() {
      let sensors = {},
        outputs = [],
        pointContactWrenchResults = new Map(),
        fuel = 0,
        running = false,
        disposed = false;
      const imports = {
          env: {
            read_binding(index) {
              if (!running)
                throw new Error("binding read outside controller tick");
              const binding = bindings[index];
              if (!binding || binding.direction !== "input")
                throw new Error(`input binding index ${index} is out of range`);
              const value = Array.isArray(sensors)
                ? sensors[index]
                : sensors?.[binding.id];
              return finiteOr(value);
            },
            read_binding_valid(index) {
              if (!running)
                throw new Error(
                  "binding validity read outside controller tick",
                );
              const binding = bindings[index];
              if (!binding || binding.direction !== "input")
                throw new Error(`input binding index ${index} is out of range`);
              if (Array.isArray(sensors)) return 0;
              const evidenceValidity = sensors?.__validity?.[binding.id],
                measurement = sensors?.[binding.id];
              return (evidenceValidity === true || evidenceValidity === 1) &&
                typeof measurement === "number" &&
                Number.isFinite(measurement)
                ? 1
                : 0;
            },
            write_binding(index, rawValue) {
              if (!running)
                throw new Error("binding write outside controller tick");
              const binding = bindings[index],
                value = Number(rawValue);
              if (!binding || binding.direction !== "output")
                throw new Error(
                  `output binding index ${index} is out of range`,
                );
              if (!Number.isFinite(value))
                throw new Error(
                  `binding ${binding.id} received a non-finite value`,
                );
              if (outputs.length >= CONTROLLER_LIMITS.outputsPerTick)
                throw new Error("controller output budget exceeded");
              outputs.push([binding.id, value]);
            },
            point_contact_wrench_output(rawSpecIndex, rawOutputIndex) {
              if (!running)
                throw new Error(
                  "point-contact wrench allocation outside controller tick",
                );
              const specIndex = Number(rawSpecIndex),
                outputIndex = Number(rawOutputIndex),
                spec = pointContactWrenchSpecs[specIndex];
              if (
                !Number.isSafeInteger(specIndex) ||
                !spec ||
                !Number.isSafeInteger(outputIndex) ||
                outputIndex < 0 ||
                outputIndex >= pointContactWrenchControllerOutputCount(spec)
              )
                throw new Error(
                  "point-contact wrench controller index is out of range",
                );
              if (!pointContactWrenchResults.has(specIndex)) {
                fuel -= 64 + spec.contacts.length * spec.solver.maxIterations;
                if (fuel < 0) throw new Error("controller fuel exhausted");
                try {
                  const request = pointContactAllocatorInput(spec, sensors),
                    allocation = pointContactWrenchHost.allocate(
                      JSON.stringify(request),
                    );
                  pointContactWrenchResults.set(
                    specIndex,
                    validatePointContactWrenchControllerResult(
                      allocation,
                      spec,
                      request,
                    ),
                  );
                } catch (error) {
                  if (!(error instanceof RangeError)) throw error;
                  pointContactWrenchResults.set(
                    specIndex,
                    numericalAllocationFailure(),
                  );
                }
              }
              return pointContactOutput(
                pointContactWrenchResults.get(specIndex),
                outputIndex,
              );
            },
            consume_fuel(rawCost) {
              const cost = Number(rawCost);
              if (!running || !Number.isInteger(cost) || cost <= 0)
                throw new Error("invalid controller fuel charge");
              fuel -= cost;
              if (fuel < 0) throw new Error("controller fuel exhausted");
            },
          },
        },
        instance = new WebAssembly.Instance(module, imports),
        tick = instance.exports.tick,
        stateGlobals = /** @type {Array<[string, WebAssembly.Global]>} */ (
          Object.entries(instance.exports)
            .filter(
              ([name, value]) =>
                /^__sim_state_\d+$/.test(name) &&
                value instanceof WebAssembly.Global,
            )
            .sort(([left], [right]) => left.localeCompare(right, "en"))
        );
      if (typeof tick !== "function")
        throw new Error("compiled tick export is missing");
      return Object.freeze({
        tick(dt, nextSensors) {
          if (disposed) throw new Error("controller runtime is disposed");
          sensors = nextSensors || {};
          outputs = [];
          pointContactWrenchResults = new Map();
          fuel = CONTROLLER_LIMITS.fuelPerTick;
          running = true;
          try {
            tick(Number(dt));
            return new Map(outputs);
          } catch (error) {
            outputs = [];
            pointContactWrenchResults = new Map();
            throw error;
          } finally {
            running = false;
            sensors = {};
          }
        },
        exportState() {
          if (disposed) throw new Error("controller runtime is disposed");
          return issueInertPlainData(
            stateGlobals.map(([name, global]) => ({
              name,
              value: Number(global.value),
            })),
          );
        },
        importState(state) {
          if (disposed) throw new Error("controller runtime is disposed");
          const validated = this.validateState(state);
          for (let index = 0; index < stateGlobals.length; index++)
            stateGlobals[index][1].value = validated[index].value;
        },
        validateState(state) {
          if (disposed) throw new Error("controller runtime is disposed");
          const detachedState = requireInertPlainData(state, {
            code: "INVALID_WAT_CHECKPOINT_PLAIN_DATA",
            message:
              "WAT checkpoint must be serialized JSON or an exported immutable state",
          });
          if (
            !Array.isArray(detachedState) ||
            detachedState.length !== stateGlobals.length
          )
            throw new Error("controller state shape does not match program");
          for (let index = 0; index < stateGlobals.length; index++) {
            const [name] = stateGlobals[index],
              record = detachedState[index],
              value = record?.value;
            if (
              !record ||
              typeof record !== "object" ||
              Array.isArray(record) ||
              Object.keys(record).length !== 2 ||
              !Object.hasOwn(record, "name") ||
              !Object.hasOwn(record, "value") ||
              record.name !== name ||
              typeof value !== "number" ||
              !Number.isFinite(value)
            )
              throw new Error(
                "controller state does not match program globals",
              );
          }
          return detachedState;
        },
        dispose() {
          disposed = true;
          running = false;
          sensors = {};
          outputs = [];
          pointContactWrenchResults = new Map();
        },
      });
    },
  });
}

/**
 * @param {string} source
 * @param {{language?:string,enforceSourceLimit?:boolean,bindingManifest?:readonly object[],pointContactWrenchSpecs?:readonly object[],pointContactWrenchHost?:{identity:string,allocate:(input:string)=>object},programIdentitySource?:string|null}} [options]
 */
export async function compileWatController(
  source,
  {
    language = "wat",
    enforceSourceLimit = true,
    bindingManifest,
    pointContactWrenchSpecs = [],
    pointContactWrenchHost = null,
    programIdentitySource = null,
  } = {},
) {
  const bindings = validateControllerBindingManifest(bindingManifest),
    validatedPointContactWrenchSpecs = Object.freeze(
      pointContactWrenchSpecs.map((spec) =>
        validatePointContactWrenchControllerSpec(spec, bindings),
      ),
    );
  if (
    validatedPointContactWrenchSpecs.length > 0 &&
    (pointContactWrenchHost?.identity !==
      POINT_CONTACT_WRENCH_HOST_ABI_VERSION ||
      typeof pointContactWrenchHost?.allocate !== "function")
  )
    throw new Error(
      "point-contact wrench controller needs a physical allocator host",
    );
  if (enforceSourceLimit)
    assertControllerSourceSize(source, `${language.toUpperCase()} source`);
  else if (typeof source !== "string")
    throw new TypeError("generated WAT source must be text");
  const syntaxTree = validateAndInstrument(parseWat(source), {
      allowPointContactWrench: validatedPointContactWrenchSpecs.length > 0,
    }),
    instrumentedSource = serializeWat(syntaxTree),
    wabt = await loadWabtRuntime(),
    parsed = wabt.parseWat("controller.wat", instrumentedSource, {
      threads: false,
      exceptions: false,
      simd: false,
      tail_call: false,
      function_references: false,
      gc: false,
      memory64: false,
    });
  try {
    parsed.resolveNames();
    parsed.validate();
    const { buffer } = parsed.toBinary({
      log: false,
      write_debug_names: false,
    });
    if (buffer.byteLength > CONTROLLER_LIMITS.compiledBytes)
      throw new Error("compiled controller exceeds 64 KB");
    const module = new WebAssembly.Module(Uint8Array.from(buffer).buffer),
      imports = WebAssembly.Module.imports(module),
      exports = WebAssembly.Module.exports(module),
      tickExports = exports.filter((entry) => entry.name === "tick"),
      stateExports = exports.filter((entry) =>
        /^__sim_state_\d+$/.test(entry.name),
      );
    if (
      imports.some(
        (entry) =>
          entry.module !== "env" ||
          ![
            "read_binding",
            "read_binding_valid",
            "write_binding",
            "point_contact_wrench_output",
            "consume_fuel",
          ].includes(entry.name) ||
          entry.kind !== "function",
      )
    )
      throw new Error("compiled controller contains an unapproved import");
    if (
      tickExports.length !== 1 ||
      tickExports[0].kind !== "function" ||
      stateExports.some((entry) => entry.kind !== "global") ||
      exports.length !== 1 + stateExports.length
    )
      throw new Error("compiled controller exports violate the runtime ABI");
    return createPreparedRuntime(
      module,
      language,
      bindings,
      await sha256Identity(
        JSON.stringify({
          version: 1,
          policyVersion: CONTROLLER_POLICY_VERSION,
          hostAbiIdentity: validatedPointContactWrenchSpecs.length
            ? POINT_CONTACT_WRENCH_HOST_ABI_VERSION
            : null,
          program: programIdentitySource ?? instrumentedSource,
        }),
      ),
      validatedPointContactWrenchSpecs,
      pointContactWrenchHost,
    );
  } finally {
    parsed.destroy?.();
  }
}
