import * as CANNON from "cannon-es";
import { assert } from "./lib/assert.mjs";
import { TYPES } from "../src/model/component-catalog.js";
import { compileAssembly } from "../src/model/assembly-compiler.js";
import { contactMaterialPair } from "../src/model/contact-material-pairs.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import {
  passiveBrushForces,
  radialContactResponse,
  surfaceFoundationResponse,
} from "../src/simulation/tire-contact.js";
import { fixtureMobilityTelemetry } from "./lib/mobility-fixture.mjs";

const radiusM = TYPES.wheel.mechanism.config.radiusM;

const compiledSemanticWheel = compileAssembly(
    {
      revision: 1,
      parts: [
        {
          id: 1,
          type: "wheel",
          pos: [0, radiusM, 0],
          orientation: [0, 0, 0, 1],
          scale: { x: 1, y: 1, z: 1 },
          mechanism: structuredClone(TYPES.wheel.mechanism),
        },
      ],
      connections: [],
    },
    TYPES,
  ),
  compiledContact = compiledSemanticWheel.contactRegions[0],
  compiledShape =
    compiledSemanticWheel.bodies[0].geometry.collisionPrimitives[0],
  expectedSemanticRoles = ["rim", "sidewall", "tire-envelope"];
assert.deepEqual(
  compiledContact.semanticRegions.map((region) => region.contactRole).sort(),
  expectedSemanticRoles,
  "compiler dropped authored wheel contact regions",
);
assert.deepEqual(
  compiledShape.semanticRegions.map((region) => region.contactRole).sort(),
  expectedSemanticRoles,
  "runtime collision projection dropped authored wheel contact regions",
);

assert.deepEqual(
  contactMaterialPair("tire-rubber", "workshop-steel"),
  contactMaterialPair("workshop-steel", "tire-rubber"),
  "contact material laws must be symmetric",
);
for (const environmentMaterial of [
  "compacted-soil",
  "natural-terrain",
  "weathered-concrete",
  "wood-bark",
  "weathered-stone",
])
  assert.deepEqual(
    contactMaterialPair("tire-rubber", environmentMaterial),
    contactMaterialPair(environmentMaterial, "tire-rubber"),
    `${environmentMaterial} tire law must be symmetric`,
  );
assert.throws(
  () => contactMaterialPair("tire-rubber", "unregistered-surface"),
  (error) => error.code === "UNKNOWN_CONTACT_MATERIAL_PAIR",
);
const asphaltPair = contactMaterialPair("tire-rubber", "dry-asphalt"),
  sandPair = contactMaterialPair("tire-rubber", "dry-sand"),
  mudPair = contactMaterialPair("tire-rubber", "saturated-mud");
assert.ok(sandPair.foundationStiffnessNPerM > 0);
assert.ok(mudPair.maximumSinkageM > sandPair.maximumSinkageM);
assert.ok(
  mudPair.rollingResistanceMultiplier > sandPair.rollingResistanceMultiplier &&
    sandPair.rollingResistanceMultiplier >
      asphaltPair.rollingResistanceMultiplier,
);
assert.throws(
  () => contactMaterialPair("tire-rubber", null),
  (error) => error.code === "MISSING_CONTACT_MATERIAL_IDENTITY",
);

const tireLaw = TYPES.wheel.mechanism.config.tireConstitutiveLaw,
  steelPair = contactMaterialPair("tire-rubber", "workshop-steel"),
  brushProbe = (normalLoadN, slipLongMPerS, slipLatMPerS) =>
    passiveBrushForces({
      slipLongMPerS,
      slipLatMPerS,
      creep: tireLaw.creepMatrixByLoad[1],
      pair: steelPair,
      normalLoadN,
      effectiveLongInverseMass: 0.002,
      effectiveLatInverseMass: 0.002,
      dt: 1 / 120,
    });
