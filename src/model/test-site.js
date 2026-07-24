import {
  canonicalId,
  deepFreeze,
  DomainValidationError,
  finiteNumber,
} from "./primitives.js";
import {
  testSitePolygonRingsIssue,
  testSiteShapeBounds,
  testSiteShapeContains,
} from "./test-site-shapes.js";
import {
  testSiteFixtureContainsPoint,
  testSiteFixtureFootprintPoints,
} from "./test-site-fixture-geometry.js";
import { testSiteHeightFeatureShape } from "./test-site-terrain.js";
import { compileTestSiteVegetation } from "./test-site-vegetation.js";

export const TEST_SITE_SCHEMA_VERSION = "test-site-definition-v2";

const EXACT_KEYS = Object.freeze({
  root: [
    "baseTerrain",
    "clearVolumes",
    "coordinateFrame",
    "districts",
    "fluidRegions",
    "footprint",
    "heightFeatures",
    "id",
    "presentation",
    "routes",
    "schemaVersion",
    "stagingPads",
    "staticFixtures",
    "surfaceRegions",
    "vegetationRules",
    "zones",
  ],
  coordinateFrame: ["axes", "origin", "units"],
  footprint: ["centerM", "sizeM"],
  baseTerrain: ["heightM", "materialKey"],
  district: ["id", "label"],
  ellipseShape: ["centerM", "kind", "rotationRad", "sizeM"],
  rectangleShape: ["centerM", "kind", "rotationRad", "sizeM"],
  polygonShape: ["centerM", "kind", "ringsM", "rotationRad"],
  corridorNetworkShape: [
    "cap",
    "centerM",
    "join",
    "kind",
    "pathsM",
    "rotationRad",
    "widthM",
  ],
  surfaceRegion: ["districtId", "id", "materialKey", "shape"],
  moundFeature: [
    "districtId",
    "elevationM",
    "footprint",
    "id",
    "kind",
    "profile",
  ],
  gradeRampFeature: [
    "centerM",
    "crestLengthM",
    "districtId",
    "edgeBlendM",
    "headingRad",
    "id",
    "kind",
    "riseM",
    "runM",
    "transitionLengthM",
    "widthM",
  ],
  corridorProfileFeature: [
    "centerline",
    "districtId",
    "id",
    "kind",
    "transverseProfileM",
  ],
  rippleTrainFeature: [
    "amplitudeM",
    "centerM",
    "districtId",
    "edgeBlendM",
    "headingRad",
    "id",
    "kind",
    "phaseRad",
    "runM",
    "wavelengthM",
    "widthM",
  ],
  fluidRegion: [
    "densityKgPerM3",
    "depthProfile",
    "districtId",
    "id",
    "materialKey",
    "shape",
    "waterHeightM",
  ],
  fluidDepthProfile: [
    "fullDepthDistanceM",
    "kind",
    "maximumDepthM",
    "shoreDepthM",
    "shoreShelfM",
  ],
  clearVolume: ["districtId", "id", "label", "purpose", "shape"],
  staticFixture: [
    "collisionGeometry",
    "districtId",
    "id",
    "materialKey",
    "pose",
    "presentation",
  ],
  fixturePresentation: ["key", "variant"],
  collisionNone: ["kind"],
  collisionBox: ["kind", "sizeM"],
  collisionCylinder: ["axis", "heightM", "kind", "radiusM", "segments"],
  collisionCompound: ["children", "kind"],
  collisionChild: ["geometry", "offsetM", "rotationEulerRad"],
  stagingPad: ["clearanceM", "districtId", "id", "pose"],
  pose: ["headingRad", "positionM"],
  zone: ["districtId", "id", "label", "shape"],
  route: ["finish", "gateIds", "id", "label", "requirements", "stagingPadId"],
  routeFinish: ["grounded", "holdS", "maxSpeedMps"],
  routeGateStateRequirement: [
    "gateId",
    "grounded",
    "kind",
    "maxSpeedMps",
    "minSpeedMps",
  ],
  routeMaterialRequirement: ["kind", "materialKeys"],
  routeFluidRequirement: ["fluidId", "kind"],
  routeIntactRequirement: ["kind", "maxDamage"],
  vegetationRule: [
    "colliderMinimumRadiusM",
    "densityPerHectare",
    "districtId",
    "excludeClearVolumes",
    "excludeFluidRegions",
    "excludeStagingPads",
    "excludeSurfaceRegions",
    "exclusionMarginM",
    "exclusionShapes",
    "id",
    "kind",
    "materialKey",
    "minimumSpacingM",
    "presentation",
    "seed",
    "sizeDistribution",
    "zone",
  ],
  vegetationSizeDistribution: ["heightM", "radiusM"],
  presentation: ["detailSeed", "overviewCamera"],
  overviewCamera: ["positionM", "targetM"],
});

function record(value, path) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype)
    throw new DomainValidationError(
      "INVALID_TEST_SITE_RECORD",
      "Expected an object",
      {
        path,
      },
    );
  return value;
}

function exactKeys(value, contract, path) {
  const source = record(value, path),
    expected = EXACT_KEYS[contract],
    actual = Object.keys(source).sort(),
    missing = expected.filter((key) => !Object.hasOwn(source, key)),
    unknown = actual.filter((key) => !expected.includes(key));
  if (missing.length || unknown.length)
    throw new DomainValidationError(
      "INVALID_TEST_SITE_KEYS",
      `Invalid ${contract} keys`,
      { path, details: { missing, unknown } },
    );
  return source;
}

