import { FLIGHT_MATERIALS, TYPES } from "./component-catalog.js";
import { resolveComponentConfig } from "./component-resolver.js";
import {
  compileMechanismBodyGeometry,
  completeMassProperties,
} from "./mechanism-geometry-compiler.js";
import { isMechanismComponentType } from "./mechanism-component-definitions.js";
import {
  deepFreeze,
  finiteScale3,
  finiteVector3,
  rotateVectorByQuaternion,
} from "./primitives.js";
import { portIds } from "./ports.js";
import { componentPorts } from "./component-contracts.js";

const axisFor = (type) =>
  ["axle", "wheel"].includes(type)
    ? [1, 0, 0]
    : ["motor", "gear12", "gear24", "sensor"].includes(type)
      ? [0, 0, 1]
      : [1, 0, 0];

function scaled(vector, scale) {
  return vector.map((value, index) => value * scale[index]);
}

function collisionFor(type, config, scale) {
  if (config.teeth)
    return {
      kind: "cylinder",
      radius: Math.max(0.05, config.radius * Math.max(scale[0], scale[1])),
      length: Math.max(0.04, 0.22 * scale[2]),
      axis: [0, 0, 1],
    };
  if (type === "wheel")
    return {
      kind: "cylinder",
      radius: Math.max(0.05, config.radius * Math.max(scale[1], scale[2])),
      length: Math.max(0.04, 0.42 * scale[0]),
      axis: [1, 0, 0],
    };
  if (type === "axle")
    return {
      kind: "cylinder",
      radius: Math.max(0.03, 0.105 * Math.max(scale[1], scale[2])),
      length: Math.max(0.04, 2 * scale[0]),
      axis: [1, 0, 0],
    };
  const size = scaled(finiteVector3(config.size || [0.6, 0.6, 0.6]), scale).map(
    (value) => Math.max(0.02, value),
  );
  return { kind: "box", size };
}

function frame(position, normal, axis = normal, clearanceM = 0) {
  return { position, normal, axis, clearanceM };
}

function defaultPortFrames(type, config, catalog) {
  const ports = portIds(type, catalog[type] ? catalog : TYPES),
    size = finiteVector3(config.size || [0.6, 0.6, 0.6]),
    half = size.map((value) => value / 2),
    frames = {},
    faces = [
      frame([-half[0], 0, 0], [-1, 0, 0]),
      frame([half[0], 0, 0], [1, 0, 0]),
      frame([0, half[1], 0], [0, 1, 0]),
      frame([0, -half[1], 0], [0, -1, 0]),
      frame([0, 0, half[2]], [0, 0, 1]),
      frame([0, 0, -half[2]], [0, 0, -1]),
    ];
  for (const [index, port] of ports.entries()) frames[port] = faces[index % 6];
  return frames;
}

function specializedPortFrames(type, config, catalog) {
  const frames = defaultPortFrames(type, config, catalog);
  if (type === "motor") {
    // This is the mounted-part center used by the existing editor snap path.
    // Decorative shaft geometry may extend beyond the connection frame.
    frames.SHAFT = frame([0, 0, 0.82], [0, 0, 1], [0, 0, 1]);
    frames.MOUNT = frame([0, 0, -0.5], [0, 0, -1]);
  } else if (["gear12", "gear24"].includes(type)) {
    frames.AXLE = frame([0, 0, 0], [0, 0, 1], [0, 0, 1]);
    frames.MESH = frame([config.radius, 0, 0], [1, 0, 0], [0, 0, 1], 0.0275);
  } else if (type === "wheel") {
    frames.AXLE = frame([0, 0, 0], [1, 0, 0], [1, 0, 0]);
  } else if (type === "axle") {
    frames.LEFT = frame([-1.05, 0, 0], [-1, 0, 0], [1, 0, 0]);
    frames.RIGHT = frame([1.05, 0, 0], [1, 0, 0], [1, 0, 0]);
  } else if (type === "sensor") {
    frames.SHAFT = frame([0, 0, -0.14], [0, 0, -1], [0, 0, 1]);
  } else if (type === "propellanttank") {
    const halfHeight = finiteVector3(config.size || [1.2, 2.4, 1.2])[1] / 2;
    frames.MOUNT = frame([0, halfHeight, 0], [0, 1, 0]);
    frames.OUTLET = frame([0, -halfHeight, 0], [0, -1, 0]);
  }
  return frames;
}

