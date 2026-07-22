import { assert } from "./lib/assert.mjs";
import {
  prepareControlIRController,
  prepareTypeScriptController as compileTypeScriptController,
  prepareWasmController as compileWasmController,
} from "../src/scripting/controller-compilers.js";
import { ControllerRuntimeManager } from "../src/scripting/controller-runtime-manager.js";
import { ControllerRuntimeReadModel } from "../src/application/controller-runtime-read-model.js";
import {
  compileVisualProgram,
  DEFAULT_VISUAL_PROGRAM,
} from "../src/model/visual-logic.js";
import {
  CONTROLLER_CHANNELS,
  CONTROLLER_LIMITS,
  CONTROLLER_POLICY_VERSION,
} from "../src/model/controller-policy.js";
import { ACTUATOR_CHANNELS } from "../src/model/actuator-contracts.js";
import {
  CONTROL_IR_VERSION,
  validateControlIR,
} from "../src/model/control-program-ir.js";

async function commandsFor(prepared, sensors = {}, dt = 1 / 120) {
  return Object.fromEntries(prepared.instantiate().tick(dt, sensors));
}

const TEST_BINDINGS = Object.freeze([
  Object.freeze({
    index: 0,
    id: "brake",
    direction: "output",
    endpointPartId: 3,
    endpointPortId: "CONTROL",
    channel: "brake",
  }),
  Object.freeze({
    index: 1,
    id: "speed",
    direction: "input",
    endpointPartId: 2,
    endpointPortId: "SIGNAL",
    reading: "speed",
  }),
  Object.freeze({
    index: 2,
    id: "throttle",
    direction: "output",
    endpointPartId: 3,
    endpointPortId: "CONTROL",
    channel: "throttle",
  }),
]);
const prepareTypeScriptController = (source, bindings = TEST_BINDINGS) =>
    compileTypeScriptController(source, bindings),
  prepareWasmController = (source, bindings = TEST_BINDINGS) =>
    compileWasmController(source, bindings);

assert.deepEqual(
  [...CONTROLLER_CHANNELS].sort(),
  [
    ...new Set(
      Object.values(ACTUATOR_CHANNELS).flatMap((contract) =>
        Object.keys(contract),
      ),
    ),
  ].sort(),
  "controller ABI must expose every authored actuator channel",
);

