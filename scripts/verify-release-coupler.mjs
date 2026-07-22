import assert from "node:assert/strict";
import fs from "node:fs";
import * as CANNON from "cannon-es";
import { MISSION_TS_SOURCE } from "../src/application/content.js";
import { compileAssembly } from "../src/model/assembly-compiler.js";
import {
  decodeBlueprint,
  decodeBlueprintOrThrow,
} from "../src/model/blueprint-decoder.js";
import { TYPES } from "../src/model/component-catalog.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { FailureRecorder } from "../src/model/failure-analysis.js";
import { stableStringify } from "../src/model/primitives.js";
import {
  createSubassemblyTemplate,
  instantiateSubassembly,
} from "../src/model/subassemblies.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { PowerNetwork } from "../src/simulation/power-network.js";
import { RuntimeCheckpointCoordinator } from "../src/simulation/runtime-checkpoints.js";
import { createSimulationContext } from "../src/simulation/simulation-context.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { PowerSystem } from "../src/simulation/systems/power-system.js";
import { ReleaseCouplerSystem } from "../src/simulation/systems/release-coupler-system.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";

const FIXED_DT = 1 / 120;
const CHECKPOINT_IDENTITIES = Object.freeze({
  runConfigurationFingerprint: `sim-sha256-${"1".repeat(64)}`,
  blueprintFingerprint: `sim-sha256-${"2".repeat(64)}`,
  compiledTopologyFingerprint: `sim-sha256-${"3".repeat(64)}`,
});

function missionBlueprint() {
  const blueprint = structuredClone(
    builtInDemo("mission", { typescript: MISSION_TS_SOURCE }).blueprint,
  );
  blueprint.name = "Arbitrary two-stage vehicle";
  delete blueprint.demo;
  return blueprint;
}

function releaseFixture(blueprint = missionBlueprint()) {
  const assembly = decodeBlueprintOrThrow(blueprint).assembly,
    compiled = compileAssembly(assembly, TYPES),
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) }),
    runtime = new MultibodyRuntime({
      world,
      material: new CANNON.Material("release-fixture"),
      catalog: TYPES,
    });
  assert.equal(compiled.stats.errorCount, 0);
  runtime.start(assembly);
  const context = createSimulationContext(assembly, {
      catalog: TYPES,
      multibodyRuntime: runtime,
    }),
    system = new ReleaseCouplerSystem(),
    descriptor = compiled.actuators.find(
      (candidate) => candidate.kind === "release-coupler-v1",
    );
  assert.ok(descriptor, "release coupler did not compile an actuator");
  system.initialize(context);
  context.powerNetwork = new PowerNetwork(TYPES).resolve(
    context.runGraph,
    FIXED_DT,
  );
  context.telemetry = {};
  return { assembly, compiled, context, descriptor, runtime, system };
}

function velocityState(runtime) {
  return [...runtime.bodyByPart]
    .sort(([left], [right]) => left - right)
    .map(([partId, body]) => ({
      partId,
      linear: body.velocity.toArray(),
      angular: body.angularVelocity.toArray(),
    }));
}

function mechanicallyReachableParts(blueprint, originId, excludedPartId) {
  const adjacency = new Map(
    blueprint.parts
      .filter((part) => part.id !== excludedPartId)
      .map((part) => [part.id, []]),
  );
  for (const connection of blueprint.connections) {
    if (
      connection.kind !== "mechanical" ||
      connection.a === excludedPartId ||
      connection.b === excludedPartId
    )
      continue;
    adjacency.get(connection.a)?.push(connection.b);
    adjacency.get(connection.b)?.push(connection.a);
  }
  const reachable = new Set([originId]),
    pending = [originId];
  while (pending.length) {
    const current = pending.pop();
    for (const neighbor of adjacency.get(current) ?? []) {
      if (reachable.has(neighbor)) continue;
      reachable.add(neighbor);
      pending.push(neighbor);
    }
  }
  return reachable;
}

function crossStageInterpenetrations(runtime, sideA, sideB) {
  const bodies = (partIds) =>
    [...partIds]
      .map((partId) => ({ partId, body: runtime.bodyByPart.get(partId) }))
      .filter(({ body }) => body);
  return bodies(sideA).flatMap((left) =>
    bodies(sideB).flatMap((right) => {
      left.body.updateAABB();
      right.body.updateAABB();
      const overlapM = ["x", "y", "z"].map(
        (axis) =>
          Math.min(
            left.body.aabb.upperBound[axis],
            right.body.aabb.upperBound[axis],
          ) -
          Math.max(
            left.body.aabb.lowerBound[axis],
            right.body.aabb.lowerBound[axis],
          ),
      );
      return overlapM.every((distance) => distance > 1e-6)
        ? [{ leftPartId: left.partId, rightPartId: right.partId, overlapM }]
        : [];
    }),
  );
}