assert.deepEqual(
  brushProbe(2500, 0, 0),
  {
    longitudinalForceN: 0,
    lateralForceN: 0,
    frictionEllipseUtilization: 0,
    dissipatedPowerW: 0,
  },
  "zero slip must produce zero tire force",
);
for (const [longitudinal, lateral] of [
  [0.3, 0],
  [-0.3, 0],
  [0, 0.3],
  [0.3, -0.3],
  [5, 5],
]) {
  const response = brushProbe(2500, longitudinal, lateral);
  assert.ok(response.frictionEllipseUtilization <= 1);
  assert.ok(
    response.longitudinalForceN * longitudinal +
      response.lateralForceN * lateral <=
      1e-9,
    "production brush law performed positive work",
  );
}
assert.ok(
  Math.abs(brushProbe(4000, 20, 0).longitudinalForceN) >
    Math.abs(brushProbe(1000, 20, 0).longitudinalForceN),
  "tire force did not respond to normal load",
);
for (const normalLoadN of [100, 1_000, 5_000, 20_000])
  for (const slipLongMPerS of [-5, -0.5, 0, 0.5, 5])
    for (const slipLatMPerS of [-5, -0.5, 0, 0.5, 5]) {
      const response = brushProbe(normalLoadN, slipLongMPerS, slipLatMPerS),
        mirrored = brushProbe(normalLoadN, -slipLongMPerS, -slipLatMPerS);
      assert.ok(
        Object.values(response).every(Number.isFinite),
        "force-slip sweep produced non-finite state",
      );
      assert.ok(response.frictionEllipseUtilization <= 1 + 1e-12);
      assert.ok(
        response.longitudinalForceN * slipLongMPerS +
          response.lateralForceN * slipLatMPerS <=
          1e-9,
        "force-slip sweep created contact energy",
      );
      assert.ok(
        Math.abs(response.longitudinalForceN + mirrored.longitudinalForceN) <=
          1e-9 &&
          Math.abs(response.lateralForceN + mirrored.lateralForceN) <= 1e-9,
        "force-slip law is not odd under mirrored slip",
      );
    }

const normalModel = tireLaw.normalModel,
  belowRim = radialContactResponse({
    normalModel,
    deflectionM: normalModel.maximumDeflectionM * 0.5,
    normalRateMPerS: 0,
    manifoldShare: 1,
    dt: 1 / 120,
  }),
  beyondRim = radialContactResponse({
    normalModel,
    deflectionM: normalModel.maximumDeflectionM * 1.2,
    normalRateMPerS: -0.5,
    manifoldShare: 1,
    dt: 1 / 120,
  });
assert.equal(belowRim.atRim, false);
assert.equal(belowRim.rimLoadN, 0);
assert.ok(belowRim.foundationLoadN > 0);
assert.equal(beyondRim.atRim, true);
assert.equal(
  beyondRim.boundedDeflectionM,
  normalModel.maximumDeflectionM,
  "massless carcass exceeded its authored travel",
);
assert.ok(beyondRim.rimLoadN > 0, "rim bottom-out did not carry excess load");
const hardFoundation = surfaceFoundationResponse({
    normalModel,
    pair: asphaltPair,
    deflectionM: normalModel.maximumDeflectionM * 0.5,
    normalRateMPerS: 0,
    manifoldShare: 1,
    dt: 1 / 120,
  }),
  softFoundation = surfaceFoundationResponse({
    normalModel,
    pair: sandPair,
    deflectionM: normalModel.maximumDeflectionM * 0.5,
    normalRateMPerS: 0,
    manifoldShare: 1,
    dt: 1 / 120,
  });
assert.equal(hardFoundation.surfaceSinkageM, 0);
assert.ok(softFoundation.surfaceSinkageM > 0);
assert.ok(softFoundation.normalLoadN < hardFoundation.normalLoadN);
for (const deflectionRatio of [0, 0.25, 0.5, 1, 1.25, 2])
  for (const normalRateMPerS of [-2, 0, 2]) {
    const response = radialContactResponse({
      normalModel,
      deflectionM: normalModel.maximumDeflectionM * deflectionRatio,
      normalRateMPerS,
      manifoldShare: 1,
      dt: 1 / 120,
    });
    assert.ok(
      Object.values(response).every(
        (value) => typeof value === "boolean" || Number.isFinite(value),
      ),
      "carcass sweep produced non-finite state",
    );
    assert.ok(
      response.boundedDeflectionM <= normalModel.maximumDeflectionM &&
        response.foundationLoadN >= 0 &&
        response.rimLoadN >= 0 &&
        response.normalLoadN >= 0,
      "carcass sweep violated complementarity bounds",
    );
    assert.equal(response.atRim, deflectionRatio > 1);
    if (deflectionRatio <= 1) assert.equal(response.rimLoadN, 0);
  }

