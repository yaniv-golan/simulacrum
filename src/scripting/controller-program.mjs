import { SENSOR_STATUSES } from '../model/sensors.mjs';
import { immutableCopy } from '../model/observation.mjs';
const LIMITS = Object.freeze({ source: 16384, nodes: 2048, state: 32, fuel: 4096 });
const fail = (message) => {
  throw Error(message);
};
const finite = (v) => Number.isFinite(v) && Math.abs(v) <= 1e6;
export { generateRules } from '../model/controller-authoring.mjs';
/** A closed TypeScript subset. No source is evaluated in JavaScript. */
export async function compileController(source, bindings) {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > LIMITS.source)
    fail('Program is too large.');
  const { default: ts } = await import('typescript');
  const file = ts.createSourceFile(
    'controller.ts',
    source,
    ts.ScriptTarget.ES2022,
    true,
    ts.ScriptKind.TS,
  );
  if (file.parseDiagnostics.length) fail('TypeScript syntax error.');
  if (
    !bindings ||
    !Array.isArray(bindings.inputs) ||
    !Array.isArray(bindings.outputs) ||
    bindings.inputs.length > 16 ||
    bindings.outputs.length > 8 ||
    new Set(bindings.inputs.map((x) => x.port)).size !== bindings.inputs.length ||
    new Set(bindings.outputs.map((x) => x.port)).size !== bindings.outputs.length
  )
    fail('Invalid program bindings.');
  let count = 0;
  const globals = [],
    locals = [],
    symbols = new Map();
  const at = (node, message) => {
    const p = file.getLineAndCharacterOfPosition(node.getStart(file));
    fail(`${message} (${p.line + 1}:${p.character + 1})`);
  };
  const bump = (n) => {
    if (++count > LIMITS.nodes) at(n, 'Program is too complex.');
  };
  const numeric = (n) =>
    ts.isNumericLiteral(n)
      ? Number(n.text)
      : ts.isPrefixUnaryExpression(n) && n.operator === ts.SyntaxKind.MinusToken
        ? -numeric(n.operand)
        : at(n, 'Use a numeric constant.');
  const name = (n) => (ts.isIdentifier(n) ? n.text : at(n, 'Use a plain variable name.'));
  const expr = (n, depth = 0) => {
    bump(n);
    if (depth > 64) at(n, 'Expression is too deep.');
    if (ts.isParenthesizedExpression(n)) return expr(n.expression, depth + 1);
    if (ts.isNumericLiteral(n)) {
      const value = Number(n.text);
      if (!finite(value)) at(n, 'Number is outside the supported range.');
      return ['number', value];
    }
    if (n.kind === ts.SyntaxKind.TrueKeyword) return ['number', 1];
    if (n.kind === ts.SyntaxKind.FalseKeyword) return ['number', 0];
    if (ts.isIdentifier(n)) {
      if (n.text === 'dt') return ['number', 1 / 120];
      const s = symbols.get(n.text);
      if (!s) at(n, 'Unknown variable.');
      return ['get', s.global, s.index];
    }
    if (
      ts.isPrefixUnaryExpression(n) &&
      [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken, ts.SyntaxKind.ExclamationToken].includes(
        n.operator,
      )
    )
      return ['unary', ts.tokenToString(n.operator), expr(n.operand, depth + 1)];
    if (ts.isBinaryExpression(n)) {
      const op = ts.tokenToString(n.operatorToken.kind);
      if (!['+', '-', '*', '/', '<', '>', '<=', '>=', '===', '!==', '&&', '||'].includes(op))
        at(n, 'Unsupported operator.');
      return ['binary', op, expr(n.left, depth + 1), expr(n.right, depth + 1)];
    }
    if (ts.isConditionalExpression(n))
      return [
        'conditional',
        expr(n.condition, depth + 1),
        expr(n.whenTrue, depth + 1),
        expr(n.whenFalse, depth + 1),
      ];
    if (
      ts.isCallExpression(n) &&
      ts.isIdentifier(n.expression) &&
      ['read', 'valid', 'status'].includes(n.expression.text) &&
      n.arguments.length === 1 &&
      ts.isStringLiteral(n.arguments[0])
    ) {
      const index = bindings.inputs.findIndex((i) => i.port === n.arguments[0].text);
      if (index < 0) at(n, 'Input is not connected.');
      return ['input', n.expression.text, index];
    }
    at(n, 'Use numbers, connected inputs, and arithmetic only.');
  };
  const declaration = (n, global) => {
    if (n.modifiers?.length) at(n, 'Declarations cannot be exported.');
    return n.declarationList.declarations.map((d) => {
      const id = name(d.name);
      if (
        symbols.has(id) ||
        ['dt', 'read', 'write', 'valid', 'status', 'tick', 'mark'].includes(id) ||
        !d.initializer
      )
        at(d, 'Use a unique initialized variable.');
      if (d.type && d.type.kind !== ts.SyntaxKind.NumberKeyword)
        at(d, 'Only numeric state is supported.');
      const value = global ? numeric(d.initializer) : expr(d.initializer);
      if (global && !finite(value)) at(d, 'Invalid initial state.');
      const list = global ? globals : locals,
        index = list.length;
      if (globals.length + locals.length >= LIMITS.state) at(d, 'Too many variables.');
      list.push(global ? { name: id, value } : id);
      symbols.set(id, { global, index, mutable: !(n.declarationList.flags & ts.NodeFlags.Const) });
      return ['set', global, index, global ? ['number', value] : value];
    });
  };
  const statement = (n) => {
    bump(n);
    if (ts.isBlock(n)) {
      const enclosing = new Map(symbols);
      const body = n.statements.flatMap(statement);
      symbols.clear();
      for (const [id, symbol] of enclosing) symbols.set(id, symbol);
      return body;
    }
    if (ts.isVariableStatement(n)) return declaration(n, false);
    if (ts.isIfStatement(n))
      return [
        [
          'if',
          expr(n.expression),
          statement(n.thenStatement),
          n.elseStatement ? statement(n.elseStatement) : [],
        ],
      ];
    if (ts.isExpressionStatement(n)) {
      const e = n.expression;
      if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const s = symbols.get(name(e.left));
        if (!s?.mutable) at(e, 'Only mutable numeric variables can be assigned.');
        return [['set', s.global, s.index, expr(e.right)]];
      }
      if (
        ts.isCallExpression(e) &&
        ts.isIdentifier(e.expression) &&
        e.expression.text === 'mark' &&
        e.arguments.length === 1
      ) {
        const value = numeric(e.arguments[0]);
        if (!Number.isInteger(value) || value < 0 || value > 15)
          at(e, 'Marker must be 0 through 15.');
        return [['mark', value]];
      }
      if (
        ts.isCallExpression(e) &&
        ts.isIdentifier(e.expression) &&
        e.expression.text === 'write' &&
        e.arguments.length === 2 &&
        ts.isStringLiteral(e.arguments[0])
      ) {
        const i = bindings.outputs.findIndex((o) => o.port === e.arguments[0].text);
        if (i < 0) at(e, 'Output is not connected.');
        return [['write', i, expr(e.arguments[1])]];
      }
    }
    at(n, 'Use assignments, output commands, and if/else. Loops and calls are not supported.');
  };
  let tick;
  for (const n of file.statements) {
    if (ts.isVariableStatement(n)) declaration(n, true);
    else if (
      ts.isFunctionDeclaration(n) &&
      n.name?.text === 'tick' &&
      !tick &&
      !n.modifiers?.length &&
      !n.asteriskToken &&
      !n.typeParameters?.length &&
      n.parameters.length === 0 &&
      n.body
    )
      tick = n;
    else at(n, 'Define one tick function and optional numeric state.');
  }
  if (!tick) fail('Define function tick() { ... }.');
  const body = statement(tick.body),
    ir = immutableCopy({ version: 1, globals, locals, body });
  const bytes = emitProgram(ir);
  return instantiateProgram(bytes, ir, bindings);
}
const u = (n) => {
  const bytes = [];
  do {
    let b = n & 127;
    n >>>= 7;
    if (n) b |= 128;
    bytes.push(b);
  } while (n);
  return bytes;
};
const vector = (xs) => [...u(xs.length), ...xs.flat()];
const str = (s) => {
  const b = [...new TextEncoder().encode(s)];
  return [...u(b.length), ...b];
};
const f64 = (n) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n, true);
  return [0x44, ...b];
};
function emitProgram(ir) {
  const op = {
    '+': 0xa0,
    '-': 0xa1,
    '*': 0xa2,
    '/': 0xa3,
    '===': 0x61,
    '!==': 0x62,
    '<': 0x63,
    '>': 0x64,
    '<=': 0x65,
    '>=': 0x66,
  };
  const fuel = [0x10, 4],
    // abs(x) > 0 is false for both zero and NaN, and true for infinities.
    truth = (e) => [...expression(e), 0x99, ...f64(0), 0x64];
  const expression = (e) => {
    let code;
    if (e[0] === 'number') code = f64(e[1]);
    else if (e[0] === 'get') code = [e[1] ? 0x23 : 0x20, ...u(e[2])];
    else if (e[0] === 'input')
      code = [0x41, ...u(e[2]), 0x10, { read: 0, valid: 1, status: 2 }[e[1]]];
    else if (e[0] === 'unary')
      code = [
        ...expression(e[2]),
        ...(e[1] === '-' ? [0x9a] : e[1] === '!' ? [0x99, ...f64(0), 0x64, 0x45, 0xb7] : []),
      ];
    else if (e[0] === 'conditional')
      code = [...truth(e[1]), 0x04, 0x7c, ...expression(e[2]), 0x05, ...expression(e[3]), 0x0b];
    else if (e[0] === 'binary') {
      if (e[1] === '&&' || e[1] === '||') {
        // Store the evaluated left operand once. Re-emitting its tree here would
        // make nested logical expressions expand exponentially during compilation.
        const saved = [0x20, ...u(ir.locals.length)];
        code = [
          ...expression(e[2]),
          0x22,
          ...u(ir.locals.length),
          0x99,
          ...f64(0),
          0x64,
          0x04,
          0x7c,
          ...(e[1] === '&&' ? expression(e[3]) : saved),
          0x05,
          ...(e[1] === '&&' ? saved : expression(e[3])),
          0x0b,
        ];
      } else
        code = [
          ...expression(e[2]),
          ...expression(e[3]),
          op[e[1]],
          ...(['+', '-', '*', '/'].includes(e[1]) ? [] : [0xb7]),
        ];
    } else fail('Invalid program expression.');
    return [...fuel, ...code];
  };
  const statements = (rows) =>
    rows.flatMap((r) => {
      if (r[0] === 'set') return [...fuel, ...expression(r[3]), r[1] ? 0x24 : 0x21, ...u(r[2])];
      if (r[0] === 'mark') return [...fuel, 0x41, ...u(r[1]), 0x10, 5];
      if (r[0] === 'write') return [...fuel, 0x41, ...u(r[1]), ...expression(r[2]), 0x10, 3];
      if (r[0] === 'if')
        return [
          ...fuel,
          ...truth(r[1]),
          0x04,
          0x40,
          ...statements(r[2]),
          0x05,
          ...statements(r[3]),
          0x0b,
        ];
      fail('Invalid program statement.');
    });
  const section = (id, bytes) => [id, ...u(bytes.length), ...bytes];
  const body = [...vector([[...u(ir.locals.length + 1), 0x7c]]), ...statements(ir.body), 0x0b];
  return new Uint8Array([
    0,
    97,
    115,
    109,
    1,
    0,
    0,
    0,
    ...section(
      1,
      vector([
        [0x60, 1, 0x7f, 1, 0x7c],
        [0x60, 2, 0x7f, 0x7c, 0],
        [0x60, 0, 0],
        [0x60, 1, 0x7f, 0],
      ]),
    ),
    ...section(
      2,
      vector(
        ['read', 'valid', 'status', 'write', 'fuel', 'mark'].map((name, i) => [
          ...str('sensor'),
          ...str(name),
          0,
          i < 3 ? 0 : i === 3 ? 1 : i === 4 ? 2 : 3,
        ]),
      ),
    ),
    ...section(3, vector([[2]])),
    ...section(6, vector(ir.globals.map((g) => [0x7c, 1, ...f64(g.value), 0x0b]))),
    ...section(
      7,
      vector([
        [...str('tick'), 0, 6],
        ...ir.globals.map((g, i) => [...str('state' + i), 3, ...u(i)]),
      ]),
    ),
    ...section(10, vector([[...u(body.length), ...body]])),
  ]);
}
function instantiateProgram(bytes, ir, bindings) {
  let inputs = [],
    outputs = [],
    fuel = 0,
    markers = [];
  const invalid = () => fail('Sensor reading is unavailable.');
  const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {
    sensor: {
      read: (i) => (inputs[i]?.status === 'ok' ? inputs[i].value : invalid()),
      valid: (i) => (inputs[i]?.status === 'ok' ? 1 : 0),
      status: (i) => SENSOR_STATUSES.indexOf(inputs[i]?.status),
      write: (i, value) => {
        if (
          !Number.isInteger(i) ||
          i < 0 ||
          i >= bindings.outputs.length ||
          !Number.isFinite(value) ||
          Math.abs(value) > 1
        )
          fail('Output must be between -1 and 1.');
        outputs[i] = value;
      },
      mark: (i) => {
        if (markers.length >= 32) fail('Too many markers.');
        markers.push(i);
      },
      fuel: () => {
        if (++fuel > LIMITS.fuel) fail('Program operation budget exceeded.');
      },
    },
  });
  const snapshot = () => ir.globals.map((_, i) => instance.exports['state' + i].value);
  const restore = (values) => {
    if (!Array.isArray(values) || values.length !== ir.globals.length || !values.every(finite))
      fail('Invalid numeric program checkpoint.');
    values.forEach((v, i) => {
      instance.exports['state' + i].value = v;
    });
  };
  return Object.freeze({
    bytes,
    ir,
    snapshot,
    restore,
    inspect: () => markers.slice(),
    run(readings) {
      if (
        !Array.isArray(readings) ||
        readings.length !== bindings.inputs.length ||
        readings.some(
          (r) =>
            !r || !SENSOR_STATUSES.includes(r.status) || (r.status === 'ok' && !finite(r.value)),
        )
      )
        fail('Invalid program observation.');
      const before = snapshot();
      inputs = readings;
      outputs = Array(bindings.outputs.length).fill(null);
      fuel = 0;
      markers = [];
      try {
        instance.exports.tick();
        if (!snapshot().every(finite)) fail('Numeric state exceeded its bounds.');
        return outputs.slice();
      } catch (error) {
        markers = [];
        restore(before);
        throw error;
      } finally {
        inputs = [];
        outputs = [];
      }
    },
  });
}
