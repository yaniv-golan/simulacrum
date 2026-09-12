import {
  learningIdentity,
  prepareLearningData,
  predictLearningModel,
  learningFeatureScales,
} from './learning-model.mjs';
import { immutableCopy } from './observation.mjs';
const compatible = (r, inputs, outputs) =>
  learningIdentity(r.inputs) === learningIdentity(inputs) &&
  learningIdentity(r.outputs) === learningIdentity(outputs);
/** Evaluation never fits preprocessing or feeds measurements back into training. */
export function evaluateLearningModel(model, intervals) {
  prepareLearningData({ inputs: model.inputs, outputs: model.outputs, intervals });
  const result = {};
  for (const partition of ['train', 'validation', 'test']) {
    const rows = intervals.filter(
      (r) =>
        r.partition === partition && r.weight > 0 && compatible(r, model.inputs, model.outputs),
    );
    const total = rows.reduce((s, r) => s + r.weight, 0);
    result[partition] = !rows.length
      ? null
      : {
          intervals: rows.length,
          samples: rows.reduce((s, r) => s + r.samples.length, 0),
          loss: rows.reduce(
            (sum, r) =>
              sum +
              ((r.weight / total) *
                r.samples.reduce(
                  (v, s) =>
                    v +
                    predictLearningModel(model, s.values).reduce(
                      (q, p, i) => q + (p - s.targets[i]) ** 2,
                      0,
                    ) /
                      model.outputs.length,
                  0,
                )) /
                r.samples.length,
            0,
          ),
        };
  }
  return immutableCopy(result);
}
/** Distances and conflicts use every declared input, never a two-axis projection. */
export function inspectLearningMoment({ model, inputs, outputs, values, intervals }) {
  prepareLearningData({ inputs, outputs, intervals });
  const rows = intervals
    .filter((r) => r.partition === 'train' && r.weight > 0 && compatible(r, inputs, outputs))
    .flatMap((r) =>
      r.samples.map((s, index) => ({
        intervalId: r.id,
        index,
        values: s.values,
        targets: s.targets,
        distance: Math.hypot(
          ...s.values.map((v, i) => (v - values[i]) / learningFeatureScales(inputs)[i]),
        ),
        prediction: model ? predictLearningModel(model, s.values) : null,
      })),
    );
  rows.sort(
    (a, b) =>
      a.distance - b.distance || a.intervalId.localeCompare(b.intervalId) || a.index - b.index,
  );
  const nearest = rows.slice(0, 5),
    exact = rows.filter((r) => r.distance < 1e-6);
  const conflicts = exact.some((a) =>
    exact.some((b) => a.targets.some((v, i) => Math.abs(v - b.targets[i]) > 0.1)),
  );
  return immutableCopy({
    prediction: model ? predictLearningModel(model, values) : null,
    nearby: nearest,
    conflicts,
    nearestDistance: nearest[0]?.distance ?? null,
    coverage: nearest.length
      ? 'Nearest-example distance in fixed scaled units; proximity is not confidence or a cause.'
      : 'No compatible training examples. Record this region.',
  });
}
export function compareLearningAttempts(a, b) {
  const strip = (attempt) => ({
    ...attempt.blueprint,
    parts: attempt.blueprint.parts.map(({ learningModel, ...p }) =>
      p.id === attempt.controller ? p : { ...p, ...(learningModel ? { learningModel } : {}) },
    ),
  });
  const changes = [];
  const left = strip(a),
    right = strip(b);
  for (const id of new Set([...left.parts, ...right.parts].map((p) => p.id)))
    if (
      learningIdentity(left.parts.find((p) => p.id === id) ?? null) !==
      learningIdentity(right.parts.find((p) => p.id === id) ?? null)
    )
      changes.push(`Part ${id} changed`);
  if (learningIdentity(left.connections) !== learningIdentity(right.connections))
    changes.push('Connections changed');
  for (const key of new Set([...Object.keys(left), ...Object.keys(right)]))
    if (
      !['parts', 'connections'].includes(key) &&
      learningIdentity(left[key] ?? null) !== learningIdentity(right[key] ?? null)
    )
      changes.push(`${key} changed`);
  const summarize = (x) => ({
    id: x.id,
    run: x.training?.id ?? null,
    modelIdentity: x.model ? learningIdentity(x.model) : null,
    seconds: (x.samples.at(-1)?.tick ?? 0) / 120,
    manualSamples: x.samples.filter((s) => s.modes.includes('manual')).length,
    outcome: x.evaluation?.outcome ?? {
      available: false,
      reason: 'No experiment evaluation was recorded.',
    },
  });
  return immutableCopy({
    sameStart: learningIdentity(left) === learningIdentity(right),
    sameModel: learningIdentity(a.model) === learningIdentity(b.model),
    changes,
    first: summarize(a),
    second: summarize(b),
  });
}
