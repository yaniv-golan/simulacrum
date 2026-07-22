import { validateMechanismAuthoredComponentWire } from "./generated/portable-machine-wire-validators.js";
import {
  deepFreeze,
  DomainValidationError,
  stableStringify,
} from "./primitives.js";
import { sha256Hex } from "./sha256.js";
import { validateWireInput, wireResult } from "./wire-validation.js";

const QUATERNION_TOLERANCE = 1e-9;

function fail(code, message, path = [], details = null) {
  throw new DomainValidationError(code, message, { path, details });
}

function visit(value, path, operation) {
  operation(value, path);
  if (Array.isArray(value))
    value.forEach((child, index) => visit(child, [...path, index], operation));
  else if (value && typeof value === "object")
    for (const [key, child] of Object.entries(value))
      visit(child, [...path, key], operation);
}

function assertQuaternion(quaternion, path) {
  const normSquared = quaternion.reduce(
    (total, component) => total + component * component,
    0,
  );
  if (Math.abs(normSquared - 1) > QUATERNION_TOLERANCE)
    fail(
      "NON_UNIT_COMPONENT_QUATERNION",
      "Authored component quaternions must have unit length",
      path,
      { normSquared, tolerance: QUATERNION_TOLERANCE },
    );
  const [x, y, z, w] = quaternion,
    canonicalComponents = [w, z, y, x],
    firstNonzero = canonicalComponents.find(
      (component) => Math.abs(component) > Number.EPSILON,
    );
  if (firstNonzero < 0)
    fail(
      "NONCANONICAL_COMPONENT_QUATERNION",
      "Quaternion sign must make the first nonzero [w,z,y,x] component positive",
      path,
    );
}

function determinant3(xx, yy, zz, xy, xz, yz) {
  return (
    xx * yy * zz + 2 * xy * xz * yz - xx * yz ** 2 - yy * xz ** 2 - zz * xy ** 2
  );
}

function assertPositiveSemidefinite(xx, yy, zz, xy, xz, yz) {
  const scale = Math.max(1, Math.abs(xx), Math.abs(yy), Math.abs(zz)),
    minorTolerance = 1e-12 * scale ** 2,
    determinantTolerance = 1e-12 * scale ** 3;
  return (
    xx >= 0 &&
    yy >= 0 &&
    zz >= 0 &&
    xx * yy - xy ** 2 >= -minorTolerance &&
    xx * zz - xz ** 2 >= -minorTolerance &&
    yy * zz - yz ** 2 >= -minorTolerance &&
    determinant3(xx, yy, zz, xy, xz, yz) >= -determinantTolerance
  );
}

function assertPhysicalInertia(tensor, path) {
  const { xx, yy, zz, xy, xz, yz } = tensor,
    determinant = determinant3(xx, yy, zz, xy, xz, yz);
  if (xx * yy - xy ** 2 <= 0 || determinant <= 0)
    fail(
      "NON_POSITIVE_DEFINITE_INERTIA",
      "Explicit inertia tensor must be positive definite",
      path,
    );
  const halfTrace = (xx + yy + zz) / 2;
  if (
    !assertPositiveSemidefinite(
      halfTrace - xx,
      halfTrace - yy,
      halfTrace - zz,
      -xy,
      -xz,
      -yz,
    )
  )
    fail(
      "PHYSICALLY_UNREALIZABLE_INERTIA",
      "Explicit inertia tensor violates rigid-body principal-moment inequalities",
      path,
    );
}

function assertUniqueBy(entries, key, code, path) {
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    if (seen.has(entry[key]))
      fail(code, `${key} values must be unique`, [...path, index, key]);
    seen.add(entry[key]);
  }
}

function assertStrictlyIncreasing(entries, key, path) {
  for (let index = 1; index < entries.length; index++)
    if (entries[index - 1][key] >= entries[index][key])
      fail(
        "NON_MONOTONIC_AUTHORED_CURVE",
        `Authored ${key} coordinates must be strictly increasing`,
        [...path, index, key],
      );
}

function assertCurve(value, path) {
  if (!Array.isArray(value) || value.length < 2) return;
  for (const key of [
    "displacementM",
    "speedMPerS",
    "absSpeedMPerS",
    "normalLoadN",
  ])
    if (value.every((point) => Object.hasOwn(point, key)))
      assertStrictlyIncreasing(value, key, path);
  if (value.every((point) => Object.hasOwn(point, "forceN")))
    for (let index = 1; index < value.length; index++)
      if (value[index].forceN < value[index - 1].forceN)
        fail(
          "NON_PASSIVE_ELASTIC_CURVE",
          "Piecewise elastic force must not decrease with displacement",
          [...path, index, "forceN"],
        );
}

