import * as CANNON from "cannon-es";
import { assert } from "./lib/assert.mjs";
import { createTestingPlaygroundEnvironment } from "../src/application/testing-playground-environment.js";
import { createWorkshopPhysicsWorld } from "../src/application/workshop-physics-world.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { TYPES } from "../src/model/component-catalog.js";
import { ReplayBuffer } from "../src/model/failure-analysis.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";

const environment = createTestingPlaygroundEnvironment(),
  laneRegions = environment.testSite.surfaceRegions
    .filter(({ id }) => id.startsWith("lane-"))
    .map((region) => ({
      materialKey: region.materialKey,
      x: region.shape.centerM[0] - region.shape.sizeM[0] * 0.36,
      z: region.shape.centerM[1],
    })),
  cart = decodeBlueprintOrThrow(builtInDemo("cart").blueprint).assembly,
  humanoid = decodeBlueprintOrThrow(builtInDemo("humanoid").blueprint).assembly,
  legQuaternion = new CANNON.Quaternion();
legQuaternion.setFromEuler(0, 0, Math.PI / 2);

const passiveLeg = {
    revision: 1,
    parts: [
      {
        id: 1,
        type: "beam",
        pos: [0, 0, 0],
        orientation: [
          legQuaternion.x,
          legQuaternion.y,
          legQuaternion.z,
          legQuaternion.w,
        ],
        scale: { x: 1, y: 1, z: 1 },
        config: {},
      },
    ],
    connections: [],
  },
  slidingBlock = {
    revision: 1,
    parts: [
      {
        id: 1,
        type: "beam",
        pos: [0, 0, 0],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
        config: {},
      },
    ],
    connections: [],
  },
  archetypes = [
    ["rover", cart],
    ["walker", humanoid],
    ["passive-leg", passiveLeg],
    ["sliding-block", slidingBlock],
  ],
  softMaterials = new Set([
    "short-grass",
    "compacted-soil",
    "loose-gravel",
    "dry-sand",
    "saturated-mud",
  ]);

function transformAssembly(source, target) {
  const snapshot = structuredClone(source),
    centerX =
      snapshot.parts.reduce((sum, part) => sum + part.pos[0], 0) /
      snapshot.parts.length,
    centerZ =
      snapshot.parts.reduce((sum, part) => sum + part.pos[2], 0) /
      snapshot.parts.length,
    minimumY = Math.min(...snapshot.parts.map((part) => part.pos[1])),
    yaw = new CANNON.Quaternion();
  yaw.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2);
  for (const part of snapshot.parts) {
    const relative = new CANNON.Vec3(
        part.pos[0] - centerX,
        0,
        part.pos[2] - centerZ,
      ),
      rotated = yaw.vmult(relative),
      orientation = new CANNON.Quaternion(...part.orientation),
      worldOrientation = yaw.mult(orientation);
    part.pos = [
      target.x + rotated.x,
      target.y + part.pos[1] - minimumY,
      target.z + rotated.z,
    ];
    part.orientation = [
      worldOrientation.x,
      worldOrientation.y,
      worldOrientation.z,
      worldOrientation.w,
    ];
  }
  return snapshot;
}

