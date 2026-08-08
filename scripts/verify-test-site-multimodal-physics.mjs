import * as CANNON from "cannon-es";
import { assert } from "./lib/assert.mjs";
import { createTestingPlaygroundEnvironment } from "../src/application/testing-playground-environment.js";
import { createWorkshopPhysicsWorld } from "../src/application/workshop-physics-world.js";
import { TYPES } from "../src/model/component-catalog.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";

const environment = createTestingPlaygroundEnvironment(),
  dt = 1 / 120;

function createScenario({ x, y, z, orientation = [0, 0, 0, 1] }) {
  const physics = createWorkshopPhysicsWorld({
      surfaceSampleAt: environment.surfaceSampleAt,
      footprint: environment.testSite.footprint,
    }),
    runtime = new MultibodyRuntime({
      world: physics.world,
      worldAdapter: physics.worldAdapter,
      material: physics.debrisMaterial,
      materialForKey: physics.materialForKey,
      catalog: TYPES,
      groundBody: physics.groundBody,
      fieldBody: physics.fieldBody,
      surfaceHeightAt: environment.surfaceHeightAt,
      terrainHeightAt: environment.terrainHeightAt,
      pondAt: environment.pondAt,
    });
  runtime.start(
    JSON.stringify({
      revision: 1,
      parts: [
        {
          id: 1,
          type: "beam",
          pos: [x, y, z],
          orientation,
          scale: { x: 1, y: 1, z: 1 },
          config: { linearDamping: 0.01, angularDamping: 0.04 },
        },
      ],
      connections: [],
    }),
  );
  physics.worldAdapter.beginSession();
  return { physics, runtime, body: runtime.bodyByPart.get(1) };
}

function fieldContact(scenario) {
  return scenario.physics.world.contacts.find(
    (contact) =>
      (contact.bi === scenario.body &&
        contact.bj === scenario.physics.fieldBody) ||
      (contact.bj === scenario.body &&
        contact.bi === scenario.physics.fieldBody),
  );
}

function step(scenario, ticks, apply = () => {}) {
  const samples = [];
  for (let tick = 0; tick < ticks; tick++) {
    const fluid = scenario.runtime.applyFluidForces();
    apply({ tick, fluid, body: scenario.body });
    scenario.physics.worldAdapter.integrate(dt);
    scenario.runtime.afterIntegration(dt);
    const contact = fieldContact(scenario);
    samples.push({
      x: scenario.body.position.x,
      y: scenario.body.position.y,
      z: scenario.body.position.z,
      speed: scenario.body.velocity.length(),
      verticalSpeed: scenario.body.velocity.y,
      inWater: fluid.inWater,
      waterDepth: fluid.waterDepth,
      bottomContact: Boolean(contact),
      materialKey: contact?.surfaceMaterialKey || null,
    });
    assert.ok(
      [
        scenario.body.position.x,
        scenario.body.position.y,
        scenario.body.position.z,
        scenario.body.velocity.x,
        scenario.body.velocity.y,
        scenario.body.velocity.z,
        scenario.body.quaternion.x,
        scenario.body.quaternion.y,
        scenario.body.quaternion.z,
        scenario.body.quaternion.w,
      ].every(Number.isFinite),
      "multimodal fixture produced non-finite state",
    );
  }
  return samples;
}

function pose(scenario) {
  const { body } = scenario;
  return [
    body.position.x,
    body.position.y,
    body.position.z,
    body.velocity.x,
    body.velocity.y,
    body.velocity.z,
    body.quaternion.x,
    body.quaternion.y,
    body.quaternion.z,
    body.quaternion.w,
    body.angularVelocity.x,
    body.angularVelocity.y,
    body.angularVelocity.z,
  ];
}

function dispose(scenario) {
  scenario.runtime.dispose();
  assert.equal(scenario.physics.world.bodies.length, 2);
}

const runwayY = environment.terrainHeightAt(192, -100),
  runway = createScenario({ x: 192, y: runwayY + 0.6, z: -100 });
step(runway, 90);
assert.equal(fieldContact(runway)?.surfaceMaterialKey, "dry-asphalt");
runway.body.velocity.z = 5;
const takeoff = step(runway, 240, ({ body }) =>
  body.applyForce(new CANNON.Vec3(0, body.mass * 14, 0)),
);
assert.ok(
  takeoff.at(-1).y > runwayY + 5,
  `physical takeoff gained only ${takeoff.at(-1).y - runwayY} m`,
);
const touchdown = step(runway, 720),
  touchdownSample = touchdown.find(
    (sample) => sample.bottomContact && sample.materialKey === "dry-asphalt",
  );
