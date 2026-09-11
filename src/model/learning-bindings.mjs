import { channelDefinition } from './sensors.mjs';
import { immutableCopy } from './observation.mjs';
import { admitLearningModel, learningIdentity } from './learning-model.mjs';
const fail = () => {
  throw Error('INVALID_CONTROLLER_CONFIGURATION');
};
const exact = (v, keys) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(',') === keys.split(',').sort().join(',');
export function admitLearningBindings(power) {
  const config = immutableCopy({
      controllers: power.controllers.map(({ node, learning }) => ({
        node,
        ...(learning ? { learning } : {}),
      })),
      sensors: power.sensors.map(({ node, kind }) => ({ node, ...(kind ? { kind } : {}) })),
      receivers: power.receivers.map(({ node }) => ({ node })),
      signalWires: power.signalWires,
    }),
    written = new Set();
  const policies = config.controllers
    .filter((c) => c.learning)
    .map((c) => {
      const l = c.learning;
      if (
        !exact(l, 'model,inputs,outputs') ||
        !Array.isArray(l.inputs) ||
        l.inputs.length > 16 ||
        !Array.isArray(l.outputs) ||
        l.outputs.length > 8 ||
        new Set(l.inputs.map((i) => i.port)).size !== l.inputs.length ||
        new Set(l.outputs.map((i) => i.port)).size !== l.outputs.length
      )
        fail();
      for (const i of l.inputs) {
        const sensor = config.sensors.find((s) => s.node === i.node);
        if (
          !exact(i, 'port,node,channel,unit,scale' + (i.encoding ? ',kind,frame,encoding' : '')) ||
          !/^input([1-9]|1[0-6])$/.test(i.port) ||
          !sensor ||
          !config.signalWires.some((e) => e[0] === i.node && e[1] === c.node) ||
          (i.encoding &&
            (i.kind !== (sensor.kind ?? 'rotation') ||
              i.frame !== channelDefinition(sensor.kind, i.channel).frame ||
              i.encoding !== 'value-status-v1')) ||
          i.unit !== channelDefinition(sensor.kind, i.channel).unit ||
          i.scale !== channelDefinition(sensor.kind, i.channel).scale
        )
          fail();
      }
      for (const o of l.outputs) {
        if (
          !exact(o, 'port,node,channel,unit') ||
          !/^out[1-8]$/.test(o.port) ||
          o.channel !== 'duty' ||
          o.unit !== 'ratio' ||
          written.has(o.node) ||
          !config.receivers.some((r) => r.node === o.node) ||
          !config.signalWires.some((e) => e[0] === c.node && e[1] === o.node)
        )
          fail();
        written.add(o.node);
      }
      const definitions = (list) => list.map(({ node, ...rest }) => rest);
      if (l.model !== null) {
        admitLearningModel(l.model);
        if (
          learningIdentity(l.model.inputs) !== learningIdentity(definitions(l.inputs)) ||
          learningIdentity(l.model.outputs) !== learningIdentity(definitions(l.outputs))
        )
          fail();
      }
      return l;
    });
  return immutableCopy(policies);
}