function volumeOf(collision) {
  if (collision.kind === "cylinder")
    return Math.PI * collision.radius ** 2 * collision.length;
  return collision.size.reduce((product, value) => product * value, 1);
}

function massPropertiesForCollision(collision, massKg) {
  let tensor;
  if (collision.kind === "box") {
    const [x, y, z] = collision.size;
    tensor = {
      xx: (massKg * (y * y + z * z)) / 12,
      yy: (massKg * (x * x + z * z)) / 12,
      zz: (massKg * (x * x + y * y)) / 12,
      xy: 0,
      xz: 0,
      yz: 0,
    };
  } else {
    const axial = (massKg * collision.radius ** 2) / 2,
      transverse =
        (massKg * (3 * collision.radius ** 2 + collision.length ** 2)) / 12;
    tensor = collision.axis[0]
      ? {
          xx: axial,
          yy: transverse,
          zz: transverse,
          xy: 0,
          xz: 0,
          yz: 0,
        }
      : {
          xx: transverse,
          yy: transverse,
          zz: axial,
          xy: 0,
          xz: 0,
          yz: 0,
        };
  }
  return completeMassProperties({
    sourceKind: "uniform-collision-solid-v1",
    massEvaluationPolicy: "analytic-runtime-primitive-v1",
    massKg,
    volumeM3: volumeOf(collision),
    comPositionPartM: [0, 0, 0],
    inertiaTensorAtComPartKgM2: tensor,
    contributingSolidIds: ["collision-solid"],
  });
}

function mechanismCollisionPrimitive(region, semanticRegions = []) {
  const geometry = region.geometry,
    common = {
      position: [...region.framePart.positionM],
      orientation: [...region.framePart.orientation],
      semanticKey: region.semanticKey,
      materialKey: region.materialKey,
      contactRole: region.contactRole,
    };
  if (geometry.kind === "box-v1")
    return { ...common, kind: "box", size: [...geometry.fullSizeM] };
  if (geometry.kind === "sphere-v1")
    return {
      ...common,
      kind: "cylinder",
      radius: geometry.radiusM,
      length: geometry.radiusM * 2,
      axis: [0, 0, 1],
    };
  if (geometry.kind === "cylinder-v1")
    return {
      ...common,
      kind: "cylinder",
      radius: geometry.radiusM,
      length: geometry.axialLengthM,
      axis: [0, 0, 1],
    };
  if (geometry.kind === "rounded-wheel-v1")
    return {
      ...common,
      kind: "cylinder",
      radius: geometry.radiusM,
      length: geometry.widthM,
      axis: [0, 0, 1],
      roundedWheel: structuredClone(geometry),
      semanticRegions: structuredClone(semanticRegions),
    };
  throw new Error(
    `Mechanism collision geometry ${geometry.kind} has no runtime projection`,
  );
}

function mechanismDescriptorForPart(part, catalog) {
  const compiled = compileMechanismBodyGeometry({
      sourcePartId: part.id,
      component: part.mechanism,
      positionWorldM: part.pos,
      orientationWorld: part.orientation,
      scale: finiteScale3(part.scale),
    }),
    body = compiled.body,
    portFrames = {};
  for (const descriptor of componentPorts(part, catalog)) {
    if (!descriptor.localFramePart) continue;
    const axis = rotateVectorByQuaternion(
      [0, 0, 1],
      descriptor.localFramePart.orientation,
    );
    portFrames[descriptor.id] = {
      position: [...descriptor.localFramePart.positionM],
      normal: [...axis],
      axis: [...axis],
      clearanceM: 0,
      localFramePart: structuredClone(descriptor.localFramePart),
    };
  }
  const dimensions = [0, 1, 2].map(
      (axis) =>
        body.boundsPartM.maximumM[axis] - body.boundsPartM.minimumM[axis],
    ),
    hasTireEnvelope = body.collisionRegions.some(
      (region) => region.contactRole === "tire-envelope",
    ),
    physicalCollisionRegions = hasTireEnvelope
      ? body.collisionRegions.filter(
          (region) => region.contactRole === "tire-envelope",
        )
      : body.collisionRegions,
    collisionPrimitives = physicalCollisionRegions.map((region) =>
      mechanismCollisionPrimitive(
        region,
        hasTireEnvelope ? body.collisionRegions : [],
      ),
    );
  return deepFreeze({
    schemaVersion: 1,
    type: part.type,
    collisionPrimitives,
    collisionRegions: structuredClone(body.collisionRegions),
    portFrames,
    dimensions,
    massKg: body.massProperties.massKg,
    massProperties: structuredClone(body.massProperties),
    displacementM3: collisionPrimitives.reduce(
      (total, primitive) => total + volumeOf(primitive),
      0,
    ),
    boundsPartM: structuredClone(body.boundsPartM),
    aerodynamicSurfaces: [
      {
        areaM2: Math.max(
          dimensions[0] * dimensions[1],
          dimensions[0] * dimensions[2],
          dimensions[1] * dimensions[2],
        ),
        dragCoefficient: FLIGHT_MATERIALS.default.cd,
        liftSlope: 0,
      },
    ],
    renderDetailAnchors: {
      center: [0, 1, 2].map(
        (axis) =>
          (body.boundsPartM.minimumM[axis] + body.boundsPartM.maximumM[axis]) /
          2,
      ),
      axis: [0, 0, 1],
      ports: Object.fromEntries(
        Object.entries(portFrames).map(([port, value]) => [
          port,
          [...value.position],
        ]),
      ),
    },
    compiledMechanismBody: structuredClone(body),
    topologyDigest: compiled.topologyDigest,
    aerothermal: {
      material: structuredClone(FLIGHT_MATERIALS.default),
      noseRadiusM: Math.max(0.025, Math.min(dimensions[0], dimensions[2]) / 2),
    },
  });
}

