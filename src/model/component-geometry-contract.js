import { FLIGHT_MATERIALS, TYPES } from "./component-catalog.js";
import { componentPorts } from "./component-contracts.js";
import {
  clampMechanismCoordinate,
  deformationAxialScale,
  deformationAxialTranslation,
  equalRadialScale,
  gearPitchConsistent,
} from "./component-geometry-decisions.js";
import { resolveComponentConfig } from "./component-resolver.js";
import {
  compileMechanismBodyGeometry,
  completeMassProperties,
} from "./mechanism-geometry-compiler.js";
import {
  canonicalQuaternion,
  deepFreeze,
  DomainValidationError,
  finiteNumber,
  finiteScale3,
  finiteVector3,
  quaternionFromEulerXYZ,
  rotateVectorByQuaternion,
  stableStringify,
} from "./primitives.js";
import { validateRotorConfig } from "./rotor-aerodynamics-contracts.js";
import { sha256Hex } from "./sha256.js";

/** @typedef {"rigid-static-v1"|"mechanism-deformed-v1"|"runtime-flexible-v1"} GeometryClassV1 */
/** @typedef {"spatial-mechanical"|"resource-attachment"|"flexible-line-attachment"|"network-only"} PortSpatialClassV1 */
/** @typedef {{positionM:number[],orientation:number[]}} GeometryFrameV2 */
/** @typedef {{framePart:GeometryFrameV2,clearanceM:number,anchorPolicy:"fixed-point-v1"|"surface-point-v1"}} PortFrameV2 */
/** @typedef {{minimumM:number[],maximumM:number[]}} GeometryBoundsV1 */
/** @typedef {{kind:"box-v1",fullSizeM:number[]}|{kind:"rounded-box-v1",fullSizeM:number[],radiusM:number}|{kind:"cylinder-v1",radiusM:number,axialLengthM:number}|{kind:"elliptic-cylinder-v1",radiusXM:number,radiusYM:number,axialLengthM:number}|{kind:"sphere-v1",radiusM:number}|{kind:"capsule-v1",radiusM:number,cylinderLengthM:number}|{kind:"cone-v1",startRadiusM:number,endRadiusM:number,axialLengthM:number}|{kind:"rounded-wheel-v1",radiusM:number,widthM:number,shoulderRadiusM:number}|{kind:"spur-gear-v1",toothCount:number,toothPhaseRad:number,pitchRadiusM:number,pressureAngleRad:number,moduleM:number,axialThicknessM:number,rootRadiusM:number,tipRadiusM:number,boreRadiusM:number,hubRadiusM:number|null,hubThicknessM:number|null}|{kind:"helical-spring-v1",meanCoilRadiusM:number,wireRadiusM:number,activeTurns:number,endTreatment:"plain-v1"|"closed-ground-v1",referenceAxialLengthM:number}|{kind:"extruded-profile-v1",pointsM:number[][],axialThicknessM:number}} PrimitiveGeometryV1 */
/** @typedef {{id:string,framePart:GeometryFrameV2,geometry:PrimitiveGeometryV1,semanticKey:string,materialKey:string,contactRole:string,approximationOf:string|null,semanticRegions:unknown[]}} BodyPrimitiveV1 */
/** @typedef {BodyPrimitiveV1} CollisionPrimitiveV1 */
/** @typedef {{kind:"port-frame-v1",portId:string,offsetM:number[]}} PhysicalFeatureAnchorV1 */
/** @typedef {{radiusM:number,lengthM:number}|{radiusXM:number,radiusYM:number,lengthM:number}} PhysicalFeatureDimensionsV1 */
/** @typedef {{id:string,primitive:"cylinder-v1"|"elliptic-cylinder-v1",anchor:PhysicalFeatureAnchorV1,dimensions:PhysicalFeatureDimensionsV1,axialOrigin:"center-v1"|"start-v1"|"end-v1",role:"physical-interface",materialKey:string}} PhysicalFeatureV1 */
/** @typedef {{minimum:number,maximum:number}} GeometryAllowedRangeV1 */
/** @typedef {{id:string,kind:"anchor-local-z-scale-v1",primitiveIds:string[]}|{id:string,kind:"local-z-translation-v1",primitiveIds:string[],gainMPerM:number}} MechanismPrimitiveProjectionV1 */
/** @typedef {{id:string,projections:MechanismPrimitiveProjectionV1[],referenceCoordinateM:number,referenceBodyLengthM:number,allowedCoordinateRangeM:GeometryAllowedRangeV1}} MechanismDeformationCoordinateV1 */
/** @typedef {{kind:"mechanism-deformation-v1",coordinates:MechanismDeformationCoordinateV1[]}} MechanismDeformationContractV1 */
/** @typedef {{kind:"flexible-line-runtime-geometry-v1",endpointPortIds:string[],diameterM:number,maximumSegmentCount:number,materialKey:string,styleKey:"rope-v1",telemetryProjection:"completed-centerline-v1"}} FlexibleRuntimeGeometryContractV1 */
/** @typedef {{xx:number,yy:number,zz:number,xy:number,xz:number,yz:number}} InertiaTensorV1 */
/** @typedef {{sourceKind:string,massEvaluationPolicy:string,massKg:number,volumeM3:number,comPositionPartM:number[],inertiaTensorAtComPartKgM2:InertiaTensorV1,contributingSolidIds:string[],principalMomentsKgM2:number[],principalAxesPart:number[][],decompositionPolicy:string}} GeometryMassPropertiesV1 */
/** @typedef {{areaM2:number,dragCoefficient:number,liftSlope:number}} GeometryAerodynamicSurfaceV1 */
/** @typedef {{heatLimit:number,specificHeat:number,emissivity:number,cd:number,ablative?:boolean,pyrolysisTemperatureK?:number,heatOfAblationJkg?:number}} GeometryAerothermalMaterialV1 */
/** @typedef {{material:GeometryAerothermalMaterialV1,noseRadiusM:number}} GeometryAerothermalV1 */
/** @typedef {{projection:"collision"|"body"|"feature",id:string,definitionPath:string}} GeometryProjectionSourceV1 */
/** @typedef {{id:string,approximationOf:string}} GeometryApproximationV1 */
/** @typedef {{kind:"component-geometry-definition-v2",definitionKind:string,definitionVersion:number,definitionDigest:string,topologyDigest:string|null,sources:GeometryProjectionSourceV1[],approximations:GeometryApproximationV1[]}} GeometryProvenanceV2 */
/** @typedef {{schemaVersion:2,type:string,geometryClass:GeometryClassV1,collisionPrimitives:CollisionPrimitiveV1[],bodyPrimitives:BodyPrimitiveV1[],portClasses:Record<string,PortSpatialClassV1>,portFrames:Record<string,PortFrameV2>,physicalFeatures:PhysicalFeatureV1[],deformationContract:MechanismDeformationContractV1|null,runtimeGeometryContract:FlexibleRuntimeGeometryContractV1|null,collisionBoundsPartM:GeometryBoundsV1|null,bodyBoundsPartM:GeometryBoundsV1|null,featureBoundsPartM:GeometryBoundsV1|null,selectionBoundsPartM:GeometryBoundsV1|null,overallPhysicalBoundsPartM:GeometryBoundsV1|null,massKg:number,massProperties:GeometryMassPropertiesV1,displacementM3:number,aerodynamicSurfaces:GeometryAerodynamicSurfaceV1[],aerothermal:GeometryAerothermalV1,provenance:GeometryProvenanceV2}} GeometryDescriptorV2 */
/** @typedef {{id:string,kind:string,behavior:string,direction:string,multiplicity:string}} ComponentGeometryPortDefinition */
/** @typedef {Record<string,unknown> & {geometryContract:ComponentGeometryDefinitionV2,ports:ComponentGeometryPortDefinition[],mass?:number,size?:number[],mechanism?:unknown,flexibleLine?:unknown}} ComponentGeometryCatalogEntry */
/** @typedef {Record<string,ComponentGeometryCatalogEntry>} ComponentGeometryCatalog */
/** @typedef {Record<string,unknown> & {schemaVersion:number,kind:"primitive-component-geometry-v1"|"mechanism-component-geometry-v1"|"flexible-line-component-geometry-v1"|"radial-rotor-component-geometry-v1",geometryClass:GeometryClassV1,dimensionalScalingPolicy:"fixed-authored-size-v1"|"uniform-similarity-v1"|"axis-aligned-affine-v1",portFrames:Record<string,unknown>,collisionPrimitives:unknown[]|Record<string,unknown>,bodyPrimitives:unknown[]|Record<string,unknown>,physicalFeatures:unknown[],deformationContract:MechanismDeformationContractV1|null}} ComponentGeometryDefinitionV2 */
/** @typedef {{type:string,id?:string|number,pos?:number[],orientation?:number[],scale?:number[]|{x:number,y:number,z:number},config?:Record<string,unknown>,mechanism?:unknown,mass?:number}} ComponentGeometryPartInput */

export const COMPONENT_GEOMETRY_SCHEMA_VERSION = 2;
export const GEOMETRY_CLASSES = Object.freeze([
  "rigid-static-v1",
  "mechanism-deformed-v1",
  "runtime-flexible-v1",
]);
export const PORT_SPATIAL_CLASSES = Object.freeze([
  "spatial-mechanical",
  "resource-attachment",
  "flexible-line-attachment",
  "network-only",
]);
export const GEOMETRY_PRIMITIVE_KINDS = Object.freeze([
  "box-v1",
  "rounded-box-v1",
  "cylinder-v1",
  "elliptic-cylinder-v1",
  "sphere-v1",
  "capsule-v1",
  "cone-v1",
  "rounded-wheel-v1",
  "spur-gear-v1",
  "helical-spring-v1",
  "extruded-profile-v1",
]);
export const PHYSICAL_FEATURE_ROLES = Object.freeze(["physical-interface"]);
export const FEATURE_AXIAL_ORIGINS = Object.freeze([
  "center-v1",
  "start-v1",
  "end-v1",
]);
export const CONNECTION_FRAME_TOLERANCES_V1 = Object.freeze({
  positionM: 1e-6,
  axisDot: 1e-8,
});

const GEOMETRY_CLASS_SET = new Set(GEOMETRY_CLASSES);
const PORT_CLASS_SET = new Set(PORT_SPATIAL_CLASSES);
const PRIMITIVE_KIND_SET = new Set(GEOMETRY_PRIMITIVE_KINDS);
const COLLISION_PRIMITIVE_KIND_SET = new Set([
  "box-v1",
  "cylinder-v1",
  "elliptic-cylinder-v1",
  "sphere-v1",
  "capsule-v1",
  "cone-v1",
  "rounded-wheel-v1",
]);
const FEATURE_ORIGIN_SET = new Set(FEATURE_AXIAL_ORIGINS);
const NETWORK_BEHAVIORS = new Set(["electrical-network", "signal-network"]);
const FLEXIBLE_BEHAVIORS = new Set(["flexible-termination"]);
const RESOURCE_BEHAVIORS = new Set(["material-resource", "compressible-gas"]);
const SPATIAL_BEHAVIORS = new Set([
  "fixed",
  "structural-surface",
  "rotary-coupling",
  "revolute-support",
  "rotary-actuator-output",
  "rotary-position-actuator-output",
  "linear-guide-output",
  "linear-position-actuator-output",
  "rotary-measurement",
  "gear",
]);
const deformationProjectionPlans = new WeakMap();
const IDENTITY_FRAME = Object.freeze({
  positionM: Object.freeze([0, 0, 0]),
  orientation: Object.freeze([0, 0, 0, 1]),
});
const BUILT_IN_GEOMETRY_CATALOG = /** @type {ComponentGeometryCatalog} */ (
  /** @type {unknown} */ (TYPES)
);

function fail(code, message, path = [], details = undefined) {
  throw new DomainValidationError(code, message, { path, details });
}

function closedKeys(value, expected, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(
      "INVALID_GEOMETRY_RECORD",
      `${path.join(".")} must be an object`,
      path,
    );
  const allowed = new Set(expected);
  for (const key of Object.keys(value))
    if (!allowed.has(key))
      fail(
        "UNKNOWN_GEOMETRY_FIELD",
        `${path.join(".")} contains unknown field ${key}`,
        [...path, key],
      );
  for (const key of expected)
    if (!Object.hasOwn(value, key))
      fail("MISSING_GEOMETRY_FIELD", `${path.join(".")} is missing ${key}`, [
        ...path,
        key,
      ]);
}

function finitePositive(value, path) {
  if (!Number.isFinite(value) || value <= 0)
    fail(
      "INVALID_GEOMETRY_DIMENSION",
      `${path.join(".")} must be positive`,
      path,
      {
        value,
      },
    );
  return Number(value);
}

function frame(positionM = [0, 0, 0], orientation = [0, 0, 0, 1]) {
  return {
    positionM: finiteVector3(positionM),
    orientation: canonicalQuaternion(orientation),
  };
}

function scaledFrame(source, scale) {
  return frame(
    source.positionM.map((value, axis) => value * scale[axis]),
    source.orientation,
  );
}

function portClass(descriptor) {
  if (NETWORK_BEHAVIORS.has(descriptor.behavior)) return "network-only";
  if (FLEXIBLE_BEHAVIORS.has(descriptor.behavior))
    return "flexible-line-attachment";
  if (RESOURCE_BEHAVIORS.has(descriptor.behavior)) return "resource-attachment";
  if (SPATIAL_BEHAVIORS.has(descriptor.behavior)) return "spatial-mechanical";
  fail(
    "UNKNOWN_PORT_SPATIAL_CLASS",
    `Port behavior ${String(descriptor.behavior)} has no geometry class`,
    ["ports", descriptor.id, "behavior"],
  );
}

function validateScalePolicy(geometryDefinition, scale) {
  const policy = geometryDefinition.dimensionalScalingPolicy,
    identity = scale.every((value) => Math.abs(value - 1) <= 1e-12),
    uniform = scale.every((value) => Math.abs(value - scale[0]) <= 1e-12);
  if (policy === "fixed-authored-size-v1" && !identity)
    fail(
      "GEOMETRY_SCALE_POLICY_VIOLATION",
      "Component geometry has fixed authored dimensions",
      ["scale"],
    );
  if (policy === "uniform-similarity-v1" && !uniform)
    fail(
      "GEOMETRY_SCALE_POLICY_VIOLATION",
      "Component geometry requires uniform scale",
      ["scale"],
    );
  if (
    ![
      "fixed-authored-size-v1",
      "uniform-similarity-v1",
      "axis-aligned-affine-v1",
    ].includes(policy)
  )
    fail(
      "UNKNOWN_GEOMETRY_SCALE_POLICY",
      `Unknown geometry scale policy ${String(policy)}`,
    );
}