function createScenario(source, lane, name) {
  const physics = createWorkshopPhysicsWorld({
      surfaceSampleAt: environment.surfaceSampleAt,
      footprint: environment.testSite.footprint,
    }),
    assembly = transformAssembly(source, {
      x: lane.x,
      y: environment.terrainHeightAt(lane.x, lane.z) + 1,
      z: lane.z,
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
  runtime.start(JSON.stringify(assembly));
  physics.worldAdapter.beginSession();
  for (const [partId, body] of runtime.bodyByPart) {
    const descriptor = runtime.compiled.bodies.find(
      (candidate) => candidate.partId === partId,
    );
    assert.deepEqual(
      body.shapes.map((shape) => shape.material?.name),
      descriptor.geometry.collisionPrimitives.map(
        (primitive) => primitive.materialKey,
      ),
      `${name} did not project canonical primitive material identity`,
    );
  }
  for (const body of runtime.bodyByPart.values())
    body.userData.testArchetype = name;
  return { physics, runtime };
}

function bodyCenter(runtime) {
  const bodies = [...runtime.bodyByPart.values()],
    mass = bodies.reduce((sum, body) => sum + body.mass, 0);
  return {
    x:
      bodies.reduce((sum, body) => sum + body.position.x * body.mass, 0) / mass,
    y:
      bodies.reduce((sum, body) => sum + body.position.y * body.mass, 0) / mass,
    z:
      bodies.reduce((sum, body) => sum + body.position.z * body.mass, 0) / mass,
  };
}

function stepScenario(
  scenario,
  ticks,
  contactMaterials,
  horizontalAccelerationMps2 = 0,
) {
  for (let tick = 0; tick < ticks; tick++) {
    if (horizontalAccelerationMps2)
      for (const body of scenario.runtime.bodyByPart.values())
        body.applyForce(
          new CANNON.Vec3(body.mass * horizontalAccelerationMps2, 0, 0),
        );
    scenario.physics.worldAdapter.integrate(1 / 120);
    scenario.runtime.afterIntegration(1 / 120);
    for (const contact of scenario.physics.world.contacts) {
      const participant =
        scenario.runtime.bodyByPart.has(contact.bi.userData?.partId) ||
        scenario.runtime.bodyByPart.has(contact.bj.userData?.partId);
      if (!participant) continue;
      if (contact.surfaceMaterialKey)
        contactMaterials.add(contact.surfaceMaterialKey);
    }
    for (const body of scenario.runtime.bodyByPart.values())
      assert.ok(
        [
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
        ].every(Number.isFinite),
        `${body.userData.testArchetype} produced non-finite state`,
      );
  }
}

function poseVector(runtime) {
  return [...runtime.bodyByPart]
    .sort(([left], [right]) => left - right)
    .flatMap(([, body]) => [
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
    ]);
}

for (const [name, source] of archetypes)
  for (const lane of laneRegions) {
    const scenario = createScenario(source, lane, name),
      contactMaterials = new Set();
    stepScenario(scenario, 45, contactMaterials);
    const start = bodyCenter(scenario.runtime);
    for (const body of scenario.runtime.bodyByPart.values()) {
      body.velocity.x = 10;
      body.wakeUp();
    }
    stepScenario(scenario, 240, contactMaterials, 12);
    const finish = bodyCenter(scenario.runtime);
    assert.ok(
      finish.x - start.x > 1.5,
      `${name} snagged on ${lane.materialKey} after ${finish.x - start.x} m: ${JSON.stringify({ start, finish, pose: poseVector(scenario.runtime) })}`,
    );
    assert.ok(
      contactMaterials.has(lane.materialKey),
      `${name} did not resolve ${lane.materialKey} from the contacted shape: ${JSON.stringify({ contacts: [...contactMaterials], start, finish })}`,
    );

    if (name === "sliding-block" && softMaterials.has(lane.materialKey)) {
      const worldCheckpoint = scenario.physics.worldAdapter.exportState(),
        runtimeCheckpoint = scenario.runtime.exportState();
      stepScenario(scenario, 60, contactMaterials);
      const firstReplay = poseVector(scenario.runtime);
      scenario.physics.worldAdapter.importState(worldCheckpoint);
      scenario.runtime.importState(runtimeCheckpoint);
      stepScenario(scenario, 60, contactMaterials);
      const secondReplay = poseVector(scenario.runtime);
      assert.equal(firstReplay.length, secondReplay.length);
      assert.ok(
        firstReplay.every(
          (value, index) => Math.abs(value - secondReplay[index]) < 1e-8,
        ),
        `${lane.materialKey} support diverged after checkpoint replay`,
      );
    }
    scenario.runtime.dispose();
    assert.equal(
      scenario.physics.world.bodies.length,
      2,
      `${name}/${lane.materialKey} teardown leaked bodies`,
    );
  }

assert.deepEqual(laneRegions.map(({ materialKey }) => materialKey).sort(), [
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

const replay = new ReplayBuffer({ seconds: 1, sampleHz: 120 }),
  canonicalSurfaceTelemetry = {
    time: 1,
    systems: {
      testSite: {
        components: [
          {
            partId: 1,
            districtId: "surface-lanes",
            materialKey: "saturated-mud",
            supportMaterialKeys: ["saturated-mud"],
            supportShapeIds: ["test-site-heightfield"],
          },
        ],
      },
    },
  };
assert.equal(replay.record(canonicalSurfaceTelemetry, { force: true }), true);
const replayedSurface = replay.frame(0);
assert.equal(
  replayedSurface.telemetry.systems.testSite.components[0].materialKey,
  "saturated-mud",
);
assert.deepEqual(
  replayedSurface.telemetry.systems.testSite.components[0].supportMaterialKeys,
  ["saturated-mud"],
);
replayedSurface.telemetry.systems.testSite.components[0].materialKey =
  "tampered";
assert.equal(
  replay.frame(0).telemetry.systems.testSite.components[0].materialKey,
  "saturated-mud",
  "replay access mutated the recorded canonical material label",
);
console.log(
  `test-site contact archetypes passed (${archetypes.length} physical archetypes × ${laneRegions.length} released surfaces; canonical replay labels preserved)`,
);