function text(value, path) {
  if (typeof value !== "string" || !value.trim())
    throw new DomainValidationError(
      "INVALID_TEST_SITE_TEXT",
      "Expected non-empty text",
      { path, details: { value } },
    );
  return value;
}

function booleanValue(value, path) {
  if (typeof value !== "boolean")
    throw new DomainValidationError(
      "INVALID_TEST_SITE_BOOLEAN",
      "Expected a boolean",
      { path, details: { value } },
    );
  return value;
}

function positiveInterval(value, path) {
  const interval = vector(value, 2, path, { positive: true });
  if (interval[1] < interval[0])
    throw new DomainValidationError(
      "INVALID_TEST_SITE_INTERVAL",
      "Interval maximum must not be smaller than its minimum",
      { path, details: { value } },
    );
  return interval;
}

function vector(value, length, path, { positive = false } = {}) {
  if (!Array.isArray(value) || value.length !== length)
    throw new DomainValidationError(
      "INVALID_TEST_SITE_VECTOR",
      `Expected a ${length}-element vector`,
      { path, details: { value } },
    );
  return value.map((entry, index) =>
    finiteNumber(entry, {
      path: [...path, index],
      min: positive ? Number.EPSILON : -Infinity,
    }),
  );
}

function list(value, path, normalize) {
  if (!Array.isArray(value))
    throw new DomainValidationError(
      "INVALID_TEST_SITE_LIST",
      "Expected a list",
      {
        path,
      },
    );
  return value.map((entry, index) => normalize(entry, [...path, index]));
}

function shape(value, path) {
  const source = record(value, path),
    kind = text(source.kind, [...path, "kind"]),
    centerM = vector(source.centerM, 2, [...path, "centerM"]),
    rotationRad = finiteNumber(source.rotationRad, {
      path: [...path, "rotationRad"],
      min: -Math.PI * 2,
      max: Math.PI * 2,
    });
  if (kind === "ellipse" || kind === "rectangle") {
    const item = exactKeys(source, `${kind}Shape`, path);
    return {
      kind,
      centerM,
      sizeM: vector(item.sizeM, 2, [...path, "sizeM"], { positive: true }),
      rotationRad,
    };
  }
  if (kind === "polygon") {
    const item = exactKeys(source, "polygonShape", path),
      ringsM = list(item.ringsM, [...path, "ringsM"], (ring, ringPath) => {
        const points = list(ring, ringPath, (point, pointPath) =>
          vector(point, 2, pointPath),
        );
        if (points.length < 3)
          throw new DomainValidationError(
            "INVALID_TEST_SITE_POLYGON",
            "Polygon rings require at least three vertices",
            { path: ringPath },
          );
        for (let index = 0; index < points.length; index++)
          if (
            Math.hypot(
              points[index][0] - points[(index + 1) % points.length][0],
              points[index][1] - points[(index + 1) % points.length][1],
            ) <= 1e-6
          )
            throw new DomainValidationError(
              "INVALID_TEST_SITE_POLYGON",
              "Polygon rings cannot contain zero-length edges",
              { path: [...ringPath, index] },
            );
        return points;
      });
    const ringsIssue = testSitePolygonRingsIssue(ringsM);
    if (ringsIssue)
      throw new DomainValidationError(
        "INVALID_TEST_SITE_POLYGON",
        `Invalid polygon rings: ${ringsIssue}`,
        { path: [...path, "ringsM"] },
      );
    return { kind, centerM, ringsM, rotationRad };
  }
  if (kind === "corridor-network") {
    const item = exactKeys(source, "corridorNetworkShape", path),
      pathsM = list(
        item.pathsM,
        [...path, "pathsM"],
        (pathPoints, pathPath) => {
          const points = list(pathPoints, pathPath, (point, pointPath) =>
            vector(point, 2, pointPath),
          );
          if (points.length < 2)
            throw new DomainValidationError(
              "INVALID_TEST_SITE_CORRIDOR",
              "Corridor paths require at least two vertices",
              { path: pathPath },
            );
          for (let index = 0; index < points.length - 1; index++)
            if (
              Math.hypot(
                points[index][0] - points[index + 1][0],
                points[index][1] - points[index + 1][1],
              ) <= 1e-6
            )
              throw new DomainValidationError(
                "INVALID_TEST_SITE_CORRIDOR",
                "Corridor paths cannot contain zero-length segments",
                { path: [...pathPath, index] },
              );
          return points;
        },
      ),
      cap = text(item.cap, [...path, "cap"]),
      join = text(item.join, [...path, "join"]);
    if (
      !pathsM.length ||
      !new Set(["round", "square"]).has(cap) ||
      !new Set(["miter", "round"]).has(join)
    )
      throw new DomainValidationError(
        "INVALID_TEST_SITE_CORRIDOR",
        "Corridors require paths and supported cap/join policies",
        { path },
      );
    return {
      kind,
      centerM,
      pathsM,
      widthM: finiteNumber(item.widthM, {
        path: [...path, "widthM"],
        min: 0.1,
        max: 100,
      }),
      cap,
      join,
      rotationRad,
    };
  }
  throw new DomainValidationError(
    "INVALID_TEST_SITE_SHAPE",
    "Test-site shapes must be rectangles, ellipses, polygons, or corridor networks",
    { path: [...path, "kind"], details: { kind } },
  );
}