const baseIR = () => ({
  version: CONTROL_IR_VERSION,
  bindingManifest: TEST_BINDINGS,
  globals: [],
  functions: [
    {
      name: "tick",
      parameters: ["dt"],
      locals: [],
      returnsValue: false,
      body: [],
    },
  ],
  entry: "tick",
});
const rejectIR = (mutate, pattern = undefined) => {
  const ir = baseIR();
  mutate(ir);
  assert.throws(() => validateControlIR(ir), pattern);
};
assert.throws(() => validateControlIR(null), /must be an object/);
rejectIR((ir) => (ir.version = 999), /unsupported/);
rejectIR((ir) => (ir.functions = []), /at least one/);
rejectIR(
  (ir) =>
    (ir.functions = Array.from(
      { length: CONTROLLER_LIMITS.functions + 1 },
      (_, i) => ({
        name: `function_${i}`,
        parameters: [],
        locals: [],
        body: [],
      }),
    )),
  /too many functions/,
);
const maximumFunctionIR = baseIR();
maximumFunctionIR.functions = Array.from(
  { length: CONTROLLER_LIMITS.functions },
  (_, index) => ({
    name: index === 0 ? "tick" : `function_${index}`,
    parameters: [],
    locals: [],
    body: [],
  }),
);
assert.equal(validateControlIR(maximumFunctionIR), maximumFunctionIR);
rejectIR(
  (ir) =>
    (ir.globals = Array.from(
      { length: CONTROLLER_LIMITS.globals + 1 },
      (_, i) => ({
        name: `global_${i}`,
        initial: 0,
      }),
    )),
  /too many globals/,
);
const maximumGlobalIR = baseIR();
maximumGlobalIR.globals = Array.from(
  { length: CONTROLLER_LIMITS.globals },
  (_, index) => ({ name: `global_${index}`, initial: 0 }),
);
assert.equal(validateControlIR(maximumGlobalIR), maximumGlobalIR);
rejectIR(
  (ir) => ir.globals.push({ name: "bad-name", initial: 0 }),
  /identifier/,
);
rejectIR((ir) => {
  ir.globals.push({ name: "state", initial: 0 }, { name: "state", initial: 1 });
}, /duplicate global/);
rejectIR((ir) => ir.globals.push({ name: "state", initial: NaN }), /finite/);
rejectIR(
  (ir) => ir.functions.push(structuredClone(ir.functions[0])),
  /duplicate function/,
);
rejectIR((ir) => (ir.functions[0].name = "__sim_hidden"), /identifier/);
rejectIR(
  (ir) =>
    (ir.functions[0].parameters = Array.from(
      { length: CONTROLLER_LIMITS.parametersPerFunction + 1 },
      (_, i) => `p${i}`,
    )),
  /too many parameters/,
);
const maximumParameterIR = baseIR();
maximumParameterIR.functions[0].parameters = Array.from(
  { length: CONTROLLER_LIMITS.parametersPerFunction },
  (_, index) => `p${index}`,
);
assert.equal(validateControlIR(maximumParameterIR), maximumParameterIR);
rejectIR(
  (ir) =>
    (ir.functions[0].locals = Array.from(
      { length: CONTROLLER_LIMITS.localsPerFunction + 1 },
      (_, i) => `l${i}`,
    )),
  /too many locals/,
);
const maximumLocalIR = baseIR();
maximumLocalIR.functions[0].locals = Array.from(
  { length: CONTROLLER_LIMITS.localsPerFunction },
  (_, index) => `l${index}`,
);
assert.equal(validateControlIR(maximumLocalIR), maximumLocalIR);
rejectIR((ir) => ir.functions[0].locals.push("bad-name"), /identifier/);
rejectIR((ir) => ir.functions[0].locals.push("dt"), /redeclares/);
rejectIR((ir) => (ir.functions[0].body = null), /statement list/);
rejectIR((ir) => ir.functions[0].body.push({ kind: "unknown" }), /statement/);
rejectIR(
  (ir) =>
    ir.functions[0].body.push({
      kind: "set-local",
      name: "missing",
      value: { kind: "number", value: 0 },
    }),
  /unknown local/,
);
rejectIR(
  (ir) =>
    ir.functions[0].body.push({
      kind: "set-global",
      name: "missing",
      value: { kind: "number", value: 0 },
    }),
  /unknown global/,
);
rejectIR(
  (ir) =>
    ir.functions[0].body.push({
      kind: "write",
      bindingId: "teleport",
      value: { kind: "number", value: 0 },
    }),
  /unknown output binding/,
);
for (const value of [
  null,
  { kind: "number", value: Infinity },
  { kind: "call", name: "bad-name", arguments: [] },
  { kind: "builtin", name: "sin", arguments: [] },
  { kind: "read", bindingId: "future_sensor" },
])
  rejectIR((ir) => ir.functions[0].body.push({ kind: "expression", value }));
let nestedExpression = { kind: "number", value: 0 };
for (let index = 0; index < CONTROLLER_LIMITS.irDepth + 2; index++)
  nestedExpression = {
    kind: "unary",
    operator: "plus",
    value: nestedExpression,
  };
rejectIR(
  (ir) =>
    ir.functions[0].body.push({
      kind: "expression",
      value: nestedExpression,
    }),
  /depth/,
);
let maximumDepthExpression = { kind: "number", value: 0 };
for (let index = 0; index < CONTROLLER_LIMITS.irDepth - 1; index++)
  maximumDepthExpression = {
    kind: "unary",
    operator: "plus",
    value: maximumDepthExpression,
  };
const maximumDepthIR = baseIR();
maximumDepthIR.functions[0].body.push({
  kind: "expression",
  value: maximumDepthExpression,
});
assert.equal(validateControlIR(maximumDepthIR), maximumDepthIR);
rejectIR(
  (ir) =>
    (ir.functions[0].body = Array.from(
      { length: CONTROLLER_LIMITS.irNodes + 1 },
      () => ({
        kind: "expression",
        value: { kind: "number", value: 0 },
      }),
    )),
  /node budget/,
);
const maximumNodeIR = baseIR();
maximumNodeIR.functions[0].body = Array.from(
  { length: CONTROLLER_LIMITS.irNodes / 2 },
  () => ({
    kind: "expression",
    value: { kind: "number", value: 0 },
  }),
);
assert.equal(validateControlIR(maximumNodeIR), maximumNodeIR);
rejectIR((ir) => (ir.entry = "missing"), /entry/);

