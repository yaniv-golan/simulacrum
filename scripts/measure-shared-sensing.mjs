import { createSession } from '../src/simulation/session.mjs';
import { SENSOR_LIMITS, SENSOR_SUPPLY, channelDefinition } from '../src/model/sensors.mjs';
import { LEARNING_LIMITS } from '../src/model/learning-model.mjs';
import { sourceIdentity } from './source-identity.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const identity = sourceIdentity();
const body = {
  shape: 'box',
  position: [0, 1, 0],
  velocity: [0, 0, 0],
  mass: 1,
  halfExtents: [0.025, 0.015, 0.025],
  fixed: true,
  rotation: [0, 0, 0, 1],
  friction: 0.5,
  restitution: 0,
};
function configuration(kind, count, total, learners = 0) {
  const bodies = Array.from({ length: total }, (_, i) => ({
    ...body,
    position: [(i % 16) * 0.2, 1 + Math.floor(i / 16) * 0.2, 0],
  }));
  const sensors = Array.from({ length: count }, (_, node) => ({
    node,
    body: node,
    ...(kind === 'rotation' ? {} : { kind }),
    supply: SENSOR_SUPPLY,
    ...(kind === 'range' ? { origin: [0, 0, 0.025], axis: [0, 0, 1], range: 10 } : {}),
    ...(kind === 'contact'
      ? { origin: [0, 0, 0.025], axis: [0, 0, 1], halfWidth: 0.025, halfHeight: 0.015 }
      : {}),
    ...(kind === 'rotation' ? { axis: [1, 0, 0] } : {}),
  }));
  const cell = count,
    controllers = [],
    receivers = [],
    signalWires = [];
  if (kind === 'contact') {
    sensors.forEach((s, i) => {
      bodies[i] = {
        ...body,
        fixed: false,
        position: [i * 0.1, 0.025, 0],
        rotation: [Math.SQRT1_2, 0, 0, Math.SQRT1_2],
      };
    });
    bodies[total - 1] = { ...body, position: [3, -0.1, 0], halfExtents: [10, 0.1, 10] };
  }
  for (let c = 0; c < learners; c++) {
    const node = count + 1 + c * (LEARNING_LIMITS.outputs + 1);
    const channel = kind === 'range' ? 'distance' : 'angularSpeed',
      d = channelDefinition(kind, channel);
    const inputs = Array.from({ length: 16 }, (_, i) => ({
      port: 'input' + (i + 1),
      node: i,
      kind,
      channel,
      unit: d.unit,
      scale: d.scale,
      frame: d.frame,
      encoding: 'value-status-v1',
    }));
    const outputs = Array.from({ length: 8 }, (_, i) => ({
      port: 'out' + (i + 1),
      node: node + 1 + i,
      channel: 'duty',
      unit: 'ratio',
    }));
    const strip = ({ node, ...rest }) => rest;
    const model = {
      version: 2,
      hidden: 6,
      scaling: 'fixed-physical-status-v2',
      inputs: inputs.map(strip),
      outputs: outputs.map(strip),
      weights: Array(6 * (16 * 4 + 1) + 8 * 7).fill(0.01),
    };
    controllers.push({ node, duty: 0, learning: { inputs, outputs, model } });
    for (const i of inputs) signalWires.push([i.node, node]);
    for (const o of outputs) {
      receivers.push({ node: o.node, duty: 0 });
      signalWires.push([node, o.node]);
    }
  }
  return {
    gravity: kind === 'contact' ? [0, -9.81, 0] : [0, 0, 0],
    bodies,
    joints: [],
    power: {
      cells: [
        {
          node: cell,
          voltage: 12,
          capacityJ: 1e6,
          initialJ: 1e6,
          resistance: 0.1,
          currentLimit: 20,
        },
      ],
      sensors,
      motors: [],
      controllers,
      receivers,
      signalWires,
      wires: sensors.map((s) => [cell, s.node]),
    },
  };
}
const cases = [];
for (const [name, kind, count, total, learners] of [
  ['maximum-ray-work', 'range', 64, Math.floor(SENSOR_LIMITS.rayTests / 64), 0],
  ['64-loaded-contact-pads', 'contact', 64, 66, 0],
  ['one-maximum-model', 'rotation', 16, 26, 1],
  ['eight-maximum-models', 'rotation', 16, 90, 8],
  ['combined-query-and-model-limits', 'range', 32, 256, 8],
]) {
  const session = await createSession(configuration(kind, count, total, learners));
  try {
    session.step(120);
    const samples = [];
    for (let tick = 0; tick < 300; tick++) {
      session.step();
      samples.push(session.observe().frames[0].phaseTimings);
    }
    const stats = Object.fromEntries(
      Object.keys(samples[0]).map((phase) => {
        const values = samples.map((s) => s[phase]).sort((a, b) => a - b);
        return [phase, { p95: values[Math.ceil(values.length * 0.95) - 1], max: values.at(-1) }];
      }),
    );
    cases.push({
      name,
      kind,
      count,
      bodies: total,
      rayTests: kind === 'range' ? count * total : 0,
      learners,
      stats,
      samples,
    });
    console.log(name, JSON.stringify(stats));
  } finally {
    session.dispose();
  }
}
mkdirSync('artifacts', { recursive: true });
writeFileSync(
  'artifacts/shared-sensing-phase-timings.json',
  JSON.stringify(
    {
      source: identity,
      runtime: process.version,
      limits: SENSOR_LIMITS,
      modelLimits: LEARNING_LIMITS,
      cases,
    },
    null,
    2,
  ),
);
