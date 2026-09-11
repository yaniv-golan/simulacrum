import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLearningDelivery,
  measureDeliveryAttempt,
} from '../src/model/fixtures/learning-delivery.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { createProgramExecutors } from '../src/scripting/controller-executors.mjs';
import { trainLearningModel, learningValues } from '../src/model/learning-model.mjs';

test('ordinary delivery fixture, rule baseline and frozen learner retain cargo; independent evaluation rejects wrong traces', async () => {
  const bp = createLearningDelivery(),
    learner = compileAssembly(bp).configuration.power.controllers.find((c) => c.learning).learning;
  const defs = (a) => a.map(({ node, ...r }) => r),
    inputs = defs(learner.inputs),
    outputs = defs(learner.outputs);
  async function trial(model = null, offset = 0) {
    const blueprint = createLearningDelivery({ policy: model ? 'learning' : 'rules' });
    if (model) blueprint.parts.find((p) => p.type === 'learningController').learningModel = model;
    for (const p of blueprint.parts)
      if (['bay-marker', 'bay-left', 'bay-right', 'range-backstop'].includes(p.id))
        p.position[2] += offset;
    const session = await createSession(
        compileAssembly(blueprint).configuration,
        undefined,
        undefined,
        undefined,
        createProgramExecutors,
      ),
      samples = [];
    try {
      session.step();
      session.step();
      session.step();
      for (const o of learner.outputs)
        session.act({ type: 'receiver-mode', node: o.node, mode: model ? 'learned' : 'automatic' });
      for (let t = 0; t < 1200; t++) {
        session.step();
        const next = session.observe().frames[0];
        if (next.tick % 6 === 0) {
          const r = next.sensors.readings.find((r) => r.node === learner.inputs[0].node);
          samples.push({
            tick: next.tick,
            values: learningValues(learner.inputs, next.sensors.readings),
            targets: learner.outputs.map(
              (o) => next.receiverControl.receivers.find((r) => r.node === o.node).duty,
            ),
            physics: next.physics,
          });
        }
      }
      return { blueprint, samples };
    } finally {
      session.dispose();
    }
  }
  const baseline = await trial();
  assert.equal(measureDeliveryAttempt(baseline).packageInBay, true);
  assert.equal(measureDeliveryAttempt(baseline).delivered, true);
  const trained = await trainLearningModel({
    inputs,
    outputs,
    intervals: [
      {
        id: 'baseline',
        attemptId: 'baseline',
        partition: 'train',
        weight: 1,
        inputs,
        outputs,
        samples: baseline.samples.map(({ tick, values, targets }) => ({ tick, values, targets })),
      },
    ],
  });
  assert.ok(trained.loss < 0.01);
  const learned = await trial(trained.model);
  assert.equal(measureDeliveryAttempt(learned).delivered, true);
  const unfamiliar = await trial(trained.model, 0.25);
  assert.equal(measureDeliveryAttempt(unfamiliar).delivered, true);
  const misleading = await trainLearningModel({
    inputs,
    outputs,
    intervals: [
      {
        id: 'stationary',
        attemptId: 'stationary',
        partition: 'train',
        weight: 1,
        inputs,
        outputs,
        samples: baseline.samples.map(({ tick, values }) => ({ tick, values, targets: [0, 0] })),
      },
    ],
  });
  assert.ok(misleading.loss < 0.01, 'stationary demonstrations fit well');
  assert.equal(
    measureDeliveryAttempt(await trial(misleading.model)).delivered,
    false,
    'good training fit cannot certify physical delivery',
  );
  const dropped = structuredClone(learned);
  dropped.samples.at(-1).physics[bp.parts.findIndex((p) => p.id === 'cargo')].position[1] = 0.015;
  assert.equal(measureDeliveryAttempt(dropped).delivered, false);
  const moving = structuredClone(learned);
  moving.samples.at(-1).physics[bp.parts.findIndex((p) => p.id === 'frame')].velocity = [0, 0, 0.5];
  assert.equal(measureDeliveryAttempt(moving).delivered, false);
  const outside = structuredClone(learned);
  for (const id of ['bay-left', 'bay-right'])
    outside.samples.at(-1).physics[bp.parts.findIndex((p) => p.id === id)].position[2] += 1;
  assert.equal(measureDeliveryAttempt(outside).delivered, false);
  const overturned = structuredClone(learned);
  overturned.samples.at(-1).physics[bp.parts.findIndex((p) => p.id === 'frame')].rotation = [
    1, 0, 0, 0,
  ];
  assert.equal(measureDeliveryAttempt(overturned).delivered, false);
  const incomplete = { ...learned, incompleteReason: 'RESYNC_REQUIRED' };
  assert.equal(measureDeliveryAttempt(incomplete).available, false);
});
