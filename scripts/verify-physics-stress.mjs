import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { TYPES } from "../src/model/component-catalog.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { CommandBus } from "../src/simulation/command-bus.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { PowerNetwork } from "../src/simulation/power-network.js";
import { RunAssemblyGraph } from "../src/simulation/run-assembly-graph.js";
import { MotorEnergySettlementSystem } from "../src/simulation/systems/motor-energy-settlement-system.js";

const DT = 1 / 120;

function percentile(samples, fraction) {
  return [...samples].sort((left, right) => left - right)[
    Math.ceil(samples.length * fraction) - 1
  ];
}

function assertFiniteBodies(bodies, label) {
  for (const body of bodies)
    for (const [field, values] of [
      ["position", body.position],
      ["quaternion", body.quaternion],
      ["velocity", body.velocity],
      ["angularVelocity", body.angularVelocity],
    ])
      assert.ok(
        [values.x, values.y, values.z, values.w]
          .filter((value) => value !== undefined)
          .every(Number.isFinite),
        `${label} produced non-finite ${field} for body ${body.id}`,
      );
}

function runDenseContactOrder(order = "forward") {
  const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
      allowSleep: true,
    }),
    adapter = new CannonWorldAdapter(world),
    material = new CANNON.Material("stress-contact"),
    ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material,
      shape: new CANNON.Plane(),
    });
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  ground.userData = { externalBodyId: "fixture:dense-stress-ground" };
  world.solver.iterations = 30;
  world.solver.tolerance = 0.0002;
  world.addBody(ground);
  const descriptors = [];
  for (let level = 0; level < 4; level++)
    for (let x = 0; x < 4; x++)
      for (let z = 0; z < 4; z++)
        descriptors.push({
          key: `${level}:${x}:${z}`,
          position: [(x - 1.5) * 0.43, 0.205 + level * 0.405, (z - 1.5) * 0.43],
        });
  const insertion =
      order === "reverse" ? [...descriptors].reverse() : descriptors,
    bodiesByKey = new Map();
  for (const descriptor of insertion) {
    const body = new CANNON.Body({
      mass: 1,
      material,
      shape: new CANNON.Box(new CANNON.Vec3(0.2, 0.2, 0.2)),
      position: new CANNON.Vec3(...descriptor.position),
      linearDamping: 0.08,
      angularDamping: 0.12,
      allowSleep: true,
      sleepSpeedLimit: 0.08,
      sleepTimeLimit: 0.5,
    });
    body.userData = { stressKey: descriptor.key };
    bodiesByKey.set(descriptor.key, body);
    world.addBody(body);
  }
  const distanceConstraints = [];
  for (let x = 0; x < 4; x++)
    for (let z = 0; z < 4; z++) {
      const top = bodiesByKey.get(`3:${x}:${z}`);
      if (x < 3)
        distanceConstraints.push(
          new CANNON.DistanceConstraint(
            top,
            bodiesByKey.get(`3:${x + 1}:${z}`),
            0.43,
            2_000,
          ),
        );
      if (z < 3)
        distanceConstraints.push(
          new CANNON.DistanceConstraint(
            top,
            bodiesByKey.get(`3:${x}:${z + 1}`),
            0.43,
            2_000,
          ),
        );
    }
  for (const constraint of distanceConstraints) world.addConstraint(constraint);
  adapter.beginSession();
  const stepMs = [];
  let maximumContacts = 0;
  for (let tick = 1; tick <= 720; tick++) {
    const started = performance.now();
    adapter.integrate(DT, { tick });
    stepMs.push(performance.now() - started);
    maximumContacts = Math.max(maximumContacts, world.contacts.length);
    if (tick % 120 === 0)
      assertFiniteBodies([...bodiesByKey.values()], "dense contact stress");
  }
  const sleeping = [...bodiesByKey.values()].filter(
    (body) => body.sleepState === CANNON.Body.SLEEPING,
  );
  assert.ok(
    sleeping.length >= 16,
    `only ${sleeping.length} stacked bodies slept`,
  );
  const wakeTarget = sleeping
      .sort((left, right) =>
        left.userData.stressKey.localeCompare(right.userData.stressKey),
      )
      .at(-1),
    beforeWakePosition = wakeTarget.position.clone();
  wakeTarget.applyImpulse(new CANNON.Vec3(0.4, 1.5, 0.2));
  for (let tick = 721; tick <= 750; tick++) adapter.integrate(DT, { tick });
  assert.notEqual(
    wakeTarget.sleepState,
    CANNON.Body.SLEEPING,
    "impulse left a body asleep",
  );
  assert.ok(
    wakeTarget.position.distanceTo(beforeWakePosition) > 0.002,
    "impulse did not move a sleeping body after wake-up",
  );
  const maximumDistanceErrorM = Math.max(
    ...distanceConstraints.map((constraint) =>
      Math.abs(
        constraint.bodyA.position.distanceTo(constraint.bodyB.position) -
          constraint.distance,
      ),
    ),
  );
  assert.ok(
    maximumContacts >= 40,
    `dense stack created only ${maximumContacts} contacts`,
  );
  assert.ok(
    maximumDistanceErrorM < 0.035,
    `dense constrained layer residual reached ${maximumDistanceErrorM} m`,
  );
  const state = [...bodiesByKey]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, body]) => [
      key,
      ...[body.position, body.quaternion, body.velocity, body.angularVelocity]
        .flatMap((value) => [value.x, value.y, value.z, value.w])
        .filter((value) => value !== undefined),
    ]);
  for (const body of [...bodiesByKey.values()]) world.removeBody(body);
  for (const constraint of distanceConstraints)
    world.removeConstraint(constraint);
  assert.equal(world.constraints.length, 0, "dense stress constraints leaked");
  assert.deepEqual(world.bodies, [ground], "dense stress bodies leaked");
  return {
    state,
    maximumContacts,
    maximumDistanceErrorM,
    p95StepMs: percentile(stepMs, 0.95),
  };
}