function resolvedDefinitionPosition(
  source,
  config,
  componentDefinition,
  authoredPart,
) {
  if (source?.kind === "constant-v1") return finiteVector3(source.value);
  if (source?.kind === "size-fraction-v1") {
    const size = finiteVector3(config.size),
      fraction = finiteVector3(source.value);
    return size.map((value, axis) => value * fraction[axis]);
  }
  if (source?.kind === "config-scalar-axis-v1") {
    const result = [0, 0, 0],
      value = Number(config[source.field]);
    if (
      !Number.isFinite(value) ||
      !Number.isInteger(source.axis) ||
      source.axis < 0 ||
      source.axis > 2
    )
      fail(
        "INVALID_GEOMETRY_POSITION_SOURCE",
        "Config scalar frame source is invalid",
      );
    result[source.axis] = value * Number(source.factor ?? 1);
    return result;
  }
  if (source?.kind === "flexible-endpoint-v1") {
    const line = componentDefinition.flexibleLine;
    if (line?.kind !== "flexible-line-v1")
      fail(
        "INVALID_FLEXIBLE_GEOMETRY",
        "Flexible endpoint source requires a flexible-line contract",
      );
    const axis = finiteVector3(line.initialAxisPart),
      magnitude = Math.hypot(...axis),
      direction = axis.map((value) => value / magnitude),
      sign = source.endpoint === "a" ? -1 : source.endpoint === "b" ? 1 : 0,
      halfLength = finitePositive(config.lengthM, ["config", "lengthM"]) / 2;
    if (!sign)
      fail("INVALID_FLEXIBLE_GEOMETRY", "Unknown flexible endpoint selector");
    return direction.map((value) => value * sign * halfLength);
  }
  if (source?.kind === "mechanism-reference-endpoint-v1") {
    const reference = authoredPart?.mechanism?.config?.referenceLaw,
      lengthM = Number(reference?.freeLengthM ?? reference?.referenceLengthM),
      sign = source.endpoint === "a" ? -1 : source.endpoint === "b" ? 1 : 0;
    if (!sign || !Number.isFinite(lengthM) || lengthM <= 0)
      fail(
        "INVALID_MECHANISM_REFERENCE_GEOMETRY",
        "Mechanism reference endpoint requires a positive reference length",
      );
    return [0, 0, sign * lengthM * 0.5];
  }
  fail(
    "UNKNOWN_GEOMETRY_POSITION_SOURCE",
    `Unknown geometry position source ${String(source?.kind)}`,
  );
}

function resolvedDefinitionFrame(
  source,
  config,
  componentDefinition,
  scale,
  authoredPart = null,
) {
  if (!source || typeof source !== "object")
    fail(
      "INVALID_GEOMETRY_FRAME_DEFINITION",
      "Geometry frame definition is required",
    );
  return scaledFrame(
    frame(
      resolvedDefinitionPosition(
        source.position,
        config,
        componentDefinition,
        authoredPart,
      ),
      source.orientation,
    ),
    scale,
  );
}

function resolvedPorts(part, config, catalog, scale, geometryDefinition) {
  const componentDefinition = catalog[part.type],
    portClasses = {},
    portFrames = {};
  for (const descriptor of componentPorts(part, catalog)) {
    const source = geometryDefinition.portFrames?.[descriptor.id],
      classification = portClass(descriptor);
    portClasses[descriptor.id] = classification;
    if (classification === "network-only" && !source) continue;
    if (!source)
      fail(
        "MISSING_SPATIAL_PORT_FRAME",
        `Port ${descriptor.id} on ${part.type} requires an explicit frame`,
        ["ports", descriptor.id, "framePart"],
      );
    portFrames[descriptor.id] = {
      framePart: resolvedDefinitionFrame(
        source,
        config,
        componentDefinition,
        scale,
        part,
      ),
      clearanceM: Number(source.clearanceM ?? 0),
      anchorPolicy:
        descriptor.behavior === "structural-surface"
          ? "surface-point-v1"
          : "fixed-point-v1",
    };
  }
  return { portClasses, portFrames };
}

function primitive(id, framePart, geometry, metadata = {}) {
  return {
    id,
    framePart,
    geometry,
    semanticKey: metadata.semanticKey ?? id,
    materialKey: metadata.materialKey ?? "generic-structure",
    contactRole: metadata.contactRole ?? "structure",
    approximationOf: metadata.approximationOf ?? null,
    semanticRegions: metadata.semanticRegions
      ? structuredClone(metadata.semanticRegions)
      : [],
  };
}

function mechanismPrimitive(
  region,
  semanticRegions = [],
  approximationOf = null,
) {
  const sourceGeometry = region.geometry,
    geometry =
      sourceGeometry.kind === "capsule-v1"
        ? {
            kind: "capsule-v1",
            radiusM: sourceGeometry.radiusM,
            cylinderLengthM: sourceGeometry.straightLengthM,
          }
        : sourceGeometry.kind === "rounded-wheel-v1"
          ? {
              kind: "rounded-wheel-v1",
              radiusM: sourceGeometry.radiusM,
              widthM: sourceGeometry.widthM,
              shoulderRadiusM: sourceGeometry.shoulderRadiusM,
            }
          : sourceGeometry.kind === "cylinder-v1"
            ? {
                kind: "cylinder-v1",
                radiusM: sourceGeometry.radiusM,
                axialLengthM: sourceGeometry.axialLengthM,
              }
            : sourceGeometry.kind === "box-v1"
              ? { kind: "box-v1", fullSizeM: [...sourceGeometry.fullSizeM] }
              : sourceGeometry.kind === "sphere-v1"
                ? { kind: "sphere-v1", radiusM: sourceGeometry.radiusM }
                : fail(
                    "UNKNOWN_GEOMETRY_PRIMITIVE",
                    `Unknown mechanism primitive ${sourceGeometry.kind}`,
                  );
  return primitive(
    region.semanticKey,
    frame(region.framePart.positionM, region.framePart.orientation),
    geometry,
    {
      semanticKey: region.semanticKey,
      materialKey: region.materialKey,
      contactRole: region.contactRole,
      approximationOf,
      semanticRegions,
    },
  );
}

function definitionScalar(source, config, label) {
  const value =
    typeof source === "number"
      ? source
      : source?.kind === "config-scalar-v1"
        ? config[source.field]
        : NaN;
  return finitePositive(Number(value), ["geometryDefinition", label]);
}

function scaleAlongLocalAxis(orientation, scale, localAxis) {
  const basis = [0, 0, 0];
  basis[localAxis] = 1;
  const partAxis = rotateVectorByQuaternion(basis, orientation),
    contributions = partAxis.map(
      (value, axis) => Math.abs(value) * scale[axis],
    ),
    nonzero = contributions.filter((value) => value > 1e-10);
  if (nonzero.length !== 1)
    fail(
      "NON_ORTHOGONAL_AFFINE_FRAME",
      "Affine geometry frames must remain aligned to part axes",
    );
  return nonzero[0];
}

function resolvedPrimitiveGeometry(source, config, scale, orientation) {
  if (source.kind === "box-v1") {
    const fullSize =
      source.fullSize?.kind === "config-vector-v1"
        ? config[source.fullSize.field]
        : source.fullSizeM;
    return {
      kind: "box-v1",
      fullSizeM: finiteVector3(fullSize).map((value, axis) =>
        finitePositive(value * scale[axis], ["geometry", "fullSizeM", axis]),
      ),
    };
  }
  const scaleX = scaleAlongLocalAxis(orientation, scale, 0),
    scaleY = scaleAlongLocalAxis(orientation, scale, 1),
    scaleZ = scaleAlongLocalAxis(orientation, scale, 2);
  if (source.kind === "rounded-box-v1") {
    const fullSize =
      source.fullSize?.kind === "config-vector-v1"
        ? config[source.fullSize.field]
        : source.fullSizeM;
    return {
      kind: "rounded-box-v1",
      fullSizeM: finiteVector3(fullSize).map(
        (value, axis) => value * scale[axis],
      ),
      radiusM:
        definitionScalar(source.radiusM, config, "radiusM") *
        Math.min(scaleX, scaleY, scaleZ),
    };
  }
  if (source.kind === "cylinder-v1") {
    const radius = definitionScalar(
        source.radius ?? source.radiusM,
        config,
        "radius",
      ),
      axialLengthM =
        definitionScalar(source.axialLengthM, config, "axialLengthM") * scaleZ;
    if (Math.abs(scaleX - scaleY) <= 1e-12)
      return { kind: "cylinder-v1", radiusM: radius * scaleX, axialLengthM };
    return {
      kind: "elliptic-cylinder-v1",
      radiusXM: radius * scaleX,
      radiusYM: radius * scaleY,
      axialLengthM,
    };
  }
  if (source.kind === "sphere-v1") {
    if (Math.abs(scaleX - scaleY) > 1e-12 || Math.abs(scaleX - scaleZ) > 1e-12)
      fail(
        "GEOMETRY_SCALE_POLICY_VIOLATION",
        "A sphere requires uniform similarity scaling",
      );
    return {
      kind: "sphere-v1",
      radiusM: definitionScalar(source.radiusM, config, "radiusM") * scaleX,
    };
  }
  if (
    source.kind === "capsule-v1" ||
    source.kind === "cone-v1" ||
    source.kind === "rounded-wheel-v1"
  ) {
    if (!equalRadialScale(scaleX, scaleY))
      fail(
        "GEOMETRY_SCALE_POLICY_VIOLATION",
        `${source.kind} requires equal radial scale`,
      );
    if (source.kind === "capsule-v1")
      return {
        kind: "capsule-v1",
        radiusM: definitionScalar(source.radiusM, config, "radiusM") * scaleX,
        cylinderLengthM:
          definitionScalar(source.cylinderLengthM, config, "cylinderLengthM") *
          scaleZ,
      };
    if (source.kind === "cone-v1")
      return {
        kind: "cone-v1",
        startRadiusM: Number(source.startRadiusM) * scaleX,
        endRadiusM: Number(source.endRadiusM) * scaleX,
        axialLengthM:
          definitionScalar(source.axialLengthM, config, "axialLengthM") *
          scaleZ,
      };
    return {
      kind: "rounded-wheel-v1",
      radiusM: definitionScalar(source.radiusM, config, "radiusM") * scaleX,
      widthM: definitionScalar(source.widthM, config, "widthM") * scaleZ,
      shoulderRadiusM:
        definitionScalar(source.shoulderRadiusM, config, "shoulderRadiusM") *
        Math.min(scaleX, scaleZ),
    };
  }
  if (source.kind === "spur-gear-v1") {
    if (!equalRadialScale(scaleX, scaleY))
      fail(
        "GEOMETRY_SCALE_POLICY_VIOLATION",
        "spur-gear-v1 requires equal radial scale",
      );
    return {
      kind: "spur-gear-v1",
      toothCount: Number(source.toothCount),
      toothPhaseRad: Number(source.toothPhaseRad),
      pitchRadiusM: Number(source.pitchRadiusM) * scaleX,
      pressureAngleRad: Number(source.pressureAngleRad),
      moduleM: Number(source.moduleM) * scaleX,
      axialThicknessM: Number(source.axialThicknessM) * scaleZ,
      rootRadiusM: Number(source.rootRadiusM) * scaleX,
      tipRadiusM: Number(source.tipRadiusM) * scaleX,
      boreRadiusM: Number(source.boreRadiusM) * scaleX,
      hubRadiusM:
        source.hubRadiusM === null ? null : Number(source.hubRadiusM) * scaleX,
      hubThicknessM:
        source.hubThicknessM === null
          ? null
          : Number(source.hubThicknessM) * scaleZ,
    };
  }
  if (source.kind === "helical-spring-v1") {
    if (Math.abs(scaleX - scaleY) > 1e-12)
      fail(
        "GEOMETRY_SCALE_POLICY_VIOLATION",
        "helical-spring-v1 requires equal radial scale",
      );
    return {
      kind: "helical-spring-v1",
      meanCoilRadiusM: Number(source.meanCoilRadiusM) * scaleX,
      wireRadiusM: Number(source.wireRadiusM) * scaleX,
      activeTurns: Number(source.activeTurns),
      endTreatment: source.endTreatment,
      referenceAxialLengthM: Number(source.referenceAxialLengthM) * scaleZ,
    };
  }
  if (source.kind === "extruded-profile-v1")
    return {
      kind: "extruded-profile-v1",
      pointsM: source.pointsM.map(([x, y]) => [x * scaleX, y * scaleY]),
      axialThicknessM: Number(source.axialThicknessM) * scaleZ,
    };
  fail(
    "UNKNOWN_GEOMETRY_PRIMITIVE",
    `Unknown primitive definition ${String(source.kind)}`,
  );
}

function resolvedDefinitionPrimitive(
  source,
  config,
  componentDefinition,
  scale,
  { collision = false, authoredPart = null } = {},
) {
  const framePart = resolvedDefinitionFrame(
    source.frame,
    config,
    componentDefinition,
    scale,
    authoredPart,
  );
  const resolvedGeometry = resolvedPrimitiveGeometry(
      source.geometry,
      config,
      scale,
      framePart.orientation,
    ),
    geometry =
      collision && resolvedGeometry.kind === "elliptic-cylinder-v1"
        ? {
            kind: "cylinder-v1",
            radiusM: Math.max(
              resolvedGeometry.radiusXM,
              resolvedGeometry.radiusYM,
            ),
            axialLengthM: resolvedGeometry.axialLengthM,
          }
        : resolvedGeometry;
  return primitive(source.id, framePart, geometry, {
    ...source,
    approximationOf:
      collision && resolvedGeometry.kind === "elliptic-cylinder-v1"
        ? `${source.id}:elliptic-cylinder-v1`
        : source.approximationOf,
  });
}

function primitiveHalfExtents(geometry) {
  if (geometry.kind === "box-v1" || geometry.kind === "rounded-box-v1")
    return geometry.fullSizeM.map((value) => value / 2);
  if (geometry.kind === "sphere-v1")
    return [geometry.radiusM, geometry.radiusM, geometry.radiusM];
  if (geometry.kind === "cylinder-v1")
    return [geometry.radiusM, geometry.radiusM, geometry.axialLengthM / 2];
  if (geometry.kind === "elliptic-cylinder-v1")
    return [geometry.radiusXM, geometry.radiusYM, geometry.axialLengthM / 2];
  if (geometry.kind === "capsule-v1") {
    const halfZ = geometry.cylinderLengthM / 2 + geometry.radiusM;
    return [geometry.radiusM, geometry.radiusM, halfZ];
  }
  if (geometry.kind === "cone-v1") {
    const radius = Math.max(geometry.startRadiusM, geometry.endRadiusM);
    return [radius, radius, geometry.axialLengthM / 2];
  }
  if (geometry.kind === "rounded-wheel-v1")
    return [geometry.radiusM, geometry.radiusM, geometry.widthM / 2];
  if (geometry.kind === "spur-gear-v1")
    return [
      geometry.tipRadiusM,
      geometry.tipRadiusM,
      Math.max(geometry.axialThicknessM, geometry.hubThicknessM || 0) / 2,
    ];
  if (geometry.kind === "helical-spring-v1") {
    const radialM = geometry.meanCoilRadiusM + geometry.wireRadiusM;
    return [radialM, radialM, geometry.referenceAxialLengthM / 2];
  }
  if (geometry.kind === "extruded-profile-v1") {
    const maximumX = Math.max(...geometry.pointsM.map(([x]) => Math.abs(x))),
      maximumY = Math.max(...geometry.pointsM.map(([, y]) => Math.abs(y)));
    return [maximumX, maximumY, geometry.axialThicknessM / 2];
  }
  fail("UNKNOWN_GEOMETRY_PRIMITIVE", `Unknown primitive ${geometry.kind}`);
}