function heightFeature(value, path, districtIds) {
  const source = record(value, path),
    kind = text(source.kind, [...path, "kind"]),
    contract =
      kind === "mound"
        ? "moundFeature"
        : kind === "grade-ramp"
          ? "gradeRampFeature"
          : kind === "corridor-profile"
            ? "corridorProfileFeature"
            : kind === "ripple-train"
              ? "rippleTrainFeature"
              : null;
  if (!contract)
    throw new DomainValidationError(
      "INVALID_TEST_SITE_HEIGHT_FEATURE_KIND",
      "Height features must be mounds, grade ramps, corridor profiles, or ripple trains",
      { path: [...path, "kind"], details: { kind } },
    );
  const item = exactKeys(source, contract, path),
    id = idAt(item.id, [...path, "id"]),
    districtId = idAt(item.districtId, [...path, "districtId"]);
  if (!districtIds.has(districtId))
    throw new DomainValidationError(
      "UNKNOWN_TEST_SITE_DISTRICT",
      `Unknown test-site district ${districtId}`,
      { path: [...path, "districtId"] },
    );
  if (kind === "mound") {
    const footprint = shape(item.footprint, [...path, "footprint"]),
      profile = text(item.profile, [...path, "profile"]);
    if (profile !== "elliptic-quartic" || footprint.kind !== "ellipse")
      throw new DomainValidationError(
        "INVALID_TEST_SITE_TERRAIN_PROFILE",
        "elliptic-quartic mounds require an ellipse footprint",
        { path },
      );
    const elevationM = finiteNumber(item.elevationM, {
      path: [...path, "elevationM"],
      min: -20,
      max: 20,
    });
    if (Math.abs(elevationM) < 1e-4)
      throw new DomainValidationError(
        "INVALID_TEST_SITE_TERRAIN_PROFILE",
        "Mound elevation must be non-zero",
        { path: [...path, "elevationM"] },
      );
    return { id, districtId, kind, elevationM, footprint, profile };
  }
  if (kind === "grade-ramp") {
    const riseM = finiteNumber(item.riseM, {
      path: [...path, "riseM"],
      min: -20,
      max: 20,
    });
    if (Math.abs(riseM) < 1e-4)
      throw new DomainValidationError(
        "INVALID_TEST_SITE_TERRAIN_PROFILE",
        "Grade-ramp rise must be non-zero",
        { path: [...path, "riseM"] },
      );
    return {
      id,
      districtId,
      kind,
      centerM: vector(item.centerM, 2, [...path, "centerM"]),
      headingRad: finiteNumber(item.headingRad, {
        path: [...path, "headingRad"],
        min: -Math.PI * 2,
        max: Math.PI * 2,
      }),
      runM: finiteNumber(item.runM, {
        path: [...path, "runM"],
        min: 1,
        max: 200,
      }),
      widthM: finiteNumber(item.widthM, {
        path: [...path, "widthM"],
        min: 1,
        max: 100,
      }),
      riseM,
      crestLengthM: finiteNumber(item.crestLengthM, {
        path: [...path, "crestLengthM"],
        min: 0.1,
        max: 100,
      }),
      transitionLengthM: finiteNumber(item.transitionLengthM, {
        path: [...path, "transitionLengthM"],
        min: 1,
        max: 200,
      }),
      edgeBlendM: finiteNumber(item.edgeBlendM, {
        path: [...path, "edgeBlendM"],
        min: 0.1,
        max: 50,
      }),
    };
  }
  if (kind === "corridor-profile") {
    const centerline = shape(item.centerline, [...path, "centerline"]);
    if (centerline.kind !== "corridor-network")
      throw new DomainValidationError(
        "INVALID_TEST_SITE_TERRAIN_PROFILE",
        "Corridor profiles require a corridor-network centerline",
        { path: [...path, "centerline"] },
      );
    const transverseProfileM = list(
      item.transverseProfileM,
      [...path, "transverseProfileM"],
      (point, pointPath) => vector(point, 2, pointPath),
    );
    if (
      transverseProfileM.length < 2 ||
      Math.abs(transverseProfileM[0][0]) > 1e-9 ||
      transverseProfileM.some(
        (point, index) =>
          point[0] < 0 ||
          (index > 0 && point[0] <= transverseProfileM[index - 1][0]),
      ) ||
      Math.abs(transverseProfileM.at(-1)[0] - centerline.widthM / 2) > 1e-6 ||
      Math.abs(transverseProfileM.at(-1)[1]) > 1e-6
    )
      throw new DomainValidationError(
        "INVALID_TEST_SITE_TERRAIN_PROFILE",
        "Transverse profiles must run monotonically from center 0 to a zero-height corridor edge",
        { path: [...path, "transverseProfileM"] },
      );
    return { id, districtId, kind, centerline, transverseProfileM };
  }
  const runM = finiteNumber(item.runM, {
      path: [...path, "runM"],
      min: 1,
      max: 300,
    }),
    wavelengthM = finiteNumber(item.wavelengthM, {
      path: [...path, "wavelengthM"],
      min: 0.1,
      max: runM,
    });
  return {
    id,
    districtId,
    kind,
    centerM: vector(item.centerM, 2, [...path, "centerM"]),
    headingRad: finiteNumber(item.headingRad, {
      path: [...path, "headingRad"],
      min: -Math.PI * 2,
      max: Math.PI * 2,
    }),
    runM,
    widthM: finiteNumber(item.widthM, {
      path: [...path, "widthM"],
      min: 1,
      max: 100,
    }),
    wavelengthM,
    amplitudeM: finiteNumber(item.amplitudeM, {
      path: [...path, "amplitudeM"],
      min: 0.01,
      max: 1,
    }),
    phaseRad: finiteNumber(item.phaseRad, {
      path: [...path, "phaseRad"],
      min: -Math.PI * 2,
      max: Math.PI * 2,
    }),
    edgeBlendM: finiteNumber(item.edgeBlendM, {
      path: [...path, "edgeBlendM"],
      min: 0.1,
      max: Math.min(runM / 2, wavelengthM),
    }),
  };
}

