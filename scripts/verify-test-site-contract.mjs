import { assert } from "./lib/assert.mjs";
import { WORKSHOP_TEST_SITE } from "../src/application/testing-playground-content.js";
import {
  createTestSiteDefinition,
  TEST_SITE_SCHEMA_VERSION,
} from "../src/model/test-site.js";
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

const mutableSite = () => structuredClone(WORKSHOP_TEST_SITE),
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
assert.equal(WORKSHOP_TEST_SITE.staticFixtures.length, 36);
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
  site.surfaceRegions[0].shape.sizeM = "large";
}, "INVALID_TEST_SITE_VECTOR");
expectDomainError((site) => {
  site.surfaceRegions[1].id = site.surfaceRegions[0].id;
}, "DUPLICATE_TEST_SITE_ID");
expectDomainError((site) => {
  site.heightFeatures[0].districtId = "missing-district";
}, "UNKNOWN_TEST_SITE_DISTRICT");
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
  site.staticFixtures[0].collision = "yes";
}, "INVALID_TEST_SITE_FIXTURE_COLLISION");
expectDomainError((site) => {
  site.staticFixtures[0].kind = "shrub";
}, "INVALID_TEST_SITE_FIXTURE");
expectDomainError((site) => {
  site.clearVolumes[0].purpose = "parking";
}, "INVALID_TEST_SITE_CLEAR_PURPOSE");
expectDomainError((site) => {
  site.staticFixtures[0].positionM = [-108, 0, 154];
}, "TEST_SITE_CLEARANCE_OCCUPIED");
expectDomainError((site) => {
  site.staticFixtures[0].positionM = [178, 0, 124];
}, "TEST_SITE_CLEARANCE_OCCUPIED");
for (const pad of WORKSHOP_TEST_SITE.stagingPads)
  expectDomainError((site) => {
    const target = site.stagingPads.find(({ id }) => id === pad.id);
    site.staticFixtures[0].positionM = [
      target.pose.positionM[0],
      0,
      target.pose.positionM[2],
    ];
  }, "TEST_SITE_CLEARANCE_OCCUPIED");
expectDomainError((site) => {
  site.surfaceRegions[5].shape.centerM = [96, -85];
}, "TEST_SITE_SURFACE_CONFLICT");

const nonCollidingDecoration = mutableSite();
nonCollidingDecoration.staticFixtures[0].collision = false;
nonCollidingDecoration.staticFixtures[0].positionM = [178, 0, 124];
assert.equal(
  createTestSiteDefinition(nonCollidingDecoration).staticFixtures[0].collision,
  false,
);
expectDomainError((site) => {
  site.clearVolumes[0].shape = {
    kind: "rectangle",
    centerM: [190, -70],
    sizeM: [20, 4],
    rotationRad: Math.PI / 4,
  };
  site.staticFixtures[0].positionM = [195, 0, -65];
  site.staticFixtures[0].sizeM = [0.5, 1, 0.5];
}, "TEST_SITE_CLEARANCE_OCCUPIED");

const field = createSurfaceField(WORKSHOP_TEST_SITE),
  asphalt = field.sample({ x: 96, z: -85 }),
  concrete = field.sample({ x: 96, z: -59 }),
  hill = field.sample({ x: 72, z: 91 }),
  poolCenter = field.sample({ x: -14, z: -108 }),
  poolShore = field.sample({ x: 17, z: -108 }),
  outside = field.sample({ x: 260, z: 0 });

assert.deepEqual(
  asphalt,
  field.sample({ x: 96, z: -85 }),
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
      amplitudeM: 4,
      shape: {
        kind: "ellipse",
        centerM: [10, 20],
        sizeM: [4, 4],
        rotationRad: 0,
      },
    },
    {
      id: "secondary-rise",
      districtId: "secondary-hills",
      amplitudeM: 1,
      shape: {
        kind: "ellipse",
        centerM: [10, 20],
        sizeM: [4, 4],
        rotationRad: 0,
      },
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
      bedDepthM: 3,
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
      bedDepthM: 2,
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
assert.equal(offsetFluid.normalizedRadius, 0.25);
assert.ok(expandedFluid && expandedFluid.depth > 0);
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
assert.equal(collision.vertexCount, 27_985);
assert.equal(
  collision.body.shapes[0].userData.shapeId,
  "test-reserve:heightfield",
);
assert.equal(
  collision.body.userData.contactMaterialAt(96, -85, debrisMaterial.name)
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