const statefulSource = `
type Sensor = 'speed';
type Channel = 'throttle' | 'brake';
interface ControlAPI {
  read(sensor: Sensor): number;
  write(channel: Channel, value: number): void;
}
let elapsed = 0;
const clamp = (value: number, limit: number): number =>
  Math.max(-limit, Math.min(limit, value));
function tick(api: ControlAPI, dt: number): void {
  elapsed += dt;
  const correction = clamp(1 - api.read('speed') * 0.1, 1);
  if (elapsed < 0.02) {
    api.write('throttle', correction);
  } else {
    api.write('brake', 0.25);
  }
}`;
const typescript = await prepareTypeScriptController(statefulSource);
assert.equal(typescript.policyVersion, CONTROLLER_POLICY_VERSION);
assert.equal(typescript.language, "typescript");
const firstInstance = typescript.instantiate();
assert.equal(firstInstance.tick(0.01, { speed: 2 }).get("throttle"), 0.8);
assert.equal(firstInstance.tick(0.01, { speed: 2 }).get("brake"), 0.25);
const resetInstance = typescript.instantiate();
assert.equal(
  resetInstance.tick(0.01, { speed: 2 }).get("throttle"),
  0.8,
  "controller state did not reset deterministically on instantiation",
);
const deterministicInputs = [
    { dt: 0.004, sensors: { speed: 1 } },
    { dt: 0.006, sensors: { speed: 3 } },
    { dt: 0.012, sensors: { speed: 5 } },
  ],
  runDeterministicSequence = () => {
    const engine = typescript.instantiate();
    return deterministicInputs.map(({ dt, sensors }) =>
      Object.fromEntries(engine.tick(dt, sensors)),
    );
  };
assert.deepEqual(
  runDeterministicSequence(),
  runDeterministicSequence(),
  "identical completed sensor steps produced different command sequences",
);

const operatorCoverage = await prepareTypeScriptController(`
let state = (+1);
const fixed = -2;
const identity = function(value: number): number { return value; };
function calculate(value: number, limit: number): number {
  let working = (value as number)!;
  working += 1;
  working -= 1;
  working *= 2;
  working /= 2;
  if (+working <= limit && working >= -limit || !false) {
    working = Math.max(-limit, Math.min(limit, working));
  }
  const comparisons =
    (working < limit ? 1 : 0) +
    (working <= limit ? 1 : 0) +
    (working > fixed ? 1 : 0) +
    (working >= fixed ? 1 : 0) +
    (working == fixed ? 1 : 0) +
    (working !== fixed ? 1 : 0);
  return working === fixed ? 0 : comparisons;
}
function tick(api: any, dt: number): void {
  state = state + dt;
  const output = calculate(api.read('speed'), Math.abs(fixed));
  identity(output);
  if (output != 0) {
    api.write('throttle', output > 0 && true ? Math.min(1, output) : 0);
  } else api.write('brake', 1);
  return;
}`);
assert.deepEqual(await commandsFor(operatorCoverage, { speed: 1 }), {
  throttle: 1,
});

const visual = compileVisualProgram(
  {
    ...DEFAULT_VISUAL_PROGRAM,
    nodes: [
      { id: "speed", type: "sensor", bindingId: "speed", x: 20, y: 20 },
      {
        id: "gain",
        type: "constant",
        value: 0.5,
        x: 220,
        y: 120,
      },
      {
        id: "multiply",
        type: "math",
        op: "mul",
        x: 420,
        y: 20,
      },
      {
        id: "throttle",
        type: "output",
        bindingId: "throttle",
        x: 640,
        y: 20,
      },
    ],
    links: [
      { from: "speed", to: "multiply", input: 0 },
      { from: "gain", to: "multiply", input: 1 },
      { from: "multiply", to: "throttle", input: 0 },
    ],
  },
  TEST_BINDINGS,
);
assert.ok(visual.ir, "Visual Logic did not compile to control IR");
const visualRuntime = await prepareControlIRController(visual.ir);
assert.deepEqual(await commandsFor(visualRuntime, { speed: 2 }), {
  throttle: 1,
});
assert.deepEqual(await commandsFor(visualRuntime, { speed: 8 }), {
  throttle: 4,
});

const watSource = `(module
  (import "env" "read_binding" (func $read (param i32) (result f32)))
  (import "env" "write_binding" (func $write (param i32 f32)))
  (global $gain (mut f32) (f32.const 0.5))
  (func $scaled (param $value f32) (result f32)
    (f32.mul (local.get $value) (global.get $gain)))
  (func $tick (export "tick") (param $dt f32)
    (call $write (i32.const 2) (call $scaled (call $read (i32.const 1))))))`;