function uniqueIds(items, path) {
  const seen = new Set();
  for (let index = 0; index < items.length; index++) {
    const id = items[index].id;
    if (seen.has(id))
      throw new DomainValidationError(
        "DUPLICATE_TEST_SITE_ID",
        `Duplicate test-site id ${id}`,
        { path: [...path, index, "id"], details: { id } },
      );
    seen.add(id);
  }
  return items;
}

function collisionGeometry(value, path, { compound = true } = {}) {
  const source = record(value, path),
    kind = text(source.kind, [...path, "kind"]);
  if (kind === "none") {
    exactKeys(source, "collisionNone", path);
    return { kind };
  }
  if (kind === "box") {
    const item = exactKeys(source, "collisionBox", path);
    return {
      kind,
      sizeM: vector(item.sizeM, 3, [...path, "sizeM"], { positive: true }),
    };
  }
  if (kind === "cylinder") {
    const item = exactKeys(source, "collisionCylinder", path),
      axis = text(item.axis, [...path, "axis"]),
      segments = finiteNumber(item.segments, {
        path: [...path, "segments"],
        min: 6,
        max: 32,
      });
    if (!new Set(["x", "y", "z"]).has(axis) || !Number.isInteger(segments))
      throw new DomainValidationError(
        "INVALID_TEST_SITE_COLLISION_GEOMETRY",
        "Cylinder axis and segment count must be explicit and supported",
        { path },
      );
    return {
      kind,
      axis,
      radiusM: finiteNumber(item.radiusM, {
        path: [...path, "radiusM"],
        min: 0.01,
        max: 100,
      }),
      heightM: finiteNumber(item.heightM, {
        path: [...path, "heightM"],
        min: 0.01,
        max: 200,
      }),
      segments,
    };
  }
  if (kind === "compound" && compound) {
    const item = exactKeys(source, "collisionCompound", path),
      children = list(
        item.children,
        [...path, "children"],
        (entry, childPath) => {
          const child = exactKeys(entry, "collisionChild", childPath);
          return {
            geometry: collisionGeometry(
              child.geometry,
              [...childPath, "geometry"],
              {
                compound: false,
              },
            ),
            offsetM: vector(child.offsetM, 3, [...childPath, "offsetM"]),
            rotationEulerRad: vector(child.rotationEulerRad, 3, [
              ...childPath,
              "rotationEulerRad",
            ]),
          };
        },
      );
    if (!children.length)
      throw new DomainValidationError(
        "INVALID_TEST_SITE_COLLISION_GEOMETRY",
        "Compound collision geometry requires at least one child",
        { path: [...path, "children"] },
      );
    return { kind, children };
  }
  throw new DomainValidationError(
    "INVALID_TEST_SITE_COLLISION_GEOMETRY",
    `Unsupported fixture collision geometry ${kind}`,
    { path: [...path, "kind"] },
  );
}

const idAt = (value, path) => String(canonicalId(value, { path }));

function fixtureOverlapsShape(fixture, target) {
  return (
    testSiteFixtureFootprintPoints(fixture).some(({ x, z }) =>
      testSiteShapeContains(target, x, z),
    ) ||
    testSiteFixtureContainsPoint(fixture, target.centerM[0], target.centerM[1])
  );
}

