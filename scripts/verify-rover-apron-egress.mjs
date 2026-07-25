import { assert } from "./lib/assert.mjs";
import { fixtureMobilityTelemetry } from "./lib/mobility-fixture.mjs";
import { createTestSiteFixtureBodies } from "../src/application/test-site-fixture-feature.js";
import { createTestingPlaygroundEnvironment } from "../src/application/testing-playground-environment.js";
import { createWorkshopPhysicsWorld } from "../src/application/workshop-physics-world.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { TYPES } from "../src/model/component-catalog.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { CommandBus } from "../src/simulation/command-bus.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { PowerNetwork } from "../src/simulation/power-network.js";
import { RunAssemblyGraph } from "../src/simulation/run-assembly-graph.js";

const environment = createTestingPlaygroundEnvironment(),
  source = decodeBlueprintOrThrow(builtInDemo("cart").blueprint).assembly,
  dt = 1 / 120,
  maximumTicks = 2_400,
  fieldEntryZ = -48,
  verificationTicksAfterFieldEntry = 240;

function scenario(throttle) {
  const assembly = structuredClone(source);
  for (const part of assembly.parts) part.pos[2] -= 16;
  const physics = createWorkshopPhysicsWorld({
      surfaceSampleAt: environment.surfaceSampleAt,
      footprint: environment.testSite.footprint,
    }),
    runGraph = new RunAssemblyGraph(assembly),
    powerNetwork = new PowerNetwork(TYPES),
    commandBus = new CommandBus(),
    runtime = new MultibodyRuntime({
      world: physics.world,
      worldAdapter: physics.worldAdapter,
      material: physics.debrisMaterial,
      catalog: TYPES,
      groundBody: physics.groundBody,
      fieldBody: physics.fieldBody,
      surfaceHeightAt: environment.surfaceHeightAt,
      terrainHeightAt: environment.terrainHeightAt,
      pondAt: environment.pondAt,
    }),
    context = { runGraph, powerNetwork, commandBus, services: {} },
    motorIds = assembly.parts
      .filter((part) => part.type === "motor")
      .map((part) => part.id),
    steeringHingeIds = assembly.parts
      .filter((part) => part.type === "hinge")
      .map((part) => part.id),
    partIds = assembly.parts.map((part) => part.id),
    chassisId = assembly.parts.find((part) => part.type === "plate").id,
    rollingContacts = () =>
      runtime.constraintEntries.filter(
        (entry) => entry.kind === "rolling-contact-v1",
      );
  for (const body of createTestSiteFixtureBodies({
    fixtures: environment.testSite.staticFixtures.filter(({ id }) =>
      id.startsWith("workshop-apron-ramp-"),
    ),
    terrainHeightAt: environment.terrainHeightAt,
    groundMaterial: physics.groundMaterial,
  }))
    physics.world.addBody(body);

  runtime.start(assembly);
  let fieldEntryTick = null,
    currentAirborneTicks = 0,
    maximumAirborneTicks = 0,
    minimumRampWheelContacts = 4,
    allMotorsActive = true,
    completedTick = maximumTicks;
  for (let tick = 1; tick <= maximumTicks; tick++) {
    commandBus.clearTick();
    for (const motorId of motorIds)
      commandBus.writeRemote(motorId, "throttle", throttle);
    for (const hingeId of steeringHingeIds)
      commandBus.writeRemote(hingeId, "joint_target", 0);
    powerNetwork.resolve(runGraph, dt);
    runtime.stepActuators(context, dt);
    physics.worldAdapter.integrate(dt, { tick });
    runtime.afterIntegration(dt);

    const position = runtime.bodyByPart.get(chassisId).position,
      wheelContacts = rollingContacts().filter(
        ({ constraint }) => constraint.state.touching,
      ).length;
    allMotorsActive &&= motorIds.every(
      (motorId) =>
        runtime.constraintEntries.find(
          (entry) => entry.descriptor.motorId === motorId,
        )?.constraint.motorEquation.enabled,
    );
    if (position.z <= -18 && position.z >= fieldEntryZ) {
      minimumRampWheelContacts = Math.min(
        minimumRampWheelContacts,
        wheelContacts,
      );
      currentAirborneTicks = wheelContacts ? 0 : currentAirborneTicks + 1;
      maximumAirborneTicks = Math.max(
        maximumAirborneTicks,
        currentAirborneTicks,
      );
    }
    if (
      fieldEntryTick == null &&
      position.z <= fieldEntryZ &&
      rollingContacts().some(
        ({ constraint }) => constraint.state.supportMaterialKeys.length,
      )
    )
      fieldEntryTick = tick;
    if (
      fieldEntryTick != null &&
      tick >= fieldEntryTick + verificationTicksAfterFieldEntry
    ) {
      completedTick = tick;
      break;
    }
  }

  const mobility = fixtureMobilityTelemetry(runtime, {
      context,
      dt,
      partIds,
    }),
    result = {
      throttle,
      completedAtS: completedTick * dt,
      fieldEntryAtS: fieldEntryTick == null ? null : fieldEntryTick * dt,
      finalPosition: { ...runtime.bodyByPart.get(chassisId).position },
      finalSpeedMPerS: mobility.signedSpeed,
      finalWheelContacts: mobility.wheelStates.filter(
        ({ touching }) => touching,
      ).length,
      minimumRampWheelContacts,
      maximumAirborneS: maximumAirborneTicks * dt,
      allMotorsActive,
    };
  runtime.dispose();
  return result;
}

const results = [0.25, 1].map(scenario);
console.log(JSON.stringify(results, null, 2));
for (const result of results) {
  assert.ok(
    result.fieldEntryAtS != null,
    `${result.throttle} throttle rover did not reach the Test Reserve field`,
  );
  assert.ok(
    result.finalPosition.z < fieldEntryZ - 1,
    `${result.throttle} throttle rover stopped at the apron-field seam`,
  );
  assert.ok(
    result.finalSpeedMPerS > 0.5,
    `${result.throttle} throttle rover locked after reaching the heightfield`,
  );
  assert.ok(
    Math.abs(result.finalPosition.x) < 2,
    `${result.throttle} throttle rover did not hold a straight egress path`,
  );
  assert.ok(
    result.maximumAirborneS <= 0.25,
    `${result.throttle} throttle rover stayed airborne for ${result.maximumAirborneS.toFixed(2)} s`,
  );
  assert.ok(
    result.allMotorsActive,
    `${result.throttle} throttle did not keep all four drive motors active`,
  );
}
console.log("rover apron egress passed at slow and fast throttle");
