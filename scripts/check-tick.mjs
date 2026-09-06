import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'acorn';
const expected = [
  'sensor-snapshot',
  'controller-commands',
  'power-signals',
  'actuators-constraints',
  'environment-forces',
  'integration-contacts',
  'structure-failure',
  'thermal-ablation',
  'telemetry',
];
function walk(node, visit, parents = []) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node, parents);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit, [...parents, node]);
    else if (value && typeof value === 'object') walk(value, visit, [...parents, node]);
  }
}
const name = (node) =>
  node?.type === 'Identifier' ? node.name : node?.type === 'Literal' ? node.value : undefined;
const member = (node, object, property) =>
  node?.type === 'MemberExpression' &&
  name(node.object) === object &&
  name(node.property) === property;
const literal = (node, value) => node?.type === 'Literal' && node.value === value;
export function checkTick(root = process.cwd()) {
  const ast = (path) =>
    parse(readFileSync(resolve(root, path), 'utf8'), {
      ecmaVersion: 'latest',
      sourceType: 'module',
    });
  let phases = 0,
    dt = 0;
  walk(ast('src/model/tick.mjs'), (node) => {
    if (node.type === 'VariableDeclarator' && name(node.id) === 'PHASES') {
      phases++;
      const init = node.init;
      if (
        init?.type !== 'CallExpression' ||
        !member(init.callee, 'Object', 'freeze') ||
        init.arguments.length !== 1 ||
        init.arguments[0]?.type !== 'ArrayExpression' ||
        JSON.stringify(
          init.arguments[0].elements.map((item) => (item?.type === 'Literal' ? item.value : null)),
        ) !== JSON.stringify(expected)
      )
        throw new Error('frozen phase order differs from runtime contract');
    }
    if (node.type === 'VariableDeclarator' && name(node.id) === 'DT') {
      dt++;
      if (
        node.init?.type !== 'BinaryExpression' ||
        node.init.operator !== '/' ||
        !literal(node.init.left, 1) ||
        !literal(node.init.right, 120)
      )
        throw new Error('fixed timestep differs from 1/120');
    }
  });
  if (phases !== 1 || dt !== 1)
    throw new Error('missing or duplicate phase order / fixed timestep');
  let integrations = 0,
    clocks = 0,
    restores = 0,
    phaseLoops = 0,
    tickInitializers = 0,
    nextInitializers = 0,
    replacements = 0;
  walk(ast('src/simulation/session.mjs'), (node, parents) => {
    const owner = [...parents].reverse().find((parent) => parent.type === 'FunctionDeclaration')
      ?.id?.name;
    if (node.type === 'ForOfStatement' && name(node.right) === 'PHASES') {
      phaseLoops++;
      if (owner !== 'step') throw new Error('phase order loop outside step');
    }
    if (node.type === 'MemberExpression' && member(node, 'world', 'step')) {
      integrations++;
      const parent = parents.at(-1),
        phaseCase = [...parents].reverse().find((item) => item.type === 'SwitchCase');
      if (
        parent?.type !== 'CallExpression' ||
        parent.callee !== node ||
        parent.arguments.length ||
        owner !== 'step' ||
        !literal(phaseCase?.test, 'integration-contacts') ||
        !parents.some((item) => item.type === 'ForOfStatement' && name(item.right) === 'PHASES')
      )
        throw new Error('integration must execute once in integration-contacts phase');
    }
    if (node.type === 'VariableDeclarator' && name(node.id) === 'next' && owner === 'step') {
      nextInitializers++;
      if (
        node.init?.type !== 'BinaryExpression' ||
        node.init.operator !== '+' ||
        name(node.init.left) !== 'tick' ||
        !literal(node.init.right, 1)
      )
        throw new Error('clock next tick must be tick + 1');
    }
    if (node.type === 'VariableDeclarator' && name(node.id) === 'tick') {
      tickInitializers++;
      if (!literal(node.init, 0)) throw new Error('clock must initialize at zero');
    }
    if (node.type === 'UpdateExpression' && name(node.argument) === 'tick')
      throw new Error('unauthorized clock advance');
    if (node.type === 'AssignmentExpression' && name(node.left) === 'tick') {
      if (node.operator !== '=') throw new Error('unauthorized clock advance');
      if (owner === 'replaceConfiguration' && literal(node.right, 0)) {
        replacements++;
        return;
      }
      if (owner === 'restore' && member(node.right, 'cp', 'tick')) {
        restores++;
        return;
      }
      const phaseCase = [...parents].reverse().find((item) => item.type === 'SwitchCase');
      if (owner !== 'step' || !literal(phaseCase?.test, 'telemetry') || name(node.right) !== 'next')
        throw new Error('clock advances only in telemetry');
      clocks++;
    }
  });
  if (integrations !== 1) throw new Error(`integration sites: expected 1, found ${integrations}`);
  if (phaseLoops !== 1) throw new Error('phase order requires one production loop');
  if (
    clocks !== 1 ||
    restores !== 1 ||
    tickInitializers !== 1 ||
    nextInitializers !== 1 ||
    replacements !== 1
  )
    throw new Error('clock requires one initializer, completed-tick advance and restore owner');
}
