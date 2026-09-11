import test from 'node:test';
import assert from 'node:assert/strict';
import {
  admitLearningModel,
  predictLearningModel,
  learningIdentity,
  trainLearningModel,
  prepareLearningData,
} from '../src/model/learning-model.mjs';
const inputs = [
  { port: 'input1', channel: 'distance', unit: 'm', scale: 4 },
  { port: 'input2', channel: 'speed', unit: 'm/s', scale: 2 },
];
const outputs = [{ port: 'out1', channel: 'duty', unit: 'ratio' }];
const interval = (id, samples, partition = 'train', weight = 1) => ({
  id,
  attemptId: id,
  partition,
  weight,
  inputs,
  outputs,
  samples: samples.map(([x, y], i) => ({ tick: i + 1, values: x, targets: y })),
});
const examples = [
  interval('cruise', [
    [[3, 0], [0.7]],
    [[3, 0.5], [0.4]],
    [[2, 0.5], [0.3]],
  ]),
  interval('brake', [
    [[0.5, 1], [-0.7]],
    [[0.2, 0], [0]],
    [[0.5, 0], [0.1]],
  ]),
];
test('bounded deterministic training fits observations; reserved values cannot alter fitted model', async () => {
  const args = { inputs, outputs, intervals: examples, seed: 19, epochs: 600 };
  const a = await trainLearningModel(args);
  const b = await trainLearningModel({
    ...args,
    intervals: [...examples, interval('reserved', [[[999, 100], [-1]]], 'test')],
  });
  assert.deepEqual(a.model, b.model);
  assert.ok(a.loss < 0.035, a.loss);
  assert.ok(predictLearningModel(a.model, [0.5, 1])[0] < -0.3);
  assert.notEqual(
    predictLearningModel(a.model, [3, 0])[0],
    predictLearningModel(a.model, [0.5, 1])[0],
  );
  assert.deepEqual(admitLearningModel(JSON.parse(JSON.stringify(a.model))), a.model);
  assert.equal(learningIdentity(a.model), learningIdentity(b.model));
});
test('equal interval weight, incomplete schema exclusion, and duplicate admission', () => {
  const long = interval(
    'long',
    Array.from({ length: 100 }, () => [[3, 0], [0.7]]),
  );
  const brief = interval('brief', [[[0.5, 1], [-0.7]]]);
  const data = prepareLearningData({ inputs, outputs, intervals: [long, brief] });
  assert.ok(Math.abs(data.samples.slice(0, 100).reduce((s, r) => s + r.weight, 0) - 0.5) < 1e-12);
  assert.equal(data.samples[100].weight, 0.5);
  assert.throws(
    () => prepareLearningData({ inputs, outputs, intervals: [long, { ...long, id: 'copy' }] }),
    /DUPLICATE/,
  );
  const changed = [
    { ...inputs[0] },
    { ...inputs[1], channel: 'angularSpeed', unit: 'rad/s', scale: 20 },
  ];
  const missing = prepareLearningData({ inputs: changed, outputs, intervals: [long] });
  assert.equal(missing.samples.length, 0);
  assert.equal(missing.excluded[0].reason, 'INCOMPATIBLE_INPUTS');
});
test('cancellation and invalid settings preserve caller model/data', async () => {
  const before = structuredClone(examples);
  await assert.rejects(
    trainLearningModel({ inputs, outputs, intervals: examples, cancelled: () => true }),
    /CANCELLED/,
  );
  await assert.rejects(
    trainLearningModel({ inputs, outputs, intervals: examples, epochs: Infinity }),
    /LIMIT/,
  );
  assert.deepEqual(examples, before);
  assert.throws(() => admitLearningModel({ version: 1, weights: [NaN] }), /INVALID_LEARNING_MODEL/);
});
test('whole-attempt partition admission rejects splitting correction intervals across training and test', () => {
  const a = interval('a', [[[3, 0], [0.7]]]);
  const b = { ...interval('b', [[[0.5, 1], [-0.7]]], 'test'), attemptId: a.attemptId };
  assert.throws(
    () => prepareLearningData({ inputs, outputs, intervals: [a, b] }),
    /MIXED_ATTEMPT_PARTITIONS/,
  );
});

test('version two keeps normal missing-return states explicit and never reinterprets legacy weights', async () => {
  const { learningValues, learningFeatureScales } = await import('../src/model/learning-model.mjs');
  const inputs = [
    {
      port: 'input1',
      kind: 'range',
      channel: 'distance',
      unit: 'm',
      scale: 4,
      frame: 'sensor-ray',
      encoding: 'value-status-v1',
    },
  ];
  const values = learningValues(
    inputs,
    [{ node: 3, channels: { distance: { status: 'no-return' } } }],
    [3],
  );
  assert.deepEqual(values, [0, 0, 1, 0]);
  assert.deepEqual(learningFeatureScales(inputs), [4, 1, 1, 1]);
  assert.equal(
    learningValues(inputs, [{ node: 3, channels: { distance: { status: 'no-power' } } }], [3]),
    null,
  );
  const outputs = [{ port: 'out1', channel: 'duty', unit: 'ratio' }];
  const model = {
    version: 2,
    inputs,
    outputs,
    hidden: 6,
    scaling: 'fixed-physical-status-v2',
    weights: Array(37).fill(0),
  };
  assert.equal(admitLearningModel(model).version, 2);
  assert.deepEqual(predictLearningModel(model, values), [0]);
  assert.throws(() => admitLearningModel({ ...model, version: 1 }));
});
