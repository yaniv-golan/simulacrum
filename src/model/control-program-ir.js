import { CONTROLLER_LIMITS } from "./controller-policy.js";
import {
  controllerBindingIndex,
  validateControllerBindingManifest,
} from "./controller-bindings.js";

export const CONTROL_IR_VERSION = 2;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const EXPRESSION_KINDS = new Set([
  "number",
  "local",
  "global",
  "read",
  "valid",
  "unary",
  "binary",
  "conditional",
  "call",
  "builtin",
]);
const STATEMENT_KINDS = new Set([
  "set-local",
  "set-global",
  "write",
  "expression",
  "if",
  "return",
]);

function assertIdentifier(value, label) {
  if (!IDENTIFIER.test(value || "") || String(value).startsWith("__sim_"))
    throw new Error(`${label} is not an allowed identifier`);
}

export function validateControlIR(input) {
  if (!input || typeof input !== "object")
    throw new TypeError("control IR must be an object");
  if (input.version !== CONTROL_IR_VERSION)
    throw new Error(`unsupported control IR version ${input.version}`);
  if (!Array.isArray(input.functions) || !input.functions.length)
    throw new Error("control IR needs at least one function");
  if (input.functions.length > CONTROLLER_LIMITS.functions)
    throw new Error("control IR has too many functions");
  if ((input.globals || []).length > CONTROLLER_LIMITS.globals)
    throw new Error("control IR has too many globals");
  const bindingManifest = validateControllerBindingManifest(
    input.bindingManifest,
  );

  let nodes = 0;
  const functionNames = new Set();
  const globalNames = new Set();
  for (const global of input.globals || []) {
    assertIdentifier(global.name, "global name");
    if (globalNames.has(global.name))
      throw new Error(`duplicate global ${global.name}`);
    globalNames.add(global.name);
    if (!Number.isFinite(global.initial))
      throw new Error(`global ${global.name} needs a finite initializer`);
  }

  const visitExpression = (expression, depth = 0) => {
    nodes++;
    if (nodes > CONTROLLER_LIMITS.irNodes)
      throw new Error("control IR exceeds the node budget");
    if (depth > CONTROLLER_LIMITS.irDepth)
      throw new Error("control IR exceeds the depth budget");
    if (!expression || !EXPRESSION_KINDS.has(expression.kind))
      throw new Error("control IR contains an unsupported expression");
    if (expression.kind === "number" && !Number.isFinite(expression.value))
      throw new Error("control IR numeric literals must be finite");
    if (["local", "global", "call"].includes(expression.kind))
      assertIdentifier(expression.name, `${expression.kind} name`);
    if (
      expression.kind === "builtin" &&
      !["abs", "min", "max"].includes(expression.name)
    )
      throw new Error(`unknown numeric builtin ${expression.name}`);
    if (["read", "valid"].includes(expression.kind))
      controllerBindingIndex(bindingManifest, expression.bindingId, "input");
    if (expression.value && typeof expression.value === "object")
      visitExpression(expression.value, depth + 1);
    if (expression.left) visitExpression(expression.left, depth + 1);
    if (expression.right) visitExpression(expression.right, depth + 1);
    if (expression.condition) visitExpression(expression.condition, depth + 1);
    if (expression.whenTrue) visitExpression(expression.whenTrue, depth + 1);
    if (expression.whenFalse) visitExpression(expression.whenFalse, depth + 1);
    for (const argument of expression.arguments || [])
      visitExpression(argument, depth + 1);
  };
  const visitStatements = (statements, localNames, depth = 0) => {
    if (!Array.isArray(statements))
      throw new Error("control IR function body must be a statement list");
    for (const statement of statements) {
      nodes++;
      if (nodes > CONTROLLER_LIMITS.irNodes)
        throw new Error("control IR exceeds the node budget");
      if (depth > CONTROLLER_LIMITS.irDepth)
        throw new Error("control IR exceeds the depth budget");
      if (!statement || !STATEMENT_KINDS.has(statement.kind))
        throw new Error("control IR contains an unsupported statement");
      if (statement.kind === "set-local" && !localNames.has(statement.name))
        throw new Error(`unknown local ${statement.name}`);
      if (statement.kind === "set-global" && !globalNames.has(statement.name))
        throw new Error(`unknown global ${statement.name}`);
      if (statement.kind === "write")
        controllerBindingIndex(bindingManifest, statement.bindingId, "output");
      if (
        ["set-local", "set-global", "write", "expression", "return"].includes(
          statement.kind,
        )
      )
        visitExpression(statement.value, depth + 1);
      if (statement.kind === "if") {
        visitExpression(statement.condition, depth + 1);
        visitStatements(statement.then, localNames, depth + 1);
        visitStatements(statement.else || [], localNames, depth + 1);
      }
    }
  };

  for (const fn of input.functions) {
    assertIdentifier(fn.name, "function name");
    if (functionNames.has(fn.name))
      throw new Error(`duplicate function ${fn.name}`);
    functionNames.add(fn.name);
    const parameters = fn.parameters || [],
      locals = fn.locals || [];
    if (parameters.length > CONTROLLER_LIMITS.parametersPerFunction)
      throw new Error(`${fn.name} has too many parameters`);
    if (locals.length > CONTROLLER_LIMITS.localsPerFunction)
      throw new Error(`${fn.name} has too many locals`);
    const localNames = new Set();
    for (const name of [...parameters, ...locals]) {
      assertIdentifier(name, `${fn.name} local`);
      if (localNames.has(name))
        throw new Error(`${fn.name} redeclares ${name}`);
      localNames.add(name);
    }
    visitStatements(fn.body, localNames);
  }
  if (!functionNames.has(input.entry || "tick"))
    throw new Error("control IR does not define its entry function");
  return input;
}
