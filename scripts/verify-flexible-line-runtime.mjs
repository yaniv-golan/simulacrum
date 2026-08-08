import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { TYPES } from "../src/model/component-catalog.js";
import { authoredComponentFields } from "../src/model/component-authoring.js";
import {
  FailureRecorder,
  ReplayBuffer,
} from "../src/model/failure-analysis.js";
import { componentDefaults } from "../src/model/component-resolver.js";
import { flexibleRuntimeBoundsWorldM } from "../src/model/component-geometry-contract.js";
import {
  completeConnectionContract,
  CONNECTION_CAPACITIES,
} from "../src/model/connection-contracts.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { CannonMaterialAdapter } from "../src/simulation/cannon-material-adapter.js";
import { constraintReactionContributions } from "../src/simulation/constraint-reaction-wrench.js";
import { FlexibleLineRuntime } from "../src/simulation/flexible-line-runtime.js";
import { startMultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { PhysicalAssemblyIndex } from "../src/simulation/physical-assembly-index.js";
import { FlexibleLineSystem } from "../src/simulation/systems/flexible-line-system.js";
import {
  FlexibleLineStructureSystem,
  FlexibleLineTelemetrySystem,
} from "../src/simulation/systems/flexible-line-system.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const part = (
  id,
  type,
  pos,
  config = componentDefaults(type),
  orientation = [0, 0, 0, 1],
) => ({
  id,
  type,
  pos,
  orientation,
  ...(TYPES[type]?.mechanism ? {} : { scale: [1, 1, 1] }),
  ...authoredComponentFields(type, TYPES[type]?.mechanism ? {} : config),
});

function attachment(
  rope,
  endpoint,
  target,
  targetPort,
  anchorB = null,
  capacity = CONNECTION_CAPACITIES.reinforced,
  connectionId = `attach:${endpoint}`,
) {
  return completeConnectionContract(
    {
      id: connectionId,
      kind: "mechanical",
      a: rope.id,
      b: target.id,
      portA: endpoint,
      portB: targetPort,
      ...(anchorB ? { anchorB } : {}),
    },
    rope,
    target,
    { capacity },
  );
}

function createRun({
  gravity = [0, -9.80665, 0],
  anchorM = [0, 0, 0],
  fixedAnchor = false,
  capacity = CONNECTION_CAPACITIES.reinforced,
  ropeConfig = componentDefaults("rope"),
  ropePosition = [0, -2, 0],
  ropeOrientation = [0, 0, 0, 1],
  targetType = "plate",
  targetPort = "TOP",
  targetPosition = [0, 0, 0],
  ground = false,
} = {}) {
  const world = new CANNON.World({ gravity: new CANNON.Vec3(...gravity) }),
    worldAdapter = new CannonWorldAdapter(world),
    material = new CANNON.Material("generic-structure"),
    rope = part(1, "rope", ropePosition, ropeConfig, ropeOrientation),
    target = part(2, targetType, targetPosition),
    snapshot = {
      revision: 1,
      parts: [rope, target],
      connections: [
        attachment(rope, "END_A", target, targetPort, anchorM, capacity),
      ],
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
    anchorBody = multibodyRuntime.bodyByPart.get(target.id);
  if (ground) {
    const groundBody = new CANNON.Body({ mass: 0, material });
    groundBody.addShape(new CANNON.Plane());
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(groundBody);
  }
  if (fixedAnchor) {
    const supportBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material,
    });
    supportBody.position.copy(anchorBody.position);
    supportBody.quaternion.copy(anchorBody.quaternion);
    world.addBody(supportBody);
    world.addConstraint(
      new CANNON.LockConstraint(anchorBody, supportBody, {
        collideConnected: false,
      }),
    );
  }
  const session = new SimulationSession({
    systems: [
      new FlexibleLineSystem(),
      new RigidBodySystem(),
      new FlexibleLineStructureSystem(),
      new StructureSystem(),
      new FlexibleLineTelemetrySystem(),
      new TelemetrySystem(),
    ],
  }).start(snapshot, {
    catalog: TYPES,
    world,
    worldAdapter,
    multibodyRuntime,
    flexibleLineRuntime,
  });
  return {
    world,
    worldAdapter,
    multibodyRuntime,
    flexibleLineRuntime,
    session,
    anchorBody,
    snapshot,
  };
}

