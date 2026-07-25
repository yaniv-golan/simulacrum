import { assert } from "./lib/assert.mjs";
import { WORKSHOP_TEST_SITE } from "../src/application/testing-playground-content.js";
import { FIELD_SURFACE_Y } from "../src/simulation/environment/earth.js";
import {
  createTestSiteDefinition,
  TEST_SITE_SCHEMA_VERSION,
} from "../src/model/test-site.js";
import {
  testSiteShapeBounds,
  testSiteShapeContains,
  testSiteShapeSignedDistance,
} from "../src/model/test-site-shapes.js";
import { DomainValidationError } from "../src/model/primitives.js";
import { createSurfaceField } from "../src/simulation/environment/surface-field.js";
import {
  createTestSiteCollisionBody,
  installTestSiteContactMaterials,
} from "../src/simulation/environment/test-site-collision.js";
import {
  contactMaterialPair,
  supportMaterialResponse,
} from "../src/model/contact-material-pairs.js";
import { testSiteSupportContact } from "../src/simulation/systems/test-site-telemetry-system.js";
import * as CANNON from "cannon-es";
import { fingerprintTestSiteDefinition } from "../src/application/mechanism-run-identity.js";
import {
  captureTestingPlaygroundDeployment,
  deploymentForBlueprint,
} from "../src/application/testing-playground-deployment.js";
import { createTestSiteFixtureBodies } from "../src/application/test-site-fixture-feature.js";
import {
  compileTestSiteVegetation,
  testSiteVegetationFixtures,
} from "../src/model/test-site-vegetation.js";

const mutableSite = () => structuredClone(WORKSHOP_TEST_SITE),
  close = (actual, expected, tolerance = 1e-10) =>
    assert.ok(
      Math.abs(actual - expected) < tolerance,
      `${actual} did not equal ${expected}`,
    ),
  expectDomainError = (mutate, code) => {
    const value = mutableSite();
    mutate(value);
    assert.throws(
      () => createTestSiteDefinition(value),
      (error) => {
        assert.ok(error instanceof DomainValidationError);
        assert.equal(error.code, code);
        return true;
      },
    );
  };

assert.equal(WORKSHOP_TEST_SITE.schemaVersion, TEST_SITE_SCHEMA_VERSION);
assert.deepEqual(WORKSHOP_TEST_SITE.footprint.sizeM, [480, 360]);
assert.equal(WORKSHOP_TEST_SITE.districts.length, 9);
assert.equal(WORKSHOP_TEST_SITE.staticFixtures.length, 83);
assert.equal(WORKSHOP_TEST_SITE.vegetationRules.length, 3);
assert.equal(WORKSHOP_TEST_SITE.clearVolumes.length, 4);
assert.ok(Object.isFrozen(WORKSHOP_TEST_SITE));
assert.ok(Object.isFrozen(WORKSHOP_TEST_SITE.surfaceRegions));
assert.ok(Object.isFrozen(WORKSHOP_TEST_SITE.surfaceRegions[0].shape));
assert.match(
  fingerprintTestSiteDefinition(WORKSHOP_TEST_SITE),
  /^sim-sha256-[0-9a-f]{64}$/,
);
const deployment = captureTestingPlaygroundDeployment({
  siteId: WORKSHOP_TEST_SITE.id,
  padId: "surface-lanes",
  parts: [{ id: 1, pos: [43, 0.2, -64], orientation: [0, 0, 0, 1] }],
});
assert.equal(
  deploymentForBlueprint(deployment, {
    parts: [{ id: 1, pos: [43, 0.2, -64], orientation: [0, 0, 0, 1] }],
  }),
  deployment,
);
assert.equal(
  deploymentForBlueprint(deployment, {
    parts: [{ id: 1, pos: [44, 0.2, -64], orientation: [0, 0, 0, 1] }],
  }),
  null,
);