function cloneCartFleet(count) {
  const source = decodeBlueprintOrThrow(builtInDemo("cart").blueprint).assembly,
    parts = [],
    connections = [];
  for (let fleetIndex = 0; fleetIndex < count; fleetIndex++) {
    const idMap = new Map(
        source.parts.map((part) => [part.id, fleetIndex * 1_000 + part.id]),
      ),
      xOffset = (fleetIndex - (count - 1) / 2) * 5;
    for (const part of source.parts)
      parts.push({
        ...structuredClone(part),
        id: idMap.get(part.id),
        pos: [part.pos[0] + xOffset, part.pos[1], part.pos[2]],
      });
    for (const connection of source.connections)
      connections.push({
        ...structuredClone(connection),
        id: `fleet-${fleetIndex}:${connection.id}`,
        a: idMap.get(connection.a),
        b: idMap.get(connection.b),
      });
  }
  return { revision: 1, parts, connections };
}

function runWheelFleet() {
  const assembly = cloneCartFleet(2),
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.80665, 0) }),
    adapter = new CannonWorldAdapter(world),
    material = new CANNON.Material("stress-fleet"),
    ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material,
      shape: new CANNON.Box(new CANNON.Vec3(40, 0.25, 40)),
      position: new CANNON.Vec3(0, -0.25, 0),
    });
  ground.userData = {
    externalBodyId: "fixture:stress-ground",
    surface: "stress ground",
    materialKey: "workshop-steel",
  };
  world.solver.iterations = 30;
  world.solver.tolerance = 0.0002;
  world.addBody(ground);
  const runtime = new MultibodyRuntime({
      world,
      worldAdapter: adapter,
      material,
      catalog: TYPES,
      groundBody: ground,
      fieldBody: ground,
      surfaceHeightAt: () => 0,
      terrainHeightAt: () => 0,
    }),
    runGraph = new RunAssemblyGraph(assembly),
    powerNetwork = new PowerNetwork(TYPES),
    motorEnergySettlement = new MotorEnergySettlementSystem(),
    commandBus = new CommandBus(),
    context = {
      runGraph,
      powerNetwork,
      commandBus,
      clock: { tick: 0 },
      telemetry: {},
      services: { multibodyRuntime: runtime, worldAdapter: adapter },
    },
    motorIds = assembly.parts
      .filter((part) => part.type === "motor")
      .map((part) => part.id),
    wheelCount = assembly.parts.filter((part) => part.type === "wheel").length;
  runtime.start(assembly);
  assert.equal(runtime.compiled.contactRegions.length, wheelCount);
  assert.ok(runtime.constraintEntries.length >= 40);
  const stepMs = [];
  let maximumContacts = 0,
    maximumActiveMotors = 0;
  for (let tick = 1; tick <= 360; tick++) {
    context.clock.tick = tick;
    context.telemetry = {};
    commandBus.clearTick();
    const throttle = tick <= 120 ? 0 : tick <= 300 ? 0.45 : 0;
    for (const motorId of motorIds)
      commandBus.writeRemote(motorId, "throttle", throttle);
    const started = performance.now();
    powerNetwork.resolve(runGraph, DT);
    const telemetry = runtime.stepActuators(context, DT);
    adapter.integrate(DT, { tick });
    motorEnergySettlement.step(context, DT);
    runtime.afterIntegration(DT);
    stepMs.push(performance.now() - started);
    maximumContacts = Math.max(maximumContacts, world.contacts.length);
    maximumActiveMotors = Math.max(maximumActiveMotors, telemetry.activeMotors);
    if (tick % 120 === 0)
      assertFiniteBodies(
        [...runtime.bodyByPart.values()],
        "wheel fleet stress",
      );
  }
  const p95StepMs = percentile(stepMs, 0.95);
  assert.equal(maximumActiveMotors, motorIds.length);
  assert.ok(maximumContacts >= wheelCount / 2);
  assert.ok(
    p95StepMs < 20,
    `eight-wheel fleet stress p95 exceeded its 20 ms budget: ${p95StepMs}`,
  );
  const compiledConstraintCount = runtime.compiled.constraints.length;
  runtime.dispose();
  assert.deepEqual(world.bodies, [ground], "wheel-fleet bodies leaked");
  assert.equal(world.constraints.length, 0, "wheel-fleet constraints leaked");
  return {
    bodies: assembly.parts.length,
    constraints: compiledConstraintCount,
    wheels: wheelCount,
    maximumContacts,
    p95StepMs,
  };
}

const forward = runDenseContactOrder("forward"),
  repeated = runDenseContactOrder("forward"),
  reverse = runDenseContactOrder("reverse"),
  fleet = runWheelFleet();
assert.deepEqual(
  forward.state,
  repeated.state,
  "stress replay was not bit exact",
);
let maximumOrderDelta = 0;
for (let row = 0; row < forward.state.length; row++)
  for (let column = 1; column < forward.state[row].length; column++)
    maximumOrderDelta = Math.max(
      maximumOrderDelta,
      Math.abs(forward.state[row][column] - reverse.state[row][column]),
    );
assert.ok(
  maximumOrderDelta < 0.002,
  `body insertion order changed the stress outcome by ${maximumOrderDelta}`,
);
assert.ok(
  Math.max(forward.p95StepMs, repeated.p95StepMs, reverse.p95StepMs) < 12,
  "dense contact fixed-step p95 exceeded 12 ms",
);
console.log(
  JSON.stringify({
    dense: {
      maximumContacts: forward.maximumContacts,
      maximumDistanceErrorM: forward.maximumDistanceErrorM,
      p95StepMs: forward.p95StepMs,
      maximumOrderDelta,
    },
    fleet,
  }),
);
