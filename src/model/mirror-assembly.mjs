import { classifySelectionConnections } from './connection-graph.mjs';
import { CATALOG } from './catalog.mjs';
import { partPrimitives } from './geometry.mjs';
import { loadSave, availablePartName } from './blueprint.mjs';
import { compileAssembly } from './assembly.mjs';
import { surfaceRegions, resolveSurfaceEndpoint } from './surfaces.mjs';
import { normalizeQuaternion, multiplyQuaternion, rotateVector } from './transforms.mjs';

export const MIRROR_REASON_CODES = Object.freeze(['MIRROR_UNREPRESENTABLE']);
const axes = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
const near = (a, b) => a.every((value, i) => Math.abs(value - b[i]) < 1e-8);
const sameRotation = (a, b) =>
  Math.abs(Math.abs(dot(normalizeQuaternion(a), normalizeQuaternion(b))) - 1) < 1e-8;
const reflected = (vector, normal) =>
  vector.map((value, i) => value - 2 * dot(vector, normal) * normal[i]);
const clean = (value) => (Math.abs(value) < 1e-12 ? 0 : value);
function reject(reasonCode, path = 'mirror', previewBlueprint) {
  throw Object.assign(new TypeError(reasonCode), {
    reasonCode,
    path,
    ...(previewBlueprint ? { previewBlueprint: structuredClone(previewBlueprint) } : {}),
  });
}
function normalFor(axis) {
  if (!Object.hasOwn(axes, axis)) reject('INVALID_COMMAND', 'axis');
  return axes[axis];
}
// H_world R H_localZ is proper: two reflections have determinant +1. Choosing
// local Z preserves ordinary local-X and local-Y shaft geometry, not handedness
// of motor torque. Authored controls remain unchanged and preview reports this.
export function reflectPose(pose, reference, axis) {
  const normal = rotateVector(reference.rotation, normalFor(axis));
  const offset = pose.position.map((value, i) => value - reference.position[i]);
  return {
    position: reflected(offset, normal).map((value, i) => clean(value + reference.position[i])),
    rotation: normalizeQuaternion(
      multiplyQuaternion(multiplyQuaternion([...normal, 0], pose.rotation), [0, 0, 1, 0]),
    ).map(clean),
  };
}
function reflectLocalRotation(rotation, axis) {
  return normalizeQuaternion(
    multiplyQuaternion(multiplyQuaternion([...normalFor(axis), 0], rotation), [0, 0, 1, 0]),
  );
}
function admitShape(part) {
  const primitives = partPrimitives(part);
  for (const shape of primitives) {
    const position = reflected(shape.position, axes.z),
      rotation = reflectLocalRotation(shape.rotation, 'z');
    const material = part.authoredMaterial[shape.id] ?? shape.materialKey;
    if (
      !primitives.some(
        (other) =>
          other.kind === shape.kind &&
          near(other.halfExtents, shape.halfExtents) &&
          near(other.position, position) &&
          sameRotation(other.rotation, rotation) &&
          (part.authoredMaterial[other.id] ?? other.materialKey) === material,
      )
    )
      reject('MIRROR_UNREPRESENTABLE', `parts/${part.id}/geometry`);
  }
}
function endpoint(part, binding, axis, newId) {
  if (binding.surface) {
    const original = resolveSurfaceEndpoint(part, binding);
    const point = reflected(original.position, normalFor(axis));
    const normal = reflected(rotateVector(original.rotation, axes.x), normalFor(axis));
    const tangent = reflected(rotateVector(original.rotation, axes.y), normalFor(axis));
    const region = surfaceRegions(part).find((region) =>
      near(rotateVector(region.rotation, axes.x), normal),
    );
    if (!region) reject('MIRROR_UNREPRESENTABLE', `parts/${part.id}/surface`);
    const uAxis = rotateVector(region.rotation, axes.y),
      vAxis = rotateVector(region.rotation, axes.z);
    const offset = point.map((value, i) => value - region.position[i]);
    return {
      part: newId,
      surface: {
        region: region.id,
        u: clean(dot(offset, uAxis)),
        v: clean(dot(offset, vAxis)),
        twist: clean(Math.atan2(dot(tangent, vAxis), dot(tangent, uAxis))),
      },
    };
  }
  const original = CATALOG[part.type].ports.find((port) => port.id === binding.port);
  if (original.kind === 'power' || original.kind === 'signal')
    return { part: newId, port: binding.port };
  const position = reflected(original.position, normalFor(axis));
  const rotation = reflectLocalRotation(original.rotation, axis);
  const candidates = CATALOG[part.type].ports.filter(
    (port) =>
      port.kind === original.kind &&
      port.joint === original.joint &&
      near(port.position, position) &&
      sameRotation(port.rotation, rotation),
  );
  const port = candidates.find((port) => port.id === binding.port) ?? candidates[0];
  if (!port) reject('MIRROR_UNREPRESENTABLE', `parts/${part.id}/ports/${binding.port}`);
  return { part: newId, port: port.id };
}
function freshId(original, used) {
  for (let n = 1; ; n++) {
    const suffix = `-mirror-${n}`,
      candidate = original.slice(0, 64 - suffix.length) + suffix;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
}

/** Pure candidate; explicit selected parts, reference-local plane, deterministic
 * new ids. Copies internal edges and mechanical attachments to the unchanged
 * reference. Other external edges are reported and omitted, never guessed.
 */
export function proposeMirroredAssembly(blueprint, options) {
  const loaded = loadSave(blueprint);
  if (!loaded.ok) reject(loaded.reasonCode, loaded.path);
  if (!options || Object.keys(options).sort().join(',') !== 'axis,ids,referenceId')
    reject('INVALID_COMMAND');
  const { ids, referenceId, axis } = options;
  normalFor(axis);
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.some((id) => typeof id !== 'string') ||
    new Set(ids).size !== ids.length ||
    ids.includes(referenceId)
  )
    reject('INVALID_COMMAND', 'ids');
  const byId = new Map(blueprint.parts.map((part) => [part.id, part]));
  const reference = byId.get(referenceId);
  if (!reference) reject('UNKNOWN_PART', 'referenceId');
  const classifiedConnections = classifySelectionConnections(blueprint, ids);
  const selected = new Set(ids),
    next = loaded.blueprint;
  const partIds = new Set(next.parts.map((part) => part.id)),
    connectionIds = new Set(next.connections.map((connection) => connection.id));
  const idMap = {},
    connectionIdMap = {},
    polarityWarnings = [],
    omittedExternalConnectionIds = [];
  for (const part of blueprint.parts.filter((part) => selected.has(part.id))) {
    admitShape(part);
    const copy = { ...structuredClone(part), ...reflectPose(part, reference, axis) };
    copy.id = freshId(part.id, partIds);
    idMap[part.id] = copy.id;
    copy.name = availablePartName(next.parts, part.name);
    next.parts.push(copy);
    if (
      part.type === 'commandReceiver' ||
      ['defaultDuty', 'defaultTarget'].some((key) =>
        Object.hasOwn(CATALOG[part.type].parameterDefinitions, key),
      )
    )
      polarityWarnings.push({
        id: copy.id,
        reason:
          'Mirroring reverses physical handedness. Settings are preserved; inspect output direction before running.',
      });
  }
  for (const { connection, classification } of classifiedConnections) {
    if (classification === 'external') continue;
    const a = selected.has(connection.a.part);
    const referenceAttachment =
      ['fixed', 'shaft', 'spring'].includes(connection.kind) &&
      (a ? connection.b.part === referenceId : connection.a.part === referenceId);
    if (classification !== 'internal' && !referenceAttachment) {
      omittedExternalConnectionIds.push(connection.id);
      continue;
    }
    const copy = structuredClone(connection);
    copy.id = freshId(connection.id, connectionIds);
    connectionIdMap[connection.id] = copy.id;
    for (const side of ['a', 'b']) {
      const binding = connection[side],
        isCopy = selected.has(binding.part);
      copy[side] = endpoint(
        byId.get(binding.part),
        binding,
        isCopy ? 'z' : axis,
        isCopy ? idMap[binding.part] : referenceId,
      );
    }
    if (copy.kind === 'fixed' && copy.a.surface && copy.b.surface) {
      // Mating surface normals oppose: removing a source-frame twist requires
      // adding that angle to the receiving frame. Keep the reflected solids in
      // place while restoring the save format's centered, zero-twist source pad.
      const twist = copy.a.surface.twist + copy.b.surface.twist;
      copy.a.surface.twist = clean(Math.atan2(Math.sin(twist), Math.cos(twist)));
      copy.b.surface.twist = 0;
    }
    next.connections.push(copy);
  }
  for (const part of next.parts.filter((p) => Object.values(idMap).includes(p.id))) {
    if (part.targetBinding) {
      if (idMap[part.targetBinding]) part.targetBinding = idMap[part.targetBinding];
      else delete part.targetBinding;
    }
    if (part.springBinding) {
      if (connectionIdMap[part.springBinding])
        part.springBinding = connectionIdMap[part.springBinding];
      else delete part.springBinding;
    }
    if (part.jointBinding) {
      if (connectionIdMap[part.jointBinding])
        part.jointBinding = connectionIdMap[part.jointBinding];
      else delete part.jointBinding;
    }
  }
  const candidate = loadSave(next);
  if (!candidate.ok) reject(candidate.reasonCode, candidate.path, next);
  const compiled = compileAssembly(candidate.blueprint),
    copiedConnectionIds = Object.values(connectionIdMap);
  const bad = compiled.connections.find(
    (connection) => copiedConnectionIds.includes(connection.id) && connection.reasonCode !== 'OK',
  );
  if (bad) reject('MIRROR_UNREPRESENTABLE', `connections/${bad.id}`);
  return {
    blueprint: candidate.blueprint,
    copiedIds: Object.values(idMap),
    copiedConnectionIds,
    idMap,
    connectionIdMap,
    omittedExternalConnectionIds,
    polarityWarnings,
  };
}