const wat = await prepareWasmController(watSource);
assert.equal(wat.language, "wat");
assert.deepEqual(await commandsFor(wat, { speed: 6 }), { throttle: 3 });
assert.deepEqual(
  Object.fromEntries(
    wat.instantiate().tick(
      1 / 120,
      Array.from({ length: 3 }, (_, index) => (index === 1 ? 8 : 0)),
    ),
  ),
  { throttle: 4 },
  "WAT numeric sensor arrays diverged from named runtime inputs",
);
const commentedWat = await prepareWasmController(`(module $controller
  ;; line comments and named module exports are accepted
  (; outer block comment (; nested block comment ;) ;)
  (export "tick" (func $tick))
  (func $tick (param f64)))`);
assert.deepEqual(await commandsFor(commentedWat), {});

const rejectedTypeScript = [
  ["parse failure", `function tick(api: any, dt: number): void {`],
  [
    "network access",
    `function tick(api: any, dt: number): void { void api; void dt; fetch('https://example.com'); }`,
  ],
  [
    "constructor escape",
    `function tick(api: any, dt: number): void { void api; void dt; ({}).constructor.constructor('return globalThis')(); }`,
  ],
  [
    "computed API access",
    `function tick(api: any, dt: number): void { void dt; api['write']('throttle', 1); }`,
  ],
  [
    "unbounded loop",
    `function tick(api: any, dt: number): void { void api; void dt; while (true) {} }`,
  ],
  [
    "async execution",
    `async function tick(api: any, dt: number): Promise<void> { void api; void dt; }`,
  ],
  [
    "generic function",
    `function helper<T>(value: number): number { return value; }
     function tick(api: any, dt: number): void { api.write('throttle', helper(dt)); }`,
  ],
  [
    "optional parameter",
    `function tick(api: any, dt?: number): void { void api; void dt; }`,
  ],
  [
    "exported declaration",
    `export const state = 0; function tick(api: any, dt: number): void { void api; void dt; }`,
  ],
  ["declaration without body", `function tick(api: any, dt: number): void;`],
  [
    "duplicate helper",
    `function helper(value: number): number { return value; }
     function helper(value: number): number { return value; }
     function tick(api: any, dt: number): void { void api; void dt; }`,
  ],
  [
    "missing global initializer",
    `let state: number; function tick(api: any, dt: number): void { void api; void dt; }`,
  ],
  [
    "duplicate global",
    `let state = 0, state = 1; function tick(api: any, dt: number): void { void api; void dt; }`,
  ],
  [
    "state function collision",
    `let helper = 0; function helper(value: number): number { return value; }
     function tick(api: any, dt: number): void { void api; void dt; }`,
  ],
  [
    "nonnumeric global",
    `let state = 'unsafe'; function tick(api: any, dt: number): void { void api; void dt; }`,
  ],
  [
    "top-level class",
    `class Hidden {} function tick(api: any, dt: number): void { void api; void dt; }`,
  ],
  ["missing tick", `function helper(value: number): number { return value; }`],
  ["wrong tick arity", `function tick(api: any): void { void api; }`],
  [
    "local redeclaration",
    `function tick(api: any, dt: number): void { const dt = 1; void api; }`,
  ],
  [
    "unknown identifier",
    `function tick(api: any, dt: number): void { void dt; api.write('throttle', missing); }`,
  ],
  [
    "unsupported unary operator",
    `function tick(api: any, dt: number): void { api.write('throttle', ~dt); }`,
  ],
  [
    "nested assignment",
    `function tick(api: any, dt: number): void { let output = 0; api.write('throttle', output = dt); }`,
  ],
  [
    "invalid sensor name",
    `function tick(api: any, dt: number): void { void dt; api.write('throttle', api.read('future_sensor')); }`,
  ],
  [
    "forbidden Math function",
    `function tick(api: any, dt: number): void { api.write('throttle', Math.sin(dt)); }`,
  ],
  [
    "wrong Math arity",
    `function tick(api: any, dt: number): void { api.write('throttle', Math.abs(dt, 1)); }`,
  ],
  [
    "property assignment",
    `function tick(api: any, dt: number): void { api.value = dt; }`,
  ],
  [
    "unknown assignment",
    `function tick(api: any, dt: number): void { missing = dt; void api; }`,
  ],
  [
    "constant global mutation",
    `const state = 0; function tick(api: any, dt: number): void { state = dt; void api; }`,
  ],
  [
    "local without initializer",
    `function tick(api: any, dt: number): void { let output: number; void api; void dt; }`,
  ],
  [
    "malformed output call",
    `function tick(api: any, dt: number): void { void dt; api.write('throttle'); }`,
  ],
  [
    "tick return value",
    `function tick(api: any, dt: number): void { void api; return dt; }`,
  ],
  [
    "helper without return",
    `function helper(value: number): number { void value; }
     function tick(api: any, dt: number): void { void api; void dt; }`,
  ],
  [
    "void helper call",
    `function tick(api: any, dt: number): void { void api; tick(dt, dt); }`,
  ],
  [
    "dynamic sensor",
    `function tick(api: any, dt: number): void { void dt; const key = 1; api.read(key); }`,
  ],
  [
    "unknown output",
    `function tick(api: any, dt: number): void { void dt; api.write('teleport', 1); }`,
  ],
  [
    "recursion",
    `function recurse(value: number): number { return recurse(value); }
     function tick(api: any, dt: number): void { api.write('throttle', recurse(dt)); }`,
  ],
  [
    "constant mutation",
    `function tick(api: any, dt: number): void { const output = 0; output = dt; api.write('throttle', output); }`,
  ],
];
const typeScriptPolicyErrors = {
  "parse failure": /expected/i,
  "network access": /only declared helpers/,
  "constructor escape": /only declared helpers/,
  "computed API access": /only declared helpers/,
  "unbounded loop": /loops, exceptions/,
  "async execution": /cannot be async/,
  "generic function": /cannot be async/,
  "optional parameter": /parameters must be required/,
  "exported declaration": /cannot be exported/,
  "declaration without body": /needs a body/,
  "duplicate helper": /duplicate function/,
  "missing global initializer": /needs an initializer/,
  "duplicate global": /duplicate global/,
  "state function collision": /both numeric state and a function/,
  "nonnumeric global": /numeric constant initializer/,
  "top-level class": /only type declarations/,
  "missing tick": /must declare function tick/,
  "wrong tick arity": /exactly \(api, dt\)/,
  "local redeclaration": /redeclares/,
  "unknown identifier": /unknown numeric value/,
  "unsupported unary operator": /unsupported unary/,
  "nested assignment": /assignments are only allowed/,
  "invalid sensor name": /unknown input binding/,
  "forbidden Math function": /Math\.sin is not allowed/,
  "wrong Math arity": /Math\.abs needs 1/,
  "property assignment": /assignment target/,
  "unknown assignment": /unknown state/,
  "constant global mutation": /cannot assign to constant/,
  "local without initializer": /needs an initializer/,
  "malformed output call": /api\.write needs/,
  "tick return value": /tick cannot return/,
  "helper without return": /must end with a numeric return/,
  "void helper call": /does not return a numeric value/,
  "dynamic sensor": /literal input binding ID/,
  "unknown output": /unknown output binding/,
  recursion: /recursive call cycle/,
  "constant mutation": /cannot assign to constant/,
};
for (const [label, source] of rejectedTypeScript)
  await assert.rejects(
    prepareTypeScriptController(source),
    typeScriptPolicyErrors[label],
    `${label} TypeScript was accepted`,
  );
