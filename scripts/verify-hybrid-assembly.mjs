import { builtInDemo } from "../src/model/demo-blueprints.js";
import { DRONE_TS_SOURCE } from "../src/application/content.js";
import { componentDefaults } from "../src/model/component-resolver.js";
import { createSharePackage } from "../src/model/share-packages.js";
import { TYPES } from "../src/model/component-catalog.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { posePartForPortMatch } from "../src/model/component-geometry-contract.js";
import {
  completeConnectionContract,
  CONNECTION_CAPACITIES,
} from "../src/model/connection-contracts.js";
import { validatePortConnection } from "../src/model/ports.js";
import { quaternionFromEulerXYZ } from "../src/model/primitives.js";
import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

function addPart(blueprint, type, pos, options = {}) {
  const mechanism = TYPES[type]?.mechanism
    ? structuredClone(mechanismComponentDefinition(type))
    : null;
  const part = {
    id: Math.max(0, ...blueprint.parts.map((candidate) => candidate.id)) + 1,
    type,
    pos,
    orientation: quaternionFromEulerXYZ(options.eulerRotation || [0, 0, 0]),
    scale: options.scale || { x: 1, y: 1, z: 1 },
    ...(mechanism
      ? { mechanism }
      : { config: { ...componentDefaults(type), ...(options.config || {}) } }),
  };
  blueprint.parts.push(part);
  return part;
}

function connect(blueprint, a, b, kind, portA, portB, capacity = null) {
  let connection = {
    id: `hybrid-${blueprint.connections.length + 1}`,
    a: a.id,
    b: b.id,
    kind,
    portA,
    portB,
  };
  connection = completeConnectionContract(connection, a, b, { capacity });
  validatePortConnection(
    a,
    portA,
    b,
    portB,
    blueprint.connections,
    TYPES,
    connection,
  );
  blueprint.connections.push(connection);
}

function wheeledRocket() {
  const { blueprint } = builtInDemo("cart"),
    chassis = blueprint.parts.find((part) => part.type === "plate"),
    controller = blueprint.parts.find((part) => part.type === "computer"),
    thruster = addPart(blueprint, "rocket", [0, 0, 0], {
      scale: { x: 0.5, y: 1, z: 0.5 },
    }),
    tankSupport = addPart(blueprint, "beam", [1, 0, 1], {
      eulerRotation: [0, 0, Math.PI / 2],
      scale: { x: 0.4, y: 1, z: 1 },
    }),
    tank = addPart(blueprint, "propellanttank", [0, 0, 0], {
      config: { capacityKg: 50, initialUsableMassKg: 50 },
      eulerRotation: [Math.PI, 0, 0],
    });
  const thrusterPose = posePartForPortMatch({
      movingPart: thruster,
      movingPortId: "MOUNT",
      targetPart: chassis,
      targetPortId: "BOTTOM",
    }),
    supportPose = posePartForPortMatch({
      movingPart: tankSupport,
      movingPortId: "A",
      targetPart: chassis,
      targetPortId: "TOP",
    });
  thruster.pos = [...thrusterPose.positionM];
  tankSupport.pos = [1, supportPose.positionM[1], 1];
  const tankPose = posePartForPortMatch({
    movingPart: tank,
    movingPortId: "MOUNT",
    targetPart: tankSupport,
    targetPortId: "B",
  });
  tank.pos = [...tankPose.positionM];
  blueprint.name = "Hybrid wheeled flight test";
  connect(
    blueprint,
    chassis,
    thruster,
    "mechanical",
    "BOTTOM",
    "MOUNT",
    CONNECTION_CAPACITIES.reinforced,
  );
  connect(blueprint, controller, thruster, "signal", "OUT", "SIGNAL");
  connect(
    blueprint,
    chassis,
    tankSupport,
    "mechanical",
    "TOP",
    "A",
    CONNECTION_CAPACITIES.reinforced,
  );
  connect(
    blueprint,
    tankSupport,
    tank,
    "mechanical",
    "B",
    "MOUNT",
    CONNECTION_CAPACITIES.reinforced,
  );
  connect(blueprint, tank, thruster, "resource", "OUTLET", "PROPELLANT");
  const profile = blueprint.remoteProfiles[blueprint.defaultRemoteProfile],
    driveControl = profile.controls.find(
      (control) => control.id === profile.actionBindings.forward.controlId,
    );
  assert.ok(driveControl, "hybrid cart has no semantic forward control");
  driveControl.defaultValue = 1;
  profile.controls.push({
    id: "cart-hybrid-thrust",
    label: "Rocket thrust",
    channel: "throttle",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.16,
    hotkey: null,
    targetId: thruster.id,
  });
  return blueprint;
}