/** Strictly validates and freezes the bundled testing-ground definition. */
export function createTestSiteDefinition(value) {
  const source = exactKeys(value, "root", []);
  if (source.schemaVersion !== TEST_SITE_SCHEMA_VERSION)
    throw new DomainValidationError(
      "UNSUPPORTED_TEST_SITE_VERSION",
      `Expected ${TEST_SITE_SCHEMA_VERSION}`,
      { path: ["schemaVersion"], details: { value: source.schemaVersion } },
    );
  const coordinateFrame = exactKeys(source.coordinateFrame, "coordinateFrame", [
      "coordinateFrame",
    ]),
    footprint = exactKeys(source.footprint, "footprint", ["footprint"]),
    baseTerrain = exactKeys(source.baseTerrain, "baseTerrain", ["baseTerrain"]),
    footprintDefinition = {
      centerM: vector(footprint.centerM, 2, ["footprint", "centerM"]),
      sizeM: vector(footprint.sizeM, 2, ["footprint", "sizeM"], {
        positive: true,
      }),
    },
    districts = uniqueIds(
      list(source.districts, ["districts"], (entry, path) => {
        const item = exactKeys(entry, "district", path);
        return {
          id: idAt(item.id, [...path, "id"]),
          label: text(item.label, [...path, "label"]),
        };
      }),
      ["districts"],
    ),
    districtIds = new Set(districts.map(({ id }) => id)),
    withDistrict = (entry, contract, path) => {
      const item = exactKeys(entry, contract, path),
        districtId = idAt(item.districtId, [...path, "districtId"]);
      if (!districtIds.has(districtId))
        throw new DomainValidationError(
          "UNKNOWN_TEST_SITE_DISTRICT",
          `Unknown test-site district ${districtId}`,
          { path: [...path, "districtId"] },
        );
      return { item, districtId };
    },
    surfaceRegions = uniqueIds(
      list(source.surfaceRegions, ["surfaceRegions"], (entry, path) => {
        const { item, districtId } = withDistrict(entry, "surfaceRegion", path);
        return {
          id: idAt(item.id, [...path, "id"]),
          districtId,
          materialKey: text(item.materialKey, [...path, "materialKey"]),
          shape: shape(item.shape, [...path, "shape"]),
        };
      }),
      ["surfaceRegions"],
    ),
    heightFeatures = uniqueIds(
      list(source.heightFeatures, ["heightFeatures"], (entry, path) =>
        heightFeature(entry, path, districtIds),
      ),
      ["heightFeatures"],
    ),
    fluidRegions = uniqueIds(
      list(source.fluidRegions, ["fluidRegions"], (entry, path) => {
        const { item, districtId } = withDistrict(entry, "fluidRegion", path),
          depthProfile = exactKeys(item.depthProfile, "fluidDepthProfile", [
            ...path,
            "depthProfile",
          ]),
          kind = text(depthProfile.kind, [...path, "depthProfile", "kind"]),
          shoreDepthM = finiteNumber(depthProfile.shoreDepthM, {
            path: [...path, "depthProfile", "shoreDepthM"],
            min: 0.01,
            max: 20,
          }),
          maximumDepthM = finiteNumber(depthProfile.maximumDepthM, {
            path: [...path, "depthProfile", "maximumDepthM"],
            min: shoreDepthM,
            max: 20,
          }),
          shoreShelfM = finiteNumber(depthProfile.shoreShelfM, {
            path: [...path, "depthProfile", "shoreShelfM"],
            min: 0,
            max: 100,
          }),
          fullDepthDistanceM = finiteNumber(depthProfile.fullDepthDistanceM, {
            path: [...path, "depthProfile", "fullDepthDistanceM"],
            min: Math.max(shoreShelfM + 0.01, 0.01),
            max: 200,
          });
        if (kind !== "shore-distance")
          throw new DomainValidationError(
            "INVALID_TEST_SITE_FLUID_PROFILE",
            `Unsupported fluid depth profile ${kind}`,
            { path: [...path, "depthProfile", "kind"] },
          );
        return {
          id: idAt(item.id, [...path, "id"]),
          districtId,
          shape: shape(item.shape, [...path, "shape"]),
          depthProfile: {
            kind,
            shoreDepthM,
            shoreShelfM,
            fullDepthDistanceM,
            maximumDepthM,
          },
          waterHeightM: finiteNumber(item.waterHeightM, {
            path: [...path, "waterHeightM"],
          }),
          densityKgPerM3: finiteNumber(item.densityKgPerM3, {
            path: [...path, "densityKgPerM3"],
            min: 1,
            max: 3000,
          }),
          materialKey: text(item.materialKey, [...path, "materialKey"]),
        };
      }),
      ["fluidRegions"],
    ),
    clearVolumes = uniqueIds(
      list(source.clearVolumes, ["clearVolumes"], (entry, path) => {
        const { item, districtId } = withDistrict(entry, "clearVolume", path),
          purpose = text(item.purpose, [...path, "purpose"]);
        if (!new Set(["approach", "helipad", "route", "runway"]).has(purpose))
          throw new DomainValidationError(
            "INVALID_TEST_SITE_CLEAR_PURPOSE",
            `Unsupported clear-volume purpose ${purpose}`,
            { path: [...path, "purpose"] },
          );
        return {
          id: idAt(item.id, [...path, "id"]),
          districtId,
          label: text(item.label, [...path, "label"]),
          purpose,
          shape: shape(item.shape, [...path, "shape"]),
        };
      }),
      ["clearVolumes"],
    );

  const fluidIds = new Set(fluidRegions.map(({ id }) => id)),
    stagingPads = uniqueIds(
      list(source.stagingPads, ["stagingPads"], (entry, path) => {
        const { item, districtId } = withDistrict(entry, "stagingPad", path),
          pose = exactKeys(item.pose, "pose", [...path, "pose"]);
        return {
          id: idAt(item.id, [...path, "id"]),
          districtId,
          pose: {
            positionM: vector(pose.positionM, 3, [
              ...path,
              "pose",
              "positionM",
            ]),
            headingRad: finiteNumber(pose.headingRad, {
              path: [...path, "pose", "headingRad"],
            }),
          },
          clearanceM: vector(item.clearanceM, 3, [...path, "clearanceM"], {
            positive: true,
          }),
        };
      }),
      ["stagingPads"],
    ),
    zones = uniqueIds(
      list(source.zones, ["zones"], (entry, path) => {
        const { item, districtId } = withDistrict(entry, "zone", path);
        return {
          id: idAt(item.id, [...path, "id"]),
          districtId,
          label: text(item.label, [...path, "label"]),
          shape: shape(item.shape, [...path, "shape"]),
        };
      }),
      ["zones"],
    ),
    zoneIds = new Set(zones.map(({ id }) => id)),
    stagingPadIds = new Set(stagingPads.map(({ id }) => id)),
    routes = uniqueIds(
      list(source.routes, ["routes"], (entry, path) => {
        const item = exactKeys(entry, "route", path),
          finish = exactKeys(item.finish, "routeFinish", [...path, "finish"]),
          gateIds = list(item.gateIds, [...path, "gateIds"], (id, idPath) =>
            idAt(id, idPath),
          ),
          requirements = list(
            item.requirements,
            [...path, "requirements"],
            (requirement, requirementPath) => {
              const kind = text(requirement?.kind, [
                ...requirementPath,
                "kind",
              ]);
              if (kind === "gate-state") {
                const value = exactKeys(
                    requirement,
                    "routeGateStateRequirement",
                    requirementPath,
                  ),
                  gateId = idAt(value.gateId, [...requirementPath, "gateId"]);
                if (!zoneIds.has(gateId))
                  throw new DomainValidationError(
                    "UNKNOWN_TEST_SITE_GATE",
                    `Unknown requirement gate ${gateId}`,
                    { path: [...requirementPath, "gateId"] },
                  );
                if (
                  value.grounded !== null &&
                  typeof value.grounded !== "boolean"
                )
                  throw new DomainValidationError(
                    "INVALID_TEST_SITE_ROUTE_REQUIREMENT",
                    "Gate grounded requirement must be boolean or null",
                    { path: [...requirementPath, "grounded"] },
                  );
                const minSpeedMps = finiteNumber(value.minSpeedMps, {
                    path: [...requirementPath, "minSpeedMps"],
                    min: 0,
                    max: 200,
                  }),
                  maxSpeedMps = finiteNumber(value.maxSpeedMps, {
                    path: [...requirementPath, "maxSpeedMps"],
                    min: minSpeedMps,
                    max: 200,
                  });
                return {
                  kind,
                  gateId,
                  grounded: value.grounded,
                  minSpeedMps,
                  maxSpeedMps,
                };
              }
              if (kind === "visit-materials") {
                const value = exactKeys(
                  requirement,
                  "routeMaterialRequirement",
                  requirementPath,
                );
                return {
                  kind,
                  materialKeys: [
                    ...new Set(
                      list(
                        value.materialKeys,
                        [...requirementPath, "materialKeys"],
                        (key, keyPath) => text(key, keyPath),
                      ),
                    ),
                  ].sort(),
                };
              }
              if (kind === "visit-fluid") {
                const value = exactKeys(
                  requirement,
                  "routeFluidRequirement",
                  requirementPath,
                );
                const fluidId = idAt(value.fluidId, [
                  ...requirementPath,
                  "fluidId",
                ]);
                if (!fluidIds.has(fluidId))
                  throw new DomainValidationError(
                    "UNKNOWN_TEST_SITE_FLUID",
                    `Unknown route fluid ${fluidId}`,
                    { path: [...requirementPath, "fluidId"] },
                  );
                return {
                  kind,
                  fluidId,
                };
              }
              if (kind === "remain-intact") {
                const value = exactKeys(
                  requirement,
                  "routeIntactRequirement",
                  requirementPath,
                );
                const maxDamage = finiteNumber(value.maxDamage, {
                  path: [...requirementPath, "maxDamage"],
                  min: 0,
                  max: 1_000,
                });
                if (!Number.isInteger(maxDamage))
                  throw new DomainValidationError(
                    "INVALID_TEST_SITE_ROUTE_REQUIREMENT",
                    "Maximum damage must be an integer",
                    { path: [...requirementPath, "maxDamage"] },
                  );
                return {
                  kind,
                  maxDamage,
                };
              }
              throw new DomainValidationError(
                "INVALID_TEST_SITE_ROUTE_REQUIREMENT",
                `Unsupported route requirement ${kind}`,
                { path: [...requirementPath, "kind"] },
              );
            },
          );
        const stagingPadId = idAt(item.stagingPadId, [...path, "stagingPadId"]);
        if (!stagingPadIds.has(stagingPadId))
          throw new DomainValidationError(
            "UNKNOWN_TEST_SITE_STAGING_PAD",
            `Unknown route staging pad ${stagingPadId}`,
            { path: [...path, "stagingPadId"] },
          );
        if (typeof finish.grounded !== "boolean")
          throw new DomainValidationError(
            "INVALID_TEST_SITE_ROUTE_FINISH",
            "Route finish grounded condition must be boolean",
            { path: [...path, "finish", "grounded"] },
          );
        for (const gateId of gateIds)
          if (!zoneIds.has(gateId))
            throw new DomainValidationError(
              "UNKNOWN_TEST_SITE_GATE",
              `Unknown route gate ${gateId}`,
              {
                path: [...path, "gateIds"],
              },
            );
        return {
          id: idAt(item.id, [...path, "id"]),
          label: text(item.label, [...path, "label"]),
          gateIds,
          requirements,
          stagingPadId,
          finish: {
            grounded: finish.grounded,
            maxSpeedMps: finiteNumber(finish.maxSpeedMps, {
              path: [...path, "finish", "maxSpeedMps"],
              min: 0,
              max: 200,
            }),
            holdS: finiteNumber(finish.holdS, {
              path: [...path, "finish", "holdS"],
              min: 0,
              max: 60,
            }),
          },
        };
      }),
      ["routes"],
    ),
    vegetationRules = uniqueIds(
      list(source.vegetationRules, ["vegetationRules"], (entry, path) => {
        const { item, districtId } = withDistrict(
            entry,
            "vegetationRule",
            path,
          ),
          kind = text(item.kind, [...path, "kind"]),
          sizeDistribution = exactKeys(
            item.sizeDistribution,
            "vegetationSizeDistribution",
            [...path, "sizeDistribution"],
          ),
          fixturePresentation = exactKeys(
            item.presentation,
            "fixturePresentation",
            [...path, "presentation"],
          ),
          seed = finiteNumber(item.seed, {
            path: [...path, "seed"],
            min: 0,
            max: 0xffffffff,
          }),
          variant = finiteNumber(fixturePresentation.variant, {
            path: [...path, "presentation", "variant"],
            min: 0,
            max: 255,
          });
        if (!new Set(["tree-stand", "shrub-field", "grass-field"]).has(kind))
          throw new DomainValidationError(
            "INVALID_TEST_SITE_VEGETATION_KIND",
            `Unsupported vegetation rule kind ${kind}`,
            { path: [...path, "kind"] },
          );
        if (!Number.isInteger(seed))
          throw new DomainValidationError(
            "INVALID_TEST_SITE_VEGETATION_SEED",
            "Vegetation seed must be an integer",
            { path: [...path, "seed"] },
          );
        if (!Number.isInteger(variant))
          throw new DomainValidationError(
            "INVALID_TEST_SITE_FIXTURE_PRESENTATION",
            "Vegetation presentation variant must be an integer",
            { path: [...path, "presentation", "variant"] },
          );
        return {
          id: idAt(item.id, [...path, "id"]),
          districtId,
          kind,
          zone: shape(item.zone, [...path, "zone"]),
          exclusionShapes: list(
            item.exclusionShapes,
            [...path, "exclusionShapes"],
            (entryShape, shapePath) => shape(entryShape, shapePath),
          ),
          excludeSurfaceRegions: booleanValue(item.excludeSurfaceRegions, [
            ...path,
            "excludeSurfaceRegions",
          ]),
          excludeFluidRegions: booleanValue(item.excludeFluidRegions, [
            ...path,
            "excludeFluidRegions",
          ]),
          excludeClearVolumes: booleanValue(item.excludeClearVolumes, [
            ...path,
            "excludeClearVolumes",
          ]),
          excludeStagingPads: booleanValue(item.excludeStagingPads, [
            ...path,
            "excludeStagingPads",
          ]),
          exclusionMarginM: finiteNumber(item.exclusionMarginM, {
            path: [...path, "exclusionMarginM"],
            min: 0,
            max: 100,
          }),
          densityPerHectare: finiteNumber(item.densityPerHectare, {
            path: [...path, "densityPerHectare"],
            min: Number.EPSILON,
            max: 1_000_000,
          }),
          minimumSpacingM: finiteNumber(item.minimumSpacingM, {
            path: [...path, "minimumSpacingM"],
            min: 0,
            max: 100,
          }),
          sizeDistribution: {
            radiusM: positiveInterval(sizeDistribution.radiusM, [
              ...path,
              "sizeDistribution",
              "radiusM",
            ]),
            heightM: positiveInterval(sizeDistribution.heightM, [
              ...path,
              "sizeDistribution",
              "heightM",
            ]),
          },
          seed,
          colliderMinimumRadiusM: finiteNumber(item.colliderMinimumRadiusM, {
            path: [...path, "colliderMinimumRadiusM"],
            min: 0.05,
            max: 10,
          }),
          materialKey: text(item.materialKey, [...path, "materialKey"]),
          presentation: {
            key: text(fixturePresentation.key, [
              ...path,
              "presentation",
              "key",
            ]),
            variant,
          },
        };
      }),
      ["vegetationRules"],
    ),
    presentation = exactKeys(source.presentation, "presentation", [
      "presentation",
    ]),
    overviewCamera = exactKeys(presentation.overviewCamera, "overviewCamera", [
      "presentation",
      "overviewCamera",
    ]);

  if (
    coordinateFrame.units !== "m" ||
    coordinateFrame.axes !== "x-east-y-up-z-north"
  )
    throw new DomainValidationError(
      "INVALID_TEST_SITE_COORDINATE_FRAME",
      "Test-site coordinates must use SI meters in the x-east-y-up-z-north frame",
      { path: ["coordinateFrame"] },
    );

  const staticFixtures = uniqueIds(
    list(source.staticFixtures, ["staticFixtures"], (entry, path) => {
      const { item, districtId } = withDistrict(entry, "staticFixture", path),
        pose = exactKeys(item.pose, "pose", [...path, "pose"]),
        presentation = exactKeys(item.presentation, "fixturePresentation", [
          ...path,
          "presentation",
        ]),
        variant = finiteNumber(presentation.variant, {
          path: [...path, "presentation", "variant"],
          min: 0,
          max: 255,
        });
      if (!Number.isInteger(variant))
        throw new DomainValidationError(
          "INVALID_TEST_SITE_FIXTURE_PRESENTATION",
          "Fixture presentation variant must be an integer",
          { path: [...path, "presentation", "variant"] },
        );
      return {
        id: idAt(item.id, [...path, "id"]),
        districtId,
        materialKey: text(item.materialKey, [...path, "materialKey"]),
        pose: {
          positionM: vector(pose.positionM, 3, [...path, "pose", "positionM"]),
          headingRad: finiteNumber(pose.headingRad, {
            path: [...path, "pose", "headingRad"],
          }),
        },
        collisionGeometry: collisionGeometry(item.collisionGeometry, [
          ...path,
          "collisionGeometry",
        ]),
        presentation: {
          key: text(presentation.key, [...path, "presentation", "key"]),
          variant,
        },
      };
    }),
    ["staticFixtures"],
  );

  const protectedAreas = [
    ...clearVolumes.map(({ id, shape: protectedShape }) => ({
      id,
      shape: protectedShape,
    })),
    ...stagingPads.map((pad) => ({
      id: `staging-pad:${pad.id}`,
      shape: {
        kind: "rectangle",
        centerM: [pad.pose.positionM[0], pad.pose.positionM[2]],
        sizeM: [pad.clearanceM[0], pad.clearanceM[2]],
        rotationRad: pad.pose.headingRad,
      },
    })),
  ];
  const [footprintCenterX, footprintCenterZ] = footprintDefinition.centerM,
    [footprintWidth, footprintDepth] = footprintDefinition.sizeM,
    overlapStepM = 2.5;
  for (
    let x = footprintCenterX - footprintWidth / 2 + overlapStepM / 2;
    x < footprintCenterX + footprintWidth / 2;
    x += overlapStepM
  )
    for (
      let z = footprintCenterZ - footprintDepth / 2 + overlapStepM / 2;
      z < footprintCenterZ + footprintDepth / 2;
      z += overlapStepM
    ) {
      const owners = surfaceRegions.filter(({ shape: regionShape }) =>
          testSiteShapeContains(regionShape, x, z),
        ),
        materialKeys = new Set(owners.map(({ materialKey }) => materialKey));
      if (materialKeys.size > 1)
        throw new DomainValidationError(
          "TEST_SITE_SURFACE_CONFLICT",
          `Conflicting surface regions overlap near ${x}, ${z}`,
          {
            path: ["surfaceRegions"],
            details: {
              x,
              z,
              regionIds: owners.map(({ id }) => id),
              materialKeys: [...materialKeys],
            },
          },
        );
    }

  const footprintBounds = {
    minX: footprintCenterX - footprintWidth / 2,
    maxX: footprintCenterX + footprintWidth / 2,
    minZ: footprintCenterZ - footprintDepth / 2,
    maxZ: footprintCenterZ + footprintDepth / 2,
  };
  for (const [collectionName, items] of [
    ["surfaceRegions", surfaceRegions],
    ["heightFeatures", heightFeatures],
    ["fluidRegions", fluidRegions],
    ["clearVolumes", clearVolumes],
    ["zones", zones],
    ["vegetationRules", vegetationRules],
  ])
    for (const item of items) {
      const itemShape =
          collectionName === "heightFeatures"
            ? testSiteHeightFeatureShape(item)
            : collectionName === "vegetationRules"
              ? item.zone
              : item.shape,
        bounds = testSiteShapeBounds(itemShape);
      if (
        bounds.minX < footprintBounds.minX - 1e-9 ||
        bounds.maxX > footprintBounds.maxX + 1e-9 ||
        bounds.minZ < footprintBounds.minZ - 1e-9 ||
        bounds.maxZ > footprintBounds.maxZ + 1e-9
      )
        throw new DomainValidationError(
          "TEST_SITE_SHAPE_OUTSIDE_FOOTPRINT",
          `Test-site shape ${item.id} extends outside the footprint`,
          {
            path: [
              collectionName,
              item.id,
              collectionName === "heightFeatures"
                ? "footprint"
                : collectionName === "vegetationRules"
                  ? "zone"
                  : "shape",
            ],
            details: bounds,
          },
        );
    }
  for (const fixture of staticFixtures) {
    if (fixture.collisionGeometry.kind === "none") continue;
    const occupied = protectedAreas.find(({ shape: protectedShape }) =>
      fixtureOverlapsShape(fixture, protectedShape),
    );
    if (occupied)
      throw new DomainValidationError(
        "TEST_SITE_CLEARANCE_OCCUPIED",
        `Fixture ${fixture.id} occupies protected area ${occupied.id}`,
        {
          path: ["staticFixtures", fixture.id],
          details: { fixtureId: fixture.id, protectedAreaId: occupied.id },
        },
      );
  }

  const definition = {
    schemaVersion: TEST_SITE_SCHEMA_VERSION,
    id: idAt(source.id, ["id"]),
    coordinateFrame: {
      units: "m",
      axes: "x-east-y-up-z-north",
      origin: text(coordinateFrame.origin, ["coordinateFrame", "origin"]),
    },
    footprint: footprintDefinition,
    baseTerrain: {
      heightM: finiteNumber(baseTerrain.heightM, {
        path: ["baseTerrain", "heightM"],
      }),
      materialKey: text(baseTerrain.materialKey, [
        "baseTerrain",
        "materialKey",
      ]),
    },
    districts,
    surfaceRegions,
    heightFeatures,
    fluidRegions,
    clearVolumes,
    staticFixtures,
    stagingPads,
    zones,
    routes,
    vegetationRules,
    presentation: {
      detailSeed: finiteNumber(presentation.detailSeed, {
        path: ["presentation", "detailSeed"],
        min: 0,
        max: 0xffffffff,
      }),
      overviewCamera: {
        positionM: vector(overviewCamera.positionM, 3, [
          "presentation",
          "overviewCamera",
          "positionM",
        ]),
        targetM: vector(overviewCamera.targetM, 3, [
          "presentation",
          "overviewCamera",
          "targetM",
        ]),
      },
    },
  };
  for (const instance of compileTestSiteVegetation(definition)) {
    if (!instance.collidable) continue;
    const occupied = protectedAreas.find(({ shape: protectedShape }) =>
      testSiteShapeContains(
        protectedShape,
        instance.pose.positionM[0],
        instance.pose.positionM[2],
        instance.radiusM,
      ),
    );
    if (occupied)
      throw new DomainValidationError(
        "TEST_SITE_CLEARANCE_OCCUPIED",
        `Vegetation ${instance.id} occupies protected area ${occupied.id}`,
        {
          path: ["vegetationRules", instance.ruleId],
          details: {
            vegetationId: instance.id,
            protectedAreaId: occupied.id,
          },
        },
      );
  }
  return deepFreeze(definition);
}
