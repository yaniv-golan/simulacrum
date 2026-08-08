import assert from "node:assert/strict";
import { createFailureEvidenceArtifact } from "../src/application/failure-evidence-export.js";
import { createWorkshopRunConfiguration } from "../src/application/mechanism-run-identity.js";
import { createSimulationRunRuntime } from "../src/application/simulation-run-runtime.js";
import { createTestSiteFixtureBodies } from "../src/application/test-site-fixture-feature.js";
import { createTestingPlaygroundEnvironment } from "../src/application/testing-playground-environment.js";
import { createWorkshopPhysicsWorld } from "../src/application/workshop-physics-world.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { TYPES } from "../src/model/component-catalog.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import {
  BUILD_SITE_LAT_DEG,
  BUILD_SITE_LON_DEG,
} from "../src/simulation/environment/earth.js";
import { createEarthEnvironmentBodyRegistry } from "../src/simulation/environment/earth-environment-bodies.js";
import { FailureEvidenceRecorder } from "../src/simulation/failure-evidence-recorder.js";
import { InputTraceRecorder } from "../src/simulation/input-trace-recorder.js";
import { RuntimeCheckpointCoordinator } from "../src/simulation/runtime-checkpoints.js";
import { cannonSolverTransactionResourceState } from "../src/simulation/cannon-solver-transaction.js";
import { WORKSHOP_CANNON_SOLVER_PROFILE } from "../src/simulation/cannon-solver-profile.js";
import { ControllerRuntimeManager } from "../src/scripting/controller-runtime-manager.js";
import { sha256Hex } from "../src/model/sha256.js";
import { stableStringify } from "../src/model/primitives.js";

const environment = createTestingPlaygroundEnvironment(),
  baseBlueprint = builtInDemo("cart").blueprint;

function placedBlueprint({
  x = null,
  z = null,
  workshopShiftZ = 0,
  placementSurfaceY = null,
}) {
  const blueprint = structuredClone(baseBlueprint),
    frame = blueprint.parts.find((part) => part.type === "plate"),
    targetX = x ?? frame.pos[0],
    targetZ = z ?? frame.pos[2] + workshopShiftZ,
    dx = targetX - frame.pos[0],
    dz = targetZ - frame.pos[2],
    dy =
      x == null || z == null
        ? 0
        : (placementSurfaceY ?? environment.surfaceHeightAt(targetX, targetZ)) -
          environment.surfaceHeightAt(frame.pos[0], frame.pos[2]);
  for (const part of blueprint.parts) {
    part.pos[0] += dx;
    part.pos[1] += dy;
    part.pos[2] += dz;
  }
  delete blueprint.demo;
  blueprint.name = `Failure evidence ${targetX},${targetZ}`;
  return blueprint;
}

function peakConnectionUtilization(runRuntime) {
  return Math.max(
    0,
    ...runRuntime.session.context.runGraph
      .connections()
      .map((connection) =>
        Math.max(
          Number(connection.forceUtilization || 0),
          Number(connection.torqueUtilization || 0),
        ),
      ),
  );
}

