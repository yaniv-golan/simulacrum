import * as CANNON from "cannon-es";
import { assert } from "./lib/assert.mjs";
import { createTestingPlaygroundEnvironment } from "../src/application/testing-playground-environment.js";
import { createWorkshopPhysicsWorld } from "../src/application/workshop-physics-world.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { TYPES } from "../src/model/component-catalog.js";
import { TestCourseRun } from "../src/model/test-course-evaluator.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";

const environment = createTestingPlaygroundEnvironment(),
  dt = 1 / 120,
  cart = decodeBlueprintOrThrow(builtInDemo("cart").blueprint).assembly,
  humanoid = decodeBlueprintOrThrow(builtInDemo("humanoid").blueprint).assembly,
  drone = decodeBlueprintOrThrow(builtInDemo("drone").blueprint).assembly,
  singleBeam = {
    revision: 1,
    parts: [
      {
        id: 1,
        type: "beam",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
        config: { linearDamping: 0.2, angularDamping: 0.2 },
      },
    ],
    connections: [],
  };

function transformAssembly(source, { x, y, z, yawRad = Math.PI / 2 }) {
  const snapshot = structuredClone(source),
    centerX =
      snapshot.parts.reduce((sum, part) => sum + part.pos[0], 0) /
      snapshot.parts.length,
    centerZ =
      snapshot.parts.reduce((sum, part) => sum + part.pos[2], 0) /
      snapshot.parts.length,
    minimumY = Math.min(...snapshot.parts.map((part) => part.pos[1])),
    yaw = new CANNON.Quaternion();
  yaw.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), yawRad);
  for (const part of snapshot.parts) {
    const relative = new CANNON.Vec3(
        part.pos[0] - centerX,
        0,
        part.pos[2] - centerZ,
      ),
      rotated = yaw.vmult(relative),
      orientation = new CANNON.Quaternion(...part.orientation),
      worldOrientation = yaw.mult(orientation);
    part.pos = [x + rotated.x, y + part.pos[1] - minimumY, z + rotated.z];
    part.orientation = [
      worldOrientation.x,
      worldOrientation.y,
      worldOrientation.z,
      worldOrientation.w,
    ];
  }
  return snapshot;
}

function createScenario(source, start) {
  const physics = createWorkshopPhysicsWorld({
      surfaceSampleAt: environment.surfaceSampleAt,
      footprint: environment.testSite.footprint,
    }),
    assembly = transformAssembly(source, start),
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
  runtime.start(JSON.stringify(assembly));
  return { physics, runtime, partIds: assembly.parts.map(({ id }) => id) };
}

function componentState(scenario) {
  const bodies = [...scenario.runtime.bodyByPart.values()],
    mass = bodies.reduce((sum, body) => sum + body.mass, 0),
    position = {
      x:
        bodies.reduce((sum, body) => sum + body.position.x * body.mass, 0) /
        mass,
      y:
        bodies.reduce((sum, body) => sum + body.position.y * body.mass, 0) /
        mass,
      z:
        bodies.reduce((sum, body) => sum + body.position.z * body.mass, 0) /
        mass,
    };
  const velocity = {
      x:
        bodies.reduce((sum, body) => sum + body.velocity.x * body.mass, 0) /
        mass,
      y:
        bodies.reduce((sum, body) => sum + body.velocity.y * body.mass, 0) /
        mass,
      z:
        bodies.reduce((sum, body) => sum + body.velocity.z * body.mass, 0) /
        mass,
    },
    bodySet = new Set(bodies),
    grounded = scenario.physics.world.contacts.some(
      (contact) =>
        (bodySet.has(contact.bi) &&
          [scenario.physics.fieldBody, scenario.physics.groundBody].includes(
            contact.bj,
          )) ||
        (bodySet.has(contact.bj) &&
          [scenario.physics.fieldBody, scenario.physics.groundBody].includes(
            contact.bi,
          )),
    ),
    surface = environment.surfaceSampleAt(position.x, position.z),
    fluid = environment.pondAt(position.x, position.z);
  return {
    position,
    velocity,
    grounded,
    speedMps: Math.hypot(velocity.x, velocity.y, velocity.z),
    materialKey: surface?.materialKey || null,
    districtId: surface?.districtId || null,
    fluidId: fluid?.id || null,
  };
}

function telemetryFrame(scenario, tick) {
  const component = componentState(scenario);
  return {
    tick,
    systems: {
      structures: { failedCount: 0, detachedPartIds: [] },
      testSite: {
        siteId: environment.testSite.id,
        components: [
          {
            componentId: "physical-solution",
            partIds: scenario.partIds,
            ...component,
          },
        ],
      },
    },
  };
}

function forceTowardVelocity(
  body,
  targetVelocity,
  accelerationLimit = 24,
  axis = "x",
) {
  const acceleration = Math.max(
    -accelerationLimit,
    Math.min(accelerationLimit, (targetVelocity - body.velocity[axis]) * 6),
  );
  body.applyForce(
    new CANNON.Vec3(
      axis === "x" ? body.mass * acceleration : 0,
      0,
      axis === "z" ? body.mass * acceleration : 0,
    ),
  );
}

function stepScenario(scenario, applyForces = () => {}) {
  scenario.runtime.applyFluidForces();
  applyForces();
  scenario.physics.worldAdapter.integrate(dt);
  scenario.runtime.afterIntegration(dt);
  for (const body of scenario.runtime.bodyByPart.values())
    assert.ok(
      [
        body.position.x,
        body.position.y,
        body.position.z,
        body.velocity.x,
        body.velocity.y,
        body.velocity.z,
      ].every(Number.isFinite),
    );
}

