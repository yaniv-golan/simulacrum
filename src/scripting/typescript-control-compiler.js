import {
  CONTROL_IR_VERSION,
  validateControlIR,
} from "../model/control-program-ir.js";
import { assertControllerSourceSize } from "../model/controller-policy.js";
import {
  controllerBindingIndex,
  validateControllerBindingManifest,
} from "../model/controller-bindings.js";

function diagnosticError(ts, sourceFile, node, message) {
  const start = node?.getStart?.(sourceFile) ?? 0,
    position = sourceFile.getLineAndCharacterOfPosition(start);
  return new Error(
    `${message} (${position.line + 1}:${position.character + 1})`,
  );
}

export async function compileTypeScriptToControlIR(source, bindingManifest) {
  assertControllerSourceSize(source, "TypeScript source");
  const bindings = validateControllerBindingManifest(bindingManifest);
  const tsModule = await import("typescript"),
    ts = tsModule.default || tsModule,
    sourceFile = ts.createSourceFile(
      "controller.ts",
      source,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.TS,
    );
  const parseDiagnostics =
    /** @type {{ parseDiagnostics?: import("typescript").Diagnostic[] }} */ (
      sourceFile
    ).parseDiagnostics;
  if (parseDiagnostics?.length) {
    const diagnostic = parseDiagnostics[0];
    throw new Error(
      `${ts.flattenDiagnosticMessageText(diagnostic.messageText, " ")} (${sourceFile.getLineAndCharacterOfPosition(diagnostic.start || 0).line + 1})`,
    );
  }

  const rawFunctions = new Map(),
    globals = [],
    globalNames = new Set();
  const nameOf = (node, label) => {
    if (!node || !ts.isIdentifier(node))
      throw diagnosticError(
        ts,
        sourceFile,
        node,
        `${label} needs a plain name`,
      );
    return node.text;
  };
  const assertCallableShape = (node, name) => {
    if (
      node.modifiers?.length ||
      node.asteriskToken ||
      node.typeParameters?.length
    )
      throw diagnosticError(
        ts,
        sourceFile,
        node,
        `${name} cannot be async, exported, generic, or a generator`,
      );
    for (const parameter of node.parameters || [])
      if (
        parameter.dotDotDotToken ||
        parameter.questionToken ||
        parameter.initializer ||
        parameter.modifiers?.length
      )
        throw diagnosticError(
          ts,
          sourceFile,
          parameter,
          `${name} parameters must be required numeric values`,
        );
  };
  const numericConstant = (node) => {
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (ts.isParenthesizedExpression(node))
      return numericConstant(node.expression);
    if (ts.isPrefixUnaryExpression(node)) {
      const value = numericConstant(node.operand);
      if (node.operator === ts.SyntaxKind.MinusToken) return -value;
      if (node.operator === ts.SyntaxKind.PlusToken) return value;
    }
    throw diagnosticError(
      ts,
      sourceFile,
      node,
      "controller globals need a numeric constant initializer",
    );
  };

  for (const statement of sourceFile.statements) {
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEmptyStatement(statement)
    )
      continue;
    if (ts.isFunctionDeclaration(statement)) {
      const name = nameOf(statement.name, "function");
      assertCallableShape(statement, name);
      if (!statement.body)
        throw diagnosticError(
          ts,
          sourceFile,
          statement,
          `${name} needs a body`,
        );
      if (rawFunctions.has(name))
        throw diagnosticError(
          ts,
          sourceFile,
          statement,
          `duplicate function ${name}`,
        );
      rawFunctions.set(name, {
        name,
        parameters: statement.parameters,
        body: statement.body,
        tick: name === "tick",
      });
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      if (statement.modifiers?.length)
        throw diagnosticError(
          ts,
          sourceFile,
          statement,
          "controller declarations cannot be exported or declared",
        );
      for (const declaration of statement.declarationList.declarations) {
        const name = nameOf(declaration.name, "top-level declaration");
        if (
          declaration.initializer &&
          (ts.isArrowFunction(declaration.initializer) ||
            ts.isFunctionExpression(declaration.initializer))
        ) {
          assertCallableShape(declaration.initializer, name);
          if (rawFunctions.has(name))
            throw diagnosticError(
              ts,
              sourceFile,
              declaration,
              `duplicate function ${name}`,
            );
          rawFunctions.set(name, {
            name,
            parameters: declaration.initializer.parameters,
            body: declaration.initializer.body,
            tick: false,
          });
          continue;
        }
        if (!declaration.initializer)
          throw diagnosticError(
            ts,
            sourceFile,
            declaration,
            `global ${name} needs an initializer`,
          );
        if (globalNames.has(name))
          throw diagnosticError(
            ts,
            sourceFile,
            declaration,
            `duplicate global ${name}`,
          );
        globalNames.add(name);
        globals.push({
          name,
          mutable: (statement.declarationList.flags & ts.NodeFlags.Const) === 0,
          initial: numericConstant(declaration.initializer),
        });
      }
      continue;
    }
    throw diagnosticError(
      ts,
      sourceFile,
      statement,
      "only type declarations, numeric state, and functions are allowed at top level",
    );
  }
  if (!rawFunctions.has("tick"))
    throw new Error("script must declare function tick(api, dt)");
  for (const name of rawFunctions.keys())
    if (globalNames.has(name))
      throw new Error(`${name} cannot be both numeric state and a function`);

  const functions = [];
  for (const raw of rawFunctions.values()) {
    const declaredParameters = raw.parameters.map((parameter) =>
        nameOf(parameter.name, `${raw.name} parameter`),
      ),
      apiName = raw.tick ? declaredParameters[0] : null,
      parameters = raw.tick ? declaredParameters.slice(1) : declaredParameters;
    if (raw.tick && declaredParameters.length !== 2)
      throw diagnosticError(
        ts,
        sourceFile,
        raw.body,
        "tick must accept exactly (api, dt)",
      );

    const localNames = new Set(parameters),
      mutableLocals = new Set(parameters),
      locals = [];
    const collectLocals = (statement) => {
      if (ts.isBlock(statement)) {
        for (const child of statement.statements) collectLocals(child);
      } else if (ts.isVariableStatement(statement)) {
        for (const declaration of statement.declarationList.declarations) {
          const name = nameOf(declaration.name, `${raw.name} local`);
          if (localNames.has(name) || globalNames.has(name))
            throw diagnosticError(
              ts,
              sourceFile,
              declaration,
              `${raw.name} redeclares ${name}`,
            );
          localNames.add(name);
          if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0)
            mutableLocals.add(name);
          locals.push(name);
        }
      } else if (ts.isIfStatement(statement)) {
        collectLocals(statement.thenStatement);
        if (statement.elseStatement) collectLocals(statement.elseStatement);
      }
    };
    if (ts.isBlock(raw.body)) collectLocals(raw.body);

    const compileExpression = (node) => {
      if (ts.isParenthesizedExpression(node))
        return compileExpression(node.expression);
      if (
        ts.isAsExpression(node) ||
        ts.isTypeAssertionExpression(node) ||
        ts.isNonNullExpression(node)
      )
        return compileExpression(node.expression);
      if (ts.isNumericLiteral(node))
        return { kind: "number", value: Number(node.text) };
      if (node.kind === ts.SyntaxKind.TrueKeyword)
        return { kind: "number", value: 1 };
      if (node.kind === ts.SyntaxKind.FalseKeyword)
        return { kind: "number", value: 0 };
      if (ts.isIdentifier(node)) {
        if (localNames.has(node.text))
          return { kind: "local", name: node.text };
        if (globalNames.has(node.text))
          return { kind: "global", name: node.text };
        throw diagnosticError(
          ts,
          sourceFile,
          node,
          `unknown numeric value ${node.text}`,
        );
      }
      if (ts.isPrefixUnaryExpression(node)) {
        const operators = {
          [ts.SyntaxKind.PlusToken]: "plus",
          [ts.SyntaxKind.MinusToken]: "negate",
          [ts.SyntaxKind.ExclamationToken]: "not",
        };
        const operator = operators[node.operator];
        if (!operator)
          throw diagnosticError(
            ts,
            sourceFile,
            node,
            "unsupported unary operator",
          );
        return {
          kind: "unary",
          operator,
          value: compileExpression(node.operand),
        };
      }
      if (ts.isBinaryExpression(node)) {
        const operators = {
          [ts.SyntaxKind.PlusToken]: "add",
          [ts.SyntaxKind.MinusToken]: "subtract",
          [ts.SyntaxKind.AsteriskToken]: "multiply",
          [ts.SyntaxKind.SlashToken]: "divide",
          [ts.SyntaxKind.LessThanToken]: "lt",
          [ts.SyntaxKind.LessThanEqualsToken]: "lte",
          [ts.SyntaxKind.GreaterThanToken]: "gt",
          [ts.SyntaxKind.GreaterThanEqualsToken]: "gte",
          [ts.SyntaxKind.EqualsEqualsToken]: "equal",
          [ts.SyntaxKind.EqualsEqualsEqualsToken]: "equal",
          [ts.SyntaxKind.ExclamationEqualsToken]: "not-equal",
          [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "not-equal",
          [ts.SyntaxKind.AmpersandAmpersandToken]: "and",
          [ts.SyntaxKind.BarBarToken]: "or",
        };
        const operator = operators[node.operatorToken.kind];
        if (!operator)
          throw diagnosticError(
            ts,
            sourceFile,
            node,
            "assignments are only allowed as standalone statements",
          );
        return {
          kind: "binary",
          operator,
          left: compileExpression(node.left),
          right: compileExpression(node.right),
        };
      }
      if (ts.isConditionalExpression(node))
        return {
          kind: "conditional",
          condition: compileExpression(node.condition),
          whenTrue: compileExpression(node.whenTrue),
          whenFalse: compileExpression(node.whenFalse),
        };
      if (ts.isCallExpression(node)) {
        if (ts.isPropertyAccessExpression(node.expression)) {
          const owner = node.expression.expression,
            method = node.expression.name.text;
          if (
            ts.isIdentifier(owner) &&
            owner.text === apiName &&
            ["read", "valid"].includes(method)
          ) {
            const key = node.arguments[0];
            if (node.arguments.length !== 1 || !ts.isStringLiteral(key))
              throw diagnosticError(
                ts,
                sourceFile,
                node,
                `api.${method} needs one literal input binding ID`,
              );
            try {
              controllerBindingIndex(bindings, key.text, "input");
            } catch {
              throw diagnosticError(
                ts,
                sourceFile,
                key,
                `unknown input binding ${key.text}`,
              );
            }
            return { kind: method, bindingId: key.text };
          }
          if (ts.isIdentifier(owner) && owner.text === "Math") {
            if (!["abs", "min", "max"].includes(method))
              throw diagnosticError(
                ts,
                sourceFile,
                node,
                `Math.${method} is not allowed`,
              );
            const expected = method === "abs" ? 1 : 2;
            if (node.arguments.length !== expected)
              throw diagnosticError(
                ts,
                sourceFile,
                node,
                `Math.${method} needs ${expected} argument(s)`,
              );
            return {
              kind: "builtin",
              name: method,
              arguments: node.arguments.map(compileExpression),
            };
          }
        }
        if (
          ts.isIdentifier(node.expression) &&
          rawFunctions.has(node.expression.text)
        )
          return {
            kind: "call",
            name: node.expression.text,
            arguments: node.arguments.map(compileExpression),
          };
        throw diagnosticError(
          ts,
          sourceFile,
          node,
          "only declared helpers, api.read/valid, and Math.abs/min/max may be called",
        );
      }
      throw diagnosticError(
        ts,
        sourceFile,
        node,
        "unsupported controller expression",
      );
    };

    const assignmentStatement = (expression) => {
      if (!ts.isBinaryExpression(expression)) return null;
      const assignments = {
        [ts.SyntaxKind.EqualsToken]: null,
        [ts.SyntaxKind.PlusEqualsToken]: "add",
        [ts.SyntaxKind.MinusEqualsToken]: "subtract",
        [ts.SyntaxKind.AsteriskEqualsToken]: "multiply",
        [ts.SyntaxKind.SlashEqualsToken]: "divide",
      };
      if (!(expression.operatorToken.kind in assignments)) return null;
      if (!ts.isIdentifier(expression.left))
        throw diagnosticError(
          ts,
          sourceFile,
          expression.left,
          "assignment target must be numeric state or a local",
        );
      const name = expression.left.text,
        kind = localNames.has(name)
          ? "set-local"
          : globalNames.has(name)
            ? "set-global"
            : null;
      if (!kind)
        throw diagnosticError(
          ts,
          sourceFile,
          expression.left,
          `unknown state ${name}`,
        );
      const global = globals.find((candidate) => candidate.name === name);
      if (kind === "set-local" && !mutableLocals.has(name))
        throw diagnosticError(
          ts,
          sourceFile,
          expression.left,
          `cannot assign to constant ${name}`,
        );
      if (global && !global.mutable)
        throw diagnosticError(
          ts,
          sourceFile,
          expression.left,
          `cannot assign to constant ${name}`,
        );
      const operator = assignments[expression.operatorToken.kind],
        right = compileExpression(expression.right),
        value = operator
          ? {
              kind: "binary",
              operator,
              left: { kind: kind === "set-local" ? "local" : "global", name },
              right,
            }
          : right;
      return { kind, name, value };
    };
    const compileStatements = (statement) => {
      const list = ts.isBlock(statement)
          ? [...statement.statements]
          : [statement],
        result = [];
      for (const current of list) {
        if (ts.isEmptyStatement(current)) continue;
        if (ts.isVariableStatement(current)) {
          for (const declaration of current.declarationList.declarations) {
            const name = nameOf(declaration.name, `${raw.name} local`);
            if (!declaration.initializer)
              throw diagnosticError(
                ts,
                sourceFile,
                declaration,
                `local ${name} needs an initializer`,
              );
            result.push({
              kind: "set-local",
              name,
              value: compileExpression(declaration.initializer),
            });
          }
          continue;
        }
        if (ts.isExpressionStatement(current)) {
          const expression = current.expression;
          if (ts.isVoidExpression(expression)) continue;
          const assignment = assignmentStatement(expression);
          if (assignment) {
            result.push(assignment);
            continue;
          }
          if (
            ts.isCallExpression(expression) &&
            ts.isPropertyAccessExpression(expression.expression) &&
            ts.isIdentifier(expression.expression.expression) &&
            expression.expression.expression.text === apiName &&
            expression.expression.name.text === "write"
          ) {
            const channel = expression.arguments[0];
            if (
              expression.arguments.length !== 2 ||
              !ts.isStringLiteral(channel)
            )
              throw diagnosticError(
                ts,
                sourceFile,
                expression,
                "api.write needs a literal output binding ID and numeric value",
              );
            try {
              controllerBindingIndex(bindings, channel.text, "output");
            } catch {
              throw diagnosticError(
                ts,
                sourceFile,
                channel,
                `unknown output binding ${channel.text}`,
              );
            }
            result.push({
              kind: "write",
              bindingId: channel.text,
              value: compileExpression(expression.arguments[1]),
            });
            continue;
          }
          result.push({
            kind: "expression",
            value: compileExpression(expression),
          });
          continue;
        }
        if (ts.isIfStatement(current)) {
          result.push({
            kind: "if",
            condition: compileExpression(current.expression),
            then: compileStatements(current.thenStatement),
            else: current.elseStatement
              ? compileStatements(current.elseStatement)
              : [],
          });
          continue;
        }
        if (ts.isReturnStatement(current)) {
          if (raw.tick && current.expression)
            throw diagnosticError(
              ts,
              sourceFile,
              current,
              "tick cannot return a value",
            );
          result.push({
            kind: "return",
            value: current.expression
              ? compileExpression(current.expression)
              : { kind: "number", value: 0 },
          });
          continue;
        }
        throw diagnosticError(
          ts,
          sourceFile,
          current,
          "loops, exceptions, object creation, and dynamic control flow are not allowed",
        );
      }
      return result;
    };
    const body = ts.isBlock(raw.body)
      ? compileStatements(raw.body)
      : [{ kind: "return", value: compileExpression(raw.body) }];
    if (!raw.tick && body.at(-1)?.kind !== "return")
      throw diagnosticError(
        ts,
        sourceFile,
        raw.body,
        `helper ${raw.name} must end with a numeric return`,
      );
    functions.push({
      name: raw.name,
      parameters,
      locals,
      returnsValue: !raw.tick,
      body,
    });
  }

  const byName = new Map(functions.map((fn) => [fn.name, fn])),
    callGraph = new Map(functions.map((fn) => [fn.name, new Set()]));
  const visitCalls = (value, owner) => {
    if (!value || typeof value !== "object") return;
    if (value.kind === "call") {
      if (!byName.has(value.name))
        throw new Error(`unknown helper ${value.name}`);
      if (!byName.get(value.name).returnsValue)
        throw new Error(`${value.name} does not return a numeric value`);
      callGraph.get(owner).add(value.name);
      const target = byName.get(value.name);
      if ((value.arguments || []).length !== target.parameters.length)
        throw new Error(
          `${value.name} expects ${target.parameters.length} argument(s)`,
        );
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child))
        for (const item of child) visitCalls(item, owner);
      else if (child && typeof child === "object") visitCalls(child, owner);
    }
  };
  for (const fn of functions) visitCalls(fn.body, fn.name);
  const active = new Set(),
    complete = new Set();
  const visitFunction = (name) => {
    if (active.has(name))
      throw new Error(`recursive call cycle includes ${name}`);
    if (complete.has(name)) return;
    active.add(name);
    for (const target of callGraph.get(name)) visitFunction(target);
    active.delete(name);
    complete.add(name);
  };
  for (const fn of functions) visitFunction(fn.name);

  return validateControlIR({
    version: CONTROL_IR_VERSION,
    bindingManifest: bindings,
    globals,
    functions,
    entry: "tick",
  });
}