await assert.rejects(
  prepareTypeScriptController(`// ${"é".repeat(17_000)}`),
  /exceeds 32 KB/,
  "UTF-8 source budget used character count instead of bytes",
);
await assert.rejects(prepareTypeScriptController(null), /must be text/);

const rejectedWat = [
  ["memory", `(module (memory 1) (func (export "tick") (param f32)))`],
  ["table", `(module (table 1 funcref) (func (export "tick") (param f32)))`],
  ["loop", `(module (func (export "tick") (param f32) (loop (br 0))))`],
  [
    "recursive calls",
    `(module (func $again (call $again)) (func (export "tick") (param f32) (call $again)))`,
  ],
  [
    "unapproved import",
    `(module (import "wasi_snapshot_preview1" "fd_write" (func $write)) (func (export "tick") (param f32)))`,
  ],
  [
    "dynamic call",
    `(module (type $t (func)) (table 1 funcref) (func (export "tick") (param f32) (call_indirect (type $t))))`,
  ],
  [
    "extra export",
    `(module (func $other (export "other")) (func (export "tick") (param f32)))`,
  ],
  [
    "bad tick signature",
    `(module (func (export "tick") (result f32) (f32.const 0)))`,
  ],
  ["malformed syntax", `(module (func (export "tick") (param f32))`],
  ["unterminated comment", `(module (; never closed`],
  [
    "escaped import string",
    `(module (import "e\\6ev" "read_sensor" (func $read (param i32) (result f32))) (func (export "tick") (param f32)))`,
  ],
  ["unterminated string", `(module (export "tick) (func $tick))`],
  ["trailing module", `(module (func (export "tick") (param f32))) (module)`],
  ["not a module", `(func (export "tick") (param f32))`],
  ["malformed module child", `(module unexpected)`],
  [
    "inline import",
    `(module (func $read (import "env" "read_binding") (param i32) (result f32)) (func (export "tick") (param f32)))`,
  ],
  [
    "reserved name",
    `(module (func $__sim_hidden) (func (export "tick") (param f32)))`,
  ],
  [
    "memory opcode",
    `(module (func (export "tick") (param f32) (drop (memory.size))))`,
  ],
  [
    "load opcode",
    `(module (func (export "tick") (param f32) (drop (i32.load (i32.const 0)))))`,
  ],
  [
    "reference opcode",
    `(module (func (export "tick") (param f32) (drop (ref.null func))))`,
  ],
  [
    "duplicate import",
    `(module
      (import "env" "read_binding" (func $a (param i32) (result f32)))
      (import "env" "read_binding" (func $b (param i32) (result f32)))
      (func (export "tick") (param f32)))`,
  ],
  [
    "bad read signature",
    `(module (import "env" "read_binding" (func $read (param f32) (result f32))) (func (export "tick") (param f32)))`,
  ],
  [
    "bad write signature",
    `(module (import "env" "write_binding" (func $write (param i32))) (func (export "tick") (param f32)))`,
  ],
  [
    "duplicate function name",
    `(module (func $same) (func $same) (func (export "tick") (param f32)))`,
  ],
  [
    "malformed module export",
    `(module (global $state f32 (f32.const 0)) (export "tick" (global $state)) (func $tick (param f32)))`,
  ],
  ["malformed inline export", `(module (func $tick (export 4) (param f32)))`],
  [
    "unknown call target",
    `(module (func (export "tick") (param f32) (call $missing)))`,
  ],
  [
    "numeric call target",
    `(module (func (export "tick") (param f32) (call 0)))`,
  ],
  [
    "WABT validation failure",
    `(module (global $state f32) (func (export "tick") (param f32)))`,
  ],
];
const watPolicyErrors = {
  memory: /memory is disabled/,
  table: /table is disabled/,
  loop: /loop is disabled/,
  "recursive calls": /recursive WAT call cycle/,
  "unapproved import": /only env\.read_binding/,
  "dynamic call": /type is disabled/,
  "extra export": /export exactly tick/,
  "bad tick signature": /tick must have signature/,
  "malformed syntax": /unterminated WAT list/,
  "unterminated comment": /unterminated block comment/,
  "escaped import string": /escaped WAT strings/,
  "unterminated string": /unterminated string/,
  "trailing module": /trailing tokens/,
  "not a module": /must begin with module/,
  "malformed module child": /malformed WAT module declaration/,
  "inline import": /inline and nested imports/,
  "reserved name": /names beginning with __sim_/,
  "memory opcode": /memory\.size is disabled/,
  "load opcode": /i32\.load is disabled/,
  "reference opcode": /ref\.null is disabled/,
  "duplicate import": /duplicate read_binding import/,
  "bad read signature": /read_binding must have signature/,
  "bad write signature": /write_binding must have signature/,
  "duplicate function name": /duplicate WAT function/,
  "malformed module export": /only the tick function may be exported/,
  "malformed inline export": /malformed function export/,
  "unknown call target": /unknown function/,
  "numeric call target": /must use named functions/,
};
for (const [label, source] of rejectedWat)
  await assert.rejects(
    prepareWasmController(source),
    watPolicyErrors[label],
    `${label} WAT was accepted`,
  );