function checkpointReleaseFixture(blueprint) {
  const assembly = decodeBlueprintOrThrow(blueprint).assembly,
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) }),
    worldAdapter = new CannonWorldAdapter(world),
    runtime = new MultibodyRuntime({
      world,
      worldAdapter,
      material: new CANNON.Material("release-checkpoint-fixture"),
      catalog: TYPES,
      fixedDt: FIXED_DT,
    }),
    system = new ReleaseCouplerSystem();
  runtime.start(assembly);
  const session = new SimulationSession({
      systems: [new PowerSystem(), system, new RigidBodySystem()],
    }).start(assembly, {
      world,
      worldAdapter,
      catalog: TYPES,
      multibodyRuntime: runtime,
    }),
    coordinator = new RuntimeCheckpointCoordinator({
      session,
      multibodyRuntime: runtime,
      worldAdapter,
    });
  return {
    assembly,
    coordinator,
    runtime,
    session,
    system,
    worldAdapter,
    dispose() {
      session.dispose();
      runtime.dispose();
    },
  };
}

function checkpointObserved(run) {
  return stableStringify({
    session: run.session.exportState(),
    physics: run.runtime.exportState(),
    runGraph: run.session.context.runGraph.exportState(),
    releaseCouplers: run.system.exportState(run.session.context),
    adapter: run.worldAdapter.exportState(),
  });
}

