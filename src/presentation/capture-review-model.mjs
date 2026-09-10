import { partPrimitives } from '../model/geometry.mjs';
import { CATALOG } from '../model/catalog.mjs';
import { environmentObstacles } from '../model/environment.mjs';
export const safeMedia = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]+\.(webm|mp4|png)$/.test(value);
export function reviewTimeline(decoded) {
  const events = decoded.events ?? [];
  if (events.length > 100000) throw Error('Review event limit exceeded');
  const samples = events
    .filter(
      (e) =>
        (e.context?.observation || typeof e.available === 'boolean') &&
        Number.isFinite(e.timeMs) &&
        e.timeMs >= 0,
    )
    .sort((a, b) => a.timeMs - b.timeMs);
  return {
    events,
    samples,
    status: decoded.status ?? 'legacy / completeness unknown',
    gaps: decoded.gaps ?? [],
    duration: Math.max(0, ...events.map((e) => (Number.isFinite(e.timeMs) ? e.timeMs : 0))),
  };
}
export function seekReview(timeline, timeMs) {
  let low = 0,
    high = timeline.samples.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (timeline.samples[mid].timeMs <= timeMs) low = mid + 1;
    else high = mid;
  }
  if (
    timeline.gaps.some(
      (g) => Number.isFinite(g.fromTimeMs) && timeMs >= g.fromTimeMs && timeMs < g.toTimeMs,
    )
  )
    return null;
  const sample = timeline.samples[low - 1];
  return sample?.available === false ? null : (sample ?? null);
}
const vector = (value, size) =>
  Array.isArray(value) &&
  value.length === size &&
  value.every((n) => Number.isFinite(n) && Math.abs(n) <= 1e6);
export function sceneParts(observation) {
  const parts = observation?.metadata?.blueprint?.parts;
  if (!Array.isArray(parts) || parts.length > 512)
    throw Error('Unsupported or oversized recorded blueprint');
  const authored = parts.map((part, index) => {
    if (!Object.hasOwn(CATALOG, part.type)) throw Error('Unsupported recorded part');
    const pose = observation.physics?.[index] ?? part;
    if (!vector(pose?.position, 3) || !vector(pose?.rotation, 4))
      throw Error('Unsupported recorded transform');
    const primitives = partPrimitives(part);
    if (primitives.length > 32) throw Error('Recorded primitive limit exceeded');
    return {
      id: part.id,
      position: pose.position,
      rotation: pose.rotation,
      primitives: primitives.map((p) => {
        if (
          !['box', 'cylinder'].includes(p.kind) ||
          !vector(p.halfExtents, 3) ||
          p.halfExtents.some((n) => n <= 0 || n > 100)
        )
          throw Error('Unsupported recorded geometry');
        return { kind: p.kind, halfExtents: p.halfExtents };
      }),
    };
  });
  return authored.concat(
    environmentObstacles(observation.metadata.blueprint.environment).map((obstacle, index) => ({
      id: `environment-${index}`,
      position: [...obstacle.position],
      rotation: [...obstacle.rotation],
      primitives: [{ kind: obstacle.shape, halfExtents: [...obstacle.halfExtents] }],
    })),
  );
}