/**
 * Canonical physical/render descriptor for one component instance. Collision,
 * port frames, dimensions, mass/displacement, aero surfaces, and render anchors
 * are generated without Three.js or Cannon.
 * @param {any} part
 * @param {any} [catalog]
 */
export function geometryDescriptorForPart(part, catalog = TYPES) {
  if (isMechanismComponentType(part?.type))
    return mechanismDescriptorForPart(part, catalog);
  const type = part?.type,
    config = resolveComponentConfig(part, undefined, catalog),
    scale = finiteScale3(part?.scale),
    collision = collisionFor(type, config, scale),
    portFrames = specializedPortFrames(type, config, catalog);
  for (const value of Object.values(portFrames)) {
    value.position = scaled(value.position, scale);
    value.normal = finiteVector3(value.normal);
    value.axis = finiteVector3(value.axis);
  }
  const material = FLIGHT_MATERIALS[type] || FLIGHT_MATERIALS.default,
    massKg = Number(part?.mass ?? catalog[type]?.mass ?? 1),
    dimensions =
      collision.kind === "box"
        ? [...collision.size]
        : collision.axis[0]
          ? [collision.length, collision.radius * 2, collision.radius * 2]
          : [collision.radius * 2, collision.radius * 2, collision.length];
  return deepFreeze({
    schemaVersion: 1,
    type,
    collisionPrimitives: [collision],
    portFrames,
    dimensions,
    massKg,
    massProperties: massPropertiesForCollision(collision, massKg),
    displacementM3: volumeOf(collision),
    boundsPartM: {
      minimumM: dimensions.map((value) => -value / 2),
      maximumM: dimensions.map((value) => value / 2),
    },
    aerodynamicSurfaces: [
      {
        areaM2: Math.max(
          dimensions[0] * dimensions[1],
          dimensions[0] * dimensions[2],
          dimensions[1] * dimensions[2],
        ),
        dragCoefficient: material.cd,
        liftSlope: Number(config.liftSlope || 0),
      },
    ],
    renderDetailAnchors: {
      center: [0, 0, 0],
      axis: axisFor(type),
      ports: Object.fromEntries(
        Object.entries(portFrames).map(([port, value]) => [
          port,
          [...value.position],
        ]),
      ),
    },
    aerothermal: {
      material: structuredClone(material),
      noseRadiusM: Math.max(
        0.025,
        Number(config.noseRadius || Math.min(dimensions[0], dimensions[2]) / 2),
      ),
    },
  });
}

/**
 * @param {string} type
 * @param {any} [catalog]
 */
export function geometryDescriptorForType(type, catalog = TYPES) {
  if (isMechanismComponentType(type))
    return geometryDescriptorForPart(
      {
        id: 0,
        type,
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
        mechanism: catalog[type]?.mechanism,
      },
      catalog,
    );
  return geometryDescriptorForPart(
    { type, config: {}, scale: { x: 1, y: 1, z: 1 } },
    catalog,
  );
}
