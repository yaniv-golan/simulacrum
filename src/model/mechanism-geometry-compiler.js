import { decodeMechanismAuthoredComponentOrThrow } from "./mechanism-authored-components.js";
import {
  canonicalId,
  canonicalQuaternion,
  deepFreeze,
  DomainValidationError,
  finiteScale3,
  finiteVector3,
  stableStringify,
} from "./primitives.js";
import { sha256Hex } from "./sha256.js";

const IDENTITY_QUATERNION = Object.freeze([0, 0, 0, 1]);
const IDENTITY_MATRIX = Object.freeze([
  Object.freeze([1, 0, 0]),
  Object.freeze([0, 1, 0]),
  Object.freeze([0, 0, 1]),
]);

function fail(code, message, path = [], details = null) {
  throw new DomainValidationError(code, message, { path, details });
}

const add = (left, right) => left.map((value, axis) => value + right[axis]);
const subtract = (left, right) =>
  left.map((value, axis) => value - right[axis]);
const multiply = (vector, scalar) => vector.map((value) => value * scalar);
const dot = (left, right) =>
  left.reduce((total, value, axis) => total + value * right[axis], 0);
const cross = (left, right) => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];

function quaternionMatrix([x, y, z, w]) {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

function multiplyMatrix(left, right) {
  return left.map((row) =>
    right[0].map((_, column) =>
      row.reduce(
        (total, value, index) => total + value * right[index][column],
        0,
      ),
    ),
  );
}

const transpose = (matrix) =>
  matrix[0].map((_, column) => matrix.map((row) => row[column]));
const transformVector = (matrix, vector) =>
  matrix.map((row) => dot(row, vector));

function tensorMatrix(tensor) {
  return [
    [tensor.xx, tensor.xy, tensor.xz],
    [tensor.xy, tensor.yy, tensor.yz],
    [tensor.xz, tensor.yz, tensor.zz],
  ];
}

function tensorRecord(matrix) {
  return {
    xx: matrix[0][0],
    yy: matrix[1][1],
    zz: matrix[2][2],
    xy: (matrix[0][1] + matrix[1][0]) / 2,
    xz: (matrix[0][2] + matrix[2][0]) / 2,
    yz: (matrix[1][2] + matrix[2][1]) / 2,
  };
}

function addMatrices(left, right) {
  return left.map((row, rowIndex) =>
    row.map((value, columnIndex) => value + right[rowIndex][columnIndex]),
  );
}

function rotateTensor(tensor, orientation) {
  const rotation = quaternionMatrix(orientation);
  return multiplyMatrix(
    multiplyMatrix(rotation, tensorMatrix(tensor)),
    transpose(rotation),
  );
}

function parallelAxis(massKg, offset) {
  const distanceSquared = dot(offset, offset);
  return IDENTITY_MATRIX.map((row, rowIndex) =>
    row.map(
      (identity, columnIndex) =>
        massKg *
        (distanceSquared * identity - offset[rowIndex] * offset[columnIndex]),
    ),
  );
}

function principalInertia(tensor, { normalizeScale = false } = {}) {
  const sourceMatrix = tensorMatrix(tensor),
    tensorScale = Math.max(...sourceMatrix.flat().map(Math.abs)),
    normalization = normalizeScale && tensorScale > 0 ? tensorScale : 1,
    matrix = sourceMatrix.map((row) =>
      row.map((value) => value / normalization),
    ),
    axes = IDENTITY_MATRIX.map((row) => [...row]),
    pairs = [
      [0, 1],
      [0, 2],
      [1, 2],
    ],
    comparisonScale = normalizeScale
      ? 1
      : Math.max(1, tensor.xx, tensor.yy, tensor.zz);
  for (let iteration = 0; iteration < 32; iteration++) {
    const [p, q] = pairs.reduce((selected, candidate) =>
      Math.abs(matrix[candidate[0]][candidate[1]]) >
      Math.abs(matrix[selected[0]][selected[1]])
        ? candidate
        : selected,
    );
    if (Math.abs(matrix[p][q]) <= comparisonScale * 1e-14) break;
    const difference = matrix[q][q] - matrix[p][p],
      tau = difference / (2 * matrix[p][q]),
      tangent =
        tau === 0
          ? 1
          : Math.sign(tau) / (Math.abs(tau) + Math.sqrt(1 + tau ** 2)),
      cosine = 1 / Math.sqrt(1 + tangent ** 2),
      sine = tangent * cosine,
      app = matrix[p][p],
      aqq = matrix[q][q],
      apq = matrix[p][q];
    matrix[p][p] =
      cosine ** 2 * app - 2 * sine * cosine * apq + sine ** 2 * aqq;
    matrix[q][q] =
      sine ** 2 * app + 2 * sine * cosine * apq + cosine ** 2 * aqq;
    matrix[p][q] = 0;
    matrix[q][p] = 0;
    for (let index = 0; index < 3; index++) {
      if (index !== p && index !== q) {
        const aip = matrix[index][p],
          aiq = matrix[index][q];
        matrix[index][p] = cosine * aip - sine * aiq;
        matrix[p][index] = matrix[index][p];
        matrix[index][q] = sine * aip + cosine * aiq;
        matrix[q][index] = matrix[index][q];
      }
      const vip = axes[index][p],
        viq = axes[index][q];
      axes[index][p] = cosine * vip - sine * viq;
      axes[index][q] = sine * vip + cosine * viq;
    }
  }
  const ordered = [0, 1, 2]
      .map((index) => ({
        moment: matrix[index][index] * normalization,
        axis: axes.map((row) => row[index]),
        index,
      }))
      .sort(
        (left, right) => left.moment - right.moment || left.index - right.index,
      ),
    first = ordered[0].axis,
    second = ordered[1].axis;
  for (const axis of [first, second]) {
    const firstNonzero = axis.find((value) => Math.abs(value) > 1e-14);
    if (firstNonzero < 0)
      for (let index = 0; index < axis.length; index++) axis[index] *= -1;
  }
  const third = cross(first, second),
    thirdLength = Math.hypot(...third);
  return {
    principalMomentsKgM2: ordered.map(({ moment }) => moment),
    principalAxesPart: [first, second, multiply(third, 1 / thirdLength)],
    decompositionPolicy: normalizeScale
      ? "ordered-right-handed-scale-normalized-jacobi-v1"
      : "ordered-right-handed-jacobi-v1",
  };
}

function withPrincipalInertia(properties, options) {
  const completed = {
    ...properties,
    ...principalInertia(properties.inertiaTensorAtComPartKgM2, options),
  };
  if (
    completed.principalMomentsKgM2.some(
      (value) => typeof value !== "number" || !Number.isFinite(value),
    ) ||
    completed.principalAxesPart.some(
      (axis) =>
        !Array.isArray(axis) || axis.some((value) => !Number.isFinite(value)),
    )
  )
    throw new RangeError("principal inertia decomposition must remain finite");
  return completed;
}

export function completeMassProperties(properties, options) {
  return deepFreeze(withPrincipalInertia(structuredClone(properties), options));
}

function primitiveMassProperties(geometry, densityKgPerM3) {
  if (geometry.kind === "box-v1") {
    const [x, y, z] = geometry.fullSizeM,
      volumeM3 = x * y * z,
      massKg = densityKgPerM3 * volumeM3;
    return {
      volumeM3,
      massKg,
      comPositionM: [0, 0, 0],
      inertiaTensorAtComKgM2: {
        xx: (massKg * (y * y + z * z)) / 12,
        yy: (massKg * (x * x + z * z)) / 12,
        zz: (massKg * (x * x + y * y)) / 12,
        xy: 0,
        xz: 0,
        yz: 0,
      },
    };
  }
  if (geometry.kind === "sphere-v1") {
    const radius = geometry.radiusM,
      volumeM3 = (4 * Math.PI * radius ** 3) / 3,
      massKg = densityKgPerM3 * volumeM3,
      inertia = (2 * massKg * radius ** 2) / 5;
    return {
      volumeM3,
      massKg,
      comPositionM: [0, 0, 0],
      inertiaTensorAtComKgM2: {
        xx: inertia,
        yy: inertia,
        zz: inertia,
        xy: 0,
        xz: 0,
        yz: 0,
      },
    };
  }
  if (geometry.kind === "cylinder-v1") {
    const radius = geometry.radiusM,
      length = geometry.axialLengthM,
      volumeM3 = Math.PI * radius ** 2 * length,
      massKg = densityKgPerM3 * volumeM3,
      transverse = (massKg * (3 * radius ** 2 + length ** 2)) / 12;
    return {
      volumeM3,
      massKg,
      comPositionM: [0, 0, 0],
      inertiaTensorAtComKgM2: {
        xx: transverse,
        yy: transverse,
        zz: (massKg * radius ** 2) / 2,
        xy: 0,
        xz: 0,
        yz: 0,
      },
    };
  }
  if (geometry.kind === "capsule-v1") {
    const radius = geometry.radiusM,
      length = geometry.straightLengthM,
      cylinderVolume = Math.PI * radius ** 2 * length,
      sphereVolume = (4 * Math.PI * radius ** 3) / 3,
      cylinderMass = densityKgPerM3 * cylinderVolume,
      sphereMass = densityKgPerM3 * sphereVolume,
      volumeM3 = cylinderVolume + sphereVolume,
      massKg = cylinderMass + sphereMass,
      capCentroidOffset = length / 2 + (3 * radius) / 8,
      transverse =
        (cylinderMass * (3 * radius ** 2 + length ** 2)) / 12 +
        sphereMass * ((83 * radius ** 2) / 320 + capCentroidOffset ** 2),
      axial =
        (cylinderMass * radius ** 2) / 2 + (2 * sphereMass * radius ** 2) / 5;
    return {
      volumeM3,
      massKg,
      comPositionM: [0, 0, 0],
      inertiaTensorAtComKgM2: {
        xx: transverse,
        yy: transverse,
        zz: axial,
        xy: 0,
        xz: 0,
        yz: 0,
      },
    };
  }
  if (geometry.kind === "rounded-wheel-v1")
    return roundedWheelMassProperties(geometry, densityKgPerM3);
  return meshMassProperties(geometry, densityKgPerM3);
}

function roundedWheelMassProperties(geometry, densityKgPerM3) {
  const radius = geometry.radiusM,
    halfWidth = geometry.widthM / 2,
    shoulder = geometry.shoulderRadiusM,
    straightHalfWidth = halfWidth - shoulder,
    panels = 1024,
    step = (2 * halfWidth) / panels;
  let volumeIntegral = 0,
    axialIntegral = 0,
    transverseIntegral = 0;
  const radialExtent = (z) => {
    const absolute = Math.abs(z);
    if (absolute <= straightHalfWidth) return radius;
    const shoulderOffset = absolute - straightHalfWidth;
    return (
      radius -
      shoulder +
      Math.sqrt(Math.max(0, shoulder ** 2 - shoulderOffset ** 2))
    );
  };
  for (let index = 0; index <= panels; index++) {
    const z = -halfWidth + index * step,
      radial = radialExtent(z),
      radialSquared = radial ** 2,
      weight = index === 0 || index === panels ? 1 : index % 2 ? 4 : 2;
    volumeIntegral += weight * Math.PI * radialSquared;
    axialIntegral += (weight * (Math.PI * radialSquared ** 2)) / 2;
    transverseIntegral +=
      weight *
      ((Math.PI * radialSquared ** 2) / 4 + Math.PI * z ** 2 * radialSquared);
  }
  const factor = step / 3,
    volumeM3 = volumeIntegral * factor,
    massKg = densityKgPerM3 * volumeM3,
    axial = densityKgPerM3 * axialIntegral * factor,
    transverse = densityKgPerM3 * transverseIntegral * factor;
  return {
    volumeM3,
    massKg,
    comPositionM: [0, 0, 0],
    inertiaTensorAtComKgM2: {
      xx: transverse,
      yy: transverse,
      zz: axial,
      xy: 0,
      xz: 0,
      yz: 0,
    },
  };
}

function meshMassProperties(geometry, densityKgPerM3) {
  const coordinateScale = 10 ** geometry.coordinateExponent10,
    vertices = geometry.verticesTicks.map((vertex) =>
      multiply(vertex, coordinateScale),
    );
  let volumeM3 = 0,
    firstMoment = [0, 0, 0],
    xx = 0,
    yy = 0,
    zz = 0,
    xy = 0,
    xz = 0,
    yz = 0;
  for (const [aIndex, bIndex, cIndex] of geometry.triangleIndices) {
    const a = vertices[aIndex],
      b = vertices[bIndex],
      c = vertices[cIndex],
      tetraVolume = dot(a, cross(b, c)) / 6,
      squareIntegral = (axis) =>
        (tetraVolume / 10) *
        (a[axis] ** 2 +
          b[axis] ** 2 +
          c[axis] ** 2 +
          a[axis] * b[axis] +
          a[axis] * c[axis] +
          b[axis] * c[axis]),
      productIntegral = (leftAxis, rightAxis) =>
        (tetraVolume / 20) *
        (2 *
          (a[leftAxis] * a[rightAxis] +
            b[leftAxis] * b[rightAxis] +
            c[leftAxis] * c[rightAxis]) +
          a[leftAxis] * b[rightAxis] +
          a[rightAxis] * b[leftAxis] +
          a[leftAxis] * c[rightAxis] +
          a[rightAxis] * c[leftAxis] +
          b[leftAxis] * c[rightAxis] +
          b[rightAxis] * c[leftAxis]);
    volumeM3 += tetraVolume;
    firstMoment = add(
      firstMoment,
      multiply(add(add(a, b), c), tetraVolume / 4),
    );
    xx += squareIntegral(0);
    yy += squareIntegral(1);
    zz += squareIntegral(2);
    xy += productIntegral(0, 1);
    xz += productIntegral(0, 2);
    yz += productIntegral(1, 2);
  }
  if (!(volumeM3 > 0))
    fail(
      "COMPILED_MASS_MESH_NONPOSITIVE_VOLUME",
      "Mass-property compilation requires a positive-volume closed mesh",
      ["massPropertySource", "massSolids"],
    );
  const massKg = densityKgPerM3 * volumeM3,
    comPositionM = multiply(firstMoment, 1 / volumeM3),
    inertiaAtOrigin = [
      [yy + zz, -xy, -xz],
      [-xy, xx + zz, -yz],
      [-xz, -yz, xx + yy],
    ].map((row) => row.map((value) => value * densityKgPerM3)),
    inertiaAtCom = addMatrices(
      inertiaAtOrigin,
      parallelAxis(-massKg, comPositionM),
    );
  return {
    volumeM3,
    massKg,
    comPositionM,
    inertiaTensorAtComKgM2: tensorRecord(inertiaAtCom),
  };
}

function resolveMassProperties(source) {
  if (source.kind === "explicit-tensor-v1")
    return withPrincipalInertia({
      sourceKind: source.kind,
      massKg: source.massKg,
      comPositionPartM: [...source.comPositionPartM],
      inertiaTensorAtComPartKgM2: structuredClone(
        source.inertiaTensorAtComPartKgM2,
      ),
      contributingSolidIds: [],
    });

  const solids = source.massSolids.map((solid) => {
      const local = primitiveMassProperties(
          solid.geometry,
          source.densityKgPerM3,
        ),
        rotation = quaternionMatrix(solid.localFramePart.orientation),
        comPositionPartM = add(
          solid.localFramePart.positionM,
          transformVector(rotation, local.comPositionM),
        );
      return {
        id: solid.id,
        massKg: local.massKg,
        volumeM3: local.volumeM3,
        comPositionPartM,
        inertiaAtComPart: rotateTensor(
          local.inertiaTensorAtComKgM2,
          solid.localFramePart.orientation,
        ),
      };
    }),
    massKg = solids.reduce((total, solid) => total + solid.massKg, 0),
    comPositionPartM = multiply(
      solids.reduce(
        (total, solid) =>
          add(total, multiply(solid.comPositionPartM, solid.massKg)),
        [0, 0, 0],
      ),
      1 / massKg,
    ),
    inertia = solids.reduce(
      (total, solid) => {
        const offset = subtract(solid.comPositionPartM, comPositionPartM);
        return addMatrices(
          total,
          addMatrices(
            solid.inertiaAtComPart,
            parallelAxis(solid.massKg, offset),
          ),
        );
      },
      [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    );
  return withPrincipalInertia({
    sourceKind: source.kind,
    densityKgPerM3: source.densityKgPerM3,
    massEvaluationPolicy:
      "analytic-primitives-exact-polyhedra-simpson-1024-rounded-profile-v1",
    massKg,
    volumeM3: solids.reduce((total, solid) => total + solid.volumeM3, 0),
    comPositionPartM,
    inertiaTensorAtComPartKgM2: tensorRecord(inertia),
    contributingSolidIds: solids.map((solid) => solid.id),
  });
}

function localBounds(geometry) {
  if (geometry.kind === "box-v1") {
    const half = multiply(geometry.fullSizeM, 0.5);
    return { minimumM: multiply(half, -1), maximumM: half };
  }
  if (geometry.kind === "sphere-v1") {
    const half = [geometry.radiusM, geometry.radiusM, geometry.radiusM];
    return { minimumM: multiply(half, -1), maximumM: half };
  }
  if (geometry.kind === "cylinder-v1") {
    const half = [
      geometry.radiusM,
      geometry.radiusM,
      geometry.axialLengthM / 2,
    ];
    return { minimumM: multiply(half, -1), maximumM: half };
  }
  if (geometry.kind === "capsule-v1") {
    const half = [
      geometry.radiusM,
      geometry.radiusM,
      geometry.straightLengthM / 2 + geometry.radiusM,
    ];
    return { minimumM: multiply(half, -1), maximumM: half };
  }
  if (geometry.kind === "rounded-wheel-v1") {
    const half = [geometry.radiusM, geometry.radiusM, geometry.widthM / 2];
    return { minimumM: multiply(half, -1), maximumM: half };
  }
  const coordinateScale = 10 ** geometry.coordinateExponent10,
    vertices = geometry.verticesTicks.map((vertex) =>
      multiply(vertex, coordinateScale),
    );
  return {
    minimumM: [0, 1, 2].map((axis) =>
      Math.min(...vertices.map((vertex) => vertex[axis])),
    ),
    maximumM: [0, 1, 2].map((axis) =>
      Math.max(...vertices.map((vertex) => vertex[axis])),
    ),
  };
}

function transformedBounds(geometry, frame) {
  const bounds = localBounds(geometry),
    rotation = quaternionMatrix(frame.orientation),
    corners = [];
  for (const x of [bounds.minimumM[0], bounds.maximumM[0]])
    for (const y of [bounds.minimumM[1], bounds.maximumM[1]])
      for (const z of [bounds.minimumM[2], bounds.maximumM[2]])
        corners.push(
          add(frame.positionM, transformVector(rotation, [x, y, z])),
        );
  return {
    minimumM: [0, 1, 2].map((axis) =>
      Math.min(...corners.map((corner) => corner[axis])),
    ),
    maximumM: [0, 1, 2].map((axis) =>
      Math.max(...corners.map((corner) => corner[axis])),
    ),
  };
}

function unionBounds(entries) {
  if (!entries.length) return null;
  return {
    minimumM: [0, 1, 2].map((axis) =>
      Math.min(...entries.map((entry) => entry.minimumM[axis])),
    ),
    maximumM: [0, 1, 2].map((axis) =>
      Math.max(...entries.map((entry) => entry.maximumM[axis])),
    ),
  };
}

function compiledFrames(config) {
  const entries = [];
  for (const [key, value] of [
    ["frame-a", config.frameA],
    ["frame-b", config.frameB],
    ["axle", config.axleFrame],
    ["coordinate-a", config.coordinate?.frameA],
    ["coordinate-b", config.coordinate?.frameB],
  ])
    if (value)
      entries.push({
        id: key,
        framePart: structuredClone(value),
        provenancePath: key.startsWith("coordinate-")
          ? ["config", "coordinate", key.endsWith("a") ? "frameA" : "frameB"]
          : [
              "config",
              key === "axle"
                ? "axleFrame"
                : key === "frame-a"
                  ? "frameA"
                  : "frameB",
            ],
      });
  return entries;
}

/**
 * Pure lowering for one already-authored mechanism component. This is not a
 * portable format and does not query the component catalog or a physics engine.
 */
export function compileMechanismBodyGeometry({
  sourcePartId,
  component,
  positionWorldM,
  orientationWorld,
  scale = [1, 1, 1],
}) {
  const partId = canonicalId(sourcePartId, { path: ["sourcePartId"] }),
    decoded = decodeMechanismAuthoredComponentOrThrow(component),
    authored = decoded.wire,
    resolvedScale = finiteScale3(scale, { path: ["scale"] });
  if (resolvedScale.some((value) => value !== 1))
    fail(
      "MECHANISM_SCALE_FORBIDDEN_BY_POLICY",
      "fixed-authored-size-v1 mechanism geometry must use identity transform scale; edit authored physical dimensions instead",
      ["scale"],
      {
        policy: authored.dimensionalScalingPolicy.kind,
        scale: resolvedScale,
      },
    );
  const positionM = finiteVector3(positionWorldM, { path: ["positionWorldM"] }),
    orientation = canonicalQuaternion(orientationWorld, {
      path: ["orientationWorld"],
    }),
    collisionRegions = authored.collisionRegions.map((region, index) => ({
      id: `collision:${partId}:${region.key}`,
      kind: "collision-region-v1",
      sourcePartIds: [partId],
      sourceConnectionIds: [],
      semanticKey: region.key,
      framePart: structuredClone(region.localFramePart),
      geometry: structuredClone(region.geometry),
      materialKey: region.materialKey,
      contactRole: region.contactRole,
      boundsPartM: transformedBounds(region.geometry, region.localFramePart),
      provenance: [
        {
          target: "framePart",
          sourcePath: ["collisionRegions", index, "localFramePart"],
        },
        {
          target: "geometry",
          sourcePath: ["collisionRegions", index, "geometry"],
        },
        {
          target: "materialKey",
          sourcePath: ["collisionRegions", index, "materialKey"],
        },
        {
          target: "contactRole",
          sourcePath: ["collisionRegions", index, "contactRole"],
        },
      ],
    })),
    body = {
      id: `body:${partId}`,
      kind: "rigid-body-v1",
      sourcePartIds: [partId],
      sourceConnectionIds: [],
      telemetryOwnerId: `body:${partId}`,
      failureGroupId: `part:${partId}`,
      frameWorld: {
        positionM,
        orientation,
      },
      dimensionalScalingPolicy: structuredClone(
        authored.dimensionalScalingPolicy,
      ),
      massProperties: resolveMassProperties(authored.massPropertySource),
      collisionRegions,
      attachmentFrames: compiledFrames(authored.config),
      boundsPartM: unionBounds(
        collisionRegions.map((region) => region.boundsPartM),
      ),
      provenance: [
        { target: "frameWorld.positionM", sourcePath: ["positionWorldM"] },
        {
          target: "frameWorld.orientation",
          sourcePath: ["orientationWorld"],
        },
        {
          target: "dimensionalScalingPolicy",
          sourcePath: ["dimensionalScalingPolicy"],
        },
        { target: "massProperties", sourcePath: ["massPropertySource"] },
        { target: "collisionRegions", sourcePath: ["collisionRegions"] },
      ],
    },
    descriptor = {
      descriptorVersion: 1,
      sourceFingerprint: decoded.fingerprint,
      body,
    },
    topologyDigest = `sim-sha256-${sha256Hex(
      `simulacrum-compiled-mechanism-body-v1\0${stableStringify(descriptor)}`,
    )}`;
  return deepFreeze({ ...descriptor, topologyDigest });
}

export const mechanismGeometryIdentityQuaternion = IDENTITY_QUATERNION;
