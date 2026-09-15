import { partPrimitives } from './geometry.mjs';
import { CATALOG } from './catalog.mjs';
import { validateBlueprint, availablePartName } from './blueprint.mjs';

function reject(reasonCode, path = '') {
  throw Object.assign(new TypeError(reasonCode), { reasonCode, path });
}
function validate(blueprint) {
  const result = validateBlueprint(blueprint);
  if (!result.ok) reject(result.reasonCode, result.path);
}
function rotate(vector, rotation) {
  const norm = Math.hypot(...rotation),
    [x, y, z, w] = rotation.map((value) => value / norm),
    [a, b, c] = vector;
  const tx = 2 * (y * c - z * b),
    ty = 2 * (z * a - x * c),
    tz = 2 * (x * b - y * a);
  return [a + w * tx + y * tz - z * ty, b + w * ty + z * tx - x * tz, c + w * tz + x * ty - y * tx];
}
// Enclose each primitive's local bounding box, including its authored frame.
// Cylinders use their enclosing boxes: placement may be conservative, never
// smaller than the canonical geometry. No collision-library state is consulted.
function bounds(part) {
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (const primitive of partPrimitives(part))
    for (let corner = 0; corner < 8; corner++) {
      const local = primitive.halfExtents.map(
        (extent, axis) => extent * (corner & (1 << axis) ? 1 : -1),
      );
      const point = rotate(
        rotate(local, primitive.rotation).map((value, axis) => value + primitive.position[axis]),
        part.rotation,
      );
      for (let axis = 0; axis < 3; axis++) {
        const value = point[axis] + part.position[axis];
        min[axis] = Math.min(min[axis], value);
        max[axis] = Math.max(max[axis], value);
      }
    }
  return { min, max };
}
function overlaps(a, b) {
  return a.min.every(
    (value, axis) => value <= b.max[axis] + 1e-10 && a.max[axis] + 1e-10 >= b.min[axis],
  );
}

/** Authoring placement grid and the gap a copy keeps from its original, in metres.
 * The 25 mm grid matches the presentation's own placement step; the copy
 * planner is the only model-side owner of these values. */
export const DUPLICATE_GRID_M = 0.025;
export const DUPLICATE_CLEARANCE_M = 0.025;
export const DUPLICATE_MAX_STEPS = 256;
/** Quantise a caller's world direction to one floor axis: the dominant of ±X and
 * ±Z (ties go to X). A vertical or zero direction has no floor component and
 * is rejected; a tiny finite one still resolves. */
function floorAxis(direction) {
  if (!Array.isArray(direction) || direction.length !== 3 || !direction.every(Number.isFinite))
    reject('INVALID_VECTOR', 'direction');
  const scale = Math.max(Math.abs(direction[0]), Math.abs(direction[2]));
  if (scale === 0) reject('INVALID_VECTOR', 'direction');
  const x = direction[0] / scale,
    z = direction[2] / scale,
    axis = Math.abs(x) >= Math.abs(z) ? 0 : 2,
    sign = (axis === 0 ? x : z) < 0 ? -1 : 1;
  const unit = [0, 0, 0];
  unit[axis] = sign;
  return { axis, unit };
}
/** Return an independent, fully authored part for the ordinary insert command.
 * Direction is a world-space vector supplied by the caller (for example the
 * camera's horizontal facing), quantised to one floor axis. The first candidate
 * sits one extent of the original plus a clearance along that axis, snapped
 * outward to the grid; later candidates step one grid at a time, at most
 * `maxSteps` of them, so a copy lands beside its original rather than metres away.
 */
export function duplicatePart(
  blueprint,
  id,
  newId,
  direction,
  {
    grid = DUPLICATE_GRID_M,
    clearance = DUPLICATE_CLEARANCE_M,
    maxSteps = DUPLICATE_MAX_STEPS,
  } = {},
) {
  validate(blueprint);
  const original = blueprint.parts.find((part) => part.id === id);
  if (!original) reject('UNKNOWN_PART', 'id');
  if (blueprint.parts.some((part) => part.id === newId)) reject('DUPLICATE_ID', 'newId');
  const { axis, unit } = floorAxis(direction);
  if (!(grid > 0) || !(clearance >= 0) || !(maxSteps > 0)) reject('INVALID_COMMAND', 'grid');
  const copy = structuredClone(original);
  // A copied sensor does not acquire authority over the original mechanism.
  delete copy.springBinding;
  delete copy.jointBinding;
  delete copy.targetBinding;
  copy.id = newId;
  copy.name = availablePartName(blueprint.parts, original.name);
  validate({ ...blueprint, parts: [...blueprint.parts, copy] });
  const occupied = blueprint.parts.map(bounds),
    source = bounds(original),
    extent = source.max[axis] - source.min[axis],
    first = Math.ceil((extent + clearance - 1e-9) / grid);
  for (let step = 0; step < maxSteps; step++) {
    const distance = (first + step) * grid;
    copy.position = original.position.map((value, i) => value + unit[i] * distance);
    // Use the authoritative schema's coordinate limits, not a second limit list.
    if (!validateBlueprint({ ...blueprint, parts: [copy], connections: [] }).ok) continue;
    const candidate = bounds(copy);
    if (!occupied.some((other) => overlaps(candidate, other))) return copy;
  }
  reject('INVALID_COMMAND', 'position');
}
