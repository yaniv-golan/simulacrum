import { environmentObstacles } from './environment.mjs';
import { LAMP_LIMIT } from './lamps.mjs';
import {
  resolveSurfaceEndpoint,
  validateSurfacePair,
  validatePlacementGeometry,
} from './surfaces.mjs';
import { admitLearningModel } from './learning-model.mjs';
import validateSchema from './generated/blueprint-validator.mjs';
import { CATALOG, MATERIALS } from './catalog.mjs';
export const BLUEPRINT_REASON_CODES = Object.freeze([
  'OK',
  'INVALID_BLUEPRINT',
  'SCENE_OBJECT_LIMIT',
  'SCENE_BODY_LIMIT',
  'INVALID_JSON',
  'SAVE_VERSION_UNSUPPORTED_OLD',
  'SAVE_VERSION_FUTURE',
  'UNKNOWN_PART_TYPE',
  'DUPLICATE_ID',
  'UNKNOWN_PART',
  'UNKNOWN_PORT',
  'SELF_CONNECTION',
  'PORT_OCCUPIED',
  'RELEASE_LATCH_CONFLICT',
  'JOINT_FACE_CONFLICT',
  'UNKNOWN_MATERIAL',
  'INVALID_ROTATION',
  'INCOMPATIBLE_PORT_DIRECTION',
]);
export const CURRENT_SAVE_VERSION = 3;
export const QUATERNION_NORM_TOLERANCE = 1e-8;
const result = (reasonCode, path = '') => ({ ok: reasonCode === 'OK', reasonCode, path });
const escape = (key) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
// Runtime accepts finite, acyclic plain JSON data. Inspect descriptors so a
// getter cannot execute while validation merely checks the supplied shape.
function invalidData(value, path = '', ancestors = new Set(), depth = 0) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? null : path;
  if (typeof value !== 'object' || depth > 16 || ancestors.has(value)) return path;
  const array = Array.isArray(value),
    prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null) return path;
  const descriptors = Object.getOwnPropertyDescriptors(value),
    keys = Reflect.ownKeys(descriptors);
  if (array && keys.length !== value.length + 1) return path;
  ancestors.add(value);
  for (const key of keys) {
    if (array && key === 'length') continue;
    const next = `${path}/${escape(key)}`,
      descriptor = descriptors[key];
    if (
      typeof key !== 'string' ||
      !Object.hasOwn(descriptor, 'value') ||
      !descriptor.enumerable ||
      (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
    )
      return next;
    const error = invalidData(descriptor.value, next, ancestors, depth + 1);
    if (error !== null) return error;
  }
  ancestors.delete(value);
  return null;
}
export function validateBlueprint(blueprint) {
  const bad = invalidData(blueprint);
  if (bad !== null) return result('INVALID_BLUEPRINT', bad);
  if (Array.isArray(blueprint?.environment?.objects) && blueprint.environment.objects.length > 32)
    return result('SCENE_OBJECT_LIMIT', '/environment/objects');
  if (!validateSchema(blueprint)) {
    const error = validateSchema.errors[0];
    let path = error.instancePath;
    if (error.keyword === 'required') path += `/${escape(error.params.missingProperty)}`;
    if (error.keyword === 'additionalProperties')
      path += `/${escape(error.params.additionalProperty)}`;
    if (error.keyword === 'enum' && /^\/parts\/\d+\/type$/.test(path))
      return result('UNKNOWN_PART_TYPE', path);
    if (error.keyword === 'enum' && /^\/parts\/\d+\/authoredMaterial\//.test(path))
      return result('UNKNOWN_MATERIAL', path);
    if (path.endsWith('/rotation') || /^\/parts\/\d+\/rotation\//.test(path))
      return result('INVALID_ROTATION', path.replace(/(\/rotation)\/\d+$/, '$1'));
    return result('INVALID_BLUEPRINT', path);
  }
  try {
    const obstacles = environmentObstacles(blueprint.environment);
    const ropeNodes = blueprint.connections.reduce(
      (count, connection) =>
        count + (connection.kind === 'rope' ? connection.rope.segments + 1 : 0),
      0,
    );
    if (blueprint.parts.length + ropeNodes + obstacles.length + 1 > 4097)
      return result('SCENE_BODY_LIMIT', '/environment/objects');
  } catch {
    return result('INVALID_BLUEPRINT', '/environment');
  }
  if (blueprint.parts.filter((p) => p.type === 'poweredLamp').length > LAMP_LIMIT)
    return result('INVALID_BLUEPRINT', '/parts');
  const parts = new Map();
  for (let index = 0; index < blueprint.parts.length; index++) {
    const part = blueprint.parts[index],
      path = `/parts/${index}`;
    if (parts.has(part.id)) return result('DUPLICATE_ID', `${path}/id`);
    if (!Object.hasOwn(CATALOG, part.type)) return result('UNKNOWN_PART_TYPE', `${path}/type`);
    if (
      Math.abs(part.rotation.reduce((sum, value) => sum + value * value, 0) - 1) >
      QUATERNION_NORM_TOLERANCE
    )
      return result('INVALID_ROTATION', `${path}/rotation`);
    for (const [primitive, material] of Object.entries(part.authoredMaterial)) {
      if (!CATALOG[part.type].primitives.some((shape) => shape.id === primitive))
        return result('INVALID_BLUEPRINT', `${path}/authoredMaterial/${escape(primitive)}`);
      if (!Object.hasOwn(MATERIALS, material))
        return result('UNKNOWN_MATERIAL', `${path}/authoredMaterial/${escape(primitive)}`);
    }
    if (part.learningModel) {
      try {
        admitLearningModel(part.learningModel);
      } catch {
        return result('INVALID_BLUEPRINT', `${path}/learningModel`);
      }
    }
    if (
      part.targetBinding &&
      (part.targetBinding === part.id || !blueprint.parts.some((p) => p.id === part.targetBinding))
    )
      return result('UNKNOWN_PART', `${path}/targetBinding`);
    parts.set(part.id, part);
  }
  const groupIds = new Set(),
    membership = new Set();
  for (const [index, group] of (blueprint.assemblies ?? []).entries()) {
    const path = `/assemblies/${index}`;
    if (groupIds.has(group.id)) return result('DUPLICATE_ID', `${path}/id`);
    groupIds.add(group.id);
    if (!group.name.trim()) return result('INVALID_BLUEPRINT', `${path}/name`);
    for (const id of group.ids) {
      if (!parts.has(id)) return result('UNKNOWN_PART', `${path}/ids`);
      if (membership.has(id)) return result('INVALID_BLUEPRINT', `${path}/ids`);
      membership.add(id);
    }
    const names = new Set(),
      endpoints = new Set();
    for (const [i, alias] of group.ports.entries()) {
      const portPath = `${path}/ports/${i}`,
        endpoint = alias.endpoint;
      if (!alias.name.trim() || names.has(alias.name.trim().toLowerCase()))
        return result('INVALID_BLUEPRINT', `${portPath}/name`);
      names.add(alias.name.trim().toLowerCase());
      if (!group.ids.includes(endpoint.part)) return result('UNKNOWN_PART', `${portPath}/endpoint`);
      const part = parts.get(endpoint.part);
      try {
        const port = endpoint.surface
          ? resolveSurfaceEndpoint(part, endpoint)
          : CATALOG[part.type].ports.find((port) => port.id === endpoint.port);
        if (!port) return result('UNKNOWN_PORT', `${portPath}/endpoint`);
      } catch (error) {
        return result(error.reasonCode ?? 'INVALID_ENDPOINT', `${portPath}/endpoint`);
      }
      const key = JSON.stringify([
        endpoint.part,
        endpoint.port ?? [
          endpoint.surface.region,
          endpoint.surface.u,
          endpoint.surface.v,
          endpoint.surface.twist,
        ],
      ]);
      if (endpoints.has(key)) return result('INVALID_BLUEPRINT', `${portPath}/endpoint`);
      endpoints.add(key);
    }
  }
  for (const [index, part] of blueprint.parts.entries())
    if (part.type === 'positionRegulator') {
      const p = part.parameters;
      if (p.minTarget >= p.maxTarget || p.target < p.minTarget || p.target > p.maxTarget)
        return result('INVALID_BLUEPRINT', `/parts/${index}/parameters`);
    } else if (['springGuide', 'linearActuator'].includes(part.type)) {
      const p = part.parameters;
      if (p.minLength >= p.maxLength || p.restLength < p.minLength || p.restLength > p.maxLength)
        return result('INVALID_BLUEPRINT', `/parts/${index}/parameters`);
    }
  const connections = new Set(),
    occupied = new Set();
  for (let index = 0; index < blueprint.connections.length; index++) {
    const connection = blueprint.connections[index],
      path = `/connections/${index}`;
    if (connections.has(connection.id)) return result('DUPLICATE_ID', `${path}/id`);
    connections.add(connection.id);
    if (connection.a.part === connection.b.part) return result('SELF_CONNECTION', `${path}/b/part`);
    if (connection.kind === 'rope') {
      for (const side of ['a', 'b']) {
        const endpoint = connection[side],
          part = parts.get(endpoint.part);
        if (!part) return result('UNKNOWN_PART', `${path}/${side}/part`);
        try {
          resolveSurfaceEndpoint(part, endpoint);
        } catch (error) {
          return result(error.reasonCode ?? 'INVALID_ENDPOINT', path);
        }
      }
      continue;
    }
    if (connection.a.surface || connection.b.surface) {
      if (!connection.a.surface || !connection.b.surface) return result('INVALID_BLUEPRINT', path);
      const a = parts.get(connection.a.part),
        b = parts.get(connection.b.part);
      if (
        a &&
        b &&
        CATALOG[a.type].releaseFace === connection.a.surface.region &&
        CATALOG[b.type].releaseFace === connection.b.surface.region
      )
        return result('RELEASE_LATCH_CONFLICT', path);
      if (a && b) {
        // A joint face mates by kind: exactly one revolute joint face makes a pivot; a fixed
        // pair has none. Latch and load-cell faces need a rigid mount, so a pin may not sit there.
        const joints = [
          CATALOG[a.type].jointFace?.region === connection.a.surface.region
            ? CATALOG[a.type].jointFace.joint
            : null,
          CATALOG[b.type].jointFace?.region === connection.b.surface.region
            ? CATALOG[b.type].jointFace.joint
            : null,
        ];
        const revolute = joints.filter((j) => j === 'revolute').length,
          declared = joints.filter(Boolean).length;
        if (connection.kind === 'pivot') {
          if (revolute !== 1 || declared !== 1) return result('INVALID_BLUEPRINT', path);
          const other = joints[0] ? [b, connection.b] : [a, connection.a];
          if (
            CATALOG[other[0].type].releaseFace === other[1].surface.region ||
            other[0].type === 'loadCellSensor'
          )
            return result('JOINT_FACE_CONFLICT', path);
        } else if (declared) return result('INVALID_BLUEPRINT', path);
        try {
          validateSurfacePair(a, connection.a, b, connection.b);
        } catch (error) {
          return result(error.reasonCode, path);
        }
      }
    }
    if (
      connection.kind === 'spring' &&
      !['springCarriage,springGuide', 'linearActuator,springCarriage'].includes(
        [parts.get(connection.a.part)?.type, parts.get(connection.b.part)?.type].sort().join(','),
      )
    )
      return result('INVALID_BLUEPRINT', path);
    for (const side of ['a', 'b']) {
      const endpoint = connection[side],
        part = parts.get(endpoint.part);
      if (!part) return result('UNKNOWN_PART', `${path}/${side}/part`);
      let port;
      if (endpoint.surface) {
        if (blueprint.version !== 3 || !['fixed', 'pivot'].includes(connection.kind))
          return result('INVALID_BLUEPRINT', `${path}/${side}`);
        try {
          port = resolveSurfaceEndpoint(part, endpoint);
        } catch (error) {
          return result(error.reasonCode, `${path}/${side}`);
        }
      } else port = CATALOG[part.type].ports.find((port) => port.id === endpoint.port);
      if (!port || (endpoint.surface ? connection.kind === 'rope' : port.kind !== connection.kind))
        return result('UNKNOWN_PORT', `${path}/${side}/port`);
      if (connection.kind === 'signal' && port.direction !== (side === 'a' ? 'output' : 'input'))
        return result('INCOMPATIBLE_PORT_DIRECTION', `${path}/${side}/port`);
      const key = JSON.stringify([
        endpoint.part,
        endpoint.surface ? `surface:${endpoint.surface.region}` : endpoint.port,
      ]);
      if (
        port.multiplicity === 'one' ||
        (endpoint.surface && (side === 'b' || part.type === 'loadCellSensor'))
      ) {
        if (occupied.has(key)) return result('PORT_OCCUPIED', `${path}/${side}/port`);
        occupied.add(key);
      }
    }
  }
  return result('OK');
}
export function loadSave(input) {
  let parsed = input;
  if (typeof input === 'string') {
    try {
      parsed = JSON.parse(input);
    } catch {
      return result('INVALID_JSON');
    }
  }
  const bad = invalidData(parsed);
  if (bad !== null) return result('INVALID_BLUEPRINT', bad);
  if (parsed && typeof parsed === 'object' && Number.isInteger(parsed.version)) {
    if (parsed.version < CURRENT_SAVE_VERSION)
      return result('SAVE_VERSION_UNSUPPORTED_OLD', '/version');
    if (parsed.version > CURRENT_SAVE_VERSION) return result('SAVE_VERSION_FUTURE', '/version');
  }
  const validation = validateBlueprint(parsed);
  if (validation.ok)
    try {
      validatePlacementGeometry(parsed);
    } catch (error) {
      return result(error.reasonCode, error.path ?? 'connections');
    }
  if (!validation.ok) return validation;
  const blueprint = structuredClone(parsed);
  canonicalizeContactOverrides(blueprint);
  return { ...validation, blueprint };
}
function authored(value) {
  const validation = validateBlueprint(value);
  if (!validation.ok)
    throw Object.assign(new TypeError(validation.reasonCode), {
      reasonCode: validation.reasonCode,
      path: validation.path,
    });
  return value;
}
export function createEmptyBlueprint(id, name) {
  return authored({ version: CURRENT_SAVE_VERSION, id, name, parts: [], connections: [] });
}
export function createPart(type, id, position) {
  if (!Object.hasOwn(CATALOG, type))
    throw Object.assign(new TypeError('UNKNOWN_PART_TYPE'), {
      reasonCode: 'UNKNOWN_PART_TYPE',
      path: '/type',
    });
  const part = {
    id,
    type,
    name: CATALOG[type].name,
    position: structuredClone(position),
    rotation: [0, 0, 0, 1],
    authoredMaterial: {},
    parameters: Object.fromEntries(
      Object.entries(CATALOG[type].parameterDefinitions).map(([key, definition]) => [
        key,
        definition.default,
      ]),
    ),
  };
  authored({
    version: CURRENT_SAVE_VERSION,
    id: 'factory',
    name: 'Factory',
    parts: [part],
    connections: [],
  });
  return part;
}

// Names identify parts to players only; ids retain connection ownership.
export function availablePartName(parts, requested) {
  const used = new Set(parts.map((part) => part.name));
  if (!used.has(requested)) return requested;
  const base = requested.replace(/-\d+$/, '');
  for (
    let n =
      Math.max(
        1,
        ...parts.map((part) =>
          part.name.startsWith(base + '-')
            ? /^[0-9]{1,8}$/.test(part.name.slice(base.length + 1))
              ? Number(part.name.slice(base.length + 1))
              : 1
            : 1,
        ),
      ) + 1;
    ;
    n++
  ) {
    const suffix = `-${n}`,
      candidate = base.slice(0, 128 - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
}

/** Remove empty optional records after admission, without changing explicit zero. */
export function canonicalizeContactOverrides(blueprint) {
  for (const part of blueprint.parts) {
    if (!part.authoredContact) continue;
    for (const [id, values] of Object.entries(part.authoredContact))
      if (Object.keys(values).length === 0) delete part.authoredContact[id];
    if (Object.keys(part.authoredContact).length === 0) delete part.authoredContact;
  }
}