function firstDifference(leftJson, rightJson) {
  const visit = (left, right, path) => {
    if (Object.is(left, right)) return null;
    if (
      !left ||
      !right ||
      typeof left !== "object" ||
      typeof right !== "object"
    )
      return { path, left, right };
    const keys = [
      ...new Set([...Object.keys(left), ...Object.keys(right)]),
    ].sort();
    for (const key of keys) {
      const difference = visit(left[key], right[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  };
  return visit(JSON.parse(leftJson), JSON.parse(rightJson), "state");
}

const blueprint = missionBlueprint(),
  decoded = decodeBlueprint(blueprint);
assert.equal(decoded.ok, true, JSON.stringify(decoded.errors));
const coupler = blueprint.parts.find((part) => part.type === "release-coupler"),
  controller = blueprint.parts.find((part) => part.type === "computer"),
  stageReceiver = blueprint.parts.find((part) =>
    controller.controllerBindings.some(
      (binding) =>
        binding.id === "pilot.stage" && binding.endpointPartId === part.id,
    ),
  ),
  releaseBinding = controller.controllerBindings.find(
    (binding) => binding.id === "coupler.release",
  ),
  breakaway = blueprint.connections.filter(
    (connection) => connection.releaseCouplerPartId === coupler.id,
  );
assert.ok(
  stageReceiver,
  "orbital stage receiver is not an exact input binding",
);
assert.deepEqual(releaseBinding, {
  id: "coupler.release",
  direction: "output",
  endpointPartId: coupler.id,
  endpointPortId: "CONTROL",
  channel: "release",
});
assert.equal(breakaway.length, 1, "orbital staging must declare one umbilical");
assert.equal(breakaway[0].kind, "signal");
assert.match(MISSION_TS_SOURCE, /api\.read\('pilot\.stage'\)/);
assert.match(MISSION_TS_SOURCE, /api\.write\([\s\S]*'coupler\.release'/);
assert.match(MISSION_TS_SOURCE, /stageWasPressed/);

const releaseSystemSource = fs.readFileSync(
    new URL(
      "../src/simulation/systems/release-coupler-system.js",
      import.meta.url,
    ),
    "utf8",
  ),
  directControlSource = fs.readFileSync(
    new URL("../src/application/direct-control-feature.js", import.meta.url),
    "utf8",
  ),
  remotePanelSource = fs.readFileSync(
    new URL("../src/presentation/remote-panel.js", import.meta.url),
    "utf8",
  );
assert.doesNotMatch(
  releaseSystemSource,
  /\b(?:demo|mission|rocket|previousTelemetry|THREE)\b|apply(?:Force|Impulse)/,
  "release law depends on presentation, demo identity, telemetry memory, or free force",
);
for (const [label, source] of [
  ["direct controls", directControlSource],
  ["field remote", remotePanelSource],
])
  assert.doesNotMatch(
    source,
    /releaseCouplerPartId|commanded-release|coupler\.release/,
    `${label} contains a staging shortcut instead of issuing an ordinary command`,
  );

const fixture = releaseFixture(blueprint),
  { context, descriptor, runtime, system } = fixture,
  batteryId = blueprint.parts.find((part) => part.type === "battery").id,
  initialEnergyJ = context.runGraph.part(batteryId).energyJ,
  beforeVelocity = velocityState(runtime);
const flangeConnections = blueprint.connections.filter(
    (connection) =>
      connection.kind === "mechanical" &&
      (connection.a === coupler.id || connection.b === coupler.id),
  ),
  flangePartByPort = new Map(
    flangeConnections.map((connection) => {
      const couplerIsA = connection.a === coupler.id;
      return [
        couplerIsA ? connection.portA : connection.portB,
        couplerIsA ? connection.b : connection.a,
      ];
    }),
  ),
  lowerStage = mechanicallyReachableParts(
    blueprint,
    flangePartByPort.get("FLANGE_A"),
    coupler.id,
  ),
  upperStage = mechanicallyReachableParts(
    blueprint,
    flangePartByPort.get("FLANGE_B"),
    coupler.id,
  );
assert.equal(flangeConnections.length, 2);
assert.equal(lowerStage.size, 8);
assert.equal(upperStage.size, 23);
assert.deepEqual(
  crossStageInterpenetrations(runtime, lowerStage, upperStage),
  [],
  "authored stages interpenetrate across the released interface",
);
assert.equal(descriptor.sourceConnectionIds.length, 2);
assert.deepEqual(
  descriptor.breakawayConnectionIds,
  breakaway.map(({ id }) => id),
);
system.step(context, FIXED_DT);
assert.equal(
  context.runGraph.events().length,
  0,
  "an uncommanded release coupler opened",
);
context.telemetry = {};
context.commandBus.writeScript(
  controller.id,
  "coupler.release",
  coupler.id,
  "release",
  1,
);
system.step(context, FIXED_DT);
const releasedState = context.telemetry.releaseCouplers.states[0],
  event = context.runGraph.events().at(-1),
  expectedFailures = [
    ...descriptor.sourceConnectionIds,
    ...descriptor.breakawayConnectionIds,
  ].sort();
assert.equal(releasedState.released, true);
assert.equal(releasedState.deliveredEnergyJ, descriptor.law.actuationEnergyJ);
assert.deepEqual([...event.failedConnectionIds].sort(), expectedFailures);
assert.equal(event.mode, "commanded-release");
assert.equal(context.runGraph.events().length, 1);
assert.equal(
  new FailureRecorder({ catalog: TYPES }).ingest({
    time: event.time,
    run: context.runGraph.snapshot(),
    systems: { fluids: { byPart: {} } },
  }).length,
  0,
  "an intentional commanded release became a failure post-mortem",
);
assert.deepEqual(
  velocityState(runtime),
  beforeVelocity,
  "bare release coupler introduced a separation impulse",
);
assert.ok(
  runtime.constraintEntries.find(
    (entry) => entry.descriptor.id === descriptor.constraintId,
  ).active === false,
  "solver latch remained active after graph release",
);
assert.ok(
  context.runGraph
    .connections()
    .filter(
      (connection) =>
        !expectedFailures.includes(connection.id) &&
        ["power", "signal", "resource"].includes(connection.kind),
    )
    .every((connection) => !connection.failed),
  "ordinary network routes failed with the latch",
);
assert.equal(
  initialEnergyJ - context.runGraph.part(batteryId).energyJ,
  descriptor.law.actuationEnergyJ / 0.96,
);

context.telemetry = {};
context.powerNetwork.resolve(context.runGraph, FIXED_DT);
system.step(context, FIXED_DT);
assert.equal(
  context.runGraph.events().length,
  1,
  "held command released twice",
);
assert.equal(context.telemetry.releaseCouplers.states[0].deliveredEnergyJ, 0);
runtime.dispose();

const checkpointRun = checkpointReleaseFixture(blueprint),
  checkpointController = checkpointRun.assembly.parts.find(
    (part) => part.type === "computer",
  ),
  checkpointCoupler = checkpointRun.assembly.parts.find(
    (part) => part.type === "release-coupler",
  );
checkpointRun.session.stepFixed();
const preReleaseCheckpoint = checkpointRun.coordinator.capture(
  CHECKPOINT_IDENTITIES,
);
checkpointRun.session.context.commandBus.writeScript(
  checkpointController.id,
  "coupler.release",
  checkpointCoupler.id,
  "release",
  1,
);
checkpointRun.session.stepFixed();
const firstReleaseOutcome = checkpointObserved(checkpointRun);
checkpointRun.coordinator.restore(preReleaseCheckpoint, CHECKPOINT_IDENTITIES);
checkpointRun.session.context.commandBus.writeScript(
  checkpointController.id,
  "coupler.release",
  checkpointCoupler.id,
  "release",
  1,
);
checkpointRun.session.stepFixed();
const restoredReleaseOutcome = checkpointObserved(checkpointRun);
assert.equal(
  restoredReleaseOutcome,
  firstReleaseOutcome,
  JSON.stringify({
    message:
      "pre-release checkpoint did not reproduce the exact structural event",
    firstDifference: firstDifference(
      restoredReleaseOutcome,
      firstReleaseOutcome,
    ),
  }),
);
const postReleaseCheckpoint = checkpointRun.coordinator.capture(
  CHECKPOINT_IDENTITIES,
);
checkpointRun.session.stepFixed();
const heldAfterRelease = checkpointObserved(checkpointRun);
checkpointRun.coordinator.restore(postReleaseCheckpoint, CHECKPOINT_IDENTITIES);
checkpointRun.session.stepFixed();
const restoredHeldOutcome = checkpointObserved(checkpointRun);
assert.equal(
  restoredHeldOutcome,
  heldAfterRelease,
  JSON.stringify({
    message: "post-release checkpoint repeated or changed the structural event",
    firstDifference: firstDifference(restoredHeldOutcome, heldAfterRelease),
  }),
);
assert.equal(checkpointRun.session.context.runGraph.events().length, 1);
checkpointRun.dispose();

const unpoweredBlueprint = missionBlueprint(),
  unpoweredCoupler = unpoweredBlueprint.parts.find(
    (part) => part.type === "release-coupler",
  );
unpoweredBlueprint.connections = unpoweredBlueprint.connections.filter(
  (connection) =>
    !(
      connection.kind === "power" &&
      (connection.a === unpoweredCoupler.id ||
        connection.b === unpoweredCoupler.id)
    ),
);
const unpowered = releaseFixture(unpoweredBlueprint),
  unpoweredController = unpoweredBlueprint.parts.find(
    (part) => part.type === "computer",
  );
unpowered.context.commandBus.writeScript(
  unpoweredController.id,
  "coupler.release",
  unpoweredCoupler.id,
  "release",
  1,
);
unpowered.system.step(unpowered.context, FIXED_DT);
assert.equal(unpowered.context.runGraph.events().length, 0);
assert.equal(
  unpowered.context.telemetry.releaseCouplers.states[0].released,
  false,
);
unpowered.runtime.dispose();

const incomplete = missionBlueprint(),
  incompleteCoupler = incomplete.parts.find(
    (part) => part.type === "release-coupler",
  );
incomplete.connections.splice(
  incomplete.connections.findIndex(
    (connection) =>
      connection.kind === "mechanical" &&
      (connection.a === incompleteCoupler.id ||
        connection.b === incompleteCoupler.id),
  ),
  1,
);
const incompleteResult = decodeBlueprint(incomplete);
assert.ok(
  incompleteResult.errors[0].details.diagnostics.some(
    (diagnostic) => diagnostic.code === "INVALID_RELEASE_COUPLER_TOPOLOGY",
  ),
  "incomplete release topology did not fail compilation",
);

const invalidBreakaway = missionBlueprint(),
  invalidCoupler = invalidBreakaway.parts.find(
    (part) => part.type === "release-coupler",
  ),
  physical = invalidBreakaway.connections.find(
    (connection) => connection.kind === "mechanical",
  );
physical.releaseCouplerPartId = invalidCoupler.id;
assert.equal(
  decodeBlueprint(invalidBreakaway).errors[0].code,
  "BREAKAWAY_PHYSICAL_CONNECTION_FORBIDDEN",
);

const asset = createSubassemblyTemplate(
    { parts: blueprint.parts, connections: blueprint.connections },
    blueprint.parts.map((part) => part.id),
    { name: "Reusable staged vehicle", origin: [0, 0, 0] },
  ),
  instance = instantiateSubassembly(asset, { nextId: 500 }),
  remappedCouplerId = instance.idMap[coupler.id],
  remappedBreakaway = instance.connections.find(
    (connection) => connection.releaseCouplerPartId != null,
  );
assert.equal(remappedBreakaway.releaseCouplerPartId, remappedCouplerId);
assert.ok(
  instance.parts
    .find((part) => part.id === instance.idMap[controller.id])
    .controllerBindings.some(
      (binding) =>
        binding.id === "coupler.release" &&
        binding.endpointPartId === remappedCouplerId,
    ),
  "subassembly instantiation did not remap the executable release binding",
);

console.log(
  `release coupler passed (${expectedFailures.length} atomic failures, ${descriptor.law.actuationEnergyJ} J delivered, no impulse)`,
);
