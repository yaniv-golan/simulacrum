import assert from "node:assert/strict";
import { createControllerSensorCapture } from "../src/application/controller-sensor-capture.js";
import { createFailureEvidenceArtifact } from "../src/application/failure-evidence-export.js";
import { verifyFailureEvidenceReplay } from "../src/application/failure-evidence-replay.js";
import { failureEvidenceManifestDigest } from "../src/model/failure-evidence-artifacts.js";
import { createWorkshopRunConfiguration } from "../src/application/mechanism-run-identity.js";
import { createSimulationRunRuntime } from "../src/application/simulation-run-runtime.js";
import { createTestSiteFixtureBodies } from "../src/application/test-site-fixture-feature.js";
import { createTestingPlaygroundEnvironment } from "../src/application/testing-playground-environment.js";
import { createWorkshopPhysicsWorld } from "../src/application/workshop-physics-world.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { controllerBindingManifest } from "../src/model/controller-bindings.js";
import { TYPES } from "../src/model/component-catalog.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { testSiteVegetationFixtures } from "../src/model/test-site-vegetation.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import {
  BUILD_SITE_LAT_DEG,
  BUILD_SITE_LON_DEG,
} from "../src/simulation/environment/earth.js";
import { createEarthEnvironmentBodyRegistry } from "../src/simulation/environment/earth-environment-bodies.js";
import { FailureEvidenceRecorder } from "../src/simulation/failure-evidence-recorder.js";
import { InputTraceRecorder } from "../src/simulation/input-trace-recorder.js";
import { RuntimeCheckpointCoordinator } from "../src/simulation/runtime-checkpoints.js";
import { ControllerRuntimeManager } from "../src/scripting/controller-runtime-manager.js";
import { prepareTypeScriptController } from "../src/scripting/controller-compilers.js";

const blueprint = structuredClone(builtInDemo("cart").blueprint),
  weakConnection = blueprint.connections.find(
    (connection) => connection.kind === "mechanical",
  );
weakConnection.capacity = { ultimateForceN: 230, ultimateTorqueNm: 230 };
const snapshot = decodeBlueprintOrThrow(blueprint).assembly,
  environment = createTestingPlaygroundEnvironment(),
  physicsWorld = createWorkshopPhysicsWorld({
    surfaceSampleAt: environment.surfaceSampleAt,
    footprint: environment.testSite.footprint,
  });
for (const body of createTestSiteFixtureBodies({
  fixtures: [
    ...environment.testSite.staticFixtures,
    ...testSiteVegetationFixtures(environment.testSite),
  ],
  terrainHeightAt: environment.terrainHeightAt,
  groundMaterial: physicsWorld.groundMaterial,
}))
  physicsWorld.world.addBody(body);

const controller = snapshot.parts.find((part) => part.type === "computer"),
  driveReceiver = snapshot.parts.find(
    (part) =>
      part.id ===
      controller.controllerBindings.find(
        (binding) => binding.id === "pilot.drive",
      ).endpointPartId,
  ),
  sensorBank = new ControllerSensorBank(),
  runtimeManager = new ControllerRuntimeManager(),
  sensorCapture = createControllerSensorCapture({
    sampleWind: () => ({ x: 0, y: 0, z: 0 }),
    sensorBank,
  }),
  inputTraceRecorder = new InputTraceRecorder(),
  recorder = new FailureEvidenceRecorder();