function obstacleProbe({
  heightM = 0,
  widthM = 0.12,
  speedMPerS = 2.4,
  approachAngleRad = 0,
  obstacleKind = "curb",
  gapWidthM = 0,
}) {
  const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    adapter = new CannonWorldAdapter(world),
    material = new CANNON.Material("fixture-material"),
    groundBodies = gapWidthM
      ? [-1, 1].map(
          (direction) =>
            new CANNON.Body({
              type: CANNON.Body.STATIC,
              material,
              shape: new CANNON.Box(new CANNON.Vec3(4, 0.25, 2)),
              position: new CANNON.Vec3(
                direction * (4 + gapWidthM / 2),
                -0.25,
                0,
              ),
            }),
        )
      : [
          new CANNON.Body({
            type: CANNON.Body.STATIC,
            material,
            shape: new CANNON.Box(new CANNON.Vec3(8, 0.25, 2)),
            position: new CANNON.Vec3(0, -0.25, 0),
          }),
        ],
    ground = groundBodies[0],
    obstacle =
      obstacleKind === "rock"
        ? new CANNON.Body({
            type: CANNON.Body.STATIC,
            material,
            shape: new CANNON.Sphere(heightM / 2),
            position: new CANNON.Vec3(0, heightM / 2, 0),
          })
        : gapWidthM
          ? null
          : new CANNON.Body({
              type: CANNON.Body.STATIC,
              material,
              shape: new CANNON.Box(
                new CANNON.Vec3(widthM / 2, heightM / 2, 2),
              ),
              position: new CANNON.Vec3(0, heightM / 2, 0),
            }),
    authoredWheel = {
      id: 1,
      type: "wheel",
      pos: [-2, radiusM, 0],
      orientation: [0, 0, 0, 1],
      scale: { x: 1, y: 1, z: 1 },
      mechanism: structuredClone(TYPES.wheel.mechanism),
    },
    runtime = new MultibodyRuntime({
      world,
      worldAdapter: adapter,
      material,
      catalog: TYPES,
      groundBody: ground,
      fieldBody: ground,
      fixedDt: 1 / 120,
    });
  groundBodies.forEach((body, index) => {
    body.userData = {
      externalBodyId: `fixture:ground:${index}`,
      surface: "ground",
      materialKey: "workshop-steel",
    };
  });
  if (obstacle) {
    obstacle.userData = {
      externalBodyId: `fixture:${obstacleKind}`,
      surface: obstacleKind,
      materialKey: "workshop-steel",
    };
    obstacle.quaternion.setFromEuler(0, approachAngleRad, 0);
  }
  world.solver.iterations = 30;
  world.solver.tolerance = 0.0002;
  for (const body of groundBodies) world.addBody(body);
  if (obstacle) world.addBody(obstacle);
  runtime.start({ revision: 1, parts: [authoredWheel], connections: [] });
  const body = runtime.bodyByPart.get(authoredWheel.id);
  assert.equal(
    body.shapes.length,
    1,
    "wheel contact used overlapping duplicate collision solids",
  );
  assert.deepEqual(
    body.shapes[0].userData.semanticRegions
      .map((region) => region.contactRole)
      .sort(),
    expectedSemanticRoles,
    "runtime narrowphase shape lost authored semantic regions",
  );
  body.velocity.set(speedMPerS, 0, 0);
  body.angularVelocity.set(0, 0, -speedMPerS / radiusM);
  let maximumY = body.position.y,
    minimumY = body.position.y,
    maximumContactPoints = 0,
    maximumRimLoadN = 0,
    maximumFrictionUtilization = 0,
    maximumFrictionState = null,
    maximumPositiveEnergyGainJ = 0,
    contactRegionKeys = new Set(),
    contactMaterialKeys = new Set(),
    supportMaterialKeys = new Set();
  const initialEnergyJ =
    0.5 * body.mass * body.velocity.lengthSquared() +
    0.5 * body.inertia.z * body.angularVelocity.z ** 2 +
    body.mass * 9.80665 * body.position.y;
  for (let tick = 1; tick <= 480; tick++) {
    adapter.integrate(1 / 120, { tick });
    runtime.afterIntegration(1 / 120);
    const state = fixtureMobilityTelemetry(runtime, { dt: 1 / 120 })
        .wheelStates[0],
      energyJ =
        0.5 * body.mass * body.velocity.lengthSquared() +
        0.5 * body.inertia.z * body.angularVelocity.z ** 2 +
        body.mass * 9.80665 * body.position.y;
    maximumY = Math.max(maximumY, body.position.y);
    minimumY = Math.min(minimumY, body.position.y);
    maximumContactPoints = Math.max(
      maximumContactPoints,
      state.manifoldPointCount,
    );
    maximumRimLoadN = Math.max(maximumRimLoadN, state.rimLoadN);
    for (const key of state.contactRegionKeys) contactRegionKeys.add(key);
    for (const key of state.contactMaterialKeys) contactMaterialKeys.add(key);
    for (const key of state.supportMaterialKeys) supportMaterialKeys.add(key);
    if (state.frictionEllipseUtilization > maximumFrictionUtilization) {
      maximumFrictionUtilization = state.frictionEllipseUtilization;
      maximumFrictionState = {
        tick,
        normalLoadN: state.normalLoadN,
        longitudinalForceN: state.longitudinalForceN,
        lateralForceN: state.lateralForceN,
        roles: state.contactRoles,
      };
    }
    maximumPositiveEnergyGainJ = Math.max(
      maximumPositiveEnergyGainJ,
      energyJ - initialEnergyJ,
    );
  }
  const result = {
    heightM,
    widthM,
    speedMPerS,
    approachAngleRad,
    obstacleKind,
    gapWidthM,
    finalX: body.position.x,
    finalY: body.position.y,
    maximumY,
    minimumY,
    maximumContactPoints,
    maximumRimLoadN,
    maximumFrictionUtilization,
    maximumFrictionState,
    maximumPositiveEnergyGainJ,
    contactRegionKeys: [...contactRegionKeys].sort(),
    contactMaterialKeys: [...contactMaterialKeys].sort(),
    supportMaterialKeys: [...supportMaterialKeys].sort(),
  };
  runtime.dispose();
  return result;
}