function wheeledDrone() {
  const { blueprint } = builtInDemo("drone", {
      droneTypescript: DRONE_TS_SOURCE,
    }),
    deck = blueprint.parts.find((part) => part.type === "plate"),
    battery = blueprint.parts.find((part) => part.type === "battery"),
    controller = blueprint.parts.find((part) => part.type === "computer"),
    wheels = [
      [-1.32, 0.65, -0.78],
      [1.32, 0.65, -0.78],
      [-1.32, 0.65, 0.78],
      [1.32, 0.65, 0.78],
    ].map((position) => addPart(blueprint, "wheel", position)),
    motors = wheels.map((wheel) => {
      const motor = addPart(blueprint, "motor", [...wheel.pos], {
        config: { rpm: 120, power: 4 },
      });
      const pose = posePartForPortMatch({
        movingPart: motor,
        movingPortId: "SHAFT",
        targetPart: wheel,
        targetPortId: "AXLE",
      });
      motor.pos = [...pose.positionM];
      return motor;
    });
  blueprint.name = "Wheeled quad drone";
  for (let index = 0; index < wheels.length; index++) {
    const motor = motors[index],
      wheel = wheels[index];
    connect(blueprint, battery, motor, "power", "POWER", "POWER");
    connect(blueprint, controller, motor, "signal", "OUT", "CONTROL");
    connect(
      blueprint,
      deck,
      motor,
      "mechanical",
      "TOP",
      "MOUNT",
      CONNECTION_CAPACITIES.standard,
    );
    connect(
      blueprint,
      motor,
      wheel,
      "mechanical",
      "SHAFT",
      "AXLE",
      CONNECTION_CAPACITIES.standard,
    );
  }
  return blueprint;
}

function articulatedAircraft() {
  const { blueprint } = builtInDemo("humanoid"),
    pelvis = blueprint.parts.find((part) => part.rigRole === "pelvis"),
    controller = blueprint.parts.find((part) => part.type === "computer"),
    thruster = addPart(blueprint, "rocket", [0, 3.1, -0.65]),
    tank = addPart(blueprint, "propellanttank", [0, 3.1, 0.65], {
      config: { capacityKg: 10, initialUsableMassKg: 10 },
    }),
    fin = addPart(blueprint, "fin", [0, 3.6, -0.55]);
  blueprint.name = "Articulated aerodynamic machine";
  connect(
    blueprint,
    pelvis,
    thruster,
    "mechanical",
    "TOP",
    "MOUNT",
    CONNECTION_CAPACITIES.reinforced,
  );
  connect(
    blueprint,
    pelvis,
    fin,
    "mechanical",
    "TOP",
    "ROOT",
    CONNECTION_CAPACITIES.reinforced,
  );
  connect(blueprint, controller, thruster, "signal", "OUT", "SIGNAL");
  connect(
    blueprint,
    pelvis,
    tank,
    "mechanical",
    "TOP",
    "MOUNT",
    CONNECTION_CAPACITIES.reinforced,
  );
  connect(blueprint, tank, thruster, "resource", "OUTLET", "PROPELLANT");
  blueprint.remoteProfiles.humanoid.controls.push({
    id: "humanoid-hybrid-thrust",
    label: "Flight thrust",
    channel: "throttle",
    type: "range",
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.08,
    hotkey: null,
    targetId: thruster.id,
  });
  return blueprint;
}

const { browser, page, errors, baseUrl } = await createBrowserTest();
await page.goto(baseUrl, {
  waitUntil: "domcontentloaded",
});
await page.click("#sandbox-start");

async function importBlueprint(blueprint) {
  const running = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ).running;
  if (running) await page.click("#run-btn");
  const toolsHidden = await page
    .locator(".tools-menu")
    .evaluate((element) => element.classList.contains("hidden"));
  if (toolsHidden) await page.click("#tools-btn");
  await page.click("#blueprint-btn");
  const packageValue = await createSharePackage({
    kind: "blueprint",
    asset: blueprint,
    metadata: { title: blueprint.name },
  });
  await page.locator("#share-paste").fill(JSON.stringify(packageValue));
  await page.click("#import-shared-text");
  const card = page.locator(
    `.exchange-item[data-fingerprint="${packageValue.fingerprint}"]`,
  );
  await card.waitFor();
  await card.locator("[data-load-share]").click();
}

async function runScenario(blueprint, setup = null) {
  await importBlueprint(blueprint);
  await setup?.();
  await page.click("#run-btn");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running,
  );
  return page.evaluate(() => {
    const coexistenceSamples = [];
    let state = null;
    for (let index = 0; index < 12; index++) {
      window.advanceTime(100);
      state = JSON.parse(window.render_game_to_text());
      const engines =
        state.architecture.session?.systems.propulsion?.engines || [];
      coexistenceSamples.push({
        timeS: (index + 1) / 10,
        wheelContacts: state.demo.mobility?.physics?.wheelContacts || 0,
        normalLoadN: state.demo.mobility?.physics?.normalLoadN || 0,
        deliveredMassFlowKgS: engines.reduce(
          (sum, engine) => sum + Number(engine.deliveredMassFlowKgS || 0),
          0,
        ),
        thrustN: engines.reduce(
          (sum, engine) => sum + Number(engine.thrustN || 0),
          0,
        ),
      });
    }
    return { ...state, coexistenceSamples };
  });
}