function assertClosedMesh(geometry, path) {
  if (geometry.kind !== "closed-triangle-mesh-v1") return;
  const vertices = geometry.verticesTicks,
    vertexKeys = new Set(vertices.map((vertex) => vertex.join(",")));
  if (vertexKeys.size !== vertices.length)
    fail(
      "DUPLICATE_MESH_VERTEX",
      "Closed mass meshes require unique quantized vertices",
      [...path, "verticesTicks"],
    );
  const edges = new Map();
  for (const [triangleIndex, triangle] of geometry.triangleIndices.entries()) {
    if (triangle.some((index) => index >= vertices.length))
      fail(
        "MESH_INDEX_OUT_OF_RANGE",
        "Closed mass mesh triangle index is outside verticesTicks",
        [...path, "triangleIndices", triangleIndex],
      );
    if (new Set(triangle).size !== 3)
      fail(
        "DEGENERATE_MESH_TRIANGLE",
        "Closed mass mesh triangles require three distinct vertices",
        [...path, "triangleIndices", triangleIndex],
      );
    for (let edgeIndex = 0; edgeIndex < 3; edgeIndex++) {
      const from = triangle[edgeIndex],
        to = triangle[(edgeIndex + 1) % 3],
        key = from < to ? `${from}:${to}` : `${to}:${from}`,
        direction = from < to ? 1 : -1,
        record = edges.get(key) || { count: 0, winding: 0 };
      record.count++;
      record.winding += direction;
      edges.set(key, record);
    }
  }
  if (
    [...edges.values()].some((edge) => edge.count !== 2 || edge.winding !== 0)
  )
    fail(
      "OPEN_OR_INCONSISTENT_MASS_MESH",
      "Mass mesh edges must appear exactly twice with opposite winding",
      [...path, "triangleIndices"],
    );
  const signedVolumeTimesSix = geometry.triangleIndices.reduce(
    (total, [aIndex, bIndex, cIndex]) => {
      const a = vertices[aIndex],
        b = vertices[bIndex],
        c = vertices[cIndex];
      return (
        total +
        a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])
      );
    },
    0,
  );
  if (signedVolumeTimesSix <= 0)
    fail(
      "MASS_MESH_NONPOSITIVE_VOLUME",
      "Closed mass mesh must have positive volume and outward winding",
      [...path, "triangleIndices"],
    );
}

function assertFailureLaw(law, path) {
  if (!law) return;
  const continuous = law.continuousLoad,
    impact = law.impactLoad,
    hasContinuousLimit =
      continuous &&
      (continuous.breakForceN != null || continuous.breakTorqueNm != null),
    hasImpactLimit =
      impact &&
      (impact.breakImpulseNs != null || impact.breakAngularImpulseNms != null);
  if (!hasContinuousLimit && !hasImpactLimit)
    fail(
      "EMPTY_FAILURE_LOAD_LAW",
      "A failure law must declare at least one physical load limit",
      path,
    );
}