function sidewallProbe(angleDeg = 0) {
  const angleRad = (angleDeg * Math.PI) / 180;
  const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, 0, -9.80665),
    }),
    adapter = new CannonWorldAdapter(world),
    material = new CANNON.Material("fixture-material"),
    wall = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material,
      shape: new CANNON.Plane(),
    }),
    authoredWheel = {
      id: 1,
      type: "wheel",
      pos: [0, 0, 0.7],
      orientation: [0, Math.sin(angleRad / 2), 0, Math.cos(angleRad / 2)],
      scale: { x: 1, y: 1, z: 1 },
      mechanism: structuredClone(TYPES.wheel.mechanism),
    },
    runtime = new MultibodyRuntime({
      world,
      worldAdapter: adapter,
      material,
      catalog: TYPES,
      groundBody: wall,
      fieldBody: wall,
      fixedDt: 1 / 120,
    });
  wall.userData = {
    externalBodyId: "fixture:sidewall-plane",
    surface: "sidewall-plane",
    materialKey: "workshop-steel",
  };
  world.solver.iterations = 30;
  world.solver.tolerance = 0.0002;
  world.addBody(wall);
  runtime.start({ revision: 1, parts: [authoredWheel], connections: [] });
  let maximumNormalLoadN = 0,
    maximumTangentialForceN = 0,
    observedSidewall = false,
    contactRegionKeys = new Set(),
    contactMaterialKeys = new Set(),
    supportMaterialKeys = new Set();
  for (let tick = 1; tick <= 240; tick++) {
    adapter.integrate(1 / 120, { tick });
    runtime.afterIntegration(1 / 120);
    const state = fixtureMobilityTelemetry(runtime, { dt: 1 / 120 })
      .wheelStates[0];
    maximumNormalLoadN = Math.max(maximumNormalLoadN, state.normalLoadN);
    maximumTangentialForceN = Math.max(
      maximumTangentialForceN,
      Math.hypot(state.longitudinalForceN, state.lateralForceN),
    );
    observedSidewall ||= state.contactRoles.includes("sidewall");
    for (const key of state.contactRegionKeys) contactRegionKeys.add(key);
    for (const key of state.contactMaterialKeys) contactMaterialKeys.add(key);
    for (const key of state.supportMaterialKeys) supportMaterialKeys.add(key);
  }
  const result = {
    angleDeg,
    maximumNormalLoadN,
    maximumTangentialForceN,
    observedSidewall,
    contactRegionKeys: [...contactRegionKeys].sort(),
    contactMaterialKeys: [...contactMaterialKeys].sort(),
    supportMaterialKeys: [...supportMaterialKeys].sort(),
  };
  runtime.dispose();
  return result;
}