await assert.rejects(
  prepareWasmController(`(module
    (func (export "tick") (param f32)
      (loop)))`),
  /loop is disabled in the control tier \(3:8\)/,
  "WAT policy diagnostics omitted the source location",
);

let deep = "(f32.const 0)";
for (let index = 0; index < CONTROLLER_LIMITS.irDepth + 2; index++)
  deep = `(drop ${deep})`;
await assert.rejects(
  prepareWasmController(`(module (func (export "tick") (param f32) ${deep}))`),
  /depth/,
);

await assert.rejects(
  prepareWasmController(
    `(module ${Array.from(
      { length: CONTROLLER_LIMITS.functions + 1 },
      (_, index) => `(func $f${index})`,
    ).join(" ")} (func (export "tick") (param f32)))`,
  ),
  /too many functions/,
);
await assert.rejects(
  prepareWasmController(
    `(module ${Array.from(
      { length: CONTROLLER_LIMITS.globals + 1 },
      (_, index) => `(global $g${index} f32 (f32.const 0))`,
    ).join(" ")} (func (export "tick") (param f32)))`,
  ),
  /too many globals/,
);

const heavyBody = "nop ".repeat(5_500),
  fuelExhaustion = await prepareWasmController(`(module
    (func $heavy (result f32) ${heavyBody} (f32.const 1))
    (func (export "tick") (param f32)
      (drop (call $heavy))
      (drop (call $heavy))))`),
  healthy = await prepareTypeScriptController(
    `function tick(api: any, dt: number): void { void dt; api.write('throttle', 0.4); }`,
  ),
  statuses = [],
  emittedCommands = [],
  traces = [],
  manager = new ControllerRuntimeManager({
    onStatus: (controllerId, status, online) =>
      statuses.push({ controllerId, status, online }),
    onCommands: (controllerId, commands) =>
      emittedCommands.push({
        controllerId,
        commands: Object.fromEntries(commands),
      }),
    onTrace: (trace) => traces.push(trace),
  });