async function runScenario(spec) {
  const blueprint = placedBlueprint(spec),
    snapshot = decodeBlueprintOrThrow(blueprint).assembly,
    physicsWorld = createWorkshopPhysicsWorld({
      surfaceSampleAt: environment.surfaceSampleAt,
      footprint: environment.testSite.footprint,
    });
  for (const body of createTestSiteFixtureBodies({
    fixtures: environment.testSite.staticFixtures,
    terrainHeightAt: environment.terrainHeightAt,
    groundMaterial: physicsWorld.groundMaterial,
  }))
    physicsWorld.world.addBody(body);

  const motorIds = snapshot.parts
      .filter((part) => part.type === "motor")
      .map((part) => part.id),
    sensorBank = new ControllerSensorBank(),
    runtimeManager = new ControllerRuntimeManager(),
    inputTraceRecorder = new InputTraceRecorder(),
    evidenceRecorder = new FailureEvidenceRecorder();
  let inputTick = 0;
  const physics = {
      ...physicsWorld,
      catalog: TYPES,
      surfaceHeightAt: environment.surfaceHeightAt,
      surfaceSampleAt: environment.surfaceSampleAt,
      terrainHeightAt: environment.terrainHeightAt,
      pondAt: environment.pondAt,
      testSite: environment.testSite,
      testCourseSelection: () => null,
      environmentBodyRegistry: createEarthEnvironmentBodyRegistry(),
      environmentOrigin: () => ({ x: 0, y: 0, z: 0 }),
      windAt: () => ({ x: 0, y: 0, z: 0 }),
    },
    controllers = {
      captureSensors(context) {
        inputTick = context.clock.tick;
        return { controllers: {}, poweredControllerIds: null };
      },
      tick: () => {},
      readCommandCandidates: () => {
        const direction = spec.reversePeriodTicks
          ? Math.floor(Math.max(0, inputTick - 1) / spec.reversePeriodTicks) % 2
            ? -1
            : 1
          : 1;
        return {
          remote: motorIds.map((targetId) => ({
            targetId,
            channel: "throttle",
            value: spec.throttle * direction,
            active: inputTick >= 1,
          })),
          scripts: [],
        };
      },
      telemetry: () => ({}),
      sensorBank,
      runtimeManager,
    },
    runRuntime = createSimulationRunRuntime({
      snapshot,
      physics,
      controllers,
      evidence: {
        inputTraceRecorder,
        failureEvidenceRecorder: evidenceRecorder,
      },
      services: {
        resolveChallengeBinding: () => null,
        windEnabled: false,
        connectionValid: () => true,
        CheckpointCoordinator: RuntimeCheckpointCoordinator,
      },
    }),
    runIdentity = createWorkshopRunConfiguration({
      blueprint,
      compiled: runRuntime.multibodyRuntime.compiled,
      environment: {
        latitude: BUILD_SITE_LAT_DEG,
        longitude: BUILD_SITE_LON_DEG,
        timeOfDay: 12,
        windEnabled: false,
        testSite: environment.testSite,
        deployment: null,
      },
      solverProfile: physicsWorld.worldAdapter.exportState().solverProfile,
    });
  evidenceRecorder.beginRun({ runIdentity });
  assert.equal(
    physicsWorld.world.solver.iterations,
    WORKSHOP_CANNON_SOLVER_PROFILE.iterations,
    "runtime solver iteration authority diverged from the canonical profile",
  );
  assert.equal(
    physicsWorld.world.solver.tolerance,
    WORKSHOP_CANNON_SOLVER_PROFILE.tolerance,
    "runtime solver tolerance authority diverged from the canonical profile",
  );
  assert.equal(
    runIdentity.configuration.identities.solverProfile.sha256,
    sha256Hex(stableStringify(WORKSHOP_CANNON_SOLVER_PROFILE)),
    "artifact solver identity does not describe the runtime profile",
  );
  assert.equal(
    cannonSolverTransactionResourceState(physicsWorld.worldAdapter.transaction)
      .rollingSupportRegistrations,
    runRuntime.multibodyRuntime.compiled.contactRegions.length,
    "rolling-support registrations do not match the compiled capabilities",
  );
  const replayAnchor = runRuntime
    .createCheckpointCoordinator(inputTraceRecorder)
    .capture(
      JSON.stringify({
        runConfigurationFingerprint: runIdentity.runConfigurationFingerprint,
        blueprintFingerprint: runIdentity.blueprintFingerprint,
        compiledTopologyFingerprint: runIdentity.compiledTopologyFingerprint,
      }),
    );
  evidenceRecorder.setReplayability({ supported: true });

  const startPosition = structuredClone(
      runRuntime.session.telemetry().systems.mobility?.assemblies?.[0]?.pose
        ?.position ||
        runRuntime.multibodyRuntime.bodyPose(snapshot.parts[0].id).position,
    ),
    observations = [];
  let firstFieldTick = null,
    firstFailure = null,
    peakUtilization = 0,
    peakDistanceFromStartM = 0,
    peakLoadedInvalidContactForceN = 0,
    observedGraphRevision = 0,
    peakCanonicalContactAllocations = 0;
  try {
    for (let tick = 1; tick <= spec.maximumTicks; tick++) {
      if (tick === spec.diagnosticOnlyTriggerTick)
        evidenceRecorder.trigger({
          kind: "rolling-actuator-stall",
          tick,
          timeS: tick / 120,
          subjectId: motorIds[0],
          validity: "measured",
        });
      runRuntime.session.stepFixed();
      peakCanonicalContactAllocations = Math.max(
        peakCanonicalContactAllocations,
        cannonSolverTransactionResourceState(
          physicsWorld.worldAdapter.transaction,
        ).canonicalContactAllocations,
      );
      const telemetry = runRuntime.session.telemetry(),
        mobility = telemetry.systems.mobility?.assemblies?.[0],
        graphRevision = runRuntime.session.context.runGraph.graphRevision,
        failureEvent =
          graphRevision > observedGraphRevision
            ? runRuntime.session.context.runGraph.events().at(-1)
            : null;
      observedGraphRevision = graphRevision;
      peakDistanceFromStartM = Math.max(
        peakDistanceFromStartM,
        Math.hypot(
          Number(mobility?.pose?.position?.x || 0) - startPosition.x,
          Number(mobility?.pose?.position?.z || 0) - startPosition.z,
        ),
      );
      for (const body of runRuntime.session.context.bodyRegistry.snapshot()
        .bodies)
        for (const contact of body.contacts)
          if (contact.tireEvidence?.withinGeometricTolerance === false)
            peakLoadedInvalidContactForceN = Math.max(
              peakLoadedInvalidContactForceN,
              Number(contact.forceN || 0),
            );
      peakUtilization = Math.max(
        peakUtilization,
        peakConnectionUtilization(runRuntime),
      );
      if (!firstFailure && failureEvent)
        firstFailure = {
          tick,
          graphRevision: failureEvent.graphRevision,
          failedConnectionIds: failureEvent.failedConnectionIds,
          detachedPartIds: failureEvent.detachedPartIds,
        };
      if (
        firstFieldTick == null &&
        mobility?.wheelStates?.some((wheel) =>
          wheel.supportMaterialKeys?.includes("short-grass"),
        )
      )
        firstFieldTick = tick;
      if (tick === 1 || tick % 120 === 0 || failureEvent)
        observations.push({
          tick,
          position: structuredClone(mobility?.pose?.position || null),
          signedSpeedMPerS: mobility?.signedSpeed ?? null,
          wheelContacts: mobility?.wheelContacts ?? null,
          wheels: (mobility?.wheelStates || []).map((wheel) => ({
            partId: wheel.partId,
            touching: wheel.touching,
            normalLoadN: wheel.normalLoadN,
            angularSpeed: wheel.angularSpeed,
            supportMaterialKeys: wheel.supportMaterialKeys,
          })),
          motors: structuredClone(mobility?.driveForce?.motors || []),
          graphRevision: runRuntime.session.context.runGraph.graphRevision,
          peakUtilization,
        });
      if (
        spec.stopAfterFieldTicks &&
        firstFieldTick != null &&
        tick >= firstFieldTick + spec.stopAfterFieldTicks
      )
        break;
    }

    const finalMobility =
        runRuntime.session.telemetry().systems.mobility?.assemblies?.[0],
      trigger = evidenceRecorder.snapshot().trigger,
      artifact = trigger
        ? createFailureEvidenceArtifact({
            runtime: {
              runBlueprint: blueprint,
              runIdentity,
              inputTraceRecorder,
              failureEvidence: {
                recorder: evidenceRecorder,
                replayAnchor,
              },
            },
          })
        : null,
      displacementM = Math.hypot(
        Number(finalMobility?.pose?.position?.x || 0) - startPosition.x,
        Number(finalMobility?.pose?.position?.z || 0) - startPosition.z,
      );
    if (artifact) {
      assert.equal(artifact.trigger.tick, trigger.tick);
      assert.equal(artifact.replayAnchorCheckpoint.committedTick, 0);
      assert.equal(artifact.externalInputTrace.endTick, trigger.tick);
    }
    return {
      id: spec.id,
      throttle: spec.throttle,
      completedTick: runRuntime.session.context.clock.tick,
      firstFieldTick,
      displacementM,
      finalPosition: finalMobility?.pose?.position || null,
      finalSpeedMPerS: finalMobility?.signedSpeed ?? null,
      peakUtilization,
      peakDistanceFromStartM,
      peakLoadedInvalidContactForceN,
      peakCanonicalContactAllocations,
      firstFailure,
      evidenceTrigger: trigger,
      artifactCausalState: artifact?.summary.causalState || null,
      observations,
    };
  } finally {
    runRuntime.dispose();
    assert.equal(
      cannonSolverTransactionResourceState(
        physicsWorld.worldAdapter.transaction,
      ).rollingSupportRegistrations,
      0,
      "rolling-support registration leaked after runtime disposal",
    );
    runtimeManager.disposeAll();
  }
}