function rotatedHalfExtents(half, orientation) {
  return [0, 1, 2].map((worldAxis) =>
    [0, 1, 2].reduce((sum, localAxis) => {
      const basis = [0, 0, 0];
      basis[localAxis] = 1;
      return (
        sum +
        Math.abs(rotateVectorByQuaternion(basis, orientation)[worldAxis]) *
          half[localAxis]
      );
    }, 0),
  );
}

function boundsForPrimitive(value) {
  const half = rotatedHalfExtents(
      primitiveHalfExtents(value.geometry),
      value.framePart.orientation,
    ),
    center = value.framePart.positionM;
  return {
    minimumM: center.map((coordinate, axis) => coordinate - half[axis]),
    maximumM: center.map((coordinate, axis) => coordinate + half[axis]),
  };
}

function unionBounds(bounds) {
  const values = bounds.filter(Boolean);
  if (!values.length) return null;
  return {
    minimumM: [0, 1, 2].map((axis) =>
      Math.min(...values.map((value) => value.minimumM[axis])),
    ),
    maximumM: [0, 1, 2].map((axis) =>
      Math.max(...values.map((value) => value.maximumM[axis])),
    ),
  };
}

function transformForProjection(coordinate, projection, coordinateM) {
  if (projection.kind === "anchor-local-z-scale-v1")
    return {
      projection: projection.kind,
      coordinateId: coordinate.id,
      positionM: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      scale: [
        1,
        1,
        deformationAxialScale(coordinateM, coordinate.referenceBodyLengthM),
      ],
    };
  if (projection.kind === "local-z-translation-v1")
    return {
      projection: projection.kind,
      coordinateId: coordinate.id,
      positionM: [
        0,
        0,
        deformationAxialTranslation(
          coordinateM,
          coordinate.referenceCoordinateM,
          projection.gainMPerM,
        ),
      ],
      orientation: [0, 0, 0, 1],
      scale: [1, 1, 1],
    };
  fail(
    "UNKNOWN_DEFORMATION_PROJECTION",
    `Unknown deformation projection ${String(projection.kind)}`,
  );
}

function transformLocalBounds(bounds, transform) {
  const z = [
    bounds.minimumM[2] * transform.scale[2] + transform.positionM[2],
    bounds.maximumM[2] * transform.scale[2] + transform.positionM[2],
  ];
  return {
    minimumM: [bounds.minimumM[0], bounds.minimumM[1], Math.min(...z)],
    maximumM: [bounds.maximumM[0], bounds.maximumM[1], Math.max(...z)],
  };
}

function conservativeDeformationSelectionBounds(
  bodyPrimitives,
  featureBoundsPartM,
  deformationContract,
) {
  const projectionByPrimitive = new Map();
  for (const coordinate of deformationContract?.coordinates || [])
    for (const projection of coordinate.projections)
      for (const primitiveId of projection.primitiveIds)
        projectionByPrimitive.set(primitiveId, { coordinate, projection });
  return unionBounds([
    ...bodyPrimitives.flatMap((primitive) => {
      const bounds = boundsForPrimitive(primitive),
        match = projectionByPrimitive.get(primitive.id);
      if (!match) return [bounds];
      return [
        match.coordinate.allowedCoordinateRangeM.minimum,
        match.coordinate.allowedCoordinateRangeM.maximum,
      ].map((coordinateM) =>
        transformLocalBounds(
          bounds,
          transformForProjection(
            match.coordinate,
            match.projection,
            coordinateM,
          ),
        ),
      );
    }),
    featureBoundsPartM,
  ]);
}

function featurePrimitive(feature, portFrames) {
  const anchor = portFrames[feature.anchor.portId];
  if (!anchor)
    fail(
      "INVALID_FEATURE_ANCHOR",
      `Feature ${feature.id} references missing port ${feature.anchor.portId}`,
    );
  const orientation = anchor.framePart.orientation,
    offset = rotateVectorByQuaternion(feature.anchor.offsetM, orientation),
    axis = rotateVectorByQuaternion([0, 0, 1], orientation),
    lengthM = feature.dimensions.lengthM,
    axialOffset =
      feature.axialOrigin === "center-v1"
        ? 0
        : feature.axialOrigin === "start-v1"
          ? lengthM / 2
          : -lengthM / 2,
    positionM = anchor.framePart.positionM.map(
      (value, index) => value + offset[index] + axis[index] * axialOffset,
    );
  const geometry =
    feature.primitive === "elliptic-cylinder-v1"
      ? {
          kind: "elliptic-cylinder-v1",
          radiusXM: feature.dimensions.radiusXM,
          radiusYM: feature.dimensions.radiusYM,
          axialLengthM: lengthM,
        }
      : {
          kind: "cylinder-v1",
          radiusM: feature.dimensions.radiusM,
          axialLengthM: lengthM,
        };
  return primitive(
    `feature:${feature.id}`,
    frame(positionM, orientation),
    geometry,
    { materialKey: feature.materialKey },
  );
}

export function physicalFeaturePrimitivesForDescriptor(descriptor) {
  return deepFreeze(
    descriptor.physicalFeatures.map((feature) =>
      featurePrimitive(feature, descriptor.portFrames),
    ),
  );
}

