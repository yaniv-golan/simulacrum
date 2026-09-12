import { channelDefinition, SENSOR_DEFINITIONS } from './sensors.mjs';
import { immutableCopy } from './observation.mjs';

const fail = (code = 'INVALID_LEARNING_MODEL') => {
  throw Error(code);
};
const exact = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(',') === keys.split(',').sort().join(',');
const bounded = (v, max = 1e6) => Number.isFinite(v) && Math.abs(v) <= max;
const integer = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
export const LEARNING_LIMITS = Object.freeze({
  inputs: 16,
  outputs: 8,
  neurons: 6,
  intervals: 64,
  samples: 8192,
  epochs: 1200,
  work: 24000000,
});
const channels = { distance: 'm', speed: 'm/s', angularSpeed: 'rad/s' };
function bindings(inputs, outputs) {
  const modern = inputs?.some((i) => i.encoding);
  if (
    !Array.isArray(inputs) ||
    inputs.length < 1 ||
    inputs.length > (modern ? 16 : 4) ||
    !Array.isArray(outputs) ||
    outputs.length < 1 ||
    outputs.length > (modern ? 8 : 2)
  )
    fail();
  if (
    new Set(inputs.map((x) => x.port)).size !== inputs.length ||
    new Set(outputs.map((x) => x.port)).size !== outputs.length
  )
    fail();
  for (const x of inputs) {
    if (modern) {
      const d = channelDefinition(x.kind, x.channel);
      if (
        !exact(x, 'port,kind,channel,unit,scale,frame,encoding') ||
        !/^input([1-9]|1[0-6])$/.test(x.port) ||
        x.encoding !== 'value-status-v1' ||
        x.unit !== d.unit ||
        x.scale !== d.scale ||
        x.frame !== d.frame
      )
        fail();
    } else if (
      !exact(x, 'port,channel,unit,scale') ||
      !/^input[1-4]$/.test(x.port) ||
      channels[x.channel] !== x.unit ||
      x.scale !== { distance: 4, speed: 2, angularSpeed: 20 }[x.channel]
    )
      fail();
  }
  for (const x of outputs)
    if (
      !exact(x, 'port,channel,unit') ||
      !(modern ? /^out[1-8]$/ : /^out[1-2]$/).test(x.port) ||
      x.channel !== 'duty' ||
      x.unit !== 'ratio'
    )
      fail();
}
export function learningFeatureScales(inputs) {
  return inputs.flatMap((i) => (i.encoding === 'value-status-v1' ? [i.scale, 1, 1, 1] : [i.scale]));
}
/** Status features are explicit: [value, ready, no-return, initializing]. Faults abort inference. */
export function learningValues(inputs, readings, nodes = inputs.map((i) => i.node)) {
  const measured = new Map(readings.map((r) => [r.node, r])),
    values = [];
  for (const [index, input] of inputs.entries()) {
    const reading = measured.get(nodes[index]),
      sample = reading?.channels?.[input.channel];
    if (input.encoding === 'value-status-v1') {
      if (!sample || !['ok', 'no-return', 'initializing'].includes(sample.status)) return null;
      values.push(
        sample.status === 'ok' ? sample.value : 0,
        sample.status === 'ok' ? 1 : 0,
        sample.status === 'no-return' ? 1 : 0,
        sample.status === 'initializing' ? 1 : 0,
      );
    } else {
      const value = sample
        ? sample.status === 'ok'
          ? sample.value
          : NaN
        : reading?.valid === false
          ? NaN
          : reading?.[input.channel === 'angularSpeed' ? 'speed' : input.channel];
      if (!bounded(value)) return null;
      values.push(value);
    }
  }
  return values.every((v) => bounded(v)) ? values : null;
}
export function validLearningValues(inputs, values) {
  if (
    !Array.isArray(values) ||
    values.length !== learningFeatureScales(inputs).length ||
    !values.every((v) => bounded(v))
  )
    return false;
  let k = 0;
  for (const input of inputs) {
    if (input.encoding) {
      const v = values.slice(k, k + 4);
      if (
        !v.slice(1).every((x) => x === 0 || x === 1) ||
        v.slice(1).reduce((a, b) => a + b, 0) !== 1 ||
        (!v[1] && v[0] !== 0)
      )
        return false;
      k += 4;
    } else k++;
  }
  return true;
}
/** Exact canonical content, not a collision-prone display digest. Names are separate. */
export function learningIdentity(value) {
  const canonical = (v) =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, canonical(v[k])]),
          )
        : v;
  return JSON.stringify(canonical(immutableCopy(value)));
}
export function admitLearningModel(input) {
  let m;
  try {
    m = immutableCopy(input);
  } catch {
    fail();
  }
  if (
    !exact(m, 'version,inputs,outputs,hidden,weights,scaling') ||
    ![1, 2].includes(m.version) ||
    m.hidden !== 6 ||
    m.scaling !==
      (m.version === 1 ? 'fixed-physical-no-clipping-v1' : 'fixed-physical-status-v2') ||
    m.inputs?.some((i) => Boolean(i.encoding) !== (m.version === 2))
  )
    fail();
  bindings(m.inputs, m.outputs);
  const count =
    m.hidden * (learningFeatureScales(m.inputs).length + 1) + m.outputs.length * (m.hidden + 1);
  if (
    !Array.isArray(m.weights) ||
    m.weights.length !== count ||
    !m.weights.every((x) => bounded(x, 100))
  )
    fail();
  return m;
}
function forward(m, values) {
  if (
    !Array.isArray(values) ||
    values.length !== learningFeatureScales(m.inputs).length ||
    !validLearningValues(m.inputs, values)
  )
    fail('INVALID_LEARNING_INPUT');
  const scales = learningFeatureScales(m.inputs);
  const x = values.map((v, i) => v / scales[i]);
  const hidden = [],
    sums = [];
  let k = 0;
  for (let h = 0; h < m.hidden; h++) {
    let z = m.weights[k++];
    for (const v of x) z += v * m.weights[k++];
    sums.push(z);
    hidden.push(Math.tanh(z));
  }
  const output = [];
  for (let o = 0; o < m.outputs.length; o++) {
    let z = m.weights[k++];
    for (const v of hidden) z += v * m.weights[k++];
    output.push(Math.tanh(z));
  }
  return { inputs: x, sums, hidden, output };
}
export function predictLearningModel(model, values) {
  return forward(admitLearningModel(model), values).output;
}
export function inspectLearningPrediction(model, values) {
  return immutableCopy(forward(admitLearningModel(model), values));
}
/** Whole attempts are split before fitting. Fixed SI scaling uses no sample statistics. */
export function prepareLearningData({ inputs, outputs, intervals }) {
  bindings(inputs, outputs);
  if (!Array.isArray(intervals) || intervals.length > 64) fail('LEARNING_DATA_LIMIT');
  let count = 0;
  const attemptPartitions = new Map();
  const ids = new Set(),
    contents = new Set(),
    eligible = [],
    excluded = [];
  for (const raw of intervals) {
    const r = immutableCopy(raw);
    if (
      !exact(
        r,
        'id,attemptId,partition,weight,inputs,outputs,samples' + (r.capture ? ',capture' : ''),
      ) ||
      typeof r.id !== 'string' ||
      !/^[\w-]{1,80}$/.test(r.id) ||
      ids.has(r.id) ||
      !['train', 'validation', 'test'].includes(r.partition) ||
      !Number.isFinite(r.weight) ||
      r.weight < 0 ||
      r.weight > 100 ||
      !Array.isArray(r.samples) ||
      !r.samples.length
    )
      fail('INVALID_LEARNING_DATA');
    if (typeof r.attemptId !== 'string' || !/^[\w-]{1,80}$/.test(r.attemptId))
      fail('INVALID_LEARNING_DATA');
    if (
      r.capture &&
      (!exact(
        r.capture,
        'version,buildId,blueprintIdentity,controllerId,initialTick,sampling,inputs,outputs',
      ) ||
        r.capture.version !== 1 ||
        !Number.isSafeInteger(r.capture.initialTick) ||
        r.capture.initialTick < 0 ||
        r.capture.sampling !== 'periodic-plus-events-v1' ||
        !['buildId', 'blueprintIdentity', 'controllerId'].every(
          (k) => typeof r.capture[k] === 'string' && r.capture[k].length <= 2000000,
        ) ||
        !Array.isArray(r.capture.inputs) ||
        r.capture.inputs.length !== r.inputs.length ||
        !Array.isArray(r.capture.outputs) ||
        r.capture.outputs.length !== r.outputs.length ||
        !r.capture.inputs.every(
          (endpoint, i) =>
            exact(endpoint, 'port,partId,channel,kind,frame') &&
            typeof endpoint.partId === 'string' &&
            endpoint.partId.length > 0 &&
            endpoint.partId.length <= 80 &&
            endpoint.port === r.inputs[i].port &&
            endpoint.channel === r.inputs[i].channel &&
            endpoint.kind === (r.inputs[i].kind ?? null) &&
            endpoint.frame === (r.inputs[i].frame ?? null),
        ) ||
        !r.capture.outputs.every(
          (endpoint, i) =>
            exact(endpoint, 'port,partId,channel') &&
            typeof endpoint.partId === 'string' &&
            endpoint.partId.length > 0 &&
            endpoint.partId.length <= 80 &&
            endpoint.port === r.outputs[i].port &&
            endpoint.channel === r.outputs[i].channel,
        ))
    )
      fail('INVALID_LEARNING_DATA');
    const priorPartition = attemptPartitions.get(r.attemptId);
    if (priorPartition && priorPartition !== r.partition) fail('MIXED_ATTEMPT_PARTITIONS');
    attemptPartitions.set(r.attemptId, r.partition);
    ids.add(r.id);
    count += r.samples.length;
    if (count > 8192) fail('LEARNING_DATA_LIMIT');
    bindings(r.inputs, r.outputs);
    let previous = -1;
    for (const s of r.samples) {
      if (
        !exact(
          s,
          'tick,values,targets' + (Object.hasOwn(s, 'durationTicks') ? ',durationTicks' : ''),
        ) ||
        (Object.hasOwn(s, 'durationTicks') &&
          (!Number.isSafeInteger(s.durationTicks) ||
            s.durationTicks < 1 ||
            s.durationTicks > 120)) ||
        !Number.isSafeInteger(s.tick) ||
        s.tick <= previous ||
        !Array.isArray(s.values) ||
        s.values.length !== learningFeatureScales(r.inputs).length ||
        !validLearningValues(r.inputs, s.values) ||
        !Array.isArray(s.targets) ||
        s.targets.length !== r.outputs.length ||
        !s.targets.every((v) => bounded(v, 1))
      )
        fail('INVALID_LEARNING_DATA');
      previous = s.tick;
    }
    // Excluding IDs and timing also catches a copied interval with rewritten timestamps.
    const content = learningIdentity({
      inputs: r.inputs,
      outputs: r.outputs,
      samples: r.samples.map((s) => [s.values, s.targets]),
    });
    if (contents.has(content)) fail('DUPLICATE_LEARNING_INTERVAL');
    contents.add(content);
    if (
      learningIdentity(r.inputs) !== learningIdentity(inputs) ||
      learningIdentity(r.outputs) !== learningIdentity(outputs)
    ) {
      excluded.push({
        id: r.id,
        reason: 'INCOMPATIBLE_INPUTS',
        missing: inputs
          .filter((i) => !r.inputs.some((old) => learningIdentity(old) === learningIdentity(i)))
          .map((i) => i.channel),
        outputsChanged: learningIdentity(r.outputs) !== learningIdentity(outputs),
      });
      continue;
    }
    if (r.partition === 'train' && r.weight > 0) eligible.push(r);
  }
  const total = eligible.reduce((s, r) => s + r.weight, 0);
  return immutableCopy({
    samples: eligible.flatMap((r) =>
      r.samples.map((s) => ({
        ...s,
        weight:
          ((r.weight / total) * (s.durationTicks ?? 1)) /
          r.samples.reduce((sum, row) => sum + (row.durationTicks ?? 1), 0),
      })),
    ),
    contributions: eligible.map((r) => ({
      id: r.id,
      samples: r.samples.length,
      seconds: (r.samples.at(-1).tick - r.samples[0].tick) / 120,
      weight: r.weight / total,
    })),
    excluded,
    trainingIdentity: learningIdentity(eligible),
  });
}
/** Bounded full-batch gradient descent. The caller yields between epochs off the simulation clock. */
export async function trainLearningModel({
  inputs,
  outputs,
  intervals,
  seed = 19,
  epochs = 600,
  learningRate = 0.15,
  cancelled = () => false,
  yieldWork = async () => {},
  onProgress = () => {},
}) {
  const data = prepareLearningData({ inputs, outputs, intervals });
  const n = learningFeatureScales(inputs).length,
    h = 6,
    o = outputs.length,
    size = h * (n + 1) + o * (h + 1);
  if (
    !integer(seed, 0, 0xffffffff) ||
    !integer(epochs, 1, 1200) ||
    !Number.isFinite(learningRate) ||
    learningRate <= 0 ||
    learningRate > 0.5 ||
    size * data.samples.length * epochs > LEARNING_LIMITS.work
  )
    fail('LEARNING_TRAINING_LIMIT');
  if (!data.samples.length) fail('NO_COMPLETE_TEACHING_EXAMPLES');
  let randomState = seed;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const m = structuredClone(
    admitLearningModel({
      version: inputs.some((i) => i.encoding) ? 2 : 1,
      inputs,
      outputs,
      hidden: h,
      scaling: inputs.some((i) => i.encoding)
        ? 'fixed-physical-status-v2'
        : 'fixed-physical-no-clipping-v1',
      weights: Array.from({ length: size }, () => (random() - 0.5) * 1.2),
    }),
  );
  let loss = 0;
  for (let epoch = 0; epoch < epochs; epoch++) {
    if (cancelled()) fail('LEARNING_CANCELLED');
    const gradient = Array(size).fill(0);
    loss = 0;
    for (const sample of data.samples) {
      const f = forward(m, sample.values),
        delta = f.output.map(
          (v, j) => (2 * (v - sample.targets[j]) * (1 - v * v) * sample.weight) / o,
        );
      loss +=
        (f.output.reduce((s, v, j) => s + (v - sample.targets[j]) ** 2, 0) * sample.weight) / o;
      const offset = h * (n + 1);
      for (let j = 0; j < o; j++) {
        gradient[offset + j * (h + 1)] += delta[j];
        for (let a = 0; a < h; a++)
          gradient[offset + j * (h + 1) + a + 1] += delta[j] * f.hidden[a];
      }
      for (let a = 0; a < h; a++) {
        const d =
          delta.reduce((s, v, j) => s + v * m.weights[offset + j * (h + 1) + a + 1], 0) *
          (1 - f.hidden[a] ** 2);
        gradient[a * (n + 1)] += d;
        for (let i = 0; i < n; i++) gradient[a * (n + 1) + i + 1] += d * f.inputs[i];
      }
    }
    for (let k = 0; k < size; k++) {
      m.weights[k] -= learningRate * gradient[k];
      if (!bounded(m.weights[k], 100)) fail('LEARNING_DIVERGED');
    }
    if (epoch % 8 === 0 || epoch === epochs - 1) {
      onProgress({ completed: epoch + 1, total: epochs, loss });
      await yieldWork();
    }
  }
  if (cancelled()) fail('LEARNING_CANCELLED');
  loss = data.samples.reduce(
    (sum, s) =>
      sum +
      (forward(m, s.values).output.reduce((v, y, j) => v + (y - s.targets[j]) ** 2, 0) * s.weight) /
        o,
    0,
  );
  return immutableCopy({
    model: admitLearningModel(m),
    loss,
    seed,
    epochs,
    learningRate,
    trainingIdentity: data.trainingIdentity,
    contributions: data.contributions,
  });
}

