import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyBlueprint,
  createPart,
  loadSave,
  validateBlueprint,
} from '../src/model/blueprint.mjs';
import * as controls from '../src/model/control-bindings.mjs';
const evaluate = (...args) => controls.evaluateControlBinding(...args);
const preset = (name) => controls.controlBindingPreset(name);

test('drive and steer presets route physical key codes independently and cancel opposing keys', () => {
  assert.equal(evaluate(preset('drive'), new Set(['KeyW'])).duty, 1);
  assert.equal(evaluate(preset('drive'), ['ArrowDown']).duty, -1);
  assert.equal(evaluate(preset('drive'), ['KeyA']).duty, 0);
  assert.equal(evaluate(preset('steer'), ['KeyD']).duty, 1);
  assert.equal(evaluate(preset('steer'), ['ArrowLeft']).duty, -1);
  assert.equal(evaluate(preset('drive'), ['KeyW', 'ArrowDown']).duty, 0);
  assert.equal(evaluate(preset('drive'), ['KeyW', 'ArrowUp']).duty, 1);
  assert.equal(evaluate(undefined, ['ArrowUp']).duty, 1);
});

test('mixed gains, inversion and saturation derive duties without part identity', () => {
  assert.equal(evaluate(preset('leftDrive'), ['KeyW', 'KeyD']).duty, 1);
  assert.equal(evaluate(preset('rightDrive'), ['KeyW', 'KeyD']).duty, 0);
  assert.equal(evaluate(preset('leftDrive'), ['KeyD']).duty, 1);
  assert.equal(evaluate(preset('rightDrive'), ['KeyD']).duty, -1);
  const binding = preset('drive');
  binding.drive.gain = -0.4;
  binding.steer.gain = 0.25;
  assert.ok(Math.abs(evaluate(binding, ['KeyW', 'KeyD']).duty + 0.15) < 1e-12);
});

test('custom keys replace presets and summary reflects authored codes and gains', () => {
  const binding = preset('custom');
  binding.drive.positiveKeys = ['Digit1'];
  binding.drive.negativeKeys = ['KeyQ'];
  binding.drive.gain = -0.5;
  assert.equal(evaluate(binding, ['KeyW', 'ArrowUp']).duty, 0);
  assert.equal(evaluate(binding, ['Digit1']).duty, -0.5);
  assert.equal(evaluate(binding, ['KeyQ']).duty, 0.5);
  const summary = controls.controlBindingSummary(binding);
  for (const label of ['1', 'Q', '-0.5', 'hold']) assert.ok(summary.includes(label), summary);
  assert.ok(!controls.CONTROL_KEYS.includes('KeyF'));
  assert.ok(!controls.CONTROL_KEYS.includes('KeyP'));
  assert.ok(!controls.CONTROL_KEYS.includes('Space'));
});

test('toggle reacts once per press, holds after release, reverses and toggles off', () => {
  const binding = preset('drive');
  binding.mode = 'toggle';
  let step = evaluate(binding, ['KeyW']);
  assert.equal(step.duty, 1);
  step = evaluate(binding, ['KeyW'], step.state);
  assert.equal(step.duty, 1);
  step = evaluate(binding, [], step.state);
  assert.equal(step.duty, 1);
  step = evaluate(binding, ['KeyW'], step.state);
  assert.equal(step.duty, 0);
  step = evaluate(binding, [], step.state);
  step = evaluate(binding, ['KeyS'], step.state);
  assert.equal(step.duty, -1);
  step = evaluate(binding, ['KeyW', 'KeyS'], step.state);
  assert.equal(step.duty, 0);
  assert.equal(evaluate(binding, []).duty, 0, 'fresh state resets latched output');
});

test('binding evaluation and preset construction do not mutate authored or previous state', () => {
  const binding = preset('leftDrive');
  binding.mode = 'toggle';
  const previous = evaluate(binding, ['KeyW']).state;
  const snapshot = structuredClone({ binding, previous });
  evaluate(binding, ['KeyD'], previous);
  assert.deepEqual({ binding, previous }, snapshot);
  binding.drive.positiveKeys.push('KeyQ');
  assert.ok(!preset('leftDrive').drive.positiveKeys.includes('KeyQ'));
  assert.ok(Object.isFrozen(controls.DEFAULT_CONTROL_BINDING.drive.positiveKeys));
});

test('strict binding schema admits receiver metadata and preserves custom settings through load', () => {
  const bp = createEmptyBlueprint('bindings', 'Bindings');
  bp.parts.push(createPart('commandReceiver', 'receiver', [0, 1, 0]));
  assert.equal(validateBlueprint(bp).ok, true, 'omitted binding uses the canonical default');
  bp.parts[0].controlBinding = preset('rightDrive');
  assert.equal(validateBlueprint(bp).ok, true);
  assert.deepEqual(loadSave(JSON.stringify(bp)).blueprint, bp);
  bp.parts[0] = {
    ...createPart('poweredMotor', 'motor', [0, 1, 0]),
    controlBinding: preset('drive'),
  };
  assert.equal(
    validateBlueprint(bp).ok,
    false,
    'other component types cannot carry receiver bindings',
  );
});

test('strict binding schema rejects unknown fields, key codes, missing members and nonfinite gains', () => {
  const bp = createEmptyBlueprint('bindings', 'Bindings');
  bp.parts.push(createPart('commandReceiver', 'receiver', [0, 1, 0]));
  bp.parts[0].controlBinding = preset('drive');
  assert.equal(validateBlueprint(bp).ok, true, 'positive control for schema admission');
  const mutations = [
    (b) => {
      b.extra = true;
    },
    (b) => {
      b.mode = 'pulse';
    },
    (b) => {
      delete b.steer;
    },
    (b) => {
      b.drive.gain = 1.01;
    },
    (b) => {
      b.drive.gain = NaN;
    },
    (b) => {
      b.drive.positiveKeys = ['KeyF'];
    },
    (b) => {
      b.drive.positiveKeys = ['w'];
    },
    (b) => {
      b.drive.positiveKeys = ['KeyW', 'KeyW'];
    },
    (b) => {
      b.drive.name = 'vehicle';
    },
    (b) => {
      b.drive.gain = '1';
    },
  ];
  for (const mutate of mutations) {
    const wrong = structuredClone(bp);
    mutate(wrong.parts[0].controlBinding);
    assert.equal(validateBlueprint(wrong).ok, false, mutate.toString());
  }
});

test('one-way custom actions admit empty negative keys and disabled axes admit no keys', () => {
  const bp = createEmptyBlueprint('oneway', 'One way');
  const part = createPart('commandReceiver', 'receiver', [0, 1, 0]);
  part.controlBinding = preset('custom');
  assert.deepEqual(part.controlBinding.drive.negativeKeys, []);
  part.controlBinding.steer.positiveKeys = [];
  part.controlBinding.steer.negativeKeys = [];
  bp.parts.push(part);
  assert.equal(validateBlueprint(bp).ok, true);
  assert.equal(evaluate(part.controlBinding, ['KeyI']).duty, 1);
  assert.equal(evaluate(part.controlBinding, ['KeyK']).duty, 0);
  part.controlBinding.drive.positiveKeys = [];
  assert.equal(validateBlueprint(bp).ok, true);
  assert.equal(evaluate(part.controlBinding, ['KeyI']).duty, 0);
});
