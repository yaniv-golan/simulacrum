import { CATALOG } from './catalog.mjs';
import { loadSave, availablePartName } from './blueprint.mjs';
import { compileAssembly, snapConnection } from './assembly.mjs';
import { classifySelectionConnections, mechanicalGroup } from './connection-graph.mjs';
import { transformPoseBetweenFrames } from './transforms.mjs';

function reject(path) {
  throw Object.assign(Error('INVALID_COMMAND'), { reasonCode: 'INVALID_COMMAND', path });
}
function admitted(input) {
  const loaded = loadSave(input);
  if (!loaded.ok) throw Object.assign(Error(loaded.reasonCode), loaded);
  return loaded.blueprint;
}
function fresh(used, prefix) {
  for (let n = 1; ; n++) {
    const id = `${prefix}-${n}`;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
}
function selection(bp, ids) {
  const edges = classifySelectionConnections(bp, ids);
  const selected = new Set(ids);
  for (const group of bp.assemblies ?? [])
    if (group.ids.some((id) => selected.has(id)) && !group.ids.every((id) => selected.has(id)))
      reject('ids');
  return { edges, selected };
}
/** Editor membership never creates physical connectivity. */
export function groupAssembly(input, { name, ids, ports }) {
  const bp = admitted(input);
  selection(bp, ids);
  if ((bp.assemblies ?? []).some((group) => group.ids.some((id) => ids.includes(id))))
    reject('ids');
  const used = new Set((bp.assemblies ?? []).map((group) => group.id));
  (bp.assemblies ??= []).push({
    id: fresh(used, 'assembly'),
    name,
    ids: structuredClone(ids),
    ports: structuredClone(ports),
  });
  return admitted(bp);
}
/** Editing metadata preserves group identity and all ordinary authored state. */
export function editAssembly(input, { id, name, ids, ports }) {
  const bp = admitted(input);
  const group = groupById(bp, id);
  Object.assign(group, { name, ids: structuredClone(ids), ports: structuredClone(ports) });
  return admitted(bp);
}
/** A library definition is a self-contained blueprint with exactly one flat group. */
export function captureAssembly(input, { name, ids, ports }) {
  const bp = admitted(input),
    { edges, selected } = selection(bp, ids);
  if ((bp.assemblies ?? []).filter((group) => group.ids.some((id) => selected.has(id))).length > 1)
    reject('ids');
  const definition = {
    version: bp.version,
    id: 'definition',
    name,
    parts: bp.parts.filter((part) => selected.has(part.id)),
    connections: edges
      .filter((edge) => edge.classification === 'internal')
      .map((edge) => edge.connection),
    assemblies: [{ id: 'assembly', name, ids: [...ids], ports: structuredClone(ports) }],
  };
  // Captures can contain a motor without its external cell; that is ordinary authored state.
  const result = admitted(definition);
  compileAssembly(result);
  return {
    definition: result,
    omittedConnectionIds: edges
      .filter((edge) => edge.classification === 'boundary')
      .map((edge) => edge.connection.id),
  };
}
export function validateAssemblyDefinition(input) {
  const bp = admitted(input),
    group = bp.assemblies?.[0];
  if (bp.assemblies?.length !== 1 || group.ids.length !== bp.parts.length) reject('definition');
  compileAssembly(bp);
  return bp;
}
export function insertAssembly(input, definition, position, rotation) {
  const bp = admitted(input),
    source = validateAssemblyDefinition(definition),
    group = source.assemblies[0];
  const used = new Set([...bp.parts, ...source.parts].map((part) => part.id)),
    usedEdges = new Set([...bp.connections, ...source.connections].map((edge) => edge.id));
  const idMap = Object.create(null),
    connectionIdMap = Object.create(null);
  const origin = source.parts.find((part) => part.id === group.ids[0]);
  // Validate the requested frame before quaternion arithmetic.
  const frame = { position, rotation };
  // Shape validation alone: repositioning only the origin need not preserve connections.
  const targetPart = { ...structuredClone(origin), position, rotation };
  admitted({
    version: bp.version,
    id: 'frame',
    name: 'Frame',
    parts: [targetPart],
    connections: [],
  });
  for (const part of source.parts) {
    const copy = structuredClone(part);
    copy.id = idMap[part.id] = fresh(used, 'part');
    copy.name = availablePartName(bp.parts, copy.name);
    Object.assign(copy, transformPoseBetweenFrames(part, origin, frame));
    bp.parts.push(copy);
  }
  for (const edge of source.connections) {
    const copy = structuredClone(edge);
    copy.id = connectionIdMap[edge.id] = fresh(usedEdges, 'connection');
    copy.a.part = idMap[edge.a.part];
    copy.b.part = idMap[edge.b.part];
    bp.connections.push(copy);
  }
  const instance = structuredClone(group);
  for (const part of bp.parts.filter((p) => Object.values(idMap).includes(p.id)))
    if (part.springBinding) {
      if (connectionIdMap[part.springBinding])
        part.springBinding = connectionIdMap[part.springBinding];
      else delete part.springBinding;
    }
  instance.name = availablePartName(bp.assemblies ?? [], group.name);
  instance.id = fresh(new Set((bp.assemblies ?? []).map((group) => group.id)), 'assembly');
  instance.ids = group.ids.map((id) => idMap[id]);
  instance.ports.forEach((port) => {
    port.endpoint.part = idMap[port.endpoint.part];
  });
  (bp.assemblies ??= []).push(instance);
  compileAssembly(bp);
  return { blueprint: bp, idMap, connectionIdMap, instanceId: instance.id };
}
function groupById(bp, id) {
  const group = bp.assemblies?.find((group) => group.id === id);
  if (!group) reject('id');
  return group;
}
function scope(bp, group) {
  return new Set(group.ids.flatMap((id) => mechanicalGroup(bp, id)));
}
export function transformAssembly(input, id, position, rotation) {
  const bp = admitted(input),
    group = groupById(bp, id);
  const origin = bp.parts.find((part) => part.id === group.ids[0]),
    frame = { position, rotation };
  admitted({
    version: bp.version,
    id: 'frame',
    name: 'Frame',
    parts: [{ ...origin, ...frame }],
    connections: [],
  });
  const moved = scope(bp, group);
  const next = structuredClone(bp);
  for (const part of next.parts)
    if (moved.has(part.id)) Object.assign(part, transformPoseBetweenFrames(part, origin, frame));
  compileAssembly(next);
  return next;
}
/** Existing snap policy places the ordinary endpoint, then the remaining editor members follow. */
export function connectAssembly(input, id, portName, target, connectionId) {
  const bp = admitted(input),
    group = groupById(bp, id),
    alias = group.ports.find((port) => port.name === portName);
  if (!alias) reject('portName');
  const binding = alias.endpoint;
  if (group.ids.includes(target.part)) reject('target');
  const before = bp.parts.find((part) => part.id === binding.part);
  const kind = binding.surface
    ? 'fixed'
    : CATALOG[before.type].ports.find((port) => port.id === binding.port).kind;
  if (kind === 'power' || kind === 'signal')
    return { blueprint: bp, endpoint: structuredClone(binding), target, connectionId };
  let next = snapConnection(bp, target, binding);
  const after = next.parts.find((part) => part.id === binding.part);
  const moved = new Set(mechanicalGroup(bp, binding.part));
  const all = scope(bp, group);
  if (all.has(target.part)) reject('target');
  for (const part of next.parts)
    if (all.has(part.id) && !moved.has(part.id))
      Object.assign(part, transformPoseBetweenFrames(part, before, after));
  return { blueprint: next, endpoint: structuredClone(binding), target, connectionId };
}