manager.attach(1, fuelExhaustion, "FUEL TEST");
manager.attach(2, healthy, "HEALTHY");
assert.deepEqual(statuses.slice(0, 2), [
  { controllerId: 1, status: "FUEL TEST ONLINE", online: true },
  { controllerId: 2, status: "HEALTHY ONLINE", online: true },
]);
assert.equal(manager.tick(1, 1 / 120, {}), false);
assert.equal(manager.ready(1), false);
assert.match(manager.status(1).status, /fuel exhausted/);
assert.equal(manager.tick(2, 1 / 120, {}), true);
assert.equal(manager.commands(2).get("throttle"), 0.4);
assert.equal(manager.ready(2), true, "one trap stopped another controller");
assert.deepEqual(manager.status(2), {
  ready: true,
  status: "HEALTHY ONLINE",
  error: null,
  language: "typescript",
  policyVersion: CONTROLLER_POLICY_VERSION,
  bindingManifestIdentity: healthy.bindingManifestIdentity,
  tick: 1,
});
assert.deepEqual(emittedCommands.at(-1), {
  controllerId: 2,
  commands: { throttle: 0.4 },
});
assert.deepEqual(traces, [
  {
    controllerId: 2,
    tick: 1,
    dt: 1 / 120,
    sensors: {},
    commands: { throttle: 0.4 },
    bindingManifestIdentity: healthy.bindingManifestIdentity,
  },
]);
assert.ok(
  statuses.some((entry) => entry.controllerId === 1 && entry.online === false),
  "trapped controller status was not isolated and reported",
);

const runtimeReadModel = new ControllerRuntimeReadModel();
runtimeReadModel.setStatus(2, "HEALTHY ONLINE", true);
runtimeReadModel.setCommands(2, [["throttle", 0.4]]);
runtimeReadModel.setStatus(3, "SECOND ONLINE", true);
runtimeReadModel.setCommands(3, [["yaw", -0.25]]);
assert.deepEqual(runtimeReadModel.get(2), {
  controllerId: 2,
  ready: true,
  status: "HEALTHY ONLINE",
  commands: { throttle: 0.4 },
});
assert.deepEqual(runtimeReadModel.get(3)?.commands, { yaw: -0.25 });
assert(Object.isFrozen(runtimeReadModel.get(2)?.commands));
runtimeReadModel.stop(2, "STOPPED");
assert.deepEqual(runtimeReadModel.get(2), {
  controllerId: 2,
  ready: false,
  status: "STOPPED",
  commands: {},
});
assert.deepEqual(
  runtimeReadModel.get(3)?.commands,
  { yaw: -0.25 },
  "stopping one controller changed another controller read model",
);
runtimeReadModel.clear();
assert.equal(runtimeReadModel.get(3), null);

const tooManyWrites = Array.from(
    { length: CONTROLLER_LIMITS.outputsPerTick + 1 },
    () => `(call $write (i32.const 0) (f32.const 1))`,
  ).join(" "),
  outputFlood = await prepareWasmController(`(module
    (import "env" "write_binding" (func $write (param i32 f32)))
    (func (export "tick") (param f32) ${tooManyWrites}))`),
  outputEngine = outputFlood.instantiate();
assert.throws(() => outputEngine.tick(1 / 120, {}), /output budget/);
const disposableEngine = healthy.instantiate();
disposableEngine.dispose();
assert.throws(() => disposableEngine.tick(1 / 120, {}), /runtime is disposed/);