runtimeManager.attach(
  controller.id,
  await prepareTypeScriptController(
    controller.scriptSources.typescript,
    controllerBindingManifest(controller, snapshot.parts, snapshot.connections),
  ),
  "TYPESCRIPT",
);
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
    captureSensors(context, fixedDt) {
      inputTick = context.clock.tick;
      return sensorCapture(context, fixedDt);
    },
    tick: (dt, sensors) =>
      runtimeManager.tick(
        controller.id,
        dt,
        sensors.controllers?.[controller.id] || {},
      ),
    readCommandCandidates: () => ({
      remote: [
        {
          targetId: driveReceiver.id,
          channel: "command",
          value: 1,
          active: inputTick >= 1,
        },
      ],
      scripts: [...runtimeManager.commands(controller.id)].map(
        ([bindingId, value]) => {
          const binding = controller.controllerBindings.find(
            (candidate) => candidate.id === bindingId,
          );
          return {
            controllerId: controller.id,
            bindingId,
            targetId: binding.endpointPartId,
            endpointPortId: binding.endpointPortId,
            channel: binding.channel,
            value,
          };
        },
      ),
    }),
    telemetry: () => ({}),
    sensorBank,
    runtimeManager,
  },
  runRuntime = createSimulationRunRuntime({
    snapshot,
    physics,
    controllers,
    evidence: { inputTraceRecorder, failureEvidenceRecorder: recorder },
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
    solverProfile: physics.worldAdapter.exportState().solverProfile,
  });
recorder.beginRun({ runIdentity });
const replayAnchor = runRuntime
  .createCheckpointCoordinator(inputTraceRecorder)
  .capture(
    JSON.stringify({
      runConfigurationFingerprint: runIdentity.runConfigurationFingerprint,
      blueprintFingerprint: runIdentity.blueprintFingerprint,
      compiledTopologyFingerprint: runIdentity.compiledTopologyFingerprint,
    }),
  );
recorder.setReplayability({ supported: true });
for (let tick = 1; tick <= 20 && !recorder.snapshot().trigger; tick++)
  runRuntime.session.stepFixed();
assert.ok(recorder.snapshot().trigger, "weak authored connection did not fail");
const artifact = createFailureEvidenceArtifact({
    runtime: {
      runBlueprint: blueprint,
      runIdentity,
      inputTraceRecorder,
      failureEvidence: { recorder, replayAnchor },
    },
  }),
  firstReplay = await verifyFailureEvidenceReplay(artifact),
  secondReplay = await verifyFailureEvidenceReplay(artifact);
assert.deepEqual(firstReplay, secondReplay, "independent replays diverged");
assert.equal(
  firstReplay.reproduced,
  true,
  `failure replay mismatch: ${JSON.stringify(firstReplay.mismatches)}`,
);
const alteredArtifact = structuredClone(artifact);
for (const input of alteredArtifact.externalInputTrace.inputs) input.value = 0;
alteredArtifact.manifestDigest = failureEvidenceManifestDigest(alteredArtifact);
const alteredReplay = await verifyFailureEvidenceReplay(alteredArtifact);
assert.equal(
  alteredReplay.reproduced,
  false,
  "altered external input trace unexpectedly reproduced",
);
const inventedBoundaryArtifact = structuredClone(artifact);
inventedBoundaryArtifact.priorEpisodeBoundaries = [
  {
    episodeIndex: 0,
    trigger: {
      kind: "numerical-anomaly",
      tick: 1,
      timeS: 1 / 120,
      subjectId: "invented-prior-episode",
      validity: "measured",
    },
    policyFingerprint: artifact.policyFingerprint,
  },
];
inventedBoundaryArtifact.manifestDigest = failureEvidenceManifestDigest(
  inventedBoundaryArtifact,
);
const inventedBoundaryReplay = await verifyFailureEvidenceReplay(
  inventedBoundaryArtifact,
);
assert.equal(
  inventedBoundaryReplay.reproduced,
  false,
  "replay accepted a missing prior episode boundary",
);
assert.ok(
  inventedBoundaryReplay.mismatches.some(
    (entry) => entry.field === "priorEpisodeBoundaries",
  ),
  inventedBoundaryReplay.mismatches,
);

runRuntime.dispose();
runtimeManager.disposeAll();
console.log(
  `failure evidence replay passed twice (trigger ${artifact.trigger.kind} at tick ${artifact.trigger.tick})`,
);