expectDomainError((site) => {
  site.futureField = true;
}, "INVALID_TEST_SITE_KEYS");
expectDomainError((site) => {
  site.schemaVersion = "future-site";
}, "UNSUPPORTED_TEST_SITE_VERSION");
expectDomainError((site) => {
  site.schemaVersion = "test-site-definition-v1";
}, "UNSUPPORTED_TEST_SITE_VERSION");
expectDomainError((site) => {
  site.coordinateFrame = null;
}, "INVALID_TEST_SITE_RECORD");
expectDomainError((site) => {
  site.coordinateFrame.units = "cm";
}, "INVALID_TEST_SITE_COORDINATE_FRAME");
expectDomainError((site) => {
  site.coordinateFrame.axes = "z-up";
}, "INVALID_TEST_SITE_COORDINATE_FRAME");
expectDomainError((site) => {
  site.districts = {};
}, "INVALID_TEST_SITE_LIST");
expectDomainError((site) => {
  site.districts[0].label = " ";
}, "INVALID_TEST_SITE_TEXT");
expectDomainError((site) => {
  site.footprint.centerM = [0];
}, "INVALID_TEST_SITE_VECTOR");
expectDomainError((site) => {
  site.footprint.sizeM[0] = 0;
}, "INVALID_FINITE_NUMBER");
expectDomainError((site) => {
  site.surfaceRegions[0].shape.kind = "triangle";
}, "INVALID_TEST_SITE_SHAPE");
expectDomainError((site) => {
  site.surfaceRegions[0].shape.rotationRad = Math.PI * 3;
}, "INVALID_FINITE_NUMBER");
expectDomainError((site) => {
  site.surfaceRegions[1].shape.sizeM = "large";
}, "INVALID_TEST_SITE_VECTOR");
expectDomainError((site) => {
  site.surfaceRegions[1].id = site.surfaceRegions[0].id;
}, "DUPLICATE_TEST_SITE_ID");
expectDomainError((site) => {
  site.heightFeatures[0].districtId = "missing-district";
}, "UNKNOWN_TEST_SITE_DISTRICT");
expectDomainError((site) => {
  site.heightFeatures[0].kind = "legacy-bump";
}, "INVALID_TEST_SITE_HEIGHT_FEATURE_KIND");
expectDomainError((site) => {
  site.heightFeatures.find(({ kind }) => kind === "grade-ramp").runM = 0;
}, "INVALID_FINITE_NUMBER");
expectDomainError((site) => {
  const feature = site.heightFeatures.find(
    ({ kind }) => kind === "corridor-profile",
  );
  feature.transverseProfileM.at(-1)[1] = 0.25;
}, "INVALID_TEST_SITE_TERRAIN_PROFILE");
expectDomainError((site) => {
  const feature = site.heightFeatures.find(
    ({ kind }) => kind === "ripple-train",
  );
  feature.wavelengthM = feature.runM + 1;
}, "INVALID_FINITE_NUMBER");
expectDomainError((site) => {
  const feature = site.heightFeatures.find(({ kind }) => kind === "mound");
  feature.footprint.kind = "rectangle";
}, "INVALID_TEST_SITE_TERRAIN_PROFILE");
expectDomainError((site) => {
  site.routes[0].gateIds = ["missing-gate"];
}, "UNKNOWN_TEST_SITE_GATE");
expectDomainError((site) => {
  site.routes[0].stagingPadId = "missing-pad";
}, "UNKNOWN_TEST_SITE_STAGING_PAD");
expectDomainError((site) => {
  site.routes[0].finish.grounded = "sometimes";
}, "INVALID_TEST_SITE_ROUTE_FINISH");
expectDomainError((site) => {
  site.routes[0].requirements = {};
}, "INVALID_TEST_SITE_LIST");
expectDomainError((site) => {
  site.routes
    .find(({ id }) => id === "suspension-shakedown")
    .requirements.find(({ kind }) => kind === "remain-intact").maxDamage = 0.5;
}, "INVALID_TEST_SITE_ROUTE_REQUIREMENT");
expectDomainError((site) => {
  site.routes[0].requirements[0].kind = "future-requirement";
}, "INVALID_TEST_SITE_ROUTE_REQUIREMENT");
expectDomainError((site) => {
  site.routes.find(({ id }) => id === "ford-crossing").requirements[0].fluidId =
    "missing-fluid";
}, "UNKNOWN_TEST_SITE_FLUID");
expectDomainError((site) => {
  site.fluidRegions[0].densityKgPerM3 = Number.NaN;
}, "INVALID_FINITE_NUMBER");
expectDomainError((site) => {
  site.staticFixtures[0].collisionGeometry.kind = "sphere";
}, "INVALID_TEST_SITE_COLLISION_GEOMETRY");
expectDomainError((site) => {
  site.staticFixtures[0].presentation.variant = 0.5;
}, "INVALID_TEST_SITE_FIXTURE_PRESENTATION");
expectDomainError((site) => {
  site.vegetationRules[0].futureField = true;
}, "INVALID_TEST_SITE_KEYS");
expectDomainError((site) => {
  site.vegetationRules[0].kind = "decorative-scatter";
}, "INVALID_TEST_SITE_VEGETATION_KIND");
expectDomainError((site) => {
  site.vegetationRules[0].excludeSurfaceRegions = "yes";
}, "INVALID_TEST_SITE_BOOLEAN");
expectDomainError((site) => {
  site.vegetationRules[0].sizeDistribution.radiusM = [0.5, 0.2];
}, "INVALID_TEST_SITE_INTERVAL");
expectDomainError((site) => {
  site.vegetationRules[0].seed = 1.5;
}, "INVALID_TEST_SITE_VEGETATION_SEED");
expectDomainError((site) => {
  site.vegetationRules[0].zone.centerM = [230, 0];
}, "TEST_SITE_SHAPE_OUTSIDE_FOOTPRINT");
expectDomainError((site) => {
  const rule = site.vegetationRules[0];
  rule.zone = {
    kind: "rectangle",
    centerM: [192, -18],
    sizeM: [1, 1],
    rotationRad: 0,
  };
  rule.densityPerHectare = 10_000;
  rule.minimumSpacingM = 0;
  rule.excludeSurfaceRegions = false;
  rule.excludeFluidRegions = false;
  rule.excludeClearVolumes = false;
  rule.excludeStagingPads = false;
  rule.exclusionMarginM = 0;
}, "TEST_SITE_CLEARANCE_OCCUPIED");
expectDomainError((site) => {
  const rule = site.vegetationRules[0];
  rule.densityPerHectare = 20_000;
  rule.minimumSpacingM = 20;
}, "TEST_SITE_VEGETATION_DENSITY_UNSATISFIABLE");
expectDomainError((site) => {
  site.clearVolumes[0].purpose = "parking";
}, "INVALID_TEST_SITE_CLEAR_PURPOSE");
expectDomainError((site) => {
  site.staticFixtures[0].pose.positionM = [192, 0, -18];
}, "TEST_SITE_CLEARANCE_OCCUPIED");
expectDomainError((site) => {
  site.staticFixtures[0].pose.positionM = [104, 0, -43];
}, "TEST_SITE_CLEARANCE_OCCUPIED");
for (const pad of WORKSHOP_TEST_SITE.stagingPads)
  expectDomainError((site) => {
    const target = site.stagingPads.find(({ id }) => id === pad.id);
    site.staticFixtures[0].pose.positionM = [
      target.pose.positionM[0],
      0,
      target.pose.positionM[2],
    ];
  }, "TEST_SITE_CLEARANCE_OCCUPIED");
