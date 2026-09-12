import { emptyControllerProgram, editControllerDraft } from '../controller-authoring.mjs';
import { measureDelivery } from '../learning-evaluators.mjs';
import { createDrivingMachine } from './driving-machine.mjs';
import { createPart } from '../blueprint.mjs';
import { snapConnection } from '../assembly.mjs';

/** All equipment and loose cargo are ordinary editable authored parts. */
export function createLearningDelivery({ legacy = false, policy = 'learning' } = {}) {
  let bp = createDrivingMachine();
  bp.id = 'learning-delivery';
  bp.name = 'Teach a cargo delivery';
  const face = (part, region, u = 0, v = 0) => ({ part, surface: { region, u, v, twist: 0 } });
  function mount(type, id, target, source, name) {
    const part = createPart(type, id, [0, 1, 0]);
    part.name = name;
    bp.parts.push(part);
    bp = snapConnection(bp, target, face(id, source));
    bp.connections.push({ id: `mount-${id}`, kind: 'fixed', a: target, b: face(id, source) });
  }
  mount(
    legacy ? 'targetSensor' : 'rangeSensor',
    'range-sensor',
    legacy ? face('frame', 'top', 0.08, -0.13) : face('frame', 'front'),
    legacy ? 'bottom' : 'back',
    legacy ? 'Distance to bay' : 'Forward range',
  );
  mount(
    'learningController',
    'learner',
    face('frame', 'top', -0.07, -0.13),
    'bottom',
    'Delivery learner',
  );
  if (!legacy) {
    mount(
      'logicController',
      'baseline',
      face('frame', 'top', 0.07, -0.13),
      'bottom',
      'Delivery rules',
    );
    bp.parts.find((p) => p.id === 'baseline').controllerProgram = editControllerDraft(
      emptyControllerProgram(),
      {
        type: 'rules',
        rules: [
          {
            input: 'input1',
            operator: '<',
            threshold: 0.8,
            output: 'out1',
            duty: 0,
            otherwise: -0.35,
          },
          {
            input: 'input1',
            operator: '<',
            threshold: 0.8,
            output: 'out2',
            duty: 0,
            otherwise: 0.35,
          },
        ],
      },
    );
    const stop = createPart('chassis', 'range-backstop', [0, 0.22, 1.9]);
    stop.name = 'Ordinary bay backstop';
    stop.rotation = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    bp.parts.push(stop);
  }
  const deck = bp.parts.find((p) => p.id === 'cell');
  const cargo = createPart('spacerBlock', 'cargo', [
    deck.position[0],
    deck.position[1] + 0.066,
    deck.position[2],
  ]);
  cargo.name = 'Loose package';
  bp.parts.push(cargo);
  const target = createPart('beam', 'bay-marker', [0, 0.02, 1.8]);
  target.name = 'Loading bay marker';
  bp.parts.push(target);
  // Floor-resting bay rails have real mass and can be pushed; they are not frozen world poses.
  for (const [id, x] of [
    ['bay-left', -0.45],
    ['bay-right', 0.45],
  ]) {
    const rail = createPart('beam', id, [x, 0.02, 1.5]);
    rail.rotation = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    rail.name = id === 'bay-left' ? 'Left bay rail' : 'Right bay rail';
    bp.parts.push(rail);
  }
  if (legacy) bp.parts.find((p) => p.id === 'range-sensor').targetBinding = 'bay-marker';
  const selectedController = policy === 'rules' ? 'baseline' : 'learner';
  for (const [a, ap, b, bpPort] of [
    ['range-sensor', 'distance', 'learner', 'input1'],
    ['range-sensor', legacy ? 'speed' : 'closingSpeed', 'learner', 'input2'],
    [selectedController, 'out1', 'left-control', 'command'],
    [selectedController, 'out2', 'right-control', 'command'],
  ])
    bp.connections.push({
      id: `learn-wire-${bp.connections.length}`,
      kind: 'signal',
      a: { part: a, port: ap },
      b: { part: b, port: bpPort },
    });
  if (!legacy)
    bp.connections.push({
      id: 'baseline-input',
      kind: 'signal',
      a: { part: 'range-sensor', port: 'distance' },
      b: { part: 'baseline', port: 'input1' },
    });
  bp.connections.push({
    id: 'sensor-power',
    kind: 'power',
    a: { part: 'cell', port: 'power' },
    b: { part: 'range-sensor', port: 'power' },
  });
  return bp;
}

/** Historical fixture helper. Generic learning uses an explicitly selected evaluator. */
export const DELIVERY_EVALUATION = {
  version: 1,
  kind: 'delivery',
  obstacles: ['range-backstop'],
  roles: {
    cargo: 'cargo',
    carrier: 'cell',
    vehicle: 'frame',
    marker: 'bay-marker',
    left: 'bay-left',
    right: 'bay-right',
  },
};
export function measureDeliveryAttempt(attempt) {
  return measureDelivery(attempt, DELIVERY_EVALUATION);
}

export const createLegacyLearningDelivery = () => createLearningDelivery({ legacy: true });