const smallCurb = obstacleProbe({ heightM: radiusM * 0.25 }),
  highCurb = obstacleProbe({ heightM: radiusM * 1.15 }),
  thinObstacle = obstacleProbe({
    heightM: radiusM * 0.18,
    widthM: 0.025,
    speedMPerS: 5,
  }),
  speedSweep = [1.5, 2.4, 4].map((speedMPerS) =>
    obstacleProbe({ heightM: radiusM * 0.2, speedMPerS }),
  ),
  obliqueCurbSweep = [5, 10, 25, 40].map((angleDeg) =>
    obstacleProbe({
      heightM: radiusM * 0.2,
      approachAngleRad: (angleDeg * Math.PI) / 180,
    }),
  ),
  rockSweep = [0.12, 0.25, 0.4].map((heightRatio) =>
    obstacleProbe({
      heightM: radiusM * heightRatio,
      obstacleKind: "rock",
    }),
  ),
  gapSweep = [0.25, 0.75, 1.5].map((widthRatio) =>
    obstacleProbe({ gapWidthM: radiusM * widthRatio }),
  ),
  sidewallSweep = [-5, -1, 0, 1, 5].map(sidewallProbe),
  sidewall = sidewallSweep.find((result) => result.angleDeg === 0);

assert.ok(
  smallCurb.finalX > 0.5 && smallCurb.maximumY > radiusM + 0.08,
  `rounded wheel did not climb the small curb: ${JSON.stringify(smallCurb)}`,
);
assert.ok(
  highCurb.finalX < 0.4,
  `wheel crossed a curb taller than its geometric envelope: ${JSON.stringify(highCurb)}`,
);
assert.ok(
  thinObstacle.maximumContactPoints > 0 && thinObstacle.finalX > 0.5,
  `thin obstacle tunneled or blocked a climbable wheel: ${JSON.stringify(thinObstacle)}`,
);
const obstacleSweep = [
  smallCurb,
  highCurb,
  thinObstacle,
  ...speedSweep,
  ...obliqueCurbSweep,
  ...rockSweep,
  ...gapSweep,
];
for (const result of obstacleSweep) {
  assert.ok(
    [
      result.finalX,
      result.finalY,
      result.maximumY,
      result.minimumY,
      result.maximumPositiveEnergyGainJ,
      result.maximumFrictionUtilization,
    ].every(Number.isFinite),
    `obstacle sweep produced non-finite state: ${JSON.stringify(result)}`,
  );
  assert.ok(
    result.maximumContactPoints > 0,
    `obstacle sweep missed ordinary narrowphase contact: ${JSON.stringify(result)}`,
  );
  assert.ok(
    result.maximumPositiveEnergyGainJ < 2,
    `passive wheel contact created ${result.maximumPositiveEnergyGainJ} J`,
  );
  assert.ok(
    result.maximumFrictionUtilization <= 1 + 1e-6,
    `solved tire force exceeded its material ellipse: ${JSON.stringify(result)}`,
  );
  assert.deepEqual(
    result.contactMaterialKeys,
    ["tire-rubber"],
    `obstacle contact bypassed its authored material region: ${JSON.stringify(result)}`,
  );
  assert.deepEqual(
    result.supportMaterialKeys,
    ["workshop-steel"],
    `wheel telemetry lost the contacted support material: ${JSON.stringify(result)}`,
  );
  assert.ok(
    result.contactRegionKeys.includes("tire-envelope"),
    `obstacle contact bypassed the authored tire envelope: ${JSON.stringify(result)}`,
  );
}