expectDomainError((site) => {
  const dry = site.surfaceRegions.find(({ id }) => id === "lane-dry-asphalt"),
    wet = site.surfaceRegions.find(({ id }) => id === "lane-wet-asphalt");
  wet.shape.centerM = [...dry.shape.centerM];
}, "TEST_SITE_SURFACE_CONFLICT");

const polygonSite = mutableSite();
polygonSite.surfaceRegions[0].shape = {
  kind: "polygon",
  centerM: [0, 26],
  ringsM: [
    [
      [-30, -4],
      [30, -4],
      [30, 4],
      [-30, 4],
    ],
    [
      [-4, -1],
      [-4, 1],
      [4, 1],
      [4, -1],
    ],
  ],
  rotationRad: 0,
};
polygonSite.surfaceRegions[1].shape = {
  kind: "corridor-network",
  centerM: [0, -26],
  pathsM: [
    [
      [-30, 0],
      [0, -3],
      [30, 0],
    ],
  ],
  widthM: 8,
  cap: "round",
  join: "round",
  rotationRad: 0,
};
const validatedPolygonSite = createTestSiteDefinition(polygonSite),
  polygonShape = validatedPolygonSite.surfaceRegions[0].shape,
  corridorShape = validatedPolygonSite.surfaceRegions[1].shape;
