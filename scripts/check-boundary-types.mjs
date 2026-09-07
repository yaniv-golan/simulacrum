import { assertRuntime } from './runtime-preflight.mjs';
import ts from 'typescript';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';
import { generateBoundaryTypes } from './generate-boundary-types.mjs';

export function check() {
  assertRuntime();
  generateBoundaryTypes({ check: true });
  const root = fileURLToPath(new URL('../', import.meta.url));
  const configPath = root + 'tsconfig.boundaries.json';
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) throw Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length)
    throw Error(ts.formatDiagnosticsWithColorAndContext(parsed.errors, host()));
  function host() {
    return {
      getCanonicalFileName: (f) => f,
      getCurrentDirectory: () => root,
      getNewLine: () => '\n',
    };
  }
  function diagnostics(files) {
    return ts.getPreEmitDiagnostics(ts.createProgram(files, parsed.options));
  }
  for (const file of parsed.fileNames.filter((file) => file.endsWith('.mjs')))
    if (!/^\/\/ @ts-check\b/m.test(readFileSync(file, 'utf8')))
      throw Error(`Checked boundary source lost @ts-check: ${file}`);
  const positive = diagnostics(parsed.fileNames);
  if (positive.length) throw Error(ts.formatDiagnosticsWithColorAndContext(positive, host()));
  const wrong = new Map(
    [
      ['wrong-endpoint', 2322],
      ['wrong-command', 2345],
      ['wrong-observation', 2540],
      ['wrong-physics', 2322],
      ['wrong-physics-door', 2353],
      ['wrong-command-shape', 2322],
      ['wrong-result', 2345],
      ['wrong-observation-consumer', 2339],
      ['wrong-geometry', 2322],
      ['wrong-placement', 2322],
      ['wrong-graph-selection', 2345],
      ['wrong-rigid-frame', 2322],
      ['wrong-render-visible', 2741],
      ['wrong-render-spelling', 2561],
      ['wrong-render-kind', 2322],
      ['wrong-render-ends', 2322],
      ['wrong-path-highlight', 2322],
    ].map(([name, code]) => [root + `test/types/${name}.mts`, code]),
  );
  const negative = diagnostics([...parsed.fileNames, ...wrong.keys()]);
  for (const [file, code] of wrong) {
    const errors = negative.filter((d) => d.file?.fileName === file);
    if (!errors.length || errors.some((d) => d.code !== code))
      throw Error(
        `Wrong-type fixture ${file} must fail only with TS${code}:\n${ts.formatDiagnosticsWithColorAndContext(errors, host())}`,
      );
  }
  const unexpected = negative.filter((d) => !wrong.has(d.file?.fileName));
  if (unexpected.length) throw Error(ts.formatDiagnosticsWithColorAndContext(unexpected, host()));

  // Command membership is owned by actual core admission. A newly added command
  // cannot quietly be omitted from the public union (or invented only in types).
  const source = parse(readFileSync(root + 'src/core/workshop.mjs', 'utf8'), {
    ecmaVersion: 'latest',
    sourceType: 'module',
  });
  const admitted = new Set();
  const commandType = (node) =>
    node?.type === 'MemberExpression' &&
    node.object.name === 'command' &&
    node.property.name === 'type';
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'SwitchStatement' && commandType(node.discriminant))
      for (const branch of node.cases)
        if (branch.test?.type === 'Literal') admitted.add(branch.test.value);
    if (node.type === 'BinaryExpression' && commandType(node.left) && node.right.type === 'Literal')
      admitted.add(node.right.value);
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'MemberExpression' &&
      node.callee.property.name === 'includes' &&
      commandType(node.arguments[0]) &&
      node.callee.object.type === 'ArrayExpression'
    )
      for (const item of node.callee.object.elements) admitted.add(item.value);
    for (const child of Object.values(node))
      if (Array.isArray(child)) child.forEach(walk);
      else walk(child);
  }
  walk(source);
  const program = ts.createProgram(parsed.fileNames, parsed.options),
    checker = program.getTypeChecker();
  const declaration = program.getSourceFile(root + 'src/model/workshop-command.d.ts');
  const alias = declaration.statements.find(
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === 'WorkshopCommand',
  );
  const contract = checker.getTypeAtLocation(alias),
    declared = new Set();
  for (const variant of contract.types) {
    const tag = checker.getTypeOfPropertyOfType(variant, 'type');
    for (const literal of tag.isUnion() ? tag.types : [tag]) declared.add(literal.value);
  }
  if (JSON.stringify([...declared].sort()) !== JSON.stringify([...admitted].sort()))
    throw Error(
      `WorkshopCommand membership differs from core admission: declared=${[...declared]} admitted=${[...admitted]}`,
    );
  console.log(
    `Boundary types: checked production sources and positive fixture; ${wrong.size} wrong-type fixtures rejected; generated schema types fresh.`,
  );

  return { ok: true };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) check();