export const LEARNING_MODEL_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['version', 'inputs', 'outputs', 'hidden', 'weights', 'scaling'],
  properties: {
    version: { enum: [1, 2] },
    hidden: { const: 6 },
    scaling: { enum: ['fixed-physical-no-clipping-v1', 'fixed-physical-status-v2'] },
    inputs: {
      type: 'array',
      minItems: 1,
      maxItems: 16,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['port', 'channel', 'unit', 'scale'],
        properties: {
          port: { type: 'string', pattern: '^input([1-9]|1[0-6])$' },
          kind: { enum: Object.keys(SENSOR_DEFINITIONS) },
          frame: {
            enum: [
              ...new Set(
                Object.values(SENSOR_DEFINITIONS).flatMap((d) =>
                  Object.values(d).map((c) => c.frame),
                ),
              ),
            ],
          },
          encoding: { const: 'value-status-v1' },
          channel: {
            enum: [...new Set(Object.values(SENSOR_DEFINITIONS).flatMap((d) => Object.keys(d)))],
          },
          unit: { enum: ['m', 'm/s', 'rad/s', 'rad', 'boolean', 'N'] },
          scale: { type: 'number', exclusiveMinimum: 0, maximum: 1000 },
        },
      },
    },
    outputs: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['port', 'channel', 'unit'],
        properties: {
          port: { type: 'string', pattern: '^out[1-8]$' },
          channel: { const: 'duty' },
          unit: { const: 'ratio' },
        },
      },
    },
    weights: {
      type: 'array',
      minItems: 19,
      maxItems: 446,
      items: { type: 'number', minimum: -100, maximum: 100 },
    },
  },
});