function assertComponentSemantics(wire) {
  visit(wire, [], (value, path) => {
    const key = path.at(-1);
    if (key === "orientation") assertQuaternion(value, path);
    if (key === "inertiaTensorAtComPartKgM2")
      assertPhysicalInertia(value, path);
    if (key === "geometry") assertClosedMesh(value, path);
    if (key === "failureLoadLaw") assertFailureLaw(value, path);
    assertCurve(value, path);
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.hasOwn(value, "lower") &&
      Object.hasOwn(value, "upper") &&
      value.lower >= value.upper
    )
      fail(
        "INVALID_AUTHORED_RANGE",
        "Authored lower bound must be less than upper bound",
        path,
      );
  });

  assertUniqueBy(
    wire.collisionRegions,
    "key",
    "DUPLICATE_COLLISION_REGION_KEY",
    ["collisionRegions"],
  );
  if (wire.massPropertySource.kind === "uniform-density-solids-v1")
    assertUniqueBy(
      wire.massPropertySource.massSolids,
      "id",
      "DUPLICATE_MASS_SOLID_ID",
      ["massPropertySource", "massSolids"],
    );

  const config = wire.config;
  if (
    config.endpointPortA != null &&
    config.endpointPortA === config.endpointPortB
  )
    fail(
      "COINCIDENT_MECHANISM_ENDPOINTS",
      "Mechanism endpoint ports must be distinct",
      ["config", "endpointPortB"],
    );
  if (
    config.guideFriction?.kind === "coulomb-viscous-v1" &&
    config.guideFriction.dynamicCoefficient >
      config.guideFriction.staticCoefficient
  )
    fail(
      "INVALID_GUIDE_FRICTION_ORDER",
      "Dynamic guide friction cannot exceed static friction",
      ["config", "guideFriction", "dynamicCoefficient"],
    );
  if (
    config.unpoweredLaw?.kind === "holding-clutch-v1" &&
    config.unpoweredLaw.dynamicForceCapacityN >
      config.unpoweredLaw.staticForceCapacityN
  )
    fail(
      "INVALID_CLUTCH_CAPACITY_ORDER",
      "Dynamic clutch capacity cannot exceed static capacity",
      ["config", "unpoweredLaw", "dynamicForceCapacityN"],
    );
  if (
    config.thermalLimits &&
    config.thermalLimits.derateTemperatureK >=
      config.thermalLimits.shutdownTemperatureK
  )
    fail(
      "INVALID_THERMAL_LIMIT_ORDER",
      "Actuator derate temperature must be below shutdown temperature",
      ["config", "thermalLimits"],
    );
  if (
    config.actuation?.thermalLimits &&
    config.actuation.thermalLimits.derateTemperatureK >=
      config.actuation.thermalLimits.shutdownTemperatureK
  )
    fail(
      "INVALID_THERMAL_LIMIT_ORDER",
      "Actuator derate temperature must be below shutdown temperature",
      ["config", "actuation", "thermalLimits"],
    );
  if (config.actuation && config.angleRangeRad) {
    const commandRange = config.actuation.commandRangeRad;
    if (
      commandRange.lower < config.angleRangeRad.lower ||
      commandRange.upper > config.angleRangeRad.upper
    )
      fail(
        "ACTUATOR_COMMAND_RANGE_EXCEEDS_JOINT_RANGE",
        "Rotary actuator command range must fit within the joint angle range",
        ["config", "actuation", "commandRangeRad"],
      );
  }
  const coordinateRange =
    config.lengthRangeM ||
    config.travelRangeM ||
    config.stroke ||
    config.angleRangeRad;
  if (
    coordinateRange &&
    config.referenceCoordinateM != null &&
    (config.referenceCoordinateM < coordinateRange.lower ||
      config.referenceCoordinateM > coordinateRange.upper)
  )
    fail(
      "REFERENCE_COORDINATE_OUTSIDE_RANGE",
      "Reference coordinate must lie within the authored travel range",
      ["config", "referenceCoordinateM"],
      { coordinateRange },
    );
  if (coordinateRange && config.lowerStop) {
    const engage = config.lowerStop.engageCoordinate;
    if (engage <= coordinateRange.lower || engage > coordinateRange.upper)
      fail(
        "INVALID_LOWER_STOP_COORDINATE",
        "Lower progressive stop must engage above the lower bound and at or below the upper bound",
        ["config", "lowerStop", "engageCoordinate"],
      );
  }
  if (coordinateRange && config.upperStop) {
    const engage = config.upperStop.engageCoordinate;
    if (engage < coordinateRange.lower || engage >= coordinateRange.upper)
      fail(
        "INVALID_UPPER_STOP_COORDINATE",
        "Upper progressive stop must engage below the upper bound and at or above the lower bound",
        ["config", "upperStop", "engageCoordinate"],
      );
  }
  if (config.tireConstitutiveLaw) {
    const tire = config.tireConstitutiveLaw;
    const calibratedRange = tire.calibratedNormalLoadRangeN,
      firstCreepPoint = tire.creepMatrixByLoad[0],
      lastCreepPoint = tire.creepMatrixByLoad.at(-1);
    if (
      firstCreepPoint.normalLoadN !== calibratedRange.lower ||
      lastCreepPoint.normalLoadN !== calibratedRange.upper
    )
      fail(
        "TIRE_CALIBRATION_ENDPOINT_MISMATCH",
        "Tire creep-matrix endpoints must exactly match the calibrated normal-load range",
        ["config", "tireConstitutiveLaw", "creepMatrixByLoad"],
        {
          calibratedRange,
          firstNormalLoadN: firstCreepPoint.normalLoadN,
          lastNormalLoadN: lastCreepPoint.normalLoadN,
        },
      );
    for (const [index, matrix] of tire.creepMatrixByLoad.entries())
      if (matrix.kLongNsPerM * matrix.kLatNsPerM - matrix.kCrossNsPerM ** 2 < 0)
        fail(
          "NON_PASSIVE_TIRE_CREEP_MATRIX",
          "Tire creep matrix must be positive semidefinite",
          ["config", "tireConstitutiveLaw", "creepMatrixByLoad", index],
        );
    const requiredRegions = new Map([
      ["tire-envelope", "tire-envelope"],
      ["sidewall", "sidewall"],
      ["rim", "rim"],
    ]);
    for (const region of wire.collisionRegions)
      if (requiredRegions.get(region.key) === region.contactRole)
        requiredRegions.delete(region.key);
    if (requiredRegions.size)
      fail(
        "MISSING_WHEEL_SEMANTIC_REGION",
        "Wheel collision regions must include tire-envelope, sidewall and rim roles",
        ["collisionRegions"],
        { missing: [...requiredRegions.keys()] },
      );
    if (
      wire.collisionRegions.length !== 3 ||
      wire.collisionRegions.some(
        (region) => !["tire-envelope", "sidewall", "rim"].includes(region.key),
      )
    )
      fail(
        "INVALID_WHEEL_SEMANTIC_REGION_SET",
        "Wheel owns exactly the tire-envelope, sidewall and rim collision regions",
        ["collisionRegions"],
      );
    const envelopeRegion = wire.collisionRegions.find(
      (region) => region.key === "tire-envelope",
    );
    if (
      envelopeRegion.geometry.kind !== "rounded-wheel-v1" ||
      envelopeRegion.geometry.radiusM !== config.radiusM ||
      envelopeRegion.geometry.widthM !== config.widthM ||
      envelopeRegion.geometry.shoulderRadiusM !== config.shoulderRadiusM
    )
      fail(
        "INVALID_WHEEL_ENVELOPE_GEOMETRY",
        "Wheel tire-envelope must use matching rounded-wheel geometry",
        ["collisionRegions"],
      );
    if (
      config.shoulderRadiusM >= config.radiusM ||
      config.shoulderRadiusM * 2 > config.widthM
    )
      fail(
        "INVALID_WHEEL_SHOULDER_GEOMETRY",
        "Wheel shoulder radius must fit within radius and width",
        ["config", "shoulderRadiusM"],
      );
    const rimRegion = wire.collisionRegions.find(
        (region) => region.key === "rim",
      ),
      normalModel = config.tireConstitutiveLaw.normalModel;
    if (
      rimRegion.geometry.kind !== "cylinder-v1" ||
      normalModel.maximumDeflectionM >
        config.radiusM - rimRegion.geometry.radiusM
    )
      fail(
        "INVALID_CARCASS_RIM_CLEARANCE",
        "Radial carcass deflection must fit the authored tire-envelope to rim clearance",
        ["config", "tireConstitutiveLaw", "normalModel"],
      );
    if (
      !normalModel.progressiveStop &&
      normalModel.kRadialNPerM * normalModel.maximumDeflectionM <
        tire.calibratedNormalLoadRangeN.upper
    )
      fail(
        "TIRE_LOAD_RANGE_EXCEEDS_CARCASS_CAPACITY",
        "Tire calibrated load range must fit the radial foundation before rim contact",
        ["config", "tireConstitutiveLaw", "calibratedNormalLoadRangeN"],
        {
          calibratedUpperN: tire.calibratedNormalLoadRangeN.upper,
          foundationCapacityN:
            normalModel.kRadialNPerM * normalModel.maximumDeflectionM,
        },
      );
  }
}

function decode(input) {
  const envelope = validateWireInput(
      input,
      "mechanism-authored-component",
      validateMechanismAuthoredComponentWire,
    ),
    wire = envelope.value;
  assertComponentSemantics(wire);
  return deepFreeze({
    wire,
    fingerprint: `sim-sha256-${sha256Hex(
      `simulacrum-authored-mechanism-component-v1\0${stableStringify(wire)}`,
    )}`,
    envelope: { bytes: envelope.bytes, nodes: envelope.nodes },
  });
}

/** Total strict decoder for the compiler-input contract, not a save format. */
export function decodeMechanismAuthoredComponent(input) {
  return wireResult(() => decode(input));
}

export function decodeMechanismAuthoredComponentOrThrow(input) {
  const result = decodeMechanismAuthoredComponent(input);
  if (result.ok) return result.value;
  const first = result.errors[0];
  throw new DomainValidationError(first.code, first.message, {
    path: first.path,
    details: first.details,
  });
}

export function encodeMechanismAuthoredComponent(input) {
  return stableStringify(decodeMechanismAuthoredComponentOrThrow(input).wire);
}

export function fingerprintMechanismAuthoredComponent(input) {
  return decodeMechanismAuthoredComponentOrThrow(input).fingerprint;
}
