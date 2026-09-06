import test from 'node:test';
import assert from 'node:assert/strict';
import { createControllerDispatcher } from '../src/simulation/controllers.mjs';
const configuration = {
  controllers: [{ node: 1, duty: 0 }],
  sensors: [
    { node: 2, joint: 0 },
    { node: 3, joint: 1 },
  ],
  receivers: [
    { node: 4, duty: 0 },
    { node: 5, duty: 0 },
  ],
  signalWires: [
    [2, 1],
    [1, 4],
  ],
};
const snapshot = {
  tick: 10,
  readings: [
    { node: 2, speed: 3 },
    { node: 3, speed: 99 },
  ],
};
test('program receives only copied declared previous snapshot inputs', () => {
  let retained;
  const dispatcher = createControllerDispatcher(configuration, [
    {
      node: 1,
      run: (view) => {
        retained = view;
        assert.deepEqual(view, { tick: 10, inputs: [{ node: 2, speed: 3 }] });
        assert.equal(view.bodies, undefined);
        assert.equal(view.metadata, undefined);
        return [{ node: 4, duty: 0.5 }];
      },
    },
  ]);
  const source = structuredClone(snapshot);
  assert.deepEqual(dispatcher.run(source), [{ node: 4, duty: 0.5 }]);
  source.readings[0].speed = 1000;
  assert.equal(retained.inputs[0].speed, 3);
  assert.throws(() => {
    retained.inputs[0].speed = 1000;
  });
  assert.ok(Object.isFrozen(retained.inputs));
});
test('reading snapshot and mutating configuration cannot grant a new input or output', () => {
  const config = structuredClone(configuration),
    dispatcher = createControllerDispatcher(config, [
      {
        node: 1,
        run: (view) => {
          assert.equal(
            view.inputs.some((input) => input.node === 3),
            false,
          );
          return [{ node: 5, duty: 1 }];
        },
      },
    ]);
  config.signalWires.push([3, 1], [1, 5]);
  assert.throws(() => dispatcher.run(snapshot), /INVALID_CONTROLLER_OUTPUT/);
});
test('malformed duplicate nonfinite and undeclared outputs reject', () => {
  for (const output of [
    [{ node: 4, duty: 2 }],
    [{ node: 4, duty: NaN }],
    [{ node: 4, duty: 0, pose: [] }],
    [
      { node: 4, duty: 0 },
      { node: 4, duty: 1 },
    ],
    [{ node: 99, duty: 0 }],
    { node: 4, duty: 0 },
    Promise.resolve([]),
  ]) {
    const dispatcher = createControllerDispatcher(configuration, [{ node: 1, run: () => output }]);
    assert.throws(() => dispatcher.run(snapshot), /INVALID_CONTROLLER_OUTPUT/);
  }
});
test('unregistered or duplicate programs and invalid snapshots reject', () => {
  assert.throws(() => createControllerDispatcher(configuration, [{ node: 99, run: () => [] }]));
  assert.throws(() =>
    createControllerDispatcher(configuration, [
      { node: 1, run: () => [] },
      { node: 1, run: () => [] },
    ]),
  );
  const dispatcher = createControllerDispatcher(configuration, [{ node: 1, run: () => [] }]);
  assert.throws(() => dispatcher.run({ tick: 10, readings: [] }));
  assert.throws(() => dispatcher.run({ ...snapshot, bodies: [] }));
  assert.throws(() => dispatcher.run({ ...snapshot, tick: NaN }));
  assert.throws(() =>
    dispatcher.run({ ...snapshot, readings: [snapshot.readings[0], snapshot.readings[0]] }),
  );
  assert.deepEqual(dispatcher.run(snapshot), []);
});
test('callback this binding cannot expose or mutate dispatcher authority', () => {
  const dispatcher = createControllerDispatcher(configuration, [
    {
      node: 1,
      run: function (view) {
        assert.equal(this, undefined);
        return [{ node: 4, duty: 0 }];
      },
    },
  ]);
  assert.deepEqual(dispatcher.run(snapshot), [{ node: 4, duty: 0 }]);
});
