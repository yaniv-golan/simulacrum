import {
  canonicalId,
  deepFreeze,
  DomainValidationError,
  finiteNumber,
} from "./primitives.js";
import { testSiteShapeWeight } from "./test-site-shapes.js";

export const TEST_SITE_SCHEMA_VERSION = "test-site-definition-v1";

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
  shape: ["centerM", "kind", "rotationRad", "sizeM"],
  surfaceRegion: ["districtId", "id", "materialKey", "shape"],
  heightFeature: ["amplitudeM", "districtId", "id", "shape"],
  fluidRegion: [
    "bedDepthM",
    "densityKgPerM3",
    "districtId",
    "id",
    "materialKey",
    "shape",
    "waterHeightM",
  ],
  clearVolume: ["districtId", "id", "label", "purpose", "shape"],
  staticFixture: [
    "collision",
    "districtId",
    "headingRad",
    "id",
    "kind",
    "materialKey",
    "positionM",
    "sizeM",
  ],
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
  vegetationRule: ["colliderMinimumRadiusM", "districtId", "id", "seed"],
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
  const source = exactKeys(value, "shape", path),
    kind = text(source.kind, [...path, "kind"]);
  if (!new Set(["ellipse", "rectangle"]).has(kind))
    throw new DomainValidationError(
      "INVALID_TEST_SITE_SHAPE",
      "Test-site shapes must be rectangles or ellipses",
      { path: [...path, "kind"], details: { kind } },
    );
  return {
    kind,
    centerM: vector(source.centerM, 2, [...path, "centerM"]),
    sizeM: vector(source.sizeM, 2, [...path, "sizeM"], { positive: true }),
    rotationRad: finiteNumber(source.rotationRad, {
      path: [...path, "rotationRad"],
      min: -Math.PI * 2,
      max: Math.PI * 2,
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

const idAt = (value, path) => String(canonicalId(value, { path }));

function fixtureOverlapsShape(fixture, target) {
  const dx = fixture.positionM[0] - target.centerM[0],
    dz = fixture.positionM[2] - target.centerM[1],
    cosine = Math.cos(-target.rotationRad),
    sine = Math.sin(-target.rotationRad),
    localX = dx * cosine - dz * sine,
    localZ = dx * sine + dz * cosine,
    fixtureRadius = Math.hypot(fixture.sizeM[0], fixture.sizeM[2]) / 2,
    radiusX = target.sizeM[0] / 2 + fixtureRadius,
    radiusZ = target.sizeM[1] / 2 + fixtureRadius;
  return target.kind === "rectangle"
    ? Math.abs(localX) <= radiusX && Math.abs(localZ) <= radiusZ
    : (localX / radiusX) ** 2 + (localZ / radiusZ) ** 2 <= 1;
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
      list(source.heightFeatures, ["heightFeatures"], (entry, path) => {
        const { item, districtId } = withDistrict(entry, "heightFeature", path);
        return {
          id: idAt(item.id, [...path, "id"]),
          districtId,
          amplitudeM: finiteNumber(item.amplitudeM, {
            path: [...path, "amplitudeM"],
            min: -20,
            max: 20,
          }),
          shape: shape(item.shape, [...path, "shape"]),
        };
      }),
      ["heightFeatures"],
    ),
    fluidRegions = uniqueIds(
      list(source.fluidRegions, ["fluidRegions"], (entry, path) => {
        const { item, districtId } = withDistrict(entry, "fluidRegion", path);
        return {
          id: idAt(item.id, [...path, "id"]),
          districtId,
          shape: shape(item.shape, [...path, "shape"]),
          bedDepthM: finiteNumber(item.bedDepthM, {
            path: [...path, "bedDepthM"],
            min: 0.01,
            max: 20,
          }),
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
        );
        return {
          id: idAt(item.id, [...path, "id"]),
          districtId,
          seed: finiteNumber(item.seed, {
            path: [...path, "seed"],
            min: 0,
            max: 0xffffffff,
          }),
          colliderMinimumRadiusM: finiteNumber(item.colliderMinimumRadiusM, {
            path: [...path, "colliderMinimumRadiusM"],
            min: 0.05,
            max: 10,
          }),
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
        kind = text(item.kind, [...path, "kind"]);
      if (!new Set(["curb", "log", "rock", "sign", "tree-trunk"]).has(kind))
        throw new DomainValidationError(
          "INVALID_TEST_SITE_FIXTURE",
          `Unsupported static fixture kind ${kind}`,
          { path: [...path, "kind"] },
        );
      if (typeof item.collision !== "boolean")
        throw new DomainValidationError(
          "INVALID_TEST_SITE_FIXTURE_COLLISION",
          "Fixture collision must be boolean",
          { path: [...path, "collision"] },
        );
      return {
        id: idAt(item.id, [...path, "id"]),
        districtId,
        kind,
        positionM: vector(item.positionM, 3, [...path, "positionM"]),
        sizeM: vector(item.sizeM, 3, [...path, "sizeM"], {
          positive: true,
        }),
        headingRad: finiteNumber(item.headingRad, {
          path: [...path, "headingRad"],
        }),
        materialKey: text(item.materialKey, [...path, "materialKey"]),
        collision: item.collision,
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
          testSiteShapeWeight(regionShape, x, z),
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
  for (const fixture of staticFixtures) {
    if (!fixture.collision) continue;
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

  return deepFreeze({
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
  });
}
