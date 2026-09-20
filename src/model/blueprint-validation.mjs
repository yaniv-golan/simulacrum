import { environmentObstacles } from './environment.mjs';
import { LAMP_LIMIT } from './lamps.mjs';
import {
  CONTROLLER_LIMITS,
  admitControllerAuthoring,
  logicalControllerPort,
} from './controller-authoring.mjs';
import { SENSOR_LIMITS } from './sensors.mjs';
import { CAMERA } from './camera.mjs';
import { resolveSurfaceEndpoint, validateSurfacePair } from './surfaces.mjs';
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
export const CURRENT_SAVE_VERSION = 4;
export const QUATERNION_NORM_TOLERANCE = 1e-8;
const result = (reasonCode, path = '') => ({ ok: reasonCode === 'OK', reasonCode, path });
const escape = (key) => String(key).replaceAll('~', '~0').replaceAll('/', '~1');
// Runtime accepts finite, acyclic plain JSON data. Inspect descriptors so a
// getter cannot execute while validation merely checks the supplied shape.
export function invalidData(value, path = '', ancestors = new Set(), depth = 0) {
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
        count +
        (connection.kind === 'rope'
          ? connection.rope.segments + 1
          : connection.kind === 'cord'
            ? connection.cord.segments + 1
            : 0),
      0,
    );
    if (blueprint.parts.length + ropeNodes + obstacles.length + 1 > 4097)
      return result('SCENE_BODY_LIMIT', '/environment/objects');
  } catch {
    return result('INVALID_BLUEPRINT', '/environment');
  }
  if (blueprint.parts.filter((p) => p.type === 'poweredLamp').length > LAMP_LIMIT)
    return result('INVALID_BLUEPRINT', '/parts');
  if (
    blueprint.parts.filter((p) => p.type === 'logicController' || p.type === 'learningController')
      .length > CONTROLLER_LIMITS.count
  )
    return result('INVALID_BLUEPRINT', '/parts');
  if (blueprint.parts.filter((p) => p.type === 'camera').length > CAMERA.maxParts)
    return result('CAMERA_LIMIT', '/parts');
  if (blueprint.parts.filter((p) => CATALOG[p.type]?.sensorSupply).length > SENSOR_LIMITS.count)
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
    if (part.controllerProgram) {
      try {
        admitControllerAuthoring(part.controllerProgram);
      } catch {
        return result('INVALID_CONTROLLER_PROGRAM', `${path}/controllerProgram`);
      }
    }
    if (
      part.targetBinding &&
      (part.targetBinding === part.id || !blueprint.parts.some((p) => p.id === part.targetBinding))
    )
      return result('UNKNOWN_PART', `${path}/targetBinding`);
    if (
      part.springBinding &&
      !blueprint.connections.some((c) => c.id === part.springBinding && c.kind === 'spring')
    )
      return result('UNKNOWN_CONNECTION', `${path}/springBinding`);
    if (
      part.jointBinding &&
      !blueprint.connections.some(
        (c) => c.id === part.jointBinding && ['shaft', 'pivot'].includes(c.kind),
      )
    )
      return result('UNKNOWN_CONNECTION', `${path}/jointBinding`);
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
    // An elastic cord binds to surfaces on the rope's admission set: the same
    // resolution, the same faces, the same absence of port occupancy.
    if (connection.kind === 'rope' || connection.kind === 'cord') {
      for (const side of ['a', 'b']) {
        const endpoint = connection[side],
          part = parts.get(endpoint.part);
        if (!part) return result('UNKNOWN_PART', `${path}/${side}/part`);
        try {
          resolveSurfaceEndpoint(part, endpoint);
        } catch (error) {
          return result(error.reasonCode ?? 'INVALID_ENDPOINT', path);
        }
        const key = JSON.stringify([
          endpoint.part,
          endpoint.surface.region,
          endpoint.surface.u,
          endpoint.surface.v,
        ]);
        if (occupied.has(key)) return result('PORT_OCCUPIED', `${path}/${side}/port`);
        occupied.add(key);
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
        if (
          blueprint.version !== CURRENT_SAVE_VERSION ||
          !['fixed', 'pivot'].includes(connection.kind)
        )
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
      const key = JSON.stringify(
        endpoint.surface
          ? part.type === 'loadCellSensor'
            ? [endpoint.part, endpoint.surface.region]
            : [endpoint.part, endpoint.surface.region, endpoint.surface.u, endpoint.surface.v]
          : [endpoint.part, logicalControllerPort(part.type, endpoint.port)],
      );
      const catalogPort = endpoint.surface
        ? port
        : CATALOG[part.type].ports.find(
            (p) => p.id === logicalControllerPort(part.type, endpoint.port),
          );
      if (port.multiplicity === 'one' || endpoint.surface || catalogPort?.multiplicity === 'one') {
        if (occupied.has(key)) return result('PORT_OCCUPIED', `${path}/${side}/port`);
        occupied.add(key);
      }
    }
  }
  return result('OK');
}
