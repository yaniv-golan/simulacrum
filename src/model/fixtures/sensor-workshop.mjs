import { createDrivingMachine } from './driving-machine.mjs';
import { createPart, createEmptyBlueprint } from '../blueprint.mjs';
import { snapConnection } from '../assembly.mjs';
import { emptyControllerProgram, editControllerDraft } from '../controller-authoring.mjs';
/** Alternate authored configurations of the same small sensor experiment. */
export function createSensorWorkshop(kind = 'contact') {
  if (kind === 'contactLoad') return createLoadedPad();
  if (!['contact', 'range', 'tilt', 'jointAngle', 'linearMotion'].includes(kind))
    throw Error('Unknown sensor experiment');
  let bp = createDrivingMachine();
  bp.id = 'sensor-' + kind;
  bp.name = 'See, decide, move · ' + kind;
  const face = (part, region, u = 0, v = 0) => ({ part, surface: { region, u, v, twist: 0 } });
  function mount(type, id, a, b, name) {
    const part = createPart(type, id, [0, 1, 0]);
    part.name = name;
    bp.parts.push(part);
    bp = snapConnection(bp, a, b);
    bp.connections.push({ id: 'mount-' + id, kind: 'fixed', a, b });
  }
  mount(
    kind + 'Sensor',
    'sensor',
    face('frame', 'front'),
    face('sensor', 'back'),
    'Watch this sensor',
  );
  mount(
    'logicController',
    'rules',
    face('frame', 'top', -0.07, -0.13),
    face('rules', 'bottom'),
    'Change this rule',
  );
  if (kind === 'jointAngle')
    bp.parts.find((p) => p.id === 'sensor').jointBinding = bp.connections.find(
      (c) =>
        c.kind === 'shaft' && [c.a, c.b].some((e) => e.part === 'left-motor' && e.port === 'shaft'),
    ).id;
  const channel = {
    contact: 'touching',
    range: 'distance',
    tilt: 'tiltX',
    jointAngle: 'angle',
    linearMotion: 'velocityZ',
  }[kind];
  for (const [id, a, ap, b, bpPort] of [
    ['measurement', 'sensor', channel, 'rules', 'input1'],
    ['left-rule', 'rules', 'out1', 'left-control', 'command'],
    ['right-rule', 'rules', 'out2', 'right-control', 'command'],
  ])
    bp.connections.push({
      id,
      kind: 'signal',
      a: { part: a, port: ap },
      b: { part: b, port: bpPort },
    });
  bp.connections.push({
    id: 'sensor-power',
    kind: 'power',
    a: { part: 'cell', port: 'power' },
    b: { part: 'sensor', port: 'power' },
  });
  const trigger =
    kind === 'range'
      ? { operator: '<', threshold: 0.6 }
      : kind === 'contact'
        ? { operator: '>', threshold: 0.5 }
        : { operator: '>', threshold: 0.3 };
  bp.parts.find((p) => p.id === 'rules').controllerProgram = editControllerDraft(
    emptyControllerProgram(),
    {
      type: 'rules',
      rules: [
        {
          input: 'input1',
          ...trigger,
          output: 'out1',
          duty: kind === 'contact' ? 0.25 : 0,
          otherwise: -0.25,
        },
        {
          input: 'input1',
          ...trigger,
          output: 'out2',
          duty: kind === 'contact' ? -0.25 : 0,
          otherwise: 0.25,
        },
      ],
    },
  );
  const barrier = createPart('chassis', 'barrier', [0, 0.02, 1.1]);
  barrier.name = 'Ordinary movable obstacle';
  bp.parts.push(barrier);
  for (let layer = 1; layer <= 2; layer++) {
    const id = 'barrier-' + layer;
    mount(
      'chassis',
      id,
      face(layer === 1 ? 'barrier' : 'barrier-1', 'top'),
      face(id, 'bottom'),
      'Obstacle layer',
    );
  }
  return bp;
}

/** Passive loaded pad: the floor supports the exposed face; the cell rests separately. */
function createLoadedPad() {
  let bp = createEmptyBlueprint('sensor-contactLoad', 'Feel the weight');
  const sensor = createPart('contactSensor', 'sensor', [0, 0.025, 0]);
  sensor.rotation = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  sensor.name = 'Watch normal load';
  const load = createPart('plate', 'load', [0, 0.06, 0]);
  load.name = 'Change my material';
  load.authoredMaterial.body = 'aluminium';
  const cell = createPart('powerCell', 'cell', [0.5, 0.04, 0]);
  cell.name = 'Sensor supply';
  bp.parts = [sensor, load, cell];
  const a = { part: 'load', surface: { region: 'bottom', u: 0, v: 0, twist: 0 } },
    b = { part: 'sensor', surface: { region: 'back', u: 0, v: 0, twist: 0 } };
  bp = snapConnection(bp, a, b);
  bp.connections.push(
    { id: 'pad-load', kind: 'fixed', a, b },
    {
      id: 'sensor-power',
      kind: 'power',
      a: { part: 'cell', port: 'power' },
      b: { part: 'sensor', port: 'power' },
    },
  );
  return bp;
}
