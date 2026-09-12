import { SENSOR_DEFINITIONS } from './sensors.mjs';
import { immutableCopy } from './observation.mjs';
/** Read one completed decision. No prediction, resampling or authority is added here. */
export function controllerDecision(frame, id) {
  const bp = frame.metadata.blueprint,
    node = bp.parts.findIndex((p) => p.id === id);
  const part = bp.parts[node];
  if (!['logicController', 'learningController'].includes(part?.type)) return null;
  const program = frame.programs?.find((p) => p.node === node);
  const inputs = [],
    outputs = [];
  for (const edge of bp.connections.filter((c) => c.kind === 'signal')) {
    const own = [edge.a, edge.b].find((e) => e.part === id);
    if (!own) continue;
    const other = own === edge.a ? edge.b : edge.a;
    const otherNode = bp.parts.findIndex((p) => p.id === other.part),
      target = bp.parts[otherNode];
    if (own.port.startsWith('input') || own.port === 'signal') {
      const kind = target?.type.slice(0, -6);
      const channel =
        other.port === 'signal' ? (kind === 'rotation' ? 'angularSpeed' : 'length') : other.port;
      const reading = frame.sensors.readings.find((r) => r.node === otherNode)?.channels?.[channel];
      inputs.push({
        port: own.port,
        partId: other.part,
        name: target?.name ?? other.part,
        channel,
        kind,
        unit: SENSOR_DEFINITIONS[target?.type.slice(0, -6)]?.[channel]?.unit ?? '',
        status: reading?.status ?? 'disconnected',
        ...(reading?.status === 'ok' ? { value: reading.value } : {}),
      });
    } else if (own.port.startsWith('out')) {
      const receiver = frame.receiverControl.receivers.find((r) => r.node === otherNode);
      outputs.push({
        port: own.port,
        partId: other.part,
        name: target?.name ?? other.part,
        requested: program?.requested[Number(own.port.slice(3) || 1) - 1] ?? null,
        applied: receiver?.duty ?? null,
        owner: receiver?.mode ?? 'unavailable',
        reason: receiver?.reason ?? 'unavailable',
      });
    }
  }
  return immutableCopy({
    tick: frame.tick,
    sampleTick: frame.sensors.tick,
    controller: id,
    blueprint: bp.id,
    source: part.controllerProgram?.source ?? null,
    inputs,
    outputs,
    markers: program?.markers ?? [],
    error: program?.error ?? null,
  });
}