function finishScenario(scenario, label) {
  scenario.runtime.dispose();
  assert.equal(
    scenario.physics.world.bodies.length,
    2,
    `${label} leaked physical bodies`,
  );
}

function straightGroundJourney({ label, source, routeId, start, stop, axis }) {
  const groundY = environment.terrainHeightAt(start.x, start.z),
    scenario = createScenario(source, {
      x: start.x,
      y: groundY + 1,
      z: start.z,
      yawRad: axis === "z" ? 0 : Math.PI / 2,
    });
  for (let tick = 0; tick < 45; tick++) stepScenario(scenario);
  const run = new TestCourseRun({
    testSite: environment.testSite,
    routeId,
    targetPartId: scenario.partIds[0],
  });
  let result = run.step(telemetryFrame(scenario, 1));
  for (let tick = 2; tick <= 2_000 && result.status === "running"; tick++) {
    const position = componentState(scenario).position,
      stopping = position[axis] >= stop;
    stepScenario(scenario, () => {
      for (const body of scenario.runtime.bodyByPart.values()) {
        if (stopping) {
          body.velocity.x = 0;
          body.velocity.z = 0;
          body.angularVelocity.set(0, 0, 0);
        } else forceTowardVelocity(body, 12, 24, axis);
      }
    });
    result = run.step(telemetryFrame(scenario, tick));
  }
  assert.equal(
    result.status,
    "complete",
    `${label}: ${result.failureReason}; final=${JSON.stringify(componentState(scenario))}`,
  );
  finishScenario(scenario, label);
  return result;
}

const wheeled = straightGroundJourney({
    label: "wheeled cart",
    source: cart,
    routeId: "suspension-shakedown",
    start: { x: -175, z: -80 },
    stop: 27,
    axis: "z",
  }),
  articulated = straightGroundJourney({
    label: "articulated humanoid",
    source: humanoid,
    routeId: "suspension-shakedown",
    start: { x: -175, z: -80 },
    stop: 27,
    axis: "z",
  });

const fordY = environment.terrainHeightAt(-205, -94),
  amphibiousScenario = createScenario(singleBeam, {
    x: -205,
    y: fordY + 1.2,
    z: -94,
    yawRad: 0,
  });
for (const body of amphibiousScenario.runtime.bodyByPart.values())
  body.velocity.x = 6;
const amphibiousRun = new TestCourseRun({
  testSite: environment.testSite,
  routeId: "ford-crossing",
  targetPartId: 1,
});
let amphibious = amphibiousRun.step(telemetryFrame(amphibiousScenario, 1));
for (let tick = 2; tick <= 2_000 && amphibious.status === "running"; tick++) {
  const state = componentState(amphibiousScenario),
    stopping = state.position.x >= -163;
  stepScenario(amphibiousScenario, () => {
    for (const body of amphibiousScenario.runtime.bodyByPart.values()) {
      if (stopping) {
        body.velocity.x = 0;
        body.velocity.z = 0;
        body.angularVelocity.set(0, 0, 0);
      } else {
        body.velocity.x = 8;
        body.velocity.z = 0;
      }
    }
  });
  amphibious = amphibiousRun.step(telemetryFrame(amphibiousScenario, tick));
}
assert.equal(
  amphibious.status,
  "complete",
  `amphibious ford: ${JSON.stringify({ result: amphibious, state: componentState(amphibiousScenario) })}`,
);
finishScenario(amphibiousScenario, "amphibious ford");

const helipadY = environment.terrainHeightAt(104, -43),
  flyingScenario = createScenario(drone, {
    x: 104,
    y: helipadY + 5,
    z: -90,
    yawRad: 0,
  }),
  flyingRun = new TestCourseRun({
    testSite: environment.testSite,
    routeId: "helipad-precision",
    targetPartId: flyingScenario.partIds[0],
  });
let flying = flyingRun.step(telemetryFrame(flyingScenario, 1));
for (let tick = 2; tick <= 10_000 && flying.status === "running"; tick++) {
  const state = componentState(flyingScenario),
    landing = state.position.z >= -72,
    stopping = state.position.z >= -43 && state.grounded,
    targetY = landing ? helipadY - 0.05 : helipadY + 5;
  stepScenario(flyingScenario, () => {
    for (const body of flyingScenario.runtime.bodyByPart.values()) {
      const verticalAcceleration = Math.max(
          -12,
          Math.min(
            12,
            9.80665 + (targetY - body.position.y) * 5 - body.velocity.y * 3,
          ),
        ),
        lateralAcceleration = Math.max(
          -10,
          Math.min(10, (104 - body.position.x) * 4 - body.velocity.x * 3),
        );
      body.applyForce(
        new CANNON.Vec3(
          body.mass * lateralAcceleration,
          body.mass * verticalAcceleration,
          0,
        ),
      );
      if (stopping) {
        body.velocity.x = 0;
        body.velocity.z = 0;
        body.angularVelocity.set(0, 0, 0);
      } else if (landing) {
        body.velocity.z = 0.35;
        if (!state.grounded) body.velocity.y = -0.6;
      } else forceTowardVelocity(body, 6, 12, "z");
    }
  });
  flying = flyingRun.step(telemetryFrame(flyingScenario, tick));
}
assert.equal(
  flying.status,
  "complete",
  `flying helipad: ${JSON.stringify({ result: flying, state: componentState(flyingScenario) })}`,
);
finishScenario(flyingScenario, "flying helipad");

assert.deepEqual(
  [wheeled, articulated, amphibious, flying].map(({ status }) => status),
  ["complete", "complete", "complete", "complete"],
);
console.log(
  "test-site solution journeys passed (wheeled, articulated, flying, amphibious; one type-independent evaluator)",
);