{
  const world = new CANNON.World({ gravity: new CANNON.Vec3(0, 0, 0) }),
    worldAdapter = new CannonWorldAdapter(world),
    material = new CANNON.Material("generic-structure"),
    rope = part(1, "rope", [0, 0, 0]),
    targetA = part(2, "plate", [0, 2, 0]),
    targetB = part(3, "plate", [0, -2, 0]),
    snapshot = {
      revision: 1,
      parts: [rope, targetA, targetB],
      connections: [
        attachment(
          rope,
          "END_A",
          targetA,
          "TOP",
          null,
          CONNECTION_CAPACITIES.reinforced,
          1,
        ),
        attachment(
          rope,
          "END_B",
          targetB,
          "TOP",
          null,
          CONNECTION_CAPACITIES.reinforced,
          "1",
        ),
      ],
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
    }).start(multibodyRuntime.compiled);
  assert.deepEqual(
    flexibleLineRuntime.attachmentEntries
      .map(({ constraint }) => constraint.simulacrumEvidence.constraintId)
      .sort(),
    ["flexible-attachment:1", "flexible-attachment:string:1:1"],
    "numeric/string homograph attachment constraints shared one identity",
  );
  assert.deepEqual(
    flexibleLineRuntime.attachmentEntries
      .flatMap(
        ({ constraint }) => constraint.simulacrumEvidence.sourceConnectionIds,
      )
      .sort(),
    ["1", "string:1:1"],
    "numeric/string homograph flexible-line provenance collapsed",
  );
  worldAdapter.beginSession();
  worldAdapter.integrate(1 / 120, { tick: 1 });
  const completedContributions = flexibleLineRuntime.attachmentEntries.flatMap(
      ({ constraint }) =>
        constraintReactionContributions(
          constraint,
          "A",
          constraint.simulacrumEvidence,
        ),
    ),
    solverRowSourceConnectionIds = completedContributions
      .filter(({ constraintId }) =>
        String(constraintId).startsWith("flexible-attachment:"),
      )
      .flatMap(({ sourceConnectionIds }) => sourceConnectionIds);
  assert.deepEqual(
    [...new Set(solverRowSourceConnectionIds)].sort(),
    ["1", "string:1:1"],
    `solver-row provenance collapsed flexible-line connection homographs: ${JSON.stringify(completedContributions.map(({ constraintId, sourceConnectionIds }) => ({ constraintId, sourceConnectionIds })))}`,
  );
  assert.ok(
    solverRowSourceConnectionIds.length > 0,
    "a flexible-line solver row lost its source connection identity",
  );
  flexibleLineRuntime.dispose();
  multibodyRuntime.dispose();
  worldAdapter.dispose();
}

{
  const run = createRun({
    ropePosition: [2.65, 0.65, 0],
    ropeOrientation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    targetType: "wheel",
    targetPort: "SURFACE",
    targetPosition: [0, 0.65, 0],
    anchorM: [0.65, 0, 0],
    ground: true,
  });
  assert.deepEqual(
    run.flexibleLineRuntime.bodyByEntityId
      .get("flex:1:node:0")
      .position.toArray(),
    [0.65, 0.65, 0],
  );
  assert.ok(
    run.flexibleLineRuntime.bodyByEntityId.get("flex:1:node:1").position.x >
      0.65,
    "the first free Rope segment spawned through the wheel",
  );
  run.session.stepFixed(120);
  const telemetry = run.session.telemetry().systems.flexibleLines;
  assert.ok(
    run.anchorBody.position.y < 1.2,
    "an unpowered wheel launched upward",
  );
  assert.ok(
    run.anchorBody.velocity.length() < 8,
    "wheel launch energy persisted",
  );
  assert.equal(telemetry.topologyEvents.length, 0, "the resting rig broke");
  assert.equal(
    run.session.context.runGraph.connection("attach:END_A").failed,
    false,
    "the resting Rope attachment failed",
  );
  run.session.dispose();
  run.flexibleLineRuntime.dispose();
  run.multibodyRuntime.dispose();
}

