import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateLearningModel,
  inspectLearningMoment,
  compareLearningAttempts,
} from '../src/model/learning-analysis.mjs';
import { trainLearningModel } from '../src/model/learning-model.mjs';
const inputs = [
  { port: 'input1', channel: 'distance', unit: 'm', scale: 4 },
  { port: 'input2', channel: 'speed', unit: 'm/s', scale: 2 },
];
const outputs = [{ port: 'out1', channel: 'duty', unit: 'ratio' }];
const interval = (id, partition, values, targets) => ({
  id,
  attemptId: id,
  partition,
  weight: 1,
  inputs,
  outputs,
  samples: [{ tick: 6, values, targets }],
});
test('reserved errors are independent from training fit and evaluation has explicit absence', async () => {
  const data = [interval('train', 'train', [1, 0], [0]), interval('test', 'test', [1, 0], [1])];
  const { model } = await trainLearningModel({ inputs, outputs, intervals: data });
  const e = evaluateLearningModel(model, data);
  assert.ok(e.train.loss < 0.01);
  assert.ok(e.test.loss > 0.8);
  assert.equal(e.validation, null);
});
test('diagnosis uses the full input vector and never calls projection conflicts a failure', async () => {
  const data = [interval('slow', 'train', [1, 0], [0]), interval('fast', 'train', [1, 1], [1])];
  const { model } = await trainLearningModel({ inputs, outputs, intervals: data });
  const view = inspectLearningMoment({ model, inputs, outputs, values: [1, 1], intervals: data });
  assert.equal(view.nearby[0].intervalId, 'fast');
  assert.equal(view.conflicts, false);
  const conflict = inspectLearningMoment({
    model,
    inputs,
    outputs,
    values: [1, 1],
    intervals: [...data, interval('opposite', 'train', [1, 1], [-1])],
  });
  assert.equal(conflict.conflicts, true);
  assert.equal(view.nearby[0].distance, 0);
});
test('comparison identifies changed authored conditions, model identities and manual intervention', () => {
  const a = {
    id: 'a',
    controller: 'c',
    blueprint: {
      id: 'b',
      parts: [
        { id: 'c', type: 'learningController', learningModel: { weights: [0] } },
        { id: 'cargo', type: 'spacerBlock', position: [0, 1, 0] },
      ],
      connections: [],
    },
    model: { weights: [0] },
    inputs,
    outputs,
    samples: [{ tick: 6, values: [1, 0], targets: [0], modes: ['learned'], physics: [] }],
  };
  const b = structuredClone(a);
  b.id = 'b';
  b.model.weights = [1];
  b.blueprint.parts[0].learningModel = b.model;
  b.samples[0].modes = ['manual'];
  const same = compareLearningAttempts(a, b);
  assert.equal(same.sameStart, true);
  assert.equal(same.sameModel, false);
  assert.equal(same.second.manualSamples, 1);
  b.blueprint.parts[1].position[1] = 2;
  assert.equal(compareLearningAttempts(a, b).sameStart, false);
  assert.match(compareLearningAttempts(a, b).changes.join(' '), /cargo/);
});

test('comparison discloses model changes on controllers outside the selected learner', () => {
  const a = {
    id: 'a',
    controller: 'selected',
    model: null,
    blueprint: {
      parts: [{ id: 'selected' }, { id: 'other', learningModel: { weights: [0] } }],
      connections: [],
    },
    samples: [],
  };
  const b = structuredClone(a);
  b.id = 'b';
  b.blueprint.parts[1].learningModel.weights = [1];
  assert.equal(compareLearningAttempts(a, b).sameStart, false);
  assert.match(compareLearningAttempts(a, b).changes.join(' '), /other/);
});