const wheeledFlight = await runScenario(wheeledRocket()),
  droneWithWheels = await runScenario(wheeledDrone(), async () => {
    const remoteHidden = await page
      .locator(".remote-console")
      .evaluate((element) => element.classList.contains("hidden"));
    if (remoteHidden) await page.click("#remote-btn");
    await page.locator('.command-range[data-index="0"]').evaluate((input) => {
      input.value = "0.06";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }),
  articulatedWithAero = await runScenario(articulatedAircraft());

console.log(
  JSON.stringify(
    {
      wheeledFlight: {
        mobility:
          wheeledFlight.architecture.session?.systems.mobility?.assemblies
            ?.length > 0,
        flight: wheeledFlight.architecture.session?.systems.flight?.active,
        propulsion:
          wheeledFlight.architecture.session?.systems.propulsion?.engines,
        speed: wheeledFlight.demo.mobility?.signedSpeed,
        wheelContacts: wheeledFlight.demo.mobility?.physics?.wheelContacts,
        normalLoadN: wheeledFlight.demo.mobility?.physics?.normalLoadN,
        coexistenceSamples: wheeledFlight.coexistenceSamples,
      },
      droneWithWheels: {
        mobility:
          droneWithWheels.architecture.session?.systems.mobility?.assemblies
            ?.length > 0,
        flight: droneWithWheels.architecture.session?.systems.flight?.active,
        attitudeControl: droneWithWheels.demo.drone,
        controllerRuntimeCount:
          droneWithWheels.architecture.session?.systems.controllers?.runtimes
            ?.length,
        validSensorBindings: Object.values(
          droneWithWheels.architecture.session?.systems.sensors?.controllers ||
            {},
        ).flatMap((controller) =>
          (controller.__bindings || []).filter((binding) => binding.valid),
        ).length,
        failures: droneWithWheels.failureAnalysis?.report,
      },
      articulatedWithAero: {
        articulated:
          articulatedWithAero.architecture.session?.systems.articulated?.active,
        flight:
          articulatedWithAero.architecture.session?.systems.flight?.active,
        poseCount:
          articulatedWithAero.architecture.session?.systems.articulated?.poses
            ?.length,
        cd: articulatedWithAero.demo.missile?.cd,
      },
      errors,
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  assert.equal(
    wheeledFlight.architecture.session?.systems.mobility?.assemblies?.length >
      0,
    true,
    "wheeled-flight assembly lost wheel physics",
  );
  assert.equal(
    wheeledFlight.architecture.session?.systems.flight?.active,
    true,
    "wheeled-flight assembly lost flight physics",
  );
  assert.ok(
    wheeledFlight.coexistenceSamples.some(
      (sample) =>
        sample.wheelContacts > 0 &&
        sample.normalLoadN > 0 &&
        sample.deliveredMassFlowKgS > 0 &&
        sample.thrustN > 0,
    ),
    "wheeled-flight assembly never advanced wheel contact and finite-resource nozzle force in the same tick",
  );
  assert.ok(
    Math.abs(wheeledFlight.demo.mobility?.signedSpeed || 0) > 0.05,
    "wheeled-flight drivetrain did not advance",
  );
  assert.equal(
    droneWithWheels.architecture.session?.systems.mobility?.assemblies?.length >
      0,
    true,
    "wheeled drone did not activate wheel physics",
  );
  assert.equal(
    droneWithWheels.architecture.session?.systems.flight?.active,
    true,
    "wheeled drone did not activate flight physics",
  );
  assert.ok(
    Object.values(droneWithWheels.demo.drone?.attitudeDeg || {}).every(
      Number.isFinite,
    ),
    "wheeled drone did not publish completed routed IMU measurements",
  );
  assert.equal(
    droneWithWheels.demo.drone?.stabilizerReady,
    false,
    "untrusted imported controller code executed without an explicit trust decision",
  );
  assert.equal(
    articulatedWithAero.architecture.session?.systems.articulated?.active,
    true,
    "aerodynamic articulated machine lost articulated constraints",
  );
  assert.equal(
    articulatedWithAero.architecture.session?.systems.flight?.active,
    true,
    "aerodynamic articulated machine did not run flight/aero physics",
  );
  assert.ok(
    articulatedWithAero.architecture.session.systems.articulated.poses.length >=
      23,
    "articulated pose graph did not advance",
  );
  assert.ok(
    Number.isFinite(articulatedWithAero.demo.missile?.cd) &&
      articulatedWithAero.demo.missile.cd > 0,
    "aerodynamic state was not resolved",
  );
  assertNoErrors(errors, "hybrid matrix");
});