{
  const run = createRun({
      fixedAnchor: true,
      ropeConfig: {
        ...componentDefaults("rope"),
        ultimateTensionN: 6,
      },
    }),
    recorder = new FailureRecorder({ catalog: TYPES }),
    replay = new ReplayBuffer({ seconds: 2, sampleHz: 120 });
  let created = [];
  for (let tick = 0; tick < 30 && !created.length; tick++) {
    run.session.stepFixed();
    const snapshot = run.session.telemetry();
    replay.record(snapshot, { force: true });
    created = recorder.ingest(snapshot);
  }
  assert.equal(
    created.length,
    1,
    "one Rope produced more than one governing internal break in a tick",
  );
  const report = recorder.report(),
    topologyEvent =
      run.session.telemetry().systems.flexibleLines.topologyEvents[0],
    replayFrame = replay.frame(replay.snapshot().frameCount - 1);
  assert.equal(report.primary.mode, "tension");
  assert.match(report.primary.evidence.channelId, /^flexible-line:/);
  assert.ok(report.primary.evidence.provenance.strain > 0);
  assert.equal(report.primary.evidence.provenance.materialKey, "nylon-rope");
  assert.equal(topologyEvent.survivingFragments.length, 2);
  assert.ok(topologyEvent.activeElementIds.length > 0);
  assert.deepEqual(
    replayFrame.telemetry.systems.flexibleLines.lines[0].centerline,
    run.session.telemetry().systems.flexibleLines.lines[0].centerline,
    "read-only replay lost the authoritative Rope centerline",
  );
  run.session.dispose();
  run.flexibleLineRuntime.dispose();
  run.multibodyRuntime.dispose();
}

{
  const run = createRun({
    fixedAnchor: true,
    capacity: { ultimateForceN: 1, ultimateTorqueNm: 1 },
  });
  run.session.stepFixed(4);
  const connection = run.session.context.runGraph.connection("attach:END_A"),
    line = run.session.telemetry().systems.flexibleLines.lines[0];
  assert.equal(connection.failed, true);
  assert.equal(line.boundaries[0].state, "free");
  assert.equal(
    run.session.context.runGraph.startSnapshot().connections[0].failed,
    undefined,
    "runtime attachment failure rewrote the authored blueprint",
  );
  run.session.dispose();
  run.flexibleLineRuntime.dispose();
  run.multibodyRuntime.dispose();
}

{
  const run = createRun({ fixedAnchor: true });
  run.session.stepFixed(120);
  const telemetry = run.session.telemetry().systems.flexibleLines.lines[0];
  assert.equal(run.worldAdapter.telemetry().integrationCount, 120);
  assert.equal(telemetry.boundaries[0].state, "attached");
  assert.equal(telemetry.boundaries[1].state, "free");
  assert.ok(telemetry.maximumTensionN > 0, "hanging Rope carried no weight");
  assert.ok(telemetry.centerline.at(-1).y < telemetry.centerline[0].y);
  assert.deepEqual(
    telemetry.runtimeBoundsWorldM,
    flexibleRuntimeBoundsWorldM(
      telemetry.centerline,
      componentDefaults("rope").diameterM / 2,
    ),
    "completed Rope telemetry did not own its exact solved bounds",
  );
  assert.equal(run.session.context.bodyRegistry.bodiesForPart(1).length, 17);
  run.session.dispose();
  run.flexibleLineRuntime.dispose();
  run.multibodyRuntime.dispose();
}

{
  const run = createRun({ gravity: [0, 0, 0], anchorM: [0, 0, 0] }),
    endpoint = run.flexibleLineRuntime.bodyByEntityId.get("flex:1:node:0");
  run.anchorBody.angularVelocity.set(0, 0, 2);
  const before = endpoint.position.clone();
  run.session.stepFixed(30);
  assert.ok(
    endpoint.position.distanceTo(before) < 0.03,
    "an axis attachment translated or invented winding under pure rotation",
  );
  run.session.dispose();
  run.flexibleLineRuntime.dispose();
  run.multibodyRuntime.dispose();
}

{
  const run = createRun({
      gravity: [0, 0, 0],
      anchorM: [0.5, 0, 0],
      ropePosition: [0.5, -2, 0],
    }),
    endpoint = run.flexibleLineRuntime.bodyByEntityId.get("flex:1:node:0");
  run.anchorBody.angularVelocity.set(0, 0, 2);
  const before = endpoint.position.clone();
  run.session.stepFixed(30);
  const localAnchor = new CANNON.Vec3(0.5, 0, 0),
    worldAnchor = run.anchorBody.pointToWorldFrame(localAnchor);
  assert.ok(
    endpoint.position.distanceTo(before) > 0.1,
    "an off-axis attachment did not follow the rotating anchor point",
  );
  assert.ok(
    endpoint.position.distanceTo(worldAnchor) < 0.04,
    "the Rope endpoint diverged from its authored rotating anchor",
  );
  assert.ok(
    Math.abs(run.anchorBody.angularVelocity.z) < 2,
    "the off-axis Rope force produced no reaction torque on the body",
  );
  run.session.dispose();
  run.flexibleLineRuntime.dispose();
  run.multibodyRuntime.dispose();
}

