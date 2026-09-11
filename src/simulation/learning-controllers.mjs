import { immutableCopy } from '../model/observation.mjs';
import { predictLearningModel, learningValues } from '../model/learning-model.mjs';
import { admitLearningBindings } from '../model/learning-bindings.mjs';
export function createLearningDispatcher(power) {
  const policies = admitLearningBindings(power);
  return Object.freeze({
    run(readings) {
      const measured = new Map(readings.map((r) => [r.node, r]));
      return immutableCopy(
        policies.flatMap((l) => {
          if (!l.model) return [];
          const values = learningValues(l.inputs, readings);
          if (!values) return l.outputs.map((o) => ({ node: o.node, duty: 0, valid: false }));
          const demand = predictLearningModel(l.model, values);
          return l.outputs.map((o, i) => ({ node: o.node, duty: demand[i], valid: true }));
        }),
      );
    },
  });
}
/** A paired sensor measures centre-to-centre distance and radial approach speed.
 * Its explicit target binding is the sole target authority; it does not sense obstacles.
 */
export function targetReading(sensor, bodies) {
  const a = bodies[sensor.body],
    b = bodies[sensor.target];
  if (!b) return { node: sensor.node, valid: false, distance: 0, speed: 0 };
  const delta = b.position.map((v, i) => v - a.position[i]),
    distance = Math.hypot(...delta);
  const speed =
    distance > 1e-12
      ? delta.reduce((s, v, i) => s + v * (a.velocity[i] - b.velocity[i]), 0) / distance
      : 0;
  return { node: sensor.node, valid: distance <= sensor.range, distance, speed };
}