const nonFinite = await prepareWasmController(`(module
  (import "env" "write_binding" (func $write (param i32 f64)))
  (func (export "tick") (param f64)
    (call $write (i32.const 0) (f64.const nan))))`);
assert.throws(() => nonFinite.instantiate().tick(1 / 120, {}), /non-finite/);
const invalidSensorIndex = await prepareWasmController(`(module
    (import "env" "read_binding" (func $read (param i32) (result f32)))
    (func (export "tick") (param f32) (drop (call $read (i32.const 999)))))`),
  invalidChannelIndex = await prepareWasmController(`(module
    (import "env" "write_binding" (func $write (param i32 f32)))
    (func (export "tick") (param f32)
      (call $write (i32.const 999) (f32.const 1))))`);
assert.throws(
  () => invalidSensorIndex.instantiate().tick(1 / 120, {}),
  /input binding index/,
);
assert.throws(
  () => invalidChannelIndex.instantiate().tick(1 / 120, {}),
  /output binding index/,
);

const statefulPrepared = await prepareTypeScriptController(`let total = 0;
function tick(api: ControlAPI, dt: number): void {
  total = total + api.read('speed') * dt;
  api.write('throttle', total);
}`),
  statefulOutputs = new Map(),
  statefulManager = new ControllerRuntimeManager({
    onCommands: (id, commands) => statefulOutputs.set(id, new Map(commands)),
  });
statefulManager.attach(41, statefulPrepared, "STATEFUL");
statefulManager.tick(41, 0.25, { speed: 2 });
statefulManager.tick(41, 0.25, { speed: 4 });
const controllerCheckpoint = statefulManager.exportState(),
  restoredOutputs = new Map(),
  restoredManager = new ControllerRuntimeManager({
    onCommands: (id, commands) => restoredOutputs.set(id, new Map(commands)),
  });
restoredManager.attach(41, statefulPrepared, "STATEFUL");
restoredManager.importState(controllerCheckpoint);
statefulManager.tick(41, 0.25, { speed: 3 });
restoredManager.tick(41, 0.25, { speed: 3 });
assert.deepEqual(restoredManager.exportState(), statefulManager.exportState());
assert.deepEqual(restoredOutputs.get(41), statefulOutputs.get(41));
assert.throws(
  () => restoredManager.importState([]),
  /does not match attached programs/,
);
for (const mutateCheckpoint of [
  (state) => (state[0].controllerId = 404),
  (state) => (state[0].language = "wat"),
  (state) => (state[0].policyVersion = "future-policy"),
]) {
  const mismatchedCheckpoint = structuredClone(controllerCheckpoint);
  mutateCheckpoint(mismatchedCheckpoint);
  assert.throws(
    () => restoredManager.importState(mismatchedCheckpoint),
    /identity mismatch/,
  );
}
statefulManager.disposeAll();
restoredManager.disposeAll();

const defaultManager = new ControllerRuntimeManager();
assert.throws(() => defaultManager.attach(1, null), /instantiate/);
assert.throws(() => defaultManager.attach(1, {}), /instantiate/);
assert.equal(defaultManager.tick(404, 1 / 120, {}), false);
assert.deepEqual(defaultManager.commands(404), new Map());
assert.equal(defaultManager.status(404), null);
defaultManager.dispose(404);
let fakeDisposeCount = 0;
const arrayRuntime = {
  language: "array-test",
  policyVersion: "array-v1",
  instantiate: () => ({
    tick: () => [["brake", 0.5]],
    dispose: () => fakeDisposeCount++,
  }),
};
defaultManager.attach(3, arrayRuntime, "DEFAULT CALLBACKS");
assert.deepEqual(defaultManager.ids(), [3]);
assert.equal(defaultManager.tick(3, 1 / 120, {}), true);
assert.deepEqual(defaultManager.status(3), {
  ready: true,
  status: "DEFAULT CALLBACKS ONLINE",
  error: null,
  language: "array-test",
  policyVersion: "array-v1",
  bindingManifestIdentity: null,
  tick: 1,
});
assert.equal(defaultManager.commands(3).get("brake"), 0.5);
defaultManager.disposeAll();
assert.equal(fakeDisposeCount, 1);
assert.deepEqual(defaultManager.ids(), []);

manager.disposeAll();
console.log(
  `controller sandbox passed (${rejectedTypeScript.length} TS attacks, ${rejectedWat.length} WAT attacks, synchronous ${CONTROLLER_LIMITS.fuelPerTick}-fuel ticks)`,
);