assert.equal(testSiteShapeContains(polygonShape, -20, 26), true);
assert.equal(testSiteShapeContains(polygonShape, 0, 26), false);
assert.ok(testSiteShapeSignedDistance(polygonShape, -20, 26) < 0);
assert.ok(testSiteShapeSignedDistance(polygonShape, 0, 26) > 0);
assert.equal(testSiteShapeContains(corridorShape, 0, -29), true);
assert.equal(testSiteShapeContains(corridorShape, 0, -34), false);
assert.deepEqual(testSiteShapeBounds(polygonShape), {
  minX: -30,
  maxX: 30,
  minZ: 22,
  maxZ: 30,
});
assert.ok(Object.isFrozen(polygonShape.ringsM[0]));

const islandSite = mutableSite();
islandSite.fluidRegions[0].shape = {
  kind: "polygon",
  centerM: [-14, -108],
  ringsM: [
    [
      [-28, -14],
      [24, -16],
      [30, -2],
      [22, 15],
      [-24, 17],
      [-31, 2],
    ],
    [
      [5, -4],
      [5, 5],
      [15, 5],
      [15, -4],
    ],
  ],
  rotationRad: 0,
};
const validatedIslandSite = createTestSiteDefinition(islandSite),
  islandField = createSurfaceField(validatedIslandSite),
  islandWater = islandField.fluidAt(-24, -108),
  dryIsland = islandField.fluidAt(-4, -108);
assert.equal(islandWater.id, "deep-pool");
assert.ok(islandWater.depth > 0.08);
assert.equal(dryIsland, null, "polygon hole did not remain a dry island");
assert.ok(Object.isFrozen(validatedIslandSite.fluidRegions[0].depthProfile));

const profileField = createSurfaceField({
  id: "profile-field",
  footprint: { centerM: [0, 0], sizeM: [40, 40] },
  baseTerrain: { heightM: 20, materialKey: "base" },
  heightFeatures: [],
  surfaceRegions: [],
  fluidRegions: [
    {
      id: "profile-water",
      districtId: "profile-district",
      materialKey: "profile-mud",
      waterHeightM: 10,
      densityKgPerM3: 1_000,
      shape: {
        kind: "ellipse",
        centerM: [0, 0],
        sizeM: [20, 20],
        rotationRad: 0,
      },
      depthProfile: {
        kind: "shore-distance",
        shoreDepthM: 0.1,
        shoreShelfM: 2,
        fullDepthDistanceM: 6,
        maximumDepthM: 4,
      },
    },
  ],
});
assert.equal(profileField.contains(20, 20), true);
assert.equal(profileField.contains(20.0001, 20), false);
assert.equal(profileField.fluidAt(10.01, 0), null);
close(profileField.fluidAt(9, 0).depth, 0.1);
close(profileField.fluidAt(9, 0).normalizedRadius, 5 / 6);
close(profileField.fluidAt(6, 0).depth, 2.05);
close(profileField.fluidAt(6, 0).normalizedRadius, 1 / 3);
close(profileField.sample({ x: 6, z: 0 }).heightM, 7.95);
close(profileField.fluidAt(4, 0).depth, 4);
close(profileField.fluidAt(4, 0).normalizedRadius, 0);
assert.equal(profileField.fluidAt(10.5, 0), null);
assert.equal(profileField.fluidAt(10.5, 0, 1.1).id, "profile-water");