assert.ok(touchdownSample, "airborne fixture did not touch down on the runway");
assert.ok(
  touchdown.at(-1).z > -100,
  "runway touchdown did not continue into a physical rollout",
);
dispose(runway);

const helipadY = environment.terrainHeightAt(104, -43),
  hold = createScenario({ x: 104, y: helipadY + 6, z: -43 }),
  holdWorldCheckpoint = hold.physics.worldAdapter.exportState(),
  holdRuntimeCheckpoint = hold.runtime.exportState(),
  holdStartY = hold.body.position.y;
step(hold, 600, ({ body }) =>
  body.applyForce(new CANNON.Vec3(0, body.mass * 9.80665, 0)),
);
const firstHold = pose(hold);
assert.ok(
  Math.abs(hold.body.position.y - holdStartY) < 0.05,
  `rotorcraft hold drifted ${hold.body.position.y - holdStartY} m`,
);
hold.physics.worldAdapter.importState(holdWorldCheckpoint);
hold.runtime.importState(holdRuntimeCheckpoint);
step(hold, 600, ({ body }) =>
  body.applyForce(new CANNON.Vec3(0, body.mass * 9.80665, 0)),
);
assert.ok(
  pose(hold).every((value, index) => Math.abs(value - firstHold[index]) < 1e-9),
  "rotorcraft hold diverged after exact checkpoint replay",
);
dispose(hold);

const deep = environment.pondAt(-140, -125),
  floating = createScenario({
    x: -140,
    y: deep.waterY + 0.05,
    z: -125,
  }),
  floatingSamples = step(floating, 1_200),
  floatingTail = floatingSamples.slice(-120),
  maximumTailHeaveMps = Math.max(
    ...floatingTail.map(({ verticalSpeed }) => Math.abs(verticalSpeed)),
  );
assert.ok(
  floatingSamples.filter((sample) => sample.inWater).length > 600,
  "floating fixture did not sustain repeated buoyant support",
);
assert.ok(
  floatingSamples.every((sample) => sample.y > deep.waterY - deep.depth + 0.2),
  "floating fixture bottomed in the deep pool",
);
assert.ok(
  maximumTailHeaveMps < 0.5,
  `floating fixture did not settle to a bounded heave (${maximumTailHeaveMps} m/s)`,
);
dispose(floating);

const shallow = environment.pondAt(-181, -94),
  ford = createScenario({
    x: -181,
    y: shallow.waterY - shallow.depth + 0.3,
    z: -94,
  });
ford.body.velocity.x = 2;
const fordSamples = step(ford, 720, ({ body }) => {
  body.applyForce(new CANNON.Vec3(body.mass * 35, -3_200, 0));
});
assert.ok(
  fordSamples.some((sample) => sample.inWater && sample.bottomContact),
  "ford fixture never waded with physical bed contact",
);
dispose(ford);

const waterExit = createScenario({
  x: -181,
  y: shallow.waterY,
  z: -94,
});
waterExit.body.velocity.x = 5;
const exitSamples = step(waterExit, 720, ({ body }) => {
  body.applyForce(new CANNON.Vec3(body.mass * 20, 0, 0));
});
assert.ok(
  exitSamples.some((sample) => !sample.inWater && sample.x > -165),
  `ford fixture did not make a deterministic water exit: ${JSON.stringify(exitSamples.at(-1))}`,
);
dispose(waterExit);

const bottoming = createScenario({
    x: -140,
    y: deep.waterY - 0.2,
    z: -125,
  }),
  bottomingSamples = step(bottoming, 600, ({ body }) =>
    body.applyForce(new CANNON.Vec3(0, -3_200, 0)),
  );
assert.ok(
  bottomingSamples.some(
    (sample) =>
      sample.inWater &&
      sample.bottomContact &&
      sample.materialKey === "saturated-mud",
  ),
  "deep-pool ballast fixture did not bottom on the canonical bed",
);
dispose(bottoming);

function rolloverJourney() {
  const scenario = createScenario({ x: -140, y: deep.waterY, z: -125 });
  scenario.body.angularVelocity.z = 2.4;
  step(scenario, 600);
  const result = pose(scenario);
  dispose(scenario);
  return result;
}
const firstRollover = rolloverJourney(),
  secondRollover = rolloverJourney();
assert.ok(
  firstRollover.every(
    (value, index) => Math.abs(value - secondRollover[index]) < 1e-9,
  ),
  "floating rollover fixture was not deterministic",
);
assert.ok(
  Math.hypot(firstRollover[6], firstRollover[7], firstRollover[8]) > 0.2,
  "rollover fixture did not produce a physical attitude change",
);

console.log(
  "test-site multimodal physics passed (takeoff, touchdown/rollout, rotor hold, float, wade, bottom, exit, rollover)",
);