const scenarios = [];
for (const spec of [
  {
    id: "slow-ramp-to-grass",
    x: 0,
    z: -44,
    placementSurfaceY: 0.05,
    throttle: 0.25,
    maximumTicks: 720,
    stopAfterFieldTicks: 240,
  },
  {
    id: "fast-ramp-to-grass",
    x: 0,
    z: -44,
    placementSurfaceY: 0.05,
    throttle: 1,
    maximumTicks: 480,
    stopAfterFieldTicks: 240,
  },
  {
    id: "constant-forward-short-grass",
    x: -48,
    z: 140,
    throttle: 0.7,
    maximumTicks: 1800,
  },
  {
    id: "constant-forward-dry-asphalt",
    x: -92,
    z: 140,
    throttle: 0.7,
    maximumTicks: 1800,
  },
  {
    id: "repeated-forward-reverse-short-grass",
    x: -48,
    z: 140,
    throttle: 0.7,
    reversePeriodTicks: 180,
    maximumTicks: 4800,
  },
  {
    id: "maximum-retention-export-budget",
    x: -48,
    z: 140,
    throttle: 0.7,
    diagnosticOnlyTriggerTick: 480,
    maximumTicks: 480,
  },
])
  scenarios.push(await runScenario(spec));

console.log(
  JSON.stringify(
    scenarios.map(({ observations, ...scenario }) => ({
      ...scenario,
      observationCount: observations.length,
      lastObservation: observations.at(-1),
    })),
    null,
    2,
  ),
);