function volumeOfGeometry(geometry) {
  if (geometry.kind === "box-v1")
    return geometry.fullSizeM.reduce((product, value) => product * value, 1);
  if (geometry.kind === "rounded-box-v1") {
    const [x, y, z] = geometry.fullSizeM.map(
        (value) => value - 2 * geometry.radiusM,
      ),
      radiusM = geometry.radiusM;
    return (
      x * y * z +
      2 * radiusM * (x * y + x * z + y * z) +
      Math.PI * radiusM ** 2 * (x + y + z) +
      (4 * Math.PI * radiusM ** 3) / 3
    );
  }
  if (geometry.kind === "sphere-v1")
    return (4 * Math.PI * geometry.radiusM ** 3) / 3;
  if (geometry.kind === "cylinder-v1")
    return Math.PI * geometry.radiusM ** 2 * geometry.axialLengthM;
  if (geometry.kind === "elliptic-cylinder-v1")
    return (
      Math.PI * geometry.radiusXM * geometry.radiusYM * geometry.axialLengthM
    );
  if (geometry.kind === "capsule-v1")
    return (
      Math.PI * geometry.radiusM ** 2 * geometry.cylinderLengthM +
      (4 * Math.PI * geometry.radiusM ** 3) / 3
    );
  if (geometry.kind === "cone-v1")
    return (
      (Math.PI *
        geometry.axialLengthM *
        (geometry.startRadiusM ** 2 +
          geometry.startRadiusM * geometry.endRadiusM +
          geometry.endRadiusM ** 2)) /
      3
    );
  if (geometry.kind === "rounded-wheel-v1")
    return Math.PI * geometry.radiusM ** 2 * geometry.widthM;
  if (geometry.kind === "spur-gear-v1")
    return (
      Math.PI *
      (geometry.pitchRadiusM ** 2 - geometry.boreRadiusM ** 2) *
      geometry.axialThicknessM
    );
  if (geometry.kind === "helical-spring-v1") {
    const centerlineAxialSpanM =
        geometry.referenceAxialLengthM - 2 * geometry.wireRadiusM,
      centerlineLengthM = Math.hypot(
        2 * Math.PI * geometry.meanCoilRadiusM * geometry.activeTurns,
        centerlineAxialSpanM,
      );
    return Math.PI * geometry.wireRadiusM ** 2 * centerlineLengthM;
  }
  if (geometry.kind === "extruded-profile-v1") {
    const twiceArea = geometry.pointsM.reduce((sum, point, index, points) => {
      const next = points[(index + 1) % points.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    return (Math.abs(twiceArea) / 2) * geometry.axialThicknessM;
  }
  fail("UNKNOWN_GEOMETRY_PRIMITIVE", `Unknown primitive ${geometry.kind}`);
}

function massPropertiesForBox(size, massKg, sourceKind) {
  const [x, y, z] = size;
  return completeMassProperties({
    sourceKind,
    massEvaluationPolicy: "analytic-runtime-primitive-v1",
    massKg,
    volumeM3: x * y * z,
    comPositionPartM: [0, 0, 0],
    inertiaTensorAtComPartKgM2: {
      xx: (massKg * (y * y + z * z)) / 12,
      yy: (massKg * (x * x + z * z)) / 12,
      zz: (massKg * (x * x + y * y)) / 12,
      xy: 0,
      xz: 0,
      yz: 0,
    },
    contributingSolidIds: ["collision-solid"],
  });
}

function ordinaryMassProperties(collision, massKg) {
  const geometry = collision.geometry;
  if (geometry.kind === "box-v1")
    return massPropertiesForBox(
      geometry.fullSizeM,
      massKg,
      "uniform-collision-solid-v2",
    );
  const radiusM =
      geometry.radiusM ?? Math.sqrt(geometry.radiusXM * geometry.radiusYM),
    lengthM = geometry.axialLengthM,
    transverse = (massKg * (3 * radiusM ** 2 + lengthM ** 2)) / 12;
  return completeMassProperties({
    sourceKind: "uniform-collision-solid-v2",
    massEvaluationPolicy: "analytic-runtime-primitive-v1",
    massKg,
    volumeM3: volumeOfGeometry(geometry),
    comPositionPartM: [0, 0, 0],
    inertiaTensorAtComPartKgM2: {
      xx: transverse,
      yy: transverse,
      zz: (massKg * radiusM ** 2) / 2,
      xy: 0,
      xz: 0,
      yz: 0,
    },
    contributingSolidIds: [collision.id],
  });
}

function radialRotorGeometry(config) {
  const hub = primitive(
      "hub",
      frame(),
      {
        kind: "cylinder-v1",
        radiusM: config.hubRadiusM,
        axialLengthM: config.hubThicknessM,
      },
      { materialKey: "workshop-steel" },
    ),
    bladeSpanM = config.radiusM - config.hubRadiusM,
    bladeCenterM = config.hubRadiusM + bladeSpanM / 2,
    bladePitchRad = (config.handedness * config.fixedPitchDeg * Math.PI) / 180,
    blades = Array.from({ length: config.bladeCount }, (_, index) => {
      const angle = (index / config.bladeCount) * Math.PI * 2;
      return primitive(
        `blade-${index}`,
        frame(
          [Math.cos(angle) * bladeCenterM, Math.sin(angle) * bladeCenterM, 0],
          quaternionFromEulerXYZ([bladePitchRad, 0, angle]),
        ),
        {
          kind: "extruded-profile-v1",
          pointsM: [
            [-bladeSpanM / 2, -config.bladeChordM * 0.38],
            [bladeSpanM / 2, -config.bladeChordM * 0.16],
            [bladeSpanM / 2, config.bladeChordM * 0.1],
            [-bladeSpanM / 2, config.bladeChordM * 0.62],
          ],
          axialThicknessM: 0.018,
        },
        { semanticKey: "rotor-blade", materialKey: "generic-structure" },
      );
    }),
    collisionHub = {
      ...structuredClone(hub),
      id: "collision-hub",
      semanticKey: "rotor-hub-contact",
      approximationOf: "rotor-blade-contact-unsupported-v1",
    };
  return {
    collisionPrimitives: [collisionHub],
    bodyPrimitives: [hub, ...blades],
  };
}

function radialRotorMassProperties(config, bodyPrimitives) {
  const hubMassKg = config.mass * 0.4,
    bladeMassKg = config.mass - hubMassKg,
    axialInertia =
      (hubMassKg * config.hubRadiusM ** 2) / 2 +
      (bladeMassKg *
        (config.radiusM ** 2 +
          config.radiusM * config.hubRadiusM +
          config.hubRadiusM ** 2)) /
        3,
    transverseInertia =
      (hubMassKg * (3 * config.hubRadiusM ** 2 + config.hubThicknessM ** 2)) /
        12 +
      axialInertia / 2;
  return completeMassProperties({
    sourceKind: "fixed-pitch-rotor-mass-v1",
    massEvaluationPolicy: "hub-and-radial-blades-v1",
    massKg: config.mass,
    volumeM3:
      Math.PI * config.hubRadiusM ** 2 * config.hubThicknessM +
      config.bladeCount *
        (config.radiusM - config.hubRadiusM) *
        config.bladeChordM *
        0.018,
    comPositionPartM: [0, 0, 0],
    inertiaTensorAtComPartKgM2: {
      xx: transverseInertia,
      yy: transverseInertia,
      zz: axialInertia,
      xy: 0,
      xz: 0,
      yz: 0,
    },
    contributingSolidIds: bodyPrimitives.map(({ id }) => id),
  });
}

function physicalFeaturesFor(geometryDefinition, scale) {
  return geometryDefinition.physicalFeatures.map((source) => {
    const anchorFrame = geometryDefinition.portFrames[source.anchor.portId],
      orientation = canonicalQuaternion(anchorFrame.orientation),
      scaleX = scaleAlongLocalAxis(orientation, scale, 0),
      scaleY = scaleAlongLocalAxis(orientation, scale, 1),
      scaleZ = scaleAlongLocalAxis(orientation, scale, 2),
      radiusM = finitePositive(source.dimensions.radiusM, [
        "physicalFeatures",
        source.id,
        "radiusM",
      ]),
      lengthM = finitePositive(source.dimensions.lengthM, [
        "physicalFeatures",
        source.id,
        "lengthM",
      ]),
      primitiveKind =
        Math.abs(scaleX - scaleY) <= 1e-12
          ? "cylinder-v1"
          : "elliptic-cylinder-v1";
    return {
      id: source.id,
      primitive: primitiveKind,
      anchor: {
        kind: "port-frame-v1",
        portId: source.anchor.portId,
        offsetM: finiteVector3(source.anchor.offsetM).map(
          (value, axis) => value * scale[axis],
        ),
      },
      dimensions:
        primitiveKind === "cylinder-v1"
          ? { radiusM: radiusM * scaleX, lengthM: lengthM * scaleZ }
          : {
              radiusXM: radiusM * scaleX,
              radiusYM: radiusM * scaleY,
              lengthM: lengthM * scaleZ,
            },
      axialOrigin: source.axialOrigin,
      role: source.role,
      materialKey: source.materialKey,
    };
  });
}

function deformationContractFor(
  geometryDefinition,
  bodyPrimitives,
  componentDefinition,
  authoredPart,
  portFrames,
) {
  const contract = geometryDefinition.deformationContract;
  if (!contract) return null;
  const available = new Set(bodyPrimitives.map(({ id }) => id));
  for (const coordinate of contract.coordinates)
    for (const projection of coordinate.projections)
      for (const id of projection.primitiveIds)
        if (!available.has(id))
          fail(
            "INVALID_DEFORMATION_PRIMITIVE",
            `Deformation coordinate ${coordinate.id} references missing primitive ${id}`,
          );
  const resolved = structuredClone(contract),
    mechanismConfig =
      authoredPart?.mechanism?.config || componentDefinition.mechanism?.config;
  for (const coordinate of resolved.coordinates) {
    const frameA = portFrames[mechanismConfig?.endpointPortA]?.framePart,
      frameB = portFrames[mechanismConfig?.endpointPortB]?.framePart,
      endpointReferenceM =
        frameA && frameB
          ? Math.hypot(
              ...frameB.positionM.map(
                (value, axis) => value - frameA.positionM[axis],
              ),
            )
          : 0,
      referenceCoordinateM = Number(
        mechanismConfig?.referenceCoordinateM ?? endpointReferenceM,
      ),
      authoredRange =
        mechanismConfig?.lengthRangeM ?? mechanismConfig?.travelRangeM;
    if (!authoredRange) continue;
    const bodyBounds = unionBounds(
        coordinate.projections.flatMap((projection) =>
          projection.primitiveIds.map((primitiveId) =>
            boundsForPrimitive(
              bodyPrimitives.find(({ id }) => id === primitiveId),
            ),
          ),
        ),
      ),
      bodyReferenceLengthM = bodyBounds
        ? bodyBounds.maximumM[2] - bodyBounds.minimumM[2]
        : 0;
    if (referenceCoordinateM <= 0 || bodyReferenceLengthM <= 0)
      fail(
        "INVALID_DEFORMATION_REFERENCE",
        `Deformation coordinate ${coordinate.id} has no finite endpoint reference`,
      );
    coordinate.referenceCoordinateM = referenceCoordinateM;
    coordinate.referenceBodyLengthM = bodyReferenceLengthM;
    coordinate.allowedCoordinateRangeM = {
      minimum: authoredRange.lower,
      maximum: authoredRange.upper,
    };
  }
  return resolved;
}

function runtimeGeometryContractFor(
  geometryDefinition,
  componentDefinition,
  config,
) {
  if (geometryDefinition.kind !== "flexible-line-component-geometry-v1")
    return null;
  const line = componentDefinition.flexibleLine;
  if (line?.kind !== "flexible-line-v1")
    fail(
      "INVALID_FLEXIBLE_GEOMETRY",
      "Flexible geometry requires a component flexible-line contract",
    );
  return {
    kind: "flexible-line-runtime-geometry-v1",
    endpointPortIds: [line.endpointPortA, line.endpointPortB],
    diameterM: finitePositive(config.diameterM, ["config", "diameterM"]),
    maximumSegmentCount: Number(line.maximumElementCount),
    materialKey: String(config.materialKey),
    styleKey: "rope-v1",
    telemetryProjection: "completed-centerline-v1",
  };
}

function flexibleSelectionBounds(portFrames, contract) {
  const bounds = contract.endpointPortIds.map((portId) => {
    const position = portFrames[portId].framePart.positionM,
      radius = contract.diameterM / 2;
    return {
      minimumM: position.map((value) => value - radius),
      maximumM: position.map((value) => value + radius),
    };
  });
  return unionBounds(bounds);
}

function descriptorForMechanism(
  part,
  scale,
  geometryDefinition,
  config,
  componentDefinition,
) {
  const compiled = compileMechanismBodyGeometry({
      sourcePartId: part.id,
      component: part.mechanism,
      positionWorldM: part.pos,
      orientationWorld: part.orientation,
      scale,
    }),
    body = compiled.body,
    hasTireEnvelope = body.collisionRegions.some(
      (region) => region.contactRole === "tire-envelope",
    ),
    collisionRegions = hasTireEnvelope
      ? body.collisionRegions.filter(
          (region) => region.contactRole === "tire-envelope",
        )
      : body.collisionRegions,
    collisionApproximationOf =
      geometryDefinition.collisionPrimitives.approximationOf,
    collisionPrimitives = collisionRegions.map((region) =>
      mechanismPrimitive(
        region,
        hasTireEnvelope ? body.collisionRegions : [],
        collisionApproximationOf,
      ),
    ),
    bodyPrimitives = geometryDefinition.bodyPrimitives.map((source) =>
      resolvedDefinitionPrimitive(source, config, componentDefinition, scale, {
        authoredPart: part,
      }),
    ),
    massProperties = {
      ...structuredClone(body.massProperties),
      massEvaluationPolicy:
        body.massProperties.massEvaluationPolicy ?? "authored-explicit-v1",
      volumeM3:
        body.massProperties.volumeM3 ??
        collisionPrimitives.reduce(
          (sum, item) => sum + volumeOfGeometry(item.geometry),
          0,
        ),
    };
  return {
    collisionPrimitives,
    bodyPrimitives,
    massProperties,
    topologyDigest: compiled.topologyDigest,
  };
}

function closedOptionalKeys(value, required, optional, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(
      "INVALID_GEOMETRY_RECORD",
      `${path.join(".")} must be an object`,
      path,
    );
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value))
    if (!allowed.has(key))
      fail(
        "UNKNOWN_GEOMETRY_FIELD",
        `${path.join(".")} contains unknown field ${key}`,
        [...path, key],
      );
  for (const key of required)
    if (!Object.hasOwn(value, key))
      fail("MISSING_GEOMETRY_FIELD", `${path.join(".")} is missing ${key}`, [
        ...path,
        key,
      ]);
}

function finiteNonNegative(value, path) {
  if (!Number.isFinite(value) || value < 0)
    fail(
      "INVALID_GEOMETRY_DIMENSION",
      `${path.join(".")} must be finite and non-negative`,
      path,
      { value },
    );
  return Number(value);
}

function validateFrameRecord(value, path) {
  closedKeys(value, ["positionM", "orientation"], path);
  finiteVector3(value.positionM, { path: [...path, "positionM"] });
  canonicalQuaternion(value.orientation, {
    path: [...path, "orientation"],
  });
}

function polygonArea2(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
}

function validateClosedProfile(points, path) {
  if (!Array.isArray(points) || points.length < 3 || points.length > 32)
    fail(
      "INVALID_GEOMETRY_PROFILE",
      `${path.join(".")} must contain 3 to 32 points`,
      path,
    );
  points.forEach((point, index) => {
    if (!Array.isArray(point) || point.length !== 2)
      fail(
        "INVALID_GEOMETRY_PROFILE",
        `${path.join(".")}.${index} must be a 2D point`,
        [...path, index],
      );
    point.forEach((coordinate, axis) => {
      if (!Number.isFinite(coordinate) || Math.abs(coordinate) > 10_000)
        fail(
          "INVALID_GEOMETRY_PROFILE",
          "Profile coordinates must be finite and bounded",
          [...path, index, axis],
        );
    });
    const next = points[(index + 1) % points.length];
    if (next && point[0] === next[0] && point[1] === next[1])
      fail("INVALID_GEOMETRY_PROFILE", "Profile contains a zero-length edge", [
        ...path,
        index,
      ]);
  });
  if (Math.abs(polygonArea2(points)) <= 1e-12)
    fail(
      "INVALID_GEOMETRY_PROFILE",
      "Profile must enclose a non-zero area",
      path,
    );
  return points;
}

function validatePrimitiveGeometryRecord(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail(
      "INVALID_GEOMETRY_PRIMITIVE",
      `${path.join(".")} must be an object`,
      path,
    );
  if (!PRIMITIVE_KIND_SET.has(value.kind))
    fail(
      "UNKNOWN_GEOMETRY_PRIMITIVE",
      `Unknown primitive ${String(value.kind)}`,
      [...path, "kind"],
    );
  if (value.kind === "box-v1") {
    closedKeys(value, ["kind", "fullSizeM"], path);
    finiteVector3(value.fullSizeM, { path: [...path, "fullSizeM"] }).forEach(
      (dimension, axis) =>
        finitePositive(dimension, [...path, "fullSizeM", axis]),
    );
  } else if (value.kind === "rounded-box-v1") {
    closedKeys(value, ["kind", "fullSizeM", "radiusM"], path);
    const dimensions = finiteVector3(value.fullSizeM, {
      path: [...path, "fullSizeM"],
    });
    dimensions.forEach((dimension, axis) =>
      finitePositive(dimension, [...path, "fullSizeM", axis]),
    );
    finitePositive(value.radiusM, [...path, "radiusM"]);
    if (value.radiusM > Math.min(...dimensions) / 2)
      fail(
        "INVALID_GEOMETRY_DIMENSION",
        "Rounded-box radius exceeds its envelope",
        [...path, "radiusM"],
      );
  } else if (value.kind === "cylinder-v1") {
    closedKeys(value, ["kind", "radiusM", "axialLengthM"], path);
    finitePositive(value.radiusM, [...path, "radiusM"]);
    finitePositive(value.axialLengthM, [...path, "axialLengthM"]);
  } else if (value.kind === "elliptic-cylinder-v1") {
    closedKeys(value, ["kind", "radiusXM", "radiusYM", "axialLengthM"], path);
    finitePositive(value.radiusXM, [...path, "radiusXM"]);
    finitePositive(value.radiusYM, [...path, "radiusYM"]);
    finitePositive(value.axialLengthM, [...path, "axialLengthM"]);
  } else if (value.kind === "sphere-v1") {
    closedKeys(value, ["kind", "radiusM"], path);
    finitePositive(value.radiusM, [...path, "radiusM"]);
  } else if (value.kind === "capsule-v1") {
    closedKeys(value, ["kind", "radiusM", "cylinderLengthM"], path);
    finitePositive(value.radiusM, [...path, "radiusM"]);
    finitePositive(value.cylinderLengthM, [...path, "cylinderLengthM"]);
  } else if (value.kind === "cone-v1") {
    closedKeys(
      value,
      ["kind", "startRadiusM", "endRadiusM", "axialLengthM"],
      path,
    );
    finiteNonNegative(value.startRadiusM, [...path, "startRadiusM"]);
    finiteNonNegative(value.endRadiusM, [...path, "endRadiusM"]);
    if (value.startRadiusM === 0 && value.endRadiusM === 0)
      fail(
        "INVALID_GEOMETRY_DIMENSION",
        "A cone requires at least one positive radius",
        path,
      );
    finitePositive(value.axialLengthM, [...path, "axialLengthM"]);
  } else if (value.kind === "rounded-wheel-v1") {
    closedKeys(value, ["kind", "radiusM", "widthM", "shoulderRadiusM"], path);
    finitePositive(value.radiusM, [...path, "radiusM"]);
    finitePositive(value.widthM, [...path, "widthM"]);
    finitePositive(value.shoulderRadiusM, [...path, "shoulderRadiusM"]);
    if (value.shoulderRadiusM > Math.min(value.radiusM, value.widthM / 2))
      fail(
        "INVALID_GEOMETRY_DIMENSION",
        "Rounded-wheel shoulder radius exceeds its envelope",
        [...path, "shoulderRadiusM"],
      );
  } else if (value.kind === "spur-gear-v1") {
    closedKeys(
      value,
      [
        "kind",
        "toothCount",
        "toothPhaseRad",
        "pitchRadiusM",
        "pressureAngleRad",
        "moduleM",
        "axialThicknessM",
        "rootRadiusM",
        "tipRadiusM",
        "boreRadiusM",
        "hubRadiusM",
        "hubThicknessM",
      ],
      path,
    );
    if (!Number.isInteger(value.toothCount) || value.toothCount < 4)
      fail(
        "INVALID_GEOMETRY_DIMENSION",
        "A spur gear requires at least four integer teeth",
        [...path, "toothCount"],
      );
    finiteNumber(value.toothPhaseRad, {
      path: [...path, "toothPhaseRad"],
    });
    for (const key of [
      "pitchRadiusM",
      "pressureAngleRad",
      "moduleM",
      "axialThicknessM",
      "rootRadiusM",
      "tipRadiusM",
      "boreRadiusM",
    ])
      finitePositive(value[key], [...path, key]);
    if (value.pressureAngleRad >= Math.PI / 2)
      fail(
        "INVALID_GEOMETRY_DIMENSION",
        "Spur-gear pressure angle must be below pi/2",
        [...path, "pressureAngleRad"],
      );
    if (
      !gearPitchConsistent(value.pitchRadiusM, value.moduleM, value.toothCount)
    )
      fail(
        "INCONSISTENT_GEAR_GEOMETRY",
        "Spur-gear pitch radius must equal module times tooth count over two",
        path,
      );
    if (!(
      value.boreRadiusM < value.rootRadiusM &&
      value.rootRadiusM < value.pitchRadiusM &&
      value.pitchRadiusM < value.tipRadiusM
    ))
      fail(
        "INCONSISTENT_GEAR_GEOMETRY",
        "Spur-gear radii must order bore, root, pitch, then tip",
        path,
      );
    const hasHub = value.hubRadiusM !== null,
      hasHubThickness = value.hubThicknessM !== null;
    if (hasHub !== hasHubThickness)
      fail(
        "INCONSISTENT_GEAR_GEOMETRY",
        "Spur-gear hub radius and thickness must be both present or both null",
        path,
      );
    if (hasHub) {
      finitePositive(value.hubRadiusM, [...path, "hubRadiusM"]);
      finitePositive(value.hubThicknessM, [...path, "hubThicknessM"]);
      if (
        value.hubRadiusM <= value.boreRadiusM ||
        value.hubRadiusM > value.rootRadiusM ||
        value.hubThicknessM < value.axialThicknessM
      )
        fail(
          "INCONSISTENT_GEAR_GEOMETRY",
          "Spur-gear hub must surround the bore within the root and span the face",
          path,
        );
    }
  } else if (value.kind === "helical-spring-v1") {
    closedKeys(
      value,
      [
        "kind",
        "meanCoilRadiusM",
        "wireRadiusM",
        "activeTurns",
        "endTreatment",
        "referenceAxialLengthM",
      ],
      path,
    );
    for (const key of [
      "meanCoilRadiusM",
      "wireRadiusM",
      "activeTurns",
      "referenceAxialLengthM",
    ])
      finitePositive(value[key], [...path, key]);
    if (value.meanCoilRadiusM <= value.wireRadiusM)
      fail(
        "INVALID_GEOMETRY_DIMENSION",
        "Spring mean coil radius must exceed wire radius",
        [...path, "meanCoilRadiusM"],
      );
    if (value.activeTurns < 1)
      fail(
        "INVALID_GEOMETRY_DIMENSION",
        "Spring requires at least one active turn",
        [...path, "activeTurns"],
      );
    if (value.referenceAxialLengthM <= 2 * value.wireRadiusM)
      fail(
        "INVALID_GEOMETRY_DIMENSION",
        "Spring reference length must contain the wire envelope",
        [...path, "referenceAxialLengthM"],
      );
    if (!["plain-v1", "closed-ground-v1"].includes(value.endTreatment))
      fail("INVALID_GEOMETRY_PROFILE", "Unknown spring end treatment", [
        ...path,
        "endTreatment",
      ]);
  } else {
    closedKeys(value, ["kind", "pointsM", "axialThicknessM"], path);
    validateClosedProfile(value.pointsM, [...path, "pointsM"]);
    finitePositive(value.axialThicknessM, [...path, "axialThicknessM"]);
  }
}

function validatePrimitiveRecord(value, path) {
  closedKeys(
    value,
    [
      "id",
      "framePart",
      "geometry",
      "semanticKey",
      "materialKey",
      "contactRole",
      "approximationOf",
      "semanticRegions",
    ],
    path,
  );
  for (const key of ["id", "semanticKey", "materialKey", "contactRole"])
    if (typeof value[key] !== "string" || !value[key])
      fail("INVALID_GEOMETRY_ID", `${path.join(".")}.${key} is required`, [
        ...path,
        key,
      ]);
  if (
    value.approximationOf !== null &&
    typeof value.approximationOf !== "string"
  )
    fail(
      "INVALID_GEOMETRY_PROVENANCE",
      "approximationOf must be a string or null",
      [...path, "approximationOf"],
    );
  if (!Array.isArray(value.semanticRegions))
    fail("INVALID_GEOMETRY_REGIONS", "semanticRegions must be an array", [
      ...path,
      "semanticRegions",
    ]);
  validateFrameRecord(value.framePart, [...path, "framePart"]);
  validatePrimitiveGeometryRecord(value.geometry, [...path, "geometry"]);
}

function validateBoundsRecord(value, path) {
  if (value === null) return;
  closedKeys(value, ["minimumM", "maximumM"], path);
  const minimum = finiteVector3(value.minimumM, {
      path: [...path, "minimumM"],
    }),
    maximum = finiteVector3(value.maximumM, {
      path: [...path, "maximumM"],
    });
  for (let axis = 0; axis < 3; axis++)
    if (minimum[axis] > maximum[axis])
      fail("INVALID_GEOMETRY_BOUNDS", "Bounds minimum exceeds maximum", path);
}

function sameBounds(actual, expected, tolerance = 1e-10) {
  if (actual === null || expected === null) return actual === expected;
  return ["minimumM", "maximumM"].every((key) =>
    actual[key].every(
      (value, axis) => Math.abs(value - expected[key][axis]) <= tolerance,
    ),
  );
}

function requireBounds(actual, expected, path) {
  validateBoundsRecord(actual, path);
  if (!sameBounds(actual, expected))
    fail(
      "INVALID_GEOMETRY_BOUNDS",
      `${path.join(".")} does not match its canonical union`,
      path,
      { actual, expected },
    );
}

function validateDeformationContract(value, bodyPrimitives, path) {
  if (value === null) return;
  closedKeys(value, ["kind", "coordinates"], path);
  if (
    value.kind !== "mechanism-deformation-v1" ||
    !Array.isArray(value.coordinates)
  )
    fail("INVALID_DEFORMATION_CONTRACT", "Invalid deformation contract", path);
  const bodyIds = new Set(bodyPrimitives.map(({ id }) => id)),
    coordinateIds = new Set(),
    projectionIds = new Set(),
    claimedPrimitives = new Set();
  for (const [index, coordinate] of value.coordinates.entries()) {
    const coordinatePath = [...path, "coordinates", index];
    closedKeys(
      coordinate,
      [
        "id",
        "projections",
        "referenceCoordinateM",
        "referenceBodyLengthM",
        "allowedCoordinateRangeM",
      ],
      coordinatePath,
    );
    if (
      typeof coordinate.id !== "string" ||
      !coordinate.id ||
      coordinateIds.has(coordinate.id)
    )
      fail(
        "INVALID_DEFORMATION_CONTRACT",
        "Duplicate deformation coordinate",
        coordinatePath,
      );
    coordinateIds.add(coordinate.id);
    if (
      !Array.isArray(coordinate.projections) ||
      !coordinate.projections.length
    )
      fail(
        "INVALID_DEFORMATION_CONTRACT",
        "Deformation coordinate requires projections",
        coordinatePath,
      );
    for (const [
      projectionIndex,
      projection,
    ] of coordinate.projections.entries()) {
      const projectionPath = [
        ...coordinatePath,
        "projections",
        projectionIndex,
      ];
      closedOptionalKeys(
        projection,
        ["id", "kind", "primitiveIds"],
        ["gainMPerM"],
        projectionPath,
      );
      if (
        typeof projection.id !== "string" ||
        !projection.id ||
        projectionIds.has(projection.id) ||
        !["anchor-local-z-scale-v1", "local-z-translation-v1"].includes(
          projection.kind,
        ) ||
        !Array.isArray(projection.primitiveIds) ||
        !projection.primitiveIds.length
      )
        fail(
          "INVALID_DEFORMATION_CONTRACT",
          "Invalid mechanism primitive projection",
          projectionPath,
        );
      projectionIds.add(projection.id);
      if (projection.kind === "local-z-translation-v1") {
        if (!Number.isFinite(projection.gainMPerM))
          fail(
            "INVALID_DEFORMATION_CONTRACT",
            "Translation projection requires a finite gain",
            projectionPath,
          );
      } else if (Object.hasOwn(projection, "gainMPerM"))
        fail(
          "INVALID_DEFORMATION_CONTRACT",
          "Scale projection cannot declare a translation gain",
          projectionPath,
        );
      for (const primitiveId of projection.primitiveIds) {
        if (!bodyIds.has(primitiveId) || claimedPrimitives.has(primitiveId))
          fail(
            "INVALID_DEFORMATION_PRIMITIVE",
            `Invalid deformation primitive ${primitiveId}`,
            projectionPath,
          );
        claimedPrimitives.add(primitiveId);
      }
    }
    finitePositive(coordinate.referenceCoordinateM, [
      ...coordinatePath,
      "referenceCoordinateM",
    ]);
    finitePositive(coordinate.referenceBodyLengthM, [
      ...coordinatePath,
      "referenceBodyLengthM",
    ]);
    closedKeys(
      coordinate.allowedCoordinateRangeM,
      ["minimum", "maximum"],
      [...coordinatePath, "allowedCoordinateRangeM"],
    );
    finiteNonNegative(coordinate.allowedCoordinateRangeM.minimum, [
      ...coordinatePath,
      "allowedCoordinateRangeM",
      "minimum",
    ]);
    finiteNonNegative(coordinate.allowedCoordinateRangeM.maximum, [
      ...coordinatePath,
      "allowedCoordinateRangeM",
      "maximum",
    ]);
    if (
      coordinate.allowedCoordinateRangeM.minimum >
      coordinate.allowedCoordinateRangeM.maximum
    )
      fail(
        "INVALID_DEFORMATION_CONTRACT",
        "Deformation coordinate range is inverted",
        coordinatePath,
      );
  }
}

function validateRuntimeGeometryContract(value, portFrames, path) {
  if (value === null) return;
  closedKeys(
    value,
    [
      "kind",
      "endpointPortIds",
      "diameterM",
      "maximumSegmentCount",
      "materialKey",
      "styleKey",
      "telemetryProjection",
    ],
    path,
  );
  if (value.kind !== "flexible-line-runtime-geometry-v1")
    fail(
      "INVALID_FLEXIBLE_GEOMETRY",
      "Unknown flexible runtime contract",
      path,
    );
  if (
    !Array.isArray(value.endpointPortIds) ||
    value.endpointPortIds.length !== 2 ||
    new Set(value.endpointPortIds).size !== 2 ||
    value.endpointPortIds.some((id) => !portFrames[id])
  )
    fail(
      "INVALID_FLEXIBLE_GEOMETRY",
      "Flexible endpoints must reference two spatial ports",
      path,
    );
  finitePositive(value.diameterM, [...path, "diameterM"]);
  if (
    !Number.isInteger(value.maximumSegmentCount) ||
    value.maximumSegmentCount <= 0
  )
    fail(
      "INVALID_FLEXIBLE_GEOMETRY",
      "Flexible segment count must be positive",
      path,
    );
  if (
    typeof value.materialKey !== "string" ||
    !value.materialKey ||
    value.styleKey !== "rope-v1" ||
    value.telemetryProjection !== "completed-centerline-v1"
  )
    fail(
      "INVALID_FLEXIBLE_GEOMETRY",
      "Invalid flexible presentation contract",
      path,
    );
}

/** @param {unknown} value @returns {GeometryDescriptorV2} */
export function validateGeometryDescriptorOrThrow(value) {
  const descriptor = /** @type {any} */ (value),
    rootKeys = [
      "schemaVersion",
      "type",
      "geometryClass",
      "collisionPrimitives",
      "bodyPrimitives",
      "portClasses",
      "portFrames",
      "physicalFeatures",
      "deformationContract",
      "runtimeGeometryContract",
      "collisionBoundsPartM",
      "bodyBoundsPartM",
      "featureBoundsPartM",
      "selectionBoundsPartM",
      "overallPhysicalBoundsPartM",
      "massKg",
      "massProperties",
      "displacementM3",
      "aerodynamicSurfaces",
      "aerothermal",
      "provenance",
    ];
  closedKeys(descriptor, rootKeys, ["geometryDescriptor"]);
  if (descriptor.schemaVersion !== COMPONENT_GEOMETRY_SCHEMA_VERSION)
    fail(
      "UNSUPPORTED_GEOMETRY_SCHEMA",
      "Geometry descriptor must be version 2",
    );
  if (!GEOMETRY_CLASS_SET.has(descriptor.geometryClass))
    fail("UNKNOWN_GEOMETRY_CLASS", "Unknown geometry class");
  if (typeof descriptor.type !== "string" || !descriptor.type)
    fail("INVALID_GEOMETRY_TYPE", "Geometry descriptor type is required");
  const ids = new Set();
  for (const [collectionName, collection] of [
    ["collisionPrimitives", descriptor.collisionPrimitives],
    ["bodyPrimitives", descriptor.bodyPrimitives],
  ]) {
    if (!Array.isArray(collection))
      fail("INVALID_GEOMETRY_COLLECTION", `${collectionName} must be an array`);
    for (const [index, item] of collection.entries()) {
      validatePrimitiveRecord(item, [collectionName, index]);
      if (
        collectionName === "collisionPrimitives" &&
        !COLLISION_PRIMITIVE_KIND_SET.has(item.geometry.kind)
      )
        fail(
          "INVALID_GEOMETRY_PRIMITIVE_ROLE",
          `${item.geometry.kind} is a body-only geometry primitive`,
          [collectionName, index, "geometry", "kind"],
        );
      if (ids.has(`${collectionName}:${item.id}`))
        fail(
          "DUPLICATE_GEOMETRY_ID",
          `Duplicate ${collectionName} ID ${item.id}`,
        );
      ids.add(`${collectionName}:${item.id}`);
    }
  }
  if (
    !descriptor.portClasses ||
    typeof descriptor.portClasses !== "object" ||
    Array.isArray(descriptor.portClasses)
  )
    fail("INVALID_PORT_CLASSES", "portClasses must be an object");
  if (
    !descriptor.portFrames ||
    typeof descriptor.portFrames !== "object" ||
    Array.isArray(descriptor.portFrames)
  )
    fail("INVALID_PORT_FRAMES", "portFrames must be an object");
  for (const [portId, classification] of Object.entries(
    descriptor.portClasses,
  )) {
    if (!portId) fail("INVALID_PORT_CLASSES", "Port IDs cannot be empty");
    if (!PORT_CLASS_SET.has(classification))
      fail("UNKNOWN_PORT_SPATIAL_CLASS", `Unknown class for ${portId}`);
    const hasFrame = Object.hasOwn(descriptor.portFrames, portId);
    if (classification !== "network-only" && !hasFrame)
      fail(
        "INVALID_PORT_FRAME_MEMBERSHIP",
        `Port frame membership is invalid for ${portId}`,
      );
  }
  for (const [portId, portFrame] of Object.entries(descriptor.portFrames)) {
    if (!Object.hasOwn(descriptor.portClasses, portId))
      fail("UNKNOWN_PORT_FRAME", `Frame ${portId} has no declared port`);
    closedKeys(
      portFrame,
      ["framePart", "clearanceM", "anchorPolicy"],
      ["portFrames", portId],
    );
    validateFrameRecord(portFrame.framePart, [
      "portFrames",
      portId,
      "framePart",
    ]);
    finiteNonNegative(portFrame.clearanceM, [
      "portFrames",
      portId,
      "clearanceM",
    ]);
    if (
      !["fixed-point-v1", "surface-point-v1"].includes(portFrame.anchorPolicy)
    )
      fail("INVALID_PORT_ANCHOR_POLICY", `Unknown anchor policy for ${portId}`);
  }
  if (!Array.isArray(descriptor.physicalFeatures))
    fail("INVALID_GEOMETRY_COLLECTION", "physicalFeatures must be an array");
  const featureIds = new Set();
  for (const [index, feature] of descriptor.physicalFeatures.entries()) {
    const featurePath = ["physicalFeatures", index];
    closedKeys(
      feature,
      [
        "id",
        "primitive",
        "anchor",
        "dimensions",
        "axialOrigin",
        "role",
        "materialKey",
      ],
      featurePath,
    );
    if (
      typeof feature.id !== "string" ||
      !feature.id ||
      featureIds.has(feature.id)
    )
      fail(
        "DUPLICATE_GEOMETRY_ID",
        "Physical feature IDs must be unique",
        featurePath,
      );
    featureIds.add(feature.id);
    if (!["cylinder-v1", "elliptic-cylinder-v1"].includes(feature.primitive))
      fail(
        "UNKNOWN_GEOMETRY_PRIMITIVE",
        `Unknown feature primitive ${feature.primitive}`,
        featurePath,
      );
    closedKeys(
      feature.anchor,
      ["kind", "portId", "offsetM"],
      [...featurePath, "anchor"],
    );
    if (
      feature.anchor.kind !== "port-frame-v1" ||
      typeof feature.anchor.portId !== "string" ||
      !descriptor.portFrames[feature.anchor.portId]
    )
      fail(
        "INVALID_FEATURE_ANCHOR",
        `Invalid feature anchor for ${feature.id}`,
        featurePath,
      );
    finiteVector3(feature.anchor.offsetM, {
      path: [...featurePath, "anchor", "offsetM"],
    });
    if (!FEATURE_ORIGIN_SET.has(feature.axialOrigin))
      fail(
        "UNKNOWN_FEATURE_AXIAL_ORIGIN",
        `Unknown axial origin for ${feature.id}`,
      );
    if (!PHYSICAL_FEATURE_ROLES.includes(feature.role))
      fail("UNKNOWN_PHYSICAL_FEATURE_ROLE", `Unknown role for ${feature.id}`);
    if (typeof feature.materialKey !== "string" || !feature.materialKey)
      fail(
        "INVALID_GEOMETRY_MATERIAL",
        "Feature material key is required",
        featurePath,
      );
    if (feature.primitive === "cylinder-v1") {
      closedKeys(
        feature.dimensions,
        ["radiusM", "lengthM"],
        [...featurePath, "dimensions"],
      );
      finitePositive(feature.dimensions.radiusM, [
        ...featurePath,
        "dimensions",
        "radiusM",
      ]);
    } else {
      closedKeys(
        feature.dimensions,
        ["radiusXM", "radiusYM", "lengthM"],
        [...featurePath, "dimensions"],
      );
      finitePositive(feature.dimensions.radiusXM, [
        ...featurePath,
        "dimensions",
        "radiusXM",
      ]);
      finitePositive(feature.dimensions.radiusYM, [
        ...featurePath,
        "dimensions",
        "radiusYM",
      ]);
    }
    finitePositive(feature.dimensions.lengthM, [
      ...featurePath,
      "dimensions",
      "lengthM",
    ]);
  }
  validateDeformationContract(
    descriptor.deformationContract,
    descriptor.bodyPrimitives,
    ["deformationContract"],
  );
  validateRuntimeGeometryContract(
    descriptor.runtimeGeometryContract,
    descriptor.portFrames,
    ["runtimeGeometryContract"],
  );
  if (!Number.isFinite(descriptor.massKg) || descriptor.massKg < 0)
    fail(
      "INVALID_GEOMETRY_MASS",
      "Geometry mass must be finite and non-negative",
    );
  if (
    !Number.isFinite(descriptor.displacementM3) ||
    descriptor.displacementM3 < 0
  )
    fail(
      "INVALID_GEOMETRY_VOLUME",
      "Geometry displacement must be finite and non-negative",
    );
  closedKeys(
    descriptor.massProperties,
    [
      "sourceKind",
      "massEvaluationPolicy",
      "massKg",
      "volumeM3",
      "comPositionPartM",
      "inertiaTensorAtComPartKgM2",
      "contributingSolidIds",
      "principalMomentsKgM2",
      "principalAxesPart",
      "decompositionPolicy",
    ],
    ["massProperties"],
  );
  if (Math.abs(descriptor.massProperties.massKg - descriptor.massKg) > 1e-10)
    fail(
      "INVALID_GEOMETRY_MASS",
      "Descriptor and mass-property masses disagree",
    );
  finiteNonNegative(descriptor.massProperties.volumeM3, [
    "massProperties",
    "volumeM3",
  ]);
  finiteVector3(descriptor.massProperties.comPositionPartM, {
    path: ["massProperties", "comPositionPartM"],
  });
  closedKeys(
    descriptor.massProperties.inertiaTensorAtComPartKgM2,
    ["xx", "yy", "zz", "xy", "xz", "yz"],
    ["massProperties", "inertiaTensorAtComPartKgM2"],
  );
  for (const key of ["xx", "yy", "zz", "xy", "xz", "yz"])
    if (
      !Number.isFinite(
        descriptor.massProperties.inertiaTensorAtComPartKgM2[key],
      )
    )
      fail("INVALID_GEOMETRY_MASS", `Invalid inertia tensor field ${key}`);
  if (
    !Array.isArray(descriptor.massProperties.principalMomentsKgM2) ||
    descriptor.massProperties.principalMomentsKgM2.length !== 3 ||
    descriptor.massProperties.principalMomentsKgM2.some(
      (moment) => !Number.isFinite(moment) || moment < 0,
    )
  )
    fail("INVALID_GEOMETRY_MASS", "Invalid principal inertia moments");
  if (
    !Array.isArray(descriptor.massProperties.principalAxesPart) ||
    descriptor.massProperties.principalAxesPart.length !== 3
  )
    fail("INVALID_GEOMETRY_MASS", "Invalid principal inertia axes");
  for (const axis of descriptor.massProperties.principalAxesPart)
    finiteVector3(axis);
  if (!Array.isArray(descriptor.massProperties.contributingSolidIds))
    fail("INVALID_GEOMETRY_MASS", "Contributing solid IDs must be an array");
  if (!Array.isArray(descriptor.aerodynamicSurfaces))
    fail(
      "INVALID_GEOMETRY_AERODYNAMICS",
      "aerodynamicSurfaces must be an array",
    );
  for (const [index, surface] of descriptor.aerodynamicSurfaces.entries()) {
    closedKeys(
      surface,
      ["areaM2", "dragCoefficient", "liftSlope"],
      ["aerodynamicSurfaces", index],
    );
    finiteNonNegative(surface.areaM2, ["aerodynamicSurfaces", index, "areaM2"]);
    finiteNonNegative(surface.dragCoefficient, [
      "aerodynamicSurfaces",
      index,
      "dragCoefficient",
    ]);
    if (!Number.isFinite(surface.liftSlope))
      fail("INVALID_GEOMETRY_AERODYNAMICS", "liftSlope must be finite");
  }
  closedKeys(
    descriptor.aerothermal,
    ["material", "noseRadiusM"],
    ["aerothermal"],
  );
  closedOptionalKeys(
    descriptor.aerothermal.material,
    ["heatLimit", "specificHeat", "emissivity", "cd"],
    ["ablative", "pyrolysisTemperatureK", "heatOfAblationJkg"],
    ["aerothermal", "material"],
  );
  for (const key of ["heatLimit", "specificHeat", "emissivity", "cd"])
    finiteNonNegative(descriptor.aerothermal.material[key], [
      "aerothermal",
      "material",
      key,
    ]);
  finitePositive(descriptor.aerothermal.noseRadiusM, [
    "aerothermal",
    "noseRadiusM",
  ]);

  const collisionBounds = unionBounds(
      descriptor.collisionPrimitives.map(boundsForPrimitive),
    ),
    bodyBounds = unionBounds(descriptor.bodyPrimitives.map(boundsForPrimitive)),
    featurePrimitives = descriptor.physicalFeatures.map((feature) =>
      featurePrimitive(feature, descriptor.portFrames),
    ),
    featureBounds = unionBounds(featurePrimitives.map(boundsForPrimitive));
  requireBounds(descriptor.collisionBoundsPartM, collisionBounds, [
    "collisionBoundsPartM",
  ]);
  requireBounds(descriptor.bodyBoundsPartM, bodyBounds, ["bodyBoundsPartM"]);
  requireBounds(descriptor.featureBoundsPartM, featureBounds, [
    "featureBoundsPartM",
  ]);

  if (descriptor.geometryClass === "rigid-static-v1") {
    if (
      descriptor.deformationContract !== null ||
      descriptor.runtimeGeometryContract !== null
    )
      fail(
        "INVALID_GEOMETRY_CLASS_CONTRACT",
        "Rigid geometry cannot declare a dynamic contract",
      );
    requireBounds(
      descriptor.selectionBoundsPartM,
      unionBounds([bodyBounds, featureBounds]),
      ["selectionBoundsPartM"],
    );
  } else if (descriptor.geometryClass === "mechanism-deformed-v1") {
    if (
      !descriptor.deformationContract ||
      descriptor.runtimeGeometryContract !== null
    )
      fail(
        "INVALID_GEOMETRY_CLASS_CONTRACT",
        "Deformed geometry requires only a deformation contract",
      );
    requireBounds(
      descriptor.selectionBoundsPartM,
      conservativeDeformationSelectionBounds(
        descriptor.bodyPrimitives,
        featureBounds,
        descriptor.deformationContract,
      ),
      ["selectionBoundsPartM"],
    );
  } else {
    if (
      descriptor.deformationContract !== null ||
      !descriptor.runtimeGeometryContract ||
      descriptor.collisionPrimitives.length ||
      descriptor.bodyPrimitives.length ||
      descriptor.physicalFeatures.length
    )
      fail(
        "INVALID_GEOMETRY_CLASS_CONTRACT",
        "Flexible geometry must be runtime-owned",
      );
    requireBounds(descriptor.collisionBoundsPartM, null, [
      "collisionBoundsPartM",
    ]);
    requireBounds(descriptor.bodyBoundsPartM, null, ["bodyBoundsPartM"]);
    requireBounds(descriptor.featureBoundsPartM, null, ["featureBoundsPartM"]);
    requireBounds(
      descriptor.selectionBoundsPartM,
      flexibleSelectionBounds(
        descriptor.portFrames,
        descriptor.runtimeGeometryContract,
      ),
      ["selectionBoundsPartM"],
    );
  }
  requireBounds(
    descriptor.overallPhysicalBoundsPartM,
    descriptor.geometryClass === "runtime-flexible-v1"
      ? null
      : unionBounds([collisionBounds, bodyBounds, featureBounds]),
    ["overallPhysicalBoundsPartM"],
  );

  closedKeys(
    descriptor.provenance,
    [
      "kind",
      "definitionKind",
      "definitionVersion",
      "definitionDigest",
      "topologyDigest",
      "sources",
      "approximations",
    ],
    ["provenance"],
  );
  if (
    descriptor.provenance.kind !== "component-geometry-definition-v2" ||
    typeof descriptor.provenance.definitionKind !== "string" ||
    !Number.isInteger(descriptor.provenance.definitionVersion) ||
    !/^[0-9a-f]{64}$/.test(descriptor.provenance.definitionDigest) ||
    (descriptor.provenance.topologyDigest !== null &&
      typeof descriptor.provenance.topologyDigest !== "string") ||
    !Array.isArray(descriptor.provenance.sources) ||
    !Array.isArray(descriptor.provenance.approximations)
  )
    fail("INVALID_GEOMETRY_PROVENANCE", "Invalid geometry provenance", [
      "provenance",
    ]);
  const projectedIds = new Set([
    ...descriptor.collisionPrimitives.map(({ id }) => `collision:${id}`),
    ...descriptor.bodyPrimitives.map(({ id }) => `body:${id}`),
    ...descriptor.physicalFeatures.map(({ id }) => `feature:${id}`),
  ]);
  const sourceIds = new Set();
  for (const [index, source] of descriptor.provenance.sources.entries()) {
    closedKeys(
      source,
      ["projection", "id", "definitionPath"],
      ["provenance", "sources", index],
    );
    const key = `${source.projection}:${source.id}`;
    if (
      !projectedIds.has(key) ||
      sourceIds.has(key) ||
      typeof source.definitionPath !== "string"
    )
      fail("INVALID_GEOMETRY_PROVENANCE", `Invalid projection source ${key}`);
    sourceIds.add(key);
  }
  if (sourceIds.size !== projectedIds.size)
    fail(
      "INVALID_GEOMETRY_PROVENANCE",
      "Every physical projection requires one source path",
    );
  for (const [
    index,
    approximation,
  ] of descriptor.provenance.approximations.entries()) {
    closedKeys(
      approximation,
      ["id", "approximationOf"],
      ["provenance", "approximations", index],
    );
    const primitive = descriptor.collisionPrimitives.find(
      ({ id }) => id === approximation.id,
    );
    if (
      !primitive ||
      primitive.approximationOf !== approximation.approximationOf
    )
      fail(
        "INVALID_GEOMETRY_PROVENANCE",
        "Approximation provenance disagrees with collision geometry",
      );
  }
  return deepFreeze(structuredClone(descriptor));
}

/** @param {unknown} value @returns {ComponentGeometryDefinitionV2} */
export function validateComponentGeometryDefinitionOrThrow(value) {
  const definition = /** @type {any} */ (value);
  if (
    !definition ||
    typeof definition !== "object" ||
    Array.isArray(definition)
  )
    fail(
      "INVALID_COMPONENT_GEOMETRY_DEFINITION",
      "Geometry definition must be an object",
    );
  closedOptionalKeys(
    definition,
    [
      "schemaVersion",
      "kind",
      "geometryClass",
      "dimensionalScalingPolicy",
      "portFrames",
      "collisionPrimitives",
      "bodyPrimitives",
      "physicalFeatures",
    ],
    ["deformationContract"],
    ["geometryDefinition"],
  );
  if (definition.schemaVersion !== 1)
    fail(
      "UNSUPPORTED_GEOMETRY_DEFINITION_SCHEMA",
      "Component geometry definition must be version 1",
    );
  if (
    ![
      "primitive-component-geometry-v1",
      "mechanism-component-geometry-v1",
      "flexible-line-component-geometry-v1",
      "radial-rotor-component-geometry-v1",
    ].includes(definition.kind) ||
    !GEOMETRY_CLASS_SET.has(definition.geometryClass) ||
    ![
      "fixed-authored-size-v1",
      "uniform-similarity-v1",
      "axis-aligned-affine-v1",
    ].includes(definition.dimensionalScalingPolicy)
  )
    fail(
      "INVALID_COMPONENT_GEOMETRY_DEFINITION",
      "Geometry definition has an unknown kind, class, or scale policy",
    );
  if (
    !definition.portFrames ||
    typeof definition.portFrames !== "object" ||
    Array.isArray(definition.portFrames)
  )
    fail(
      "INVALID_COMPONENT_GEOMETRY_DEFINITION",
      "Geometry definition requires a port-frame record",
    );

  const validatePositionSource = (source, path) => {
    if (!source || typeof source !== "object" || Array.isArray(source))
      fail("INVALID_GEOMETRY_POSITION_SOURCE", "Invalid position source", path);
    if (["constant-v1", "size-fraction-v1"].includes(source.kind)) {
      closedKeys(source, ["kind", "value"], path);
      finiteVector3(source.value, { path: [...path, "value"] });
    } else if (source.kind === "config-scalar-axis-v1") {
      closedKeys(source, ["kind", "field", "axis", "factor"], path);
      if (
        typeof source.field !== "string" ||
        !source.field ||
        !Number.isInteger(source.axis) ||
        source.axis < 0 ||
        source.axis > 2 ||
        !Number.isFinite(source.factor)
      )
        fail(
          "INVALID_GEOMETRY_POSITION_SOURCE",
          "Invalid config-axis source",
          path,
        );
    } else if (source.kind === "flexible-endpoint-v1") {
      closedKeys(source, ["kind", "endpoint"], path);
      if (!["a", "b"].includes(source.endpoint))
        fail(
          "INVALID_GEOMETRY_POSITION_SOURCE",
          "Invalid flexible endpoint",
          path,
        );
    } else if (source.kind === "mechanism-reference-endpoint-v1") {
      closedKeys(source, ["kind", "endpoint"], path);
      if (!["a", "b"].includes(source.endpoint))
        fail(
          "INVALID_GEOMETRY_POSITION_SOURCE",
          "Invalid mechanism reference endpoint",
          path,
        );
    } else
      fail(
        "UNKNOWN_GEOMETRY_POSITION_SOURCE",
        `Unknown position source ${String(source.kind)}`,
        path,
      );
  };
  const validateDefinitionFrame = (source, path) => {
    closedOptionalKeys(
      source,
      ["position", "orientation"],
      ["clearanceM"],
      path,
    );
    validatePositionSource(source.position, [...path, "position"]);
    canonicalQuaternion(source.orientation, { path: [...path, "orientation"] });
    if (Object.hasOwn(source, "clearanceM"))
      finiteNonNegative(source.clearanceM, [...path, "clearanceM"]);
  };
  for (const [portId, source] of Object.entries(definition.portFrames)) {
    if (!portId)
      fail(
        "INVALID_COMPONENT_GEOMETRY_DEFINITION",
        "Port frame ID is required",
      );
    validateDefinitionFrame(source, [
      "geometryDefinition",
      "portFrames",
      portId,
    ]);
  }

  const validateDefinitionGeometry = (geometry, path) => {
    if (!geometry || typeof geometry !== "object" || Array.isArray(geometry))
      fail(
        "INVALID_COMPONENT_GEOMETRY_DEFINITION",
        "Primitive geometry is required",
        path,
      );
    if (geometry.kind === "box-v1") {
      const sizeKey = Object.hasOwn(geometry, "fullSize")
        ? "fullSize"
        : "fullSizeM";
      closedKeys(geometry, ["kind", sizeKey], path);
      if (sizeKey === "fullSize") {
        closedKeys(geometry.fullSize, ["kind", "field"], [...path, "fullSize"]);
        if (
          geometry.fullSize.kind !== "config-vector-v1" ||
          typeof geometry.fullSize.field !== "string"
        )
          fail(
            "INVALID_COMPONENT_GEOMETRY_DEFINITION",
            "Invalid box dimension source",
            path,
          );
      } else
        finiteVector3(geometry.fullSizeM, {
          path: [...path, "fullSizeM"],
        }).forEach((dimension, axis) =>
          finitePositive(dimension, [...path, "fullSizeM", axis]),
        );
    } else if (geometry.kind === "rounded-box-v1") {
      const sizeKey = Object.hasOwn(geometry, "fullSize")
        ? "fullSize"
        : "fullSizeM";
      closedKeys(geometry, ["kind", sizeKey, "radiusM"], path);
      let dimensions = null;
      if (sizeKey === "fullSize") {
        closedKeys(geometry.fullSize, ["kind", "field"], [...path, "fullSize"]);
        if (
          geometry.fullSize.kind !== "config-vector-v1" ||
          typeof geometry.fullSize.field !== "string"
        )
          fail(
            "INVALID_COMPONENT_GEOMETRY_DEFINITION",
            "Invalid rounded-box dimension source",
            path,
          );
      } else {
        dimensions = finiteVector3(geometry.fullSizeM, {
          path: [...path, "fullSizeM"],
        });
        dimensions.forEach((dimension, axis) =>
          finitePositive(dimension, [...path, "fullSizeM", axis]),
        );
      }
      finitePositive(geometry.radiusM, [...path, "radiusM"]);
      if (dimensions && geometry.radiusM > Math.min(...dimensions) / 2)
        fail(
          "INVALID_GEOMETRY_DIMENSION",
          "Rounded-box radius exceeds its envelope",
          [...path, "radiusM"],
        );
    } else if (geometry.kind === "cylinder-v1") {
      const radiusKey = Object.hasOwn(geometry, "radius")
        ? "radius"
        : "radiusM";
      closedKeys(geometry, ["kind", radiusKey, "axialLengthM"], path);
      if (radiusKey === "radius") {
        closedKeys(geometry.radius, ["kind", "field"], [...path, "radius"]);
        if (
          geometry.radius.kind !== "config-scalar-v1" ||
          typeof geometry.radius.field !== "string"
        )
          fail(
            "INVALID_COMPONENT_GEOMETRY_DEFINITION",
            "Invalid radius source",
            path,
          );
      } else finitePositive(geometry.radiusM, [...path, "radiusM"]);
      finitePositive(geometry.axialLengthM, [...path, "axialLengthM"]);
    } else if (geometry.kind === "sphere-v1") {
      closedKeys(geometry, ["kind", "radiusM"], path);
      finitePositive(geometry.radiusM, [...path, "radiusM"]);
    } else if (geometry.kind === "capsule-v1") {
      closedKeys(geometry, ["kind", "radiusM", "cylinderLengthM"], path);
      finitePositive(geometry.radiusM, [...path, "radiusM"]);
      finitePositive(geometry.cylinderLengthM, [...path, "cylinderLengthM"]);
    } else if (geometry.kind === "cone-v1") {
      closedKeys(
        geometry,
        ["kind", "startRadiusM", "endRadiusM", "axialLengthM"],
        path,
      );
      finiteNonNegative(geometry.startRadiusM, [...path, "startRadiusM"]);
      finiteNonNegative(geometry.endRadiusM, [...path, "endRadiusM"]);
      finitePositive(geometry.axialLengthM, [...path, "axialLengthM"]);
    } else if (geometry.kind === "rounded-wheel-v1") {
      closedKeys(
        geometry,
        ["kind", "radiusM", "widthM", "shoulderRadiusM"],
        path,
      );
      for (const key of ["radiusM", "widthM", "shoulderRadiusM"])
        finitePositive(geometry[key], [...path, key]);
    } else if (geometry.kind === "spur-gear-v1") {
      validatePrimitiveGeometryRecord(geometry, path);
    } else if (geometry.kind === "helical-spring-v1") {
      validatePrimitiveGeometryRecord(geometry, path);
    } else if (geometry.kind === "extruded-profile-v1") {
      validatePrimitiveGeometryRecord(geometry, path);
    } else
      fail(
        "UNKNOWN_GEOMETRY_PRIMITIVE",
        `Unknown definition primitive ${String(geometry.kind)}`,
        path,
      );
  };
  const validateDefinitionPrimitive = (source, path) => {
    closedKeys(
      source,
      [
        "id",
        "frame",
        "geometry",
        "semanticKey",
        "materialKey",
        "contactRole",
        "approximationOf",
      ],
      path,
    );
    for (const key of ["id", "semanticKey", "materialKey", "contactRole"])
      if (typeof source[key] !== "string" || !source[key])
        fail(
          "INVALID_COMPONENT_GEOMETRY_DEFINITION",
          `Invalid primitive ${key}`,
          path,
        );
    validateDefinitionFrame(source.frame, [...path, "frame"]);
    validateDefinitionGeometry(source.geometry, [...path, "geometry"]);
  };

  if (definition.kind === "primitive-component-geometry-v1") {
    for (const collectionName of ["collisionPrimitives", "bodyPrimitives"]) {
      const collection = definition[collectionName];
      if (!Array.isArray(collection))
        fail(
          "INVALID_COMPONENT_GEOMETRY_DEFINITION",
          `${collectionName} must be an array`,
        );
      const collectionIds = new Set();
      for (const [index, source] of collection.entries()) {
        validateDefinitionPrimitive(source, [
          "geometryDefinition",
          collectionName,
          index,
        ]);
        if (
          collectionName === "collisionPrimitives" &&
          !COLLISION_PRIMITIVE_KIND_SET.has(source.geometry.kind)
        )
          fail(
            "INVALID_GEOMETRY_PRIMITIVE_ROLE",
            `${source.geometry.kind} is a body-only geometry primitive`,
            ["geometryDefinition", collectionName, index, "geometry", "kind"],
          );
        if (collectionIds.has(source.id))
          fail(
            "DUPLICATE_GEOMETRY_ID",
            `Duplicate definition primitive ${source.id}`,
          );
        collectionIds.add(source.id);
      }
    }
    const bodyIds = new Set(definition.bodyPrimitives.map(({ id }) => id));
    for (const [index, source] of definition.collisionPrimitives.entries()) {
      if (
        source.approximationOf !== null &&
        !bodyIds.has(source.approximationOf)
      )
        fail(
          "INVALID_COMPONENT_GEOMETRY_DEFINITION",
          "Collision approximation target must name a body primitive",
          [
            "geometryDefinition",
            "collisionPrimitives",
            index,
            "approximationOf",
          ],
        );
    }
  } else if (definition.kind === "mechanism-component-geometry-v1") {
    closedKeys(
      definition.collisionPrimitives,
      ["kind", "approximationOf"],
      ["geometryDefinition", "collisionPrimitives"],
    );
    if (
      definition.collisionPrimitives.kind !== "mechanism-collision-regions-v1"
    )
      fail(
        "INVALID_COMPONENT_GEOMETRY_DEFINITION",
        "Mechanism collision geometry must project authored collision regions",
      );
    if (!Array.isArray(definition.bodyPrimitives))
      fail(
        "INVALID_COMPONENT_GEOMETRY_DEFINITION",
        "Mechanism bodyPrimitives must be an explicit recipe array",
      );
    const bodyIds = new Set();
    for (const [index, source] of definition.bodyPrimitives.entries()) {
      validateDefinitionPrimitive(source, [
        "geometryDefinition",
        "bodyPrimitives",
        index,
      ]);
      if (bodyIds.has(source.id))
        fail(
          "DUPLICATE_GEOMETRY_ID",
          `Duplicate mechanism body primitive ${source.id}`,
        );
      bodyIds.add(source.id);
    }
    const approximationOf = definition.collisionPrimitives.approximationOf;
    if (approximationOf !== null && !bodyIds.has(approximationOf))
      fail(
        "INVALID_COMPONENT_GEOMETRY_DEFINITION",
        "Mechanism collision approximation target must name a body primitive",
      );
  } else if (definition.kind === "radial-rotor-component-geometry-v1") {
    closedKeys(
      definition.collisionPrimitives,
      ["kind"],
      ["geometryDefinition", "collisionPrimitives"],
    );
    closedKeys(
      definition.bodyPrimitives,
      ["kind"],
      ["geometryDefinition", "bodyPrimitives"],
    );
    if (
      definition.collisionPrimitives.kind !== "radial-rotor-hub-v1" ||
      definition.bodyPrimitives.kind !== "radial-rotor-body-v1"
    )
      fail(
        "INVALID_COMPONENT_GEOMETRY_DEFINITION",
        "Radial rotor geometry must project its canonical hub and blade body",
      );
  } else if (
    definition.collisionPrimitives.length !== 0 ||
    definition.bodyPrimitives.length !== 0
  )
    fail(
      "INVALID_FLEXIBLE_GEOMETRY",
      "Flexible definitions cannot author static primitives",
    );

  if (!Array.isArray(definition.physicalFeatures))
    fail(
      "INVALID_COMPONENT_GEOMETRY_DEFINITION",
      "physicalFeatures must be an array",
    );
  const featureIds = new Set();
  for (const [index, feature] of definition.physicalFeatures.entries()) {
    const path = ["geometryDefinition", "physicalFeatures", index];
    closedKeys(
      feature,
      [
        "id",
        "primitive",
        "anchor",
        "dimensions",
        "axialOrigin",
        "role",
        "materialKey",
      ],
      path,
    );
    if (featureIds.has(feature.id))
      fail("DUPLICATE_GEOMETRY_ID", `Duplicate feature ${feature.id}`, path);
    featureIds.add(feature.id);
    if (feature.primitive !== "cylinder-v1")
      fail(
        "UNKNOWN_GEOMETRY_PRIMITIVE",
        "Definition features must be circular before scale projection",
        path,
      );
    closedKeys(
      feature.anchor,
      ["kind", "portId", "offsetM"],
      [...path, "anchor"],
    );
    if (
      feature.anchor.kind !== "port-frame-v1" ||
      !definition.portFrames[feature.anchor.portId]
    )
      fail(
        "INVALID_FEATURE_ANCHOR",
        `Invalid feature anchor for ${feature.id}`,
        path,
      );
    finiteVector3(feature.anchor.offsetM, {
      path: [...path, "anchor", "offsetM"],
    });
    closedKeys(
      feature.dimensions,
      ["radiusM", "lengthM"],
      [...path, "dimensions"],
    );
    finitePositive(feature.dimensions.radiusM, [
      ...path,
      "dimensions",
      "radiusM",
    ]);
    finitePositive(feature.dimensions.lengthM, [
      ...path,
      "dimensions",
      "lengthM",
    ]);
    if (
      !FEATURE_ORIGIN_SET.has(feature.axialOrigin) ||
      !PHYSICAL_FEATURE_ROLES.includes(feature.role)
    )
      fail(
        "INVALID_COMPONENT_GEOMETRY_DEFINITION",
        `Invalid feature semantics for ${feature.id}`,
        path,
      );
  }

  const deformation = definition.deformationContract ?? null;
  if (definition.geometryClass === "mechanism-deformed-v1") {
    if (
      !deformation ||
      deformation.kind !== "mechanism-deformation-v1" ||
      !Array.isArray(deformation.coordinates)
    )
      fail(
        "INVALID_DEFORMATION_CONTRACT",
        "Deformed definition requires coordinates",
      );
  } else if (deformation !== null)
    fail(
      "INVALID_GEOMETRY_CLASS_CONTRACT",
      "Only deformed definitions may declare deformation",
    );
  if (
    (definition.geometryClass === "runtime-flexible-v1") !==
    (definition.kind === "flexible-line-component-geometry-v1")
  )
    fail(
      "INVALID_GEOMETRY_CLASS_CONTRACT",
      "Flexible geometry class and kind must agree",
    );
  return deepFreeze(structuredClone(definition));
}

/**
 * Resolves the sole engine-neutral geometry contract for one authored part.
 * @param {ComponentGeometryPartInput} part
 * @param {ComponentGeometryCatalog} [catalog]
 * @returns {GeometryDescriptorV2}
 */
export function resolveComponentGeometryContract(
  part,
  catalog = BUILT_IN_GEOMETRY_CATALOG,
) {
  if (!part || typeof part.type !== "string" || !catalog[part.type])
    fail(
      "UNKNOWN_COMPONENT_GEOMETRY",
      `Unknown component ${String(part?.type)}`,
    );
  const componentDefinition = catalog[part.type],
    geometryDefinition = componentDefinition.geometryContract
      ? validateComponentGeometryDefinitionOrThrow(
          componentDefinition.geometryContract,
        )
      : null;
  if (!geometryDefinition)
    fail(
      "MISSING_COMPONENT_GEOMETRY_DEFINITION",
      `Component ${part.type} has no geometry contract`,
    );
  validateScalePolicy(geometryDefinition, finiteScale3(part.scale));
  const definitionKind = geometryDefinition.kind,
    config = resolveComponentConfig(part, undefined, catalog),
    scale = finiteScale3(part.scale),
    rotorConfig =
      definitionKind === "radial-rotor-component-geometry-v1"
        ? validateRotorConfig(
            config,
            { x: scale[0], y: scale[1], z: scale[2] },
            part.id,
          )
        : null,
    geometryClass = geometryDefinition.geometryClass,
    { portClasses, portFrames } = resolvedPorts(
      part,
      config,
      catalog,
      scale,
      geometryDefinition,
    ),
    mechanism =
      definitionKind === "mechanism-component-geometry-v1"
        ? descriptorForMechanism(
            part,
            scale,
            geometryDefinition,
            config,
            componentDefinition,
          )
        : null,
    rotorGeometry = rotorConfig ? radialRotorGeometry(rotorConfig) : null,
    definitionCollisionPrimitives = /** @type {any[]} */ (
      geometryDefinition.collisionPrimitives
    ),
    definitionBodyPrimitives = /** @type {any[]} */ (
      geometryDefinition.bodyPrimitives
    ),
    collisionPrimitives = mechanism
      ? mechanism.collisionPrimitives
      : rotorGeometry
        ? rotorGeometry.collisionPrimitives
        : definitionKind === "primitive-component-geometry-v1"
          ? definitionCollisionPrimitives.map((source) =>
              resolvedDefinitionPrimitive(
                source,
                config,
                componentDefinition,
                scale,
                { collision: true },
              ),
            )
          : definitionKind === "flexible-line-component-geometry-v1"
            ? []
            : fail(
                "UNKNOWN_COMPONENT_GEOMETRY_DEFINITION",
                `Unknown geometry definition kind ${String(definitionKind)}`,
              ),
    bodyPrimitives = mechanism
      ? mechanism.bodyPrimitives
      : rotorGeometry
        ? rotorGeometry.bodyPrimitives
        : definitionKind === "primitive-component-geometry-v1"
          ? definitionBodyPrimitives.map((source) =>
              resolvedDefinitionPrimitive(
                source,
                config,
                componentDefinition,
                scale,
              ),
            )
          : [],
    physicalFeatures = physicalFeaturesFor(geometryDefinition, scale),
    featurePrimitives = physicalFeatures.map((feature) =>
      featurePrimitive(feature, portFrames),
    ),
    deformationContract = deformationContractFor(
      geometryDefinition,
      bodyPrimitives,
      componentDefinition,
      part,
      portFrames,
    ),
    runtimeGeometryContract = runtimeGeometryContractFor(
      geometryDefinition,
      componentDefinition,
      config,
    ),
    collisionBoundsPartM = unionBounds(
      collisionPrimitives.map(boundsForPrimitive),
    ),
    bodyBoundsPartM = unionBounds(bodyPrimitives.map(boundsForPrimitive)),
    featureBoundsPartM = unionBounds(featurePrimitives.map(boundsForPrimitive)),
    selectionBoundsPartM = runtimeGeometryContract
      ? flexibleSelectionBounds(portFrames, runtimeGeometryContract)
      : deformationContract
        ? conservativeDeformationSelectionBounds(
            bodyPrimitives,
            featureBoundsPartM,
            deformationContract,
          )
        : unionBounds([bodyBoundsPartM, featureBoundsPartM]),
    overallPhysicalBoundsPartM = runtimeGeometryContract
      ? null
      : unionBounds([
          collisionBoundsPartM,
          bodyBoundsPartM,
          featureBoundsPartM,
        ]),
    massKg = Number(
      mechanism?.massProperties.massKg ??
        part.mass ??
        config.mass ??
        componentDefinition.mass ??
        (runtimeGeometryContract
          ? Number(config.linearDensityKgPerM) * Number(config.lengthM)
          : 1),
    ),
    massProperties = mechanism
      ? mechanism.massProperties
      : rotorConfig
        ? radialRotorMassProperties(rotorConfig, bodyPrimitives)
        : collisionPrimitives.length
          ? ordinaryMassProperties(collisionPrimitives[0], massKg)
          : massPropertiesForBox(
              [
                Number(config.diameterM),
                Number(config.lengthM),
                Number(config.diameterM),
              ],
              massKg,
              "distributed-flexible-line-v1",
            ),
    displacementM3 = runtimeGeometryContract
      ? Math.PI *
        (runtimeGeometryContract.diameterM / 2) ** 2 *
        Number(config.lengthM)
      : collisionPrimitives.reduce(
          (sum, item) => sum + volumeOfGeometry(item.geometry),
          0,
        ),
    boundsForAero = collisionBoundsPartM || selectionBoundsPartM,
    dimensions = boundsForAero
      ? [0, 1, 2].map(
          (axis) => boundsForAero.maximumM[axis] - boundsForAero.minimumM[axis],
        )
      : [0, 0, 0],
    material = FLIGHT_MATERIALS[part.type] || FLIGHT_MATERIALS.default,
    sourceDigest = sha256Hex(stableStringify(geometryDefinition)),
    definitionPathForPrimitive = (projection, item) => {
      if (definitionKind === "mechanism-component-geometry-v1") {
        if (projection === "body") {
          const index = definitionBodyPrimitives.findIndex(
            ({ id }) => id === item.id,
          );
          return `geometryContract.bodyPrimitives[${index}]`;
        }
        const authoredMechanism = /** @type {any} */ (part.mechanism),
          index = authoredMechanism.collisionRegions.findIndex(
            ({ semanticKey }) => semanticKey === item.semanticKey,
          );
        return `mechanism.collisionRegions[${index}]`;
      }
      if (definitionKind === "radial-rotor-component-geometry-v1")
        return projection === "collision"
          ? "geometryContract.collisionPrimitives"
          : item.id === "hub"
            ? "geometryContract.bodyPrimitives.hub"
            : `geometryContract.bodyPrimitives.blades[${item.id.slice("blade-".length)}]`;
      const collection = /** @type {any[]} */ (
          geometryDefinition[`${projection}Primitives`]
        ),
        index = collection.findIndex(({ id }) => id === item.id);
      return `geometryContract.${projection}Primitives[${index}]`;
    },
    projectionSources = [
      ...collisionPrimitives.map((item) => ({
        projection: "collision",
        id: item.id,
        definitionPath: definitionPathForPrimitive("collision", item),
      })),
      ...bodyPrimitives.map((item) => ({
        projection: "body",
        id: item.id,
        definitionPath: definitionPathForPrimitive("body", item),
      })),
      ...physicalFeatures.map((item, index) => ({
        projection: "feature",
        id: item.id,
        definitionPath: `geometryContract.physicalFeatures[${index}]`,
      })),
    ],
    descriptor = {
      schemaVersion: COMPONENT_GEOMETRY_SCHEMA_VERSION,
      type: part.type,
      geometryClass,
      collisionPrimitives,
      bodyPrimitives,
      portClasses,
      portFrames,
      physicalFeatures,
      deformationContract,
      runtimeGeometryContract,
      collisionBoundsPartM,
      bodyBoundsPartM,
      featureBoundsPartM,
      selectionBoundsPartM,
      overallPhysicalBoundsPartM,
      massKg,
      massProperties,
      displacementM3,
      aerodynamicSurfaces: [
        {
          areaM2: rotorConfig
            ? Math.PI * rotorConfig.hubRadiusM ** 2
            : Math.max(
                dimensions[0] * dimensions[1],
                dimensions[0] * dimensions[2],
                dimensions[1] * dimensions[2],
              ),
          dragCoefficient: material.cd,
          liftSlope: Number(config.liftSlope || 0),
        },
      ],
      aerothermal: {
        material: structuredClone(material),
        noseRadiusM: Math.max(
          0.025,
          Number(
            rotorConfig?.hubRadiusM ||
              config.noseRadius ||
              Math.min(dimensions[0], dimensions[2]) / 2,
          ),
        ),
      },
      provenance: {
        kind: "component-geometry-definition-v2",
        definitionKind,
        definitionVersion: geometryDefinition.schemaVersion,
        definitionDigest: sourceDigest,
        topologyDigest: mechanism?.topologyDigest ?? null,
        sources: projectionSources,
        approximations: collisionPrimitives
          .filter(({ approximationOf }) => approximationOf)
          .map(({ id, approximationOf }) => ({ id, approximationOf })),
      },
    };
  return validateGeometryDescriptorOrThrow(descriptor);
}

/**
 * @param {string} type
 * @param {ComponentGeometryCatalog} [catalog]
 * @returns {GeometryDescriptorV2}
 */
export function resolveComponentGeometryContractForType(
  type,
  catalog = BUILT_IN_GEOMETRY_CATALOG,
) {
  const definition = catalog[type];
  if (!definition)
    fail("UNKNOWN_COMPONENT_GEOMETRY", `Unknown component ${type}`);
  return resolveComponentGeometryContract(
    {
      id: 0,
      type,
      pos: [0, 0, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1, y: 1, z: 1 },
      config: {},
      ...(definition.mechanism
        ? { mechanism: structuredClone(definition.mechanism) }
        : {}),
    },
    catalog,
  );
}

export function portAxisPart(portFrame) {
  return rotateVectorByQuaternion([0, 0, 1], portFrame.framePart.orientation);
}

export function primaryGeometryAxisPart(descriptor) {
  const firstFrame = Object.entries(descriptor.portFrames).find(
    ([portId]) => descriptor.portClasses[portId] !== "network-only",
  )?.[1];
  return firstFrame ? portAxisPart(firstFrame) : [0, 0, 1];
}

/**
 * Solves only the moving part translation required to make two canonical port
 * frames coincident. The caller remains authoritative for orientation.
 */
export function posePartForPortMatch({
  movingPart,
  movingPortId,
  targetPart,
  targetPortId,
  catalog = BUILT_IN_GEOMETRY_CATALOG,
}) {
  const movingFrame = resolveComponentGeometryContract(movingPart, catalog)
      .portFrames[movingPortId],
    targetFrame = resolveComponentGeometryContract(targetPart, catalog)
      .portFrames[targetPortId];
  if (!movingFrame || !targetFrame)
    fail(
      "MISSING_SPATIAL_PORT_FRAME",
      "Port matching requires two canonical spatial frames",
    );
  const targetOffset = rotateVectorByQuaternion(
      targetFrame.framePart.positionM,
      canonicalQuaternion(targetPart.orientation),
    ),
    movingOffset = rotateVectorByQuaternion(
      movingFrame.framePart.positionM,
      canonicalQuaternion(movingPart.orientation),
    ),
    targetWorld = finiteVector3(targetPart.pos).map(
      (value, axis) => value + targetOffset[axis],
    );
  return deepFreeze({
    positionM: targetWorld.map((value, axis) => {
      const resolved = value - movingOffset[axis];
      return resolved === 0 ? 0 : resolved;
    }),
    orientation: [...canonicalQuaternion(movingPart.orientation)],
  });
}

export function boundsCenter(bounds) {
  if (!bounds) return [0, 0, 0];
  return [0, 1, 2].map(
    (axis) => (bounds.minimumM[axis] + bounds.maximumM[axis]) / 2,
  );
}

export function boundsDimensions(bounds) {
  if (!bounds) return [0, 0, 0];
  return [0, 1, 2].map((axis) => bounds.maximumM[axis] - bounds.minimumM[axis]);
}

/**
 * Resolves the completed local body bounds for a closed mechanism deformation
 * snapshot. The descriptor remains the reference-pose authority; this helper
 * projects only coordinates explicitly declared by its deformation contract.
 * @param {GeometryDescriptorV2} descriptor
 * @param {{coordinateId:string,coordinateM:number}[]} coordinateSamples
 * @returns {GeometryBoundsV1|null}
 */
export function deformedBodyBoundsPartM(descriptor, coordinateSamples) {
  if (descriptor.geometryClass !== "mechanism-deformed-v1")
    return descriptor.bodyBoundsPartM;
  const coordinates = descriptor.deformationContract?.coordinates || [];
  const transforms = mechanismDeformationTransforms(
    descriptor,
    coordinateSamples,
  );
  let projectionPlan = deformationProjectionPlans.get(descriptor);
  if (!projectionPlan) {
    const projectionByPrimitive = new Map();
    for (const coordinate of coordinates)
      for (const projection of coordinate.projections)
        for (const primitiveId of projection.primitiveIds)
          projectionByPrimitive.set(primitiveId, projection);
    projectionPlan = descriptor.bodyPrimitives.map((primitive) => ({
      bounds: boundsForPrimitive(primitive),
      projection: projectionByPrimitive.get(primitive.id) || null,
    }));
    deformationProjectionPlans.set(descriptor, projectionPlan);
  }
  return unionBounds(
    projectionPlan.map(({ bounds, projection }) => {
      if (!projection) return bounds;
      return transformLocalBounds(bounds, transforms[projection.id]);
    }),
  );
}

/**
 * Resolves presentation and bounds transforms from the same completed physical
 * mechanism coordinates. No pose-owned scale or presentation inference enters
 * this function.
 * @param {GeometryDescriptorV2} descriptor
 * @param {{coordinateId:string,coordinateM:number}[]} coordinateSamples
 */
export function mechanismDeformationTransforms(descriptor, coordinateSamples) {
  const coordinates = descriptor.deformationContract?.coordinates || [];
  if (!Array.isArray(coordinateSamples))
    fail(
      "INVALID_DEFORMATION_TELEMETRY",
      "Mechanism coordinate samples must be an array",
    );
  const coordinateById = new Map(
      coordinates.map((coordinate) => [coordinate.id, coordinate]),
    ),
    sampleById = new Map();
  for (const [index, sample] of coordinateSamples.entries()) {
    closedKeys(
      sample,
      ["coordinateId", "coordinateM"],
      ["mechanismCoordinates", index],
    );
    if (
      typeof sample.coordinateId !== "string" ||
      !coordinateById.has(sample.coordinateId) ||
      sampleById.has(sample.coordinateId) ||
      !Number.isFinite(sample.coordinateM)
    )
      fail(
        "INVALID_DEFORMATION_TELEMETRY",
        `Invalid mechanism coordinate ${String(sample.coordinateId)}`,
      );
    const { minimum, maximum } = coordinateById.get(
      sample.coordinateId,
    ).allowedCoordinateRangeM;
    sampleById.set(
      sample.coordinateId,
      clampMechanismCoordinate(sample.coordinateM, minimum, maximum),
    );
  }
  if (sampleById.size !== coordinates.length)
    fail(
      "INVALID_DEFORMATION_TELEMETRY",
      "Every deformation coordinate requires one completed sample",
    );
  return deepFreeze(
    Object.fromEntries(
      coordinates.flatMap((coordinate) =>
        coordinate.projections.map((projection) => [
          projection.id,
          transformForProjection(
            coordinate,
            projection,
            sampleById.get(coordinate.id),
          ),
        ]),
      ),
    ),
  );
}

/**
 * Projects a part-local AABB into an exact conservative world AABB.
 * @param {GeometryBoundsV1|null} bounds
 * @param {number[]} positionWorldM
 * @param {number[]} orientationWorld
 * @returns {GeometryBoundsV1|null}
 */
export function projectBoundsToWorld(bounds, positionWorldM, orientationWorld) {
  if (!bounds) return null;
  const position = finiteVector3(positionWorldM),
    [x, y, z, w] = canonicalQuaternion(orientationWorld),
    centerPartM = [0, 1, 2].map(
      (axis) => (bounds.minimumM[axis] + bounds.maximumM[axis]) / 2,
    ),
    halfExtentPartM = [0, 1, 2].map(
      (axis) => (bounds.maximumM[axis] - bounds.minimumM[axis]) / 2,
    ),
    rotation = [
      [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
      [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
      [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ],
    centerWorldM = rotation.map(
      (row, worldAxis) =>
        position[worldAxis] +
        row.reduce(
          (sum, coefficient, localAxis) =>
            sum + coefficient * centerPartM[localAxis],
          0,
        ),
    ),
    halfExtentWorldM = rotation.map((row) =>
      row.reduce(
        (sum, coefficient, localAxis) =>
          sum + Math.abs(coefficient) * halfExtentPartM[localAxis],
        0,
      ),
    );
  return deepFreeze({
    minimumM: centerWorldM.map((value, axis) => value - halfExtentWorldM[axis]),
    maximumM: centerWorldM.map((value, axis) => value + halfExtentWorldM[axis]),
  });
}

/**
 * Computes the runtime-owned world bounds of a completed flexible centreline.
 * @param {Array<{x:number,y:number,z:number}>} centerline
 * @param {number} radiusM
 * @returns {GeometryBoundsV1}
 */
export function flexibleRuntimeBoundsWorldM(centerline, radiusM) {
  if (!Array.isArray(centerline) || !centerline.length)
    fail("INVALID_FLEXIBLE_TELEMETRY", "Flexible centreline is required");
  const radius = finitePositive(radiusM, ["runtimeBoundsWorldM", "radiusM"]),
    points = centerline.map((point, index) =>
      finiteVector3([point?.x, point?.y, point?.z], {
        path: ["runtimeBoundsWorldM", "centerline", index],
      }),
    );
  return deepFreeze({
    minimumM: [0, 1, 2].map(
      (axis) => Math.min(...points.map((point) => point[axis])) - radius,
    ),
    maximumM: [0, 1, 2].map(
      (axis) => Math.max(...points.map((point) => point[axis])) + radius,
    ),
  });
}

export { IDENTITY_FRAME };
