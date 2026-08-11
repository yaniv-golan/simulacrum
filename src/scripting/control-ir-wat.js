import { validateControlIR } from "../model/control-program-ir.js";
import { controllerBindingIndex } from "../model/controller-bindings.js";
import { validatePointContactWrenchControllerSpec } from "../model/point-contact-wrench-controller-contract.js";

function watName(name) {
  return `$${name}`;
}

function watNumber(value) {
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

export function pointContactWrenchSpecsFromControlIR(input) {
  const ir = validateControlIR(input),
    specs = [],
    indexes = new Map(),
    visitStatements = (statements) => {
      for (const statement of statements) {
        if (statement.kind === "point-contact-wrench-write") {
          const spec = validatePointContactWrenchControllerSpec(
              statement.spec,
              ir.bindingManifest,
            ),
            key = JSON.stringify(spec);
          if (!indexes.has(key)) {
            indexes.set(key, specs.length);
            specs.push(spec);
          }
        }
        if (statement.kind === "if") {
          visitStatements(statement.then);
          visitStatements(statement.else || []);
        }
      }
    };
  for (const fn of ir.functions) visitStatements(fn.body);
  return Object.freeze(specs);
}

export function compileControlIRToWat(input) {
  const ir = validateControlIR(input),
    functions = new Map(ir.functions.map((fn) => [fn.name, fn])),
    pointContactWrenchSpecs = pointContactWrenchSpecsFromControlIR(ir),
    pointContactWrenchSpecIndexes = new Map(
      pointContactWrenchSpecs.map((spec, index) => [
        JSON.stringify(spec),
        index,
      ]),
    );
  const expression = (node) => {
    if (node.kind === "number") return `(f64.const ${watNumber(node.value)})`;
    if (node.kind === "local") return `(local.get ${watName(node.name)})`;
    if (node.kind === "global") return `(global.get ${watName(node.name)})`;
    if (node.kind === "read")
      return `(call $read_binding (i32.const ${controllerBindingIndex(ir.bindingManifest, node.bindingId, "input")}))`;
    if (node.kind === "valid")
      return `(call $read_binding_valid (i32.const ${controllerBindingIndex(ir.bindingManifest, node.bindingId, "input")}))`;
    if (node.kind === "unary") {
      const value = expression(node.value);
      if (node.operator === "plus") return value;
      if (node.operator === "negate") return `(f64.neg ${value})`;
      if (node.operator === "not")
        return `(f64.convert_i32_s (f64.eq ${value} (f64.const 0)))`;
      throw new Error(`unsupported unary IR operator ${node.operator}`);
    }
    if (node.kind === "binary") {
      const left = expression(node.left),
        right = expression(node.right),
        numeric = {
          add: "f64.add",
          subtract: "f64.sub",
          multiply: "f64.mul",
          divide: "f64.div",
        }[node.operator],
        comparison = {
          lt: "f64.lt",
          lte: "f64.le",
          gt: "f64.gt",
          gte: "f64.ge",
          equal: "f64.eq",
          "not-equal": "f64.ne",
        }[node.operator];
      if (numeric) return `(${numeric} ${left} ${right})`;
      if (comparison)
        return `(f64.convert_i32_s (${comparison} ${left} ${right}))`;
      if (node.operator === "and")
        return `(if (result f64) (f64.ne ${left} (f64.const 0)) (then (f64.convert_i32_s (f64.ne ${right} (f64.const 0)))) (else (f64.const 0)))`;
      if (node.operator === "or")
        return `(if (result f64) (f64.ne ${left} (f64.const 0)) (then (f64.const 1)) (else (f64.convert_i32_s (f64.ne ${right} (f64.const 0)))))`;
      throw new Error(`unsupported binary IR operator ${node.operator}`);
    }
    if (node.kind === "conditional")
      return `(if (result f64) (f64.ne ${expression(node.condition)} (f64.const 0)) (then ${expression(node.whenTrue)}) (else ${expression(node.whenFalse)}))`;
    if (node.kind === "builtin") {
      const values = node.arguments.map(expression);
      if (node.name === "abs") return `(f64.abs ${values[0]})`;
      if (node.name === "min") return `(f64.min ${values[0]} ${values[1]})`;
      if (node.name === "max") return `(f64.max ${values[0]} ${values[1]})`;
    }
    if (node.kind === "call") {
      const target = functions.get(node.name);
      if (!target) throw new Error(`unknown IR helper ${node.name}`);
      if (node.arguments.length !== target.parameters.length)
        throw new Error(`${node.name} received the wrong number of arguments`);
      return `(call ${watName(node.name)} ${node.arguments.map(expression).join(" ")})`;
    }
    throw new Error(`unsupported control IR expression ${node.kind}`);
  };
  const statements = (items, fn) =>
    items
      .map((statement) => {
        if (statement.kind === "set-local")
          return `(local.set ${watName(statement.name)} ${expression(statement.value)})`;
        if (statement.kind === "set-global")
          return `(global.set ${watName(statement.name)} ${expression(statement.value)})`;
        if (statement.kind === "write")
          return `(call $write_binding (i32.const ${controllerBindingIndex(ir.bindingManifest, statement.bindingId, "output")}) ${expression(statement.value)})`;
        if (statement.kind === "point-contact-wrench-write") {
          const spec = validatePointContactWrenchControllerSpec(
              statement.spec,
              ir.bindingManifest,
            ),
            specIndex = pointContactWrenchSpecIndexes.get(JSON.stringify(spec));
          return statement.outputBindingIds
            .map(
              (bindingId, outputIndex) =>
                `(call $write_binding (i32.const ${controllerBindingIndex(ir.bindingManifest, bindingId, "output")}) (call $point_contact_wrench_output (i32.const ${specIndex}) (i32.const ${outputIndex})))`,
            )
            .join("\n    ");
        }
        if (statement.kind === "expression")
          return `(drop ${expression(statement.value)})`;
        if (statement.kind === "if")
          return `(if (f64.ne ${expression(statement.condition)} (f64.const 0)) (then ${statements(statement.then, fn)}) (else ${statements(statement.else, fn)}))`;
        if (statement.kind === "return")
          return fn.returnsValue
            ? `(return ${expression(statement.value)})`
            : `(return)`;
        throw new Error(`unsupported control IR statement ${statement.kind}`);
      })
      .join("\n    ");

  const lines = [
    "(module",
    '  (import "env" "read_binding" (func $read_binding (param i32) (result f64)))',
    '  (import "env" "read_binding_valid" (func $read_binding_valid (param i32) (result f64)))',
    '  (import "env" "write_binding" (func $write_binding (param i32 f64)))',
  ];
  if (pointContactWrenchSpecs.length)
    lines.push(
      '  (import "env" "point_contact_wrench_output" (func $point_contact_wrench_output (param i32 i32) (result f64)))',
    );
  for (const global of ir.globals || [])
    lines.push(
      `  (global ${watName(global.name)} ${global.mutable ? "(mut f64)" : "f64"} (f64.const ${watNumber(global.initial)}))`,
    );
  for (const fn of ir.functions) {
    const signature = [
      `(func ${watName(fn.name)}`,
      fn.name === ir.entry ? ` (export "tick")` : "",
      ...fn.parameters.map((name) => ` (param ${watName(name)} f64)`),
      fn.returnsValue ? " (result f64)" : "",
    ].join("");
    lines.push(`  ${signature}`);
    for (const local of fn.locals)
      lines.push(`    (local ${watName(local)} f64)`);
    const body = statements(fn.body, fn);
    if (body) lines.push(`    ${body}`);
    lines.push("  )");
  }
  lines.push(")");
  return lines.join("\n");
}