for (const scenario of scenarios) {
  assert.equal(
    scenario.firstFailure,
    null,
    `${scenario.id} must not break on ordinary continuous terrain`,
  );
  if (scenario.id !== "maximum-retention-export-budget")
    assert.equal(
      scenario.evidenceTrigger,
      null,
      `${scenario.id} emitted a false diagnostic trigger`,
    );
  assert.equal(
    scenario.peakLoadedInvalidContactForceN,
    0,
    `${scenario.id} solved a geometrically invalid rolling contact`,
  );
  assert.ok(
    scenario.peakUtilization < 1,
    `${scenario.id} overloaded an authored connection (${scenario.peakUtilization})`,
  );
  assert.ok(
    scenario.peakCanonicalContactAllocations <= 64,
    `${scenario.id} canonical contact pool grew without a physical bound`,
  );
}

const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
for (const id of ["slow-ramp-to-grass", "fast-ramp-to-grass"])
  assert.notEqual(
    byId.get(id).firstFieldTick,
    null,
    `${id} did not reach grass`,
  );
assert.ok(
  byId.get("slow-ramp-to-grass").displacementM > 3,
  "slow ramp exit did not make sustained progress",
);
assert.ok(
  byId.get("fast-ramp-to-grass").displacementM > 5,
  "fast ramp exit did not make sustained progress",
);
for (const id of [
  "constant-forward-short-grass",
  "constant-forward-dry-asphalt",
]) {
  const scenario = byId.get(id);
  assert.equal(
    scenario.completedTick,
    1800,
    `${id} did not complete 15 seconds`,
  );
  assert.ok(
    scenario.displacementM > 20,
    `${id} stalled before sustained travel`,
  );
  assert.ok(
    Math.abs(scenario.finalSpeedMPerS) > 2,
    `${id} ended at stall speed`,
  );
}
const reversal = byId.get("repeated-forward-reverse-short-grass");
assert.equal(
  reversal.completedTick,
  4800,
  "reversal run ended before 40 seconds",
);
assert.ok(
  reversal.peakDistanceFromStartM > 3,
  "reversal run never demonstrated sustained powered motion",
);
const exportBudget = byId.get("maximum-retention-export-budget");
assert.equal(exportBudget.completedTick, 480);
assert.equal(exportBudget.evidenceTrigger?.tick, 480);
assert.equal(
  exportBudget.artifactCausalState,
  "complete",
  "full-retention rover evidence did not strict-export with a complete chain",
);

console.log(
  "rover failure-evidence diagnostic passed (slow/fast ramp, grass, asphalt, full production order)",
);