{
  const run = createRun({ gravity: [0, 0, 0] });
  run.session.stepFixed(2);
  const checkpoint = run.flexibleLineRuntime.exportState(),
    before = structuredClone(
      run.flexibleLineRuntime.afterIntegration(run.session.context.clock.tick),
    );
  run.session.stepFixed(10);
  run.flexibleLineRuntime.importState(checkpoint);
  const restored = run.flexibleLineRuntime.afterIntegration(
    run.session.context.clock.tick,
  );
  assert.deepEqual(restored.lines[0].centerline, before.lines[0].centerline);
  run.session.dispose();
  run.flexibleLineRuntime.dispose();
  run.multibodyRuntime.dispose();
}

{
  const run = createRun({ gravity: [0, 0, 0] }),
    graph = run.session.context.runGraph,
    index = new PhysicalAssemblyIndex(run.multibodyRuntime.compiled),
    entries = [
      ...run.multibodyRuntime.constraintEntries,
      ...run.flexibleLineRuntime.edgeEntries,
      ...run.flexibleLineRuntime.attachmentEntries,
    ],
    initial = index.refresh({ runGraph: graph, constraintEntries: entries }),
    middle = run.flexibleLineRuntime.edgeEntries[8];
  assert.equal(initial.components.length, 1);
  middle.active = false;
  graph.applyStructuralEvent({
    failedInternalEdgeIds: [middle.descriptor.id],
    mode: "flexible-internal-break-v1",
  });
  const split = index.refresh({
    runGraph: graph,
    constraintEntries: entries,
    topologyRevision: 1,
  });
  assert.equal(split.components.length, 2);
  assert.equal(index.componentForPart(1), null);
  assert.equal(index.componentsForPart(1).length, 2);
  assert.ok(
    split.components.every((component) => component.partIds.includes(1)),
    "Rope fragments lost their shared authored source identity",
  );
  run.session.dispose();
  run.flexibleLineRuntime.dispose();
  run.multibodyRuntime.dispose();
}

{
  const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    worldAdapter = new CannonWorldAdapter(world),
    structureMaterial = new CANNON.Material("generic-structure"),
    groundMaterial = new CANNON.Material("workshop-steel"),
    ropeMaterial = new CANNON.Material("nylon-rope"),
    materials = new CannonMaterialAdapter(world, [
      ["generic-structure", structureMaterial],
      ["workshop-steel", groundMaterial],
      ["nylon-rope", ropeMaterial],
    ]).install(),
    ground = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: groundMaterial,
      shape: new CANNON.Plane(),
    }),
    rope = part(1, "rope", [0, 3, 0]),
    snapshot = { parts: [rope], connections: [] };
  ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  ground.userData = {
    externalBodyId: "environment:test-ground",
    materialKey: "workshop-steel",
  };
  world.addBody(ground);
  const multibodyRuntime = startMultibodyRuntime(JSON.stringify(snapshot), {
      world,
      worldAdapter,
      material: structureMaterial,
      catalog: TYPES,
    }),
    flexibleLineRuntime = new FlexibleLineRuntime({
      world,
      materialForKey: (key) => materials.materialForKey(key),
      multibodyRuntime,
    }).start(multibodyRuntime.compiled),
    session = new SimulationSession({
      systems: [
        new FlexibleLineSystem(),
        new RigidBodySystem(),
        new (class {
          phase = "structures";
          step(context) {
            context.telemetry.flexibleLines =
              flexibleLineRuntime.afterIntegration(context.clock.tick);
          }
        })(),
        new TelemetrySystem(),
      ],
    }).start(snapshot, {
      catalog: TYPES,
      world,
      worldAdapter,
      multibodyRuntime,
      flexibleLineRuntime,
    });
  session.stepFixed(720);
  const line = session.telemetry().systems.flexibleLines.lines[0],
    minimumY = Math.min(...line.centerline.map((point) => point.y));
  assert.ok(line.contactCount > 0, "dropped Rope reported no ground contact");
  assert.ok(minimumY > -0.03, `Rope penetrated the ground to ${minimumY} m`);
  assert.ok(
    world.getContactMaterial(ropeMaterial, groundMaterial),
    "Rope contact used no explicit authored material pair",
  );
  session.dispose();
  flexibleLineRuntime.dispose();
  multibodyRuntime.dispose();
}

console.log(
  "flexible-line runtime passed (single integration, hang, contact, axis/off-axis rotation, checkpoint, split topology)",
);
