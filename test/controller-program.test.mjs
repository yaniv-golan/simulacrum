import test from 'node:test';
import assert from 'node:assert/strict';
import { compileController, generateRules } from '../src/scripting/controller-program.mjs';
const bindings = { inputs: [{ port: 'input1' }], outputs: [{ port: 'out1' }] };
test('rules execute their displayed TypeScript through WASM with explicit missing-data branch', async () => {
  const source = generateRules([
    { input: 'input1', operator: '<', threshold: 1, output: 'out1', duty: -1, otherwise: 0.5 },
  ]);
  const p = await compileController(source, bindings);
  assert.ok(p.bytes instanceof Uint8Array);
  assert.deepEqual(p.run([{ status: 'ok', value: 0.3 }]), [-1]);
  assert.deepEqual(p.run([{ status: 'ok', value: 2 }]), [0.5]);
  assert.deepEqual(p.run([{ status: 'no-power' }]), [null]);
});
test('bounded numeric state checkpoints and rejected programs cannot execute host code', async () => {
  const p = await compileController(
    'let count = 0; function tick() { count = count + 0.1; write("out1", count); }',
    bindings,
  );
  assert.deepEqual(p.run([{ status: 'ok', value: 0 }]), [0.1]);
  const cp = p.snapshot();
  p.run([{ status: 'ok', value: 0 }]);
  p.restore(cp);
  assert.deepEqual(p.run([{ status: 'ok', value: 0 }]), [0.2]);
  for (const source of [
    'function tick(){while(true){}}',
    'function tick(){fetch("x");}',
    'function tick(){globalThis.secret=1;}',
    'function tick(){tick();}',
    'import x from "x"; function tick(){}',
    'function tick(){write("other",1);}',
    'function tick(){write("out1",1/0); }',
  ]) {
    await assert.rejects(async () => {
      const q = await compileController(source, bindings);
      q.run([{ status: 'ok', value: 0 }]);
    });
  }
});
test('numeric logical operators preserve operands and short circuit unavailable reads', async () => {
  for (const [expression, expected] of [
    ['0.2 || 0.4', 0.2],
    ['0.2 && 0.4', 0.4],
    ['0 && read("input1")', 0],
    ['0.2 || read("input1")', 0.2],
  ]) {
    const p = await compileController(`function tick(){write("out1", ${expression});}`, bindings);
    assert.deepEqual(p.run([{ status: 'no-return' }]), [expected]);
  }
});
test('block variables cannot escape or leak into the opposite branch', async () => {
  for (const source of [
    'function tick(){if(1){let x=0.2;}write("out1",x);}',
    'function tick(){if(1){let x=0.2;}else{write("out1",x);}}',
  ])
    await assert.rejects(compileController(source, bindings), /Unknown variable/);
});
test('nested logical expressions compile with linear code size', async () => {
  let expression = '0.2';
  for (let i = 0; i < 14; i++) expression = `(${expression} || 0.4)`;
  const p = await compileController(`function tick(){write("out1", ${expression});}`, bindings);
  assert.ok(p.bytes.length < 2000, 'bounded source must not expand exponentially');
  assert.deepEqual(p.run([{ status: 'no-return' }]), [0.2]);
});
test('status rules distinguish healthy missing readings from a valid zero through generated WASM', async () => {
  const rule = {
    input: 'input1',
    operator: '===',
    threshold: 0,
    status: 'no-return',
    output: 'out1',
    duty: 0.2,
    otherwise: 0,
  };
  const p = await compileController(generateRules([rule]), bindings);
  assert.deepEqual(p.run([{ status: 'no-return' }]), [0.2]);
  assert.deepEqual(p.run([{ status: 'initializing' }]), [0]);
  assert.deepEqual(p.run([{ status: 'ok', value: 0 }]), [0]);
});
test('generated source mapping selects the exact threshold even when another field has the same number', async () => {
  const { generateRuleSource } = await import('../src/model/controller-authoring.mjs');
  const generated = generateRuleSource([
    { input: 'input1', operator: '<', threshold: 0.3, output: 'out1', duty: 0.3, otherwise: 0 },
  ]);
  const range = generated.rules[0].threshold;
  assert.equal(generated.source.slice(...range), '0.3');
  assert.ok(range[0] < generated.source.indexOf('write('));
});

test('numeric NaN is false in every conditional and logical form', async () => {
  for (const [expression, expected] of [
    ['(0 / 0) ? 0.5 : -0.5', -0.5],
    ['!(0 / 0) ? 0.5 : -0.5', 0.5],
    ['(0 / 0) || -0.5', -0.5],
    ['((0 / 0) && read("input1")) || 0.4', 0.4],
    ['(1 / 0) ? 0.5 : -0.5', 0.5],
    ['(-1 / 0) ? 0.5 : -0.5', 0.5],
    ['-0 ? 0.5 : -0.5', -0.5],
  ]) {
    const p = await compileController(`function tick(){write("out1", ${expression});}`, bindings);
    assert.deepEqual(p.run([{ status: 'no-return' }]), [expected], expression);
  }
  const p = await compileController(
    'function tick(){if(0/0){write("out1",0.5);}else{write("out1",-0.5);}}',
    bindings,
  );
  assert.deepEqual(p.run([{ status: 'ok', value: 0 }]), [-0.5]);
});