expectDomainError((site) => {
  site.surfaceRegions[0].shape = {
    kind: "polygon",
    centerM: [0, 0],
    ringsM: [
      [
        [-2, -2],
        [2, 2],
        [-2, 2],
        [2, -2],
      ],
    ],
    rotationRad: 0,
  };
}, "INVALID_TEST_SITE_POLYGON");
expectDomainError((site) => {
  site.surfaceRegions[0].shape = {
    kind: "polygon",
    centerM: [0, 0],
    ringsM: [
      [
        [-2, -2],
        [-2, 2],
        [2, 2],
        [2, -2],
      ],
    ],
    rotationRad: 0,
  };
}, "INVALID_TEST_SITE_POLYGON");
expectDomainError((site) => {
  site.surfaceRegions[0].shape = {
    kind: "corridor-network",
    centerM: [0, 0],
    pathsM: [
      [
        [0, 0],
        [0, 0],
      ],
    ],
    widthM: 8,
    cap: "round",
    join: "round",
    rotationRad: 0,
  };
}, "INVALID_TEST_SITE_CORRIDOR");
expectDomainError((site) => {
  site.surfaceRegions[0].shape = {
    kind: "corridor-network",
    centerM: [0, 0],
    pathsM: [
      [
        [0, 0],
        [10, 0],
      ],
    ],
    widthM: 8,
    cap: "butt",
    join: "round",
    rotationRad: 0,
  };
}, "INVALID_TEST_SITE_CORRIDOR");
expectDomainError((site) => {
  site.surfaceRegions[0].shape = {
    kind: "polygon",
    centerM: [239, 0],
    ringsM: [
      [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
    ],
    rotationRad: 0,
  };
}, "TEST_SITE_SHAPE_OUTSIDE_FOOTPRINT");
expectDomainError((site) => {
  site.fluidRegions[0].depthProfile.kind = "radial-guess";
}, "INVALID_TEST_SITE_FLUID_PROFILE");
expectDomainError((site) => {
  site.fluidRegions[0].depthProfile.fullDepthDistanceM =
    site.fluidRegions[0].depthProfile.shoreShelfM;
}, "INVALID_FINITE_NUMBER");

const nonCollidingDecoration = mutableSite();
nonCollidingDecoration.staticFixtures[0].collisionGeometry = { kind: "none" };
nonCollidingDecoration.staticFixtures[0].pose.positionM = [104, 0, -43];
assert.equal(
  createTestSiteDefinition(nonCollidingDecoration).staticFixtures[0]
    .collisionGeometry.kind,
  "none",
);
expectDomainError((site) => {
  site.clearVolumes[0].shape = {
    kind: "rectangle",
    centerM: [190, -70],
    sizeM: [20, 4],
    rotationRad: Math.PI / 4,
  };
  site.staticFixtures[0].pose.positionM = [195, 0, -65];
  site.staticFixtures[0].collisionGeometry = {
    kind: "box",
    sizeM: [0.5, 1, 0.5],
  };
}, "TEST_SITE_CLEARANCE_OCCUPIED");

const field = createSurfaceField(WORKSHOP_TEST_SITE),
  asphalt = field.sample({ x: -92, z: 108 }),
  concrete = field.sample({ x: -70, z: 108 }),
  hill = field.sample({ x: 108, z: 105 }),
  poolCenter = field.sample({ x: -140, z: -125 }),
  poolShore = field.sample({ x: -78, z: -125 }),
  outside = field.sample({ x: 260, z: 0 });

for (const [x, angleDeg, startZ] of [
  [65, 10, 80],
  [108, 20, 84],
  [150, 30, 86],
]) {
  const lower = field.sample({ x, z: startZ + 5 }).heightM,
    upper = field.sample({ x, z: startZ + 15 }).heightM,
    measuredGrade = (upper - lower) / 10;
  assert.ok(
    Math.abs(measuredGrade - Math.tan((angleDeg * Math.PI) / 180)) < 1e-9,
    `${angleDeg}-degree ramp measured ${Math.atan(measuredGrade) * (180 / Math.PI)} degrees`,
  );
}
assert.ok(field.sample({ x: 72, z: 60 }).heightM < -1.9);
assert.ok(
  Math.abs(
    field.sample({ x: 72, z: 60 }).heightM -
      field.sample({ x: 72, z: 58 }).heightM,
  ) < 1e-9,
);
assert.ok(
  field.sample({ x: -175, z: -62 }).heightM -
    WORKSHOP_TEST_SITE.baseTerrain.heightM >
    0.14,
);

const vegetation = compileTestSiteVegetation(WORKSHOP_TEST_SITE),
  vegetationFixtures = testSiteVegetationFixtures(WORKSHOP_TEST_SITE),
  allFixtures = [...WORKSHOP_TEST_SITE.staticFixtures, ...vegetationFixtures],
  fixtureBodies = createTestSiteFixtureBodies({
    fixtures: allFixtures,
    terrainHeightAt: (x, z) => field.sample({ x, z }).heightM,
    groundMaterial: new CANNON.Material("fixture-contract-ground"),
  }),
  repeatedFixtureBodies = createTestSiteFixtureBodies({
    fixtures: allFixtures,
    terrainHeightAt: (x, z) => field.sample({ x, z }).heightM,
    groundMaterial: new CANNON.Material("fixture-contract-ground-repeat"),
  }),
  fixtureBodyIds = fixtureBodies.map(({ userData }) => userData.externalBodyId),
  fixtureShapeIds = fixtureBodies.flatMap(({ shapes }) =>
    shapes.map(({ userData }) => userData.shapeId),
  );
assert.deepEqual(
  Object.fromEntries(
    WORKSHOP_TEST_SITE.vegetationRules.map((rule) => [
      rule.id,
      vegetation.filter(({ ruleId }) => ruleId === rule.id).length,
    ]),
  ),
  { "grove-trees": 280, "grove-shrubs": 220, "campus-grass": 3600 },
);
assert.equal(vegetationFixtures.length, 280);
assert.ok(Object.isFrozen(vegetation));
assert.ok(Object.isFrozen(vegetation[0].pose.positionM));
assert.equal(
  WORKSHOP_TEST_SITE.staticFixtures.find(({ id }) => id === "water-bridge")
    .collisionGeometry.children.length,
  7,
);
assert.equal(
  WORKSHOP_TEST_SITE.staticFixtures.filter(({ id }) =>
    id.startsWith("durability-step-"),
  ).length,
  12,
);
assert.equal(
  WORKSHOP_TEST_SITE.staticFixtures.filter(({ id }) =>
    id.startsWith("handling-marker-"),
  ).length,
  14,
);
const apronRamps = WORKSHOP_TEST_SITE.staticFixtures.filter(({ id }) =>
    id.startsWith("workshop-apron-ramp-"),
  ),
  rampTopY = (child, localZ) => {
    const angle = child.rotationEulerRad[0],
      thicknessM = child.geometry.sizeM[1];
    return (
      child.offsetM[1] +
      (thicknessM / 2) * Math.cos(angle) -
      localZ * Math.sin(angle)
    );
  };
assert.deepEqual(
  apronRamps.map(({ id }) => id),
  ["workshop-apron-ramp-south"],
  "routine workshop access must use one south ramp and preserve three raw edges",
);
for (const ramp of apronRamps) {
  const children = ramp.collisionGeometry.children;
  assert.equal(ramp.materialKey, "weathered-concrete");
  assert.equal(children.length, 1);
  const first = children[0],
    last = children.at(-1);
  close(rampTopY(first, first.geometry.sizeM[2] / 2), -FIELD_SURFACE_Y, 0.001);
  close(rampTopY(last, -last.geometry.sizeM[2] / 2), 0, 0.001);
}
assert.equal(fixtureBodies.length, 33);
assert.equal(new Set(fixtureBodyIds).size, fixtureBodies.length);
assert.deepEqual(
  fixtureBodyIds,
  repeatedFixtureBodies.map(({ userData }) => userData.externalBodyId),
  "fixture compound-body identities are not deterministic",
);
assert.equal(fixtureShapeIds.length, 372);
assert.equal(new Set(fixtureShapeIds).size, fixtureShapeIds.length);
assert.ok(fixtureShapeIds.includes("fixture:operations-building:0"));
assert.ok(fixtureShapeIds.includes("fixture:airfield-sign:1"));
assert.ok(fixtureShapeIds.includes("fixture:vegetation:grove-trees-1:0"));
assert.ok(
  fixtureBodies.every(({ shapes }) => shapes.length <= 24),
  "fixture tiling produced an oversized compound body",
);

assert.deepEqual(
  asphalt,
  field.sample({ x: -92, z: 108 }),
  "surface sampling is not deterministic",
);
assert.equal(asphalt.materialKey, "dry-asphalt");
assert.equal(asphalt.districtId, "surface-lanes");
assert.equal(concrete.materialKey, "weathered-concrete");
assert.ok(hill.heightM > 5, `authored hill was not physical: ${hill.heightM}`);
assert.equal(poolCenter.fluid.id, "deep-pool");
assert.equal(poolCenter.materialKey, "saturated-mud");
assert.ok(
  poolCenter.heightM < -3.7,
  `deep pool bed is too shallow: ${poolCenter.heightM}`,
);
assert.ok(
  poolShore.heightM > poolCenter.heightM,
  "pool bank did not grade toward the shore",
);
assert.equal(outside.inside, false);
assert.equal(field.contains(240, 180), true);
assert.equal(field.contains(240.01, 180), false);

const offsetField = createSurfaceField({
  id: "offset-field",
  footprint: { centerM: [10, 20], sizeM: [20, 10] },
  baseTerrain: { heightM: 1, materialKey: "base" },
  heightFeatures: [
    {
      id: "primary-rise",
      districtId: "primary-hills",
      kind: "mound",
      elevationM: 4,
      footprint: {
        kind: "ellipse",
        centerM: [10, 20],
        sizeM: [4, 4],
        rotationRad: 0,
      },
      profile: "elliptic-quartic",
    },
    {
      id: "secondary-rise",
      districtId: "secondary-hills",
      kind: "mound",
      elevationM: 1,
      footprint: {
        kind: "ellipse",
        centerM: [10, 20],
        sizeM: [4, 4],
        rotationRad: 0,
      },
      profile: "elliptic-quartic",
    },
  ],
  surfaceRegions: [
    {
      id: "offset-lane",
      districtId: "lanes",
      materialKey: "lane-material",
      shape: {
        kind: "rectangle",
        centerM: [15, 20],
        sizeM: [2, 2],
        rotationRad: 0,
      },
    },
  ],
  fluidRegions: [
    {
      id: "offset-fluid-a",
      districtId: "water-a",
      materialKey: "mud-a",
      depthProfile: {
        kind: "shore-distance",
        shoreDepthM: 0.1,
        shoreShelfM: 0,
        fullDepthDistanceM: 1,
        maximumDepthM: 3,
      },
      waterHeightM: 2,
      densityKgPerM3: 1000,
      shape: {
        kind: "ellipse",
        centerM: [5, 20],
        sizeM: [4, 2],
        rotationRad: 0,
      },
    },
    {
      id: "offset-fluid-b",
      districtId: "water-b",
      materialKey: "mud-b",
      depthProfile: {
        kind: "shore-distance",
        shoreDepthM: 0.1,
        shoreShelfM: 0,
        fullDepthDistanceM: 0.5,
        maximumDepthM: 2,
      },
      waterHeightM: 2,
      densityKgPerM3: 1000,
      shape: {
        kind: "ellipse",
        centerM: [18, 20],
        sizeM: [2, 2],
        rotationRad: 0,
      },
    },
  ],
});
assert.equal(offsetField.contains(0, 15), true);
assert.equal(offsetField.contains(20, 25), true);
assert.equal(offsetField.contains(-0.01, 20), false);
assert.equal(offsetField.contains(10, 14.99), false);
assert.deepEqual(offsetField.sample({ x: 10, z: 20 }), {
  siteId: "offset-field",
  inside: true,
  heightM: 6,
  materialKey: "base",
  districtId: "primary-hills",
  surfaceRegionId: null,
  featureIds: ["primary-rise", "secondary-rise"],
  fluid: null,
});
assert.equal(offsetField.sample({ x: 11, z: 20 }).heightM, 3.8125);
assert.equal(offsetField.sample({ x: 15, z: 20 }).materialKey, "lane-material");
const offsetFluid = offsetField.fluidAt(6, 20),
  expandedFluid = offsetField.fluidAt(7.5, 20, 2),
  secondFluid = offsetField.sample({ x: 18, z: 20 });
assert.equal(offsetFluid.id, "offset-fluid-a");
assert.equal(offsetFluid.rx, 2);
assert.equal(offsetFluid.rz, 1);
assert.equal(offsetFluid.normalizedRadius, 0.5);
assert.ok(expandedFluid, "expanded fluid clearance query missed its margin");
assert.equal(expandedFluid.depth, 0, "fluid margin invented water depth");
assert.equal(secondFluid.fluid.id, "offset-fluid-b");
assert.equal(secondFluid.materialKey, "mud-b");
assert.equal(secondFluid.districtId, "water-b");
assert.equal(secondFluid.heightM, 0);

const world = new CANNON.World(),
  footMaterial = new CANNON.Material("test-foot"),
  debrisMaterial = new CANNON.Material("test-debris"),
  collision = createTestSiteCollisionBody({
    sampleAt: (x, z) => field.sample({ x, z }),
    footprint: WORKSHOP_TEST_SITE.footprint,
    fallbackMaterial: new CANNON.Material("test-ground"),
  });
world.addBody(collision.body);
installTestSiteContactMaterials({
  world,
  materialsByKey: collision.materialsByKey,
  footMaterial,
  debrisMaterial,
});
assert.equal(collision.body.shapes.length, 1);
assert.equal(collision.body.shapes[0].type, CANNON.Shape.types.HEIGHTFIELD);
assert.equal(
  Object.values(collision.triangleCounts).reduce(
    (sum, count) => sum + count,
    0,
  ),
  collision.segmentsX * collision.segmentsZ * 2,
  "site triangles were duplicated or omitted while partitioning materials",
);
assert.deepEqual([...collision.materialsByKey.keys()].sort(), [
  "compacted-soil",
  "dry-asphalt",
  "dry-sand",
  "loose-gravel",
  "low-grip-polymer",
  "saturated-mud",
  "short-grass",
  "weathered-concrete",
  "wet-asphalt",
]);
assert.equal(collision.vertexCount, 43_621);
assert.equal(
  collision.body.shapes[0].userData.shapeId,
  "test-reserve:heightfield",
);
assert.equal(
  collision.body.userData.contactMaterialAt(-92, 108, debrisMaterial.name)
    .materialKey,
  "dry-asphalt",
);
assert.equal(world.contactmaterials.length, collision.materialsByKey.size * 2);
const footAsphalt = world.getContactMaterial(
    footMaterial,
    collision.materialsByKey.get("dry-asphalt"),
  ),
  footMud = world.getContactMaterial(
    footMaterial,
    collision.materialsByKey.get("saturated-mud"),
  );
assert.ok(
  footMud.contactEquationStiffness < footAsphalt.contactEquationStiffness,
  "non-wheel mud contact did not use the authored compliant foundation",
);
assert.equal(
  footMud.contactEquationStiffness,
  supportMaterialResponse("saturated-mud").foundationStiffnessNPerM,
);
const softContact = testSiteSupportContact(4, {
  otherBodyId: "environment:test-reserve",
  otherShapeId: "test-reserve:saturated-mud",
  otherMaterialKey: "saturated-mud",
  point: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 1, z: 0 },
  forceN: 100_000,
  relativeVelocity: { x: 1, y: 0, z: 0 },
});
assert.equal(softContact.materialKey, "saturated-mud");
assert.equal(softContact.surfaceSinkageM, 0.18);
assert.equal(softContact.maximumSinkageM, 0.18);
assert.ok(
  contactMaterialPair("tire-rubber", "dry-asphalt")
    .longitudinalFrictionCoefficient >
    contactMaterialPair("tire-rubber", "wet-asphalt")
      .longitudinalFrictionCoefficient,
);
assert.ok(
  contactMaterialPair("tire-rubber", "wet-asphalt")
    .longitudinalFrictionCoefficient >
    contactMaterialPair("tire-rubber", "low-grip-polymer")
      .longitudinalFrictionCoefficient,
);

console.log(
  `test-site contract verified (${WORKSHOP_TEST_SITE.surfaceRegions.length} regions, ${collision.materialsByKey.size} physical materials, ${WORKSHOP_TEST_SITE.heightFeatures.length} height features, ${WORKSHOP_TEST_SITE.fluidRegions.length} fluids)`,
);
