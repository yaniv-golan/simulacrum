import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { TYPES } from "../src/model/component-catalog.js";
import { componentDefaults } from "../src/model/component-resolver.js";
import {
  completeConnectionContract,
  CONNECTION_CAPACITIES,
} from "../src/model/connection-contracts.js";
import { stableStringify } from "../src/model/primitives.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { FlexibleLineRuntime } from "../src/simulation/flexible-line-runtime.js";
import { startMultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { RuntimeCheckpointCoordinator } from "../src/simulation/runtime-checkpoints.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import {
  FlexibleLineStructureSystem,
  FlexibleLineSystem,
  FlexibleLineTelemetrySystem,
} from "../src/simulation/systems/flexible-line-system.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const IDENTITIES = Object.freeze({
  runConfigurationFingerprint: `sim-sha256-${"1".repeat(64)}`,
  blueprintFingerprint: `sim-sha256-${"2".repeat(64)}`,
  compiledTopologyFingerprint: `sim-sha256-${"3".repeat(64)}`,
});
const IDENTITIES_JSON = JSON.stringify(IDENTITIES);

function part(id, type, pos, config = componentDefaults(type)) {
  return {
    id,
    type,
    pos,
    orientation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    config,
  };
}

function createRuntime() {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    worldAdapter = new CannonWorldAdapter(world),
    material = new CANNON.Material("generic-structure"),
    rope = part(1, "rope", [0, -2, 0], {
      ...componentDefaults("rope"),
      ultimateTensionN: 80,
    }),
    plate = part(2, "plate", [0, 0, 0]),
    connection = completeConnectionContract(
      {
        id: "checkpoint-rope-anchor",
        kind: "mechanical",
        a: rope.id,
        b: plate.id,
        portA: "END_A",
        portB: "TOP",
        anchorB: [0, 0, 0],
      },
      rope,
      plate,
      { capacity: CONNECTION_CAPACITIES.reinforced },
    ),
    snapshot = {
      revision: 1,
      parts: [rope, plate],
      connections: [connection],
    },
    multibodyRuntime = startMultibodyRuntime(JSON.stringify(snapshot), {
      world,
      worldAdapter,
      material,
      catalog: TYPES,
    }),
    flexibleLineRuntime = new FlexibleLineRuntime({
      world,
      material,
      multibodyRuntime,
    }).start(multibodyRuntime.compiled),
    structureSystem = new StructureSystem();
  const session = new SimulationSession({
      systems: [
        new FlexibleLineSystem(),
        new RigidBodySystem(),
        new FlexibleLineStructureSystem(),
        structureSystem,
        new FlexibleLineTelemetrySystem(),
        new TelemetrySystem(),
      ],
    }).start(snapshot, {
      catalog: TYPES,
      world,
      worldAdapter,
      multibodyRuntime,
      flexibleLineRuntime,
    }),
    coordinator = new RuntimeCheckpointCoordinator({
      session,
      multibodyRuntime,
      flexibleLineRuntime,
      worldAdapter,
    });
  return {
    session,
    worldAdapter,
    multibodyRuntime,
    flexibleLineRuntime,
    coordinator,
    dispose() {
      session.dispose();
      flexibleLineRuntime.dispose();
      multibodyRuntime.dispose();
    },
  };
}

function observed(run) {
  return stableStringify({
    session: run.session.exportState(),
    flexibleLines: run.flexibleLineRuntime.exportState(),
    physics: run.multibodyRuntime.exportState(),
    bodyRegistry: run.session.context.bodyRegistry.exportState(),
    runGraph: run.session.context.runGraph.exportState(),
    adapter: run.worldAdapter.exportState(),
  });
}

function continueThroughFailure(run, finalTick) {
  let failureTick = null;
  while (run.session.context.clock.tick < finalTick) {
    if (run.session.context.clock.tick === 10)
      run.flexibleLineRuntime.bodyByEntityId
        .get("flex:1:node:16")
        .velocity.set(0, -20, 0);
    run.session.stepFixed();
    if (
      failureTick == null &&
      run.session.telemetry().systems.flexibleLines.topologyEvents.length
    )
      failureTick = run.session.context.clock.tick;
  }
  return failureTick;
}

const run = createRuntime();
run.session.stepFixed(10);
const checkpoint = run.coordinator.capture(IDENTITIES_JSON);
assert.equal(checkpoint.committedTick, 10);
const uninterruptedFailureTick = continueThroughFailure(run, 50),
  uninterrupted = observed(run);
assert.ok(uninterruptedFailureTick, "shock continuation did not break Rope");

run.coordinator.restore(checkpoint, IDENTITIES_JSON);
assert.equal(run.session.context.clock.tick, 10);
const restoredFailureTick = continueThroughFailure(run, 50),
  restored = observed(run);
assert.equal(restoredFailureTick, uninterruptedFailureTick);
assert.equal(
  restored,
  uninterrupted,
  "checkpoint-split Rope run diverged from uninterrupted state",
);
assert.ok(
  run.session.telemetry().systems.flexibleLines.topologyRevision >= 1,
  "restored Rope topology did not retain the governing split",
);
run.dispose();

console.log(
  `flexible-line checkpoint passed (exact split/restore and failure tick ${restoredFailureTick})`,
);