assert.ok(
  speedSweep[0].finalX < -0.5 &&
    speedSweep[1].finalX > 0.5 &&
    speedSweep[2].finalX > 0.5,
  `curb crossing did not expose a physical speed boundary: ${JSON.stringify(speedSweep)}`,
);
assert.ok(
  obliqueCurbSweep[0].finalX > 0.5 &&
    obliqueCurbSweep.slice(1).every((result) => result.finalX < 0.5),
  `oblique curb sweep did not expose an approach-angle boundary: ${JSON.stringify(obliqueCurbSweep)}`,
);
assert.ok(
  rockSweep.slice(0, 2).every((result) => result.finalX > 0.5) &&
    rockSweep[2].finalX < 0,
  `rounded rock sweep did not expose a geometric climb boundary: ${JSON.stringify(rockSweep)}`,
);
assert.ok(
  gapSweep.slice(0, 2).every((result) => result.finalX > 0.5) &&
    gapSweep[2].finalX < 0.5 &&
    gapSweep[2].minimumY < radiusM * 0.75,
  `gap sweep did not expose a span/fall boundary: ${JSON.stringify(gapSweep)}`,
);
assert.equal(sidewall.observedSidewall, true, "sidewall role was not observed");
assert.ok(
  sidewall.maximumNormalLoadN > 0,
  "sidewall did not carry normal load",
);
assert.ok(
  sidewall.maximumTangentialForceN <= 1e-9,
  `axle-normal sidewall contact invented traction: ${JSON.stringify(sidewall)}`,
);
for (const result of sidewallSweep) {
  assert.ok(
    Number.isFinite(result.maximumNormalLoadN) &&
      Number.isFinite(result.maximumTangentialForceN) &&
      result.maximumNormalLoadN > 0,
    `sidewall orientation sweep produced invalid state: ${JSON.stringify(result)}`,
  );
  assert.ok(
    result.observedSidewall && result.contactRegionKeys.includes("sidewall"),
    `sidewall orientation lost its authored semantic region: ${JSON.stringify(result)}`,
  );
  assert.deepEqual(result.contactMaterialKeys, ["tire-rubber"]);
  assert.deepEqual(result.supportMaterialKeys, ["workshop-steel"]);
  assert.ok(
    result.maximumTangentialForceN <= result.maximumNormalLoadN,
    `near-degenerate sidewall basis exceeded normal loading: ${JSON.stringify(result)}`,
  );
}
for (const angleDeg of [1, 5]) {
  const negative = sidewallSweep.find(
      (result) => result.angleDeg === -angleDeg,
    ),
    positive = sidewallSweep.find((result) => result.angleDeg === angleDeg),
    scale = Math.max(
      1,
      negative.maximumTangentialForceN,
      positive.maximumTangentialForceN,
    );
  assert.ok(
    Math.abs(
      negative.maximumTangentialForceN - positive.maximumTangentialForceN,
    ) /
      scale <
      0.35,
    `mirrored sidewall sweep was orientation-order sensitive at ${angleDeg} degrees`,
  );
}

console.log(
  `rounded contact sweeps passed (${obstacleSweep.length} obstacles, ${sidewallSweep.length} sidewall angles; small ${smallCurb.finalX.toFixed(2)} m, high ${highCurb.finalX.toFixed(2)} m)`,
);
