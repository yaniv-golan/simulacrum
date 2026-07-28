import { createControllerSensorCapture } from "./controller-sensor-capture.js";
import { createFailureEvidenceCaptureCoordinator } from "./failure-evidence-capture-coordinator.js";
import {
  compiledTopologyFingerprint,
  fingerprintContactMaterialMap,
  fingerprintTestSiteDefinition,
} from "./mechanism-run-identity.js";
import { createSimulationRunRuntime } from "./simulation-run-runtime.js";
import { createTestSiteFixtureBodies } from "./test-site-fixture-feature.js";
import { createTestingPlaygroundEnvironment } from "./testing-playground-environment.js";
import { createWorkshopPhysicsWorld } from "./workshop-physics-world.js";
import { decodeBlueprintOrThrow } from "../model/blueprint-decoder.js";
import { controllerBindingManifest } from "../model/controller-bindings.js";
import { decodeFailureEvidenceOrThrow } from "../model/failure-evidence-artifacts.js";
import { stableStringify } from "../model/primitives.js";
import {
  compileVisualProgram,
  DEFAULT_VISUAL_PROGRAM,
} from "../model/visual-logic.js";
import { testSiteVegetationFixtures } from "../model/test-site-vegetation.js";
import { TYPES } from "../model/component-catalog.js";
import { ControllerSensorBank } from "../simulation/controller-sensors.js";
import { createEarthEnvironmentBodyRegistry } from "../simulation/environment/earth-environment-bodies.js";
import { sampleWindVelocity } from "../simulation/environment/wind-field.js";
import { FailureEvidenceRecorder } from "../simulation/failure-evidence-recorder.js";
import { InputTracePlayer } from "../simulation/input-trace-player.js";
import { RuntimeCheckpointCoordinator } from "../simulation/runtime-checkpoints.js";
import { ControllerRuntimeManager } from "../scripting/controller-runtime-manager.js";
import {
  prepareControlIRController,
  prepareTypeScriptController,
  prepareWasmController,
} from "../scripting/controller-compilers.js";

function ownerPayload(checkpoint, ownerId) {
  const owner = checkpoint.stateOwners.find(
    (candidate) => candidate.ownerId === ownerId,
  );
  return owner ? JSON.parse(owner.payloadJson) : null;
}

function sortedIds(values) {
  return [...new Set(values.filter(Boolean).map(String))].sort((left, right) =>
    left.localeCompare(right, "en"),
  );
}

function frameProjection(artifact) {
  const frame = artifact.exactFrames.find(
    (candidate) => candidate.tick === artifact.trigger.tick,
  );
  return {
    trigger: artifact.trigger,
    firstFailedConnectionId: artifact.summary.firstFailedConnectionId,
    preTopologyRevision: artifact.summary.preTopologyRevision,
    postTopologyRevision: artifact.summary.postTopologyRevision,
    connectionLoads: frame.connectionLoads,
    rowIds: sortedIds(frame.solverContributions.map((row) => row.rowId)),
    contactIds: sortedIds(frame.contacts.map((contact) => contact.contactId)),
  };
}

function compareProjection(expected, actual) {
  const mismatches = [];
  for (const field of [
    "trigger",
    "firstFailedConnectionId",
    "preTopologyRevision",
    "postTopologyRevision",
    "connectionLoads",
    "rowIds",
    "contactIds",
  ])
    if (stableStringify(expected[field]) !== stableStringify(actual[field]))
      mismatches.push({
        field,
        expected: expected[field],
        actual: actual[field],
      });
  return mismatches;
}

async function prepareReplayController(controller, snapshot, state) {
  const manifest = controllerBindingManifest(
      controller,
      snapshot.parts,
      snapshot.connections,
    ),
    language = String(state.language || controller.scriptLanguage || "");
  if (language === "typescript")
    return prepareTypeScriptController(
      controller.scriptSources?.typescript || "",
      manifest,
    );
  if (language === "wat")
    return prepareWasmController(controller.scriptSources?.wat || "", manifest);
  if (language === "visual") {
    const compiled = compileVisualProgram(
      controller.scriptSources?.visual || DEFAULT_VISUAL_PROGRAM,
      manifest,
    );
    return prepareControlIRController(compiled.ir);
  }
  throw new Error(`unsupported replay controller language ${language}`);
}

async function createReplayControllers({
  snapshot,
  controllerState,
  tracePlayer,
  sensorCapture,
}) {
  const runtimeManager = new ControllerRuntimeManager(),
    controllersById = new Map(
      snapshot.parts
        .filter((part) => part.type === "computer")
        .map((part) => [part.id, part]),
    );
  let inputTick = 0;
  for (const state of controllerState || []) {
    const controller = controllersById.get(state.controllerId);
    if (!controller)
      throw new Error(
        `checkpoint controller ${String(state.controllerId)} is absent from the blueprint`,
      );
    runtimeManager.attach(
      controller.id,
      await prepareReplayController(controller, snapshot, state),
      state.label || "SCRIPT",
    );
  }
  return {
    captureSensors(context, fixedDt) {
      inputTick = context.clock.tick;
      return sensorCapture(context, fixedDt);
    },
    tick(dt, sensorSnapshot = {}) {
      const poweredControllerIds = sensorSnapshot.poweredControllerIds;
      for (const controllerId of runtimeManager.ids()) {
        if (
          poweredControllerIds &&
          !poweredControllerIds.includes(controllerId)
        ) {
          runtimeManager.dispose(controllerId);
          continue;
        }
        runtimeManager.tick(
          controllerId,
          dt,
          sensorSnapshot.controllers?.[controllerId] || {},
        );
      }
    },
    readCommandCandidates() {
      return {
        remote: tracePlayer.readCommandCandidates(inputTick).remote,
        scripts: snapshot.parts.flatMap((controller) => {
          if (
            controller.type !== "computer" ||
            !runtimeManager.ready(controller.id)
          )
            return [];
          const bindings = new Map(
            (controller.controllerBindings || [])
              .filter((binding) => binding.direction === "output")
              .map((binding) => [binding.id, binding]),
          );
          return [...runtimeManager.commands(controller.id)].map(
            ([bindingId, value]) => {
              const binding = bindings.get(bindingId);
              return {
                controllerId: controller.id,
                bindingId,
                targetId: binding?.endpointPartId ?? null,
                endpointPortId: binding?.endpointPortId ?? null,
                channel: binding?.channel ?? null,
                value,
              };
            },
          );
        }),
      };
    },
    telemetry: () => ({
      runtimes: runtimeManager.ids().map((controllerId) => ({
        controllerId,
        ...runtimeManager.status(controllerId),
      })),
    }),
    runtimeManager,
  };
}

/** Replays one strict artifact through a fresh production SimulationSession. */
export async function verifyFailureEvidenceReplay(input) {
  const artifact = decodeFailureEvidenceOrThrow(input).wire;
  if (artifact.replayability.status !== "supported")
    return {
      reproduced: false,
      trigger: artifact.trigger,
      mismatches: [
        {
          field: "replayability",
          expected: "supported",
          actual: artifact.replayability,
        },
      ],
    };

  const controllerState = ownerPayload(
    artifact.replayAnchorCheckpoint,
    "controllers",
  );
  const environment = createTestingPlaygroundEnvironment(),
    identityMismatches = [];
  for (const [field, actual] of [
    [
      "testSiteFingerprint",
      fingerprintTestSiteDefinition(environment.testSite),
    ],
    ["materialMapFingerprint", fingerprintContactMaterialMap()],
  ])
    if (artifact.runIdentity[field] !== actual)
      identityMismatches.push({
        field: `runIdentity.${field}`,
        expected: artifact.runIdentity[field],
        actual,
      });
  if (identityMismatches.length)
    return {
      reproduced: false,
      trigger: artifact.trigger,
      mismatches: identityMismatches,
    };

  const snapshot = decodeBlueprintOrThrow(artifact.blueprint).assembly,
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

  const tracePlayer = new InputTracePlayer(artifact.externalInputTrace, {
      targetIds: snapshot.parts.map((part) => part.id),
    }),
    sensorBank = new ControllerSensorBank(),
    sensorCapture = createControllerSensorCapture({
      sampleWind: (position, time) =>
        sampleWindVelocity(position, {
          enabled: artifact.runIdentity.environment.windEnabled,
          elapsedSeconds: time,
        }),
      sensorBank,
    }),
    recorder = new FailureEvidenceRecorder({
      policy: artifact.diagnosticPolicy,
    });
  recorder.beginRun({
    runIdentity: {
      ...artifact.runIdentity,
      configuration: artifact.runConfiguration,
    },
  });
  recorder.setReplayability({ supported: true });
  const artifactRuntime = {
      runBlueprint: artifact.blueprint,
      runIdentity: {
        ...artifact.runIdentity,
        deployment: JSON.parse(artifact.runIdentity.deploymentJson),
        configuration: artifact.runConfiguration,
      },
      inputTraceRecorder: {
        inputsThrough: (tick) =>
          artifact.externalInputTrace.inputs.filter(
            (entry) => entry.tick <= tick,
          ),
      },
      failureEvidence: {
        recorder,
        replayAnchor: artifact.replayAnchorCheckpoint,
        captureCoordinator: null,
      },
    },
    captureCoordinator = createFailureEvidenceCaptureCoordinator({
      runtime: artifactRuntime,
    });
  artifactRuntime.failureEvidence.captureCoordinator = captureCoordinator;
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
    windAt: (position, time) =>
      sampleWindVelocity(position, {
        enabled: artifact.runIdentity.environment.windEnabled,
        elapsedSeconds: time,
      }),
    materialForPart: () => physicsWorld.debrisMaterial,
  };
  let controllers;
  try {
    controllers = await createReplayControllers({
      snapshot,
      controllerState,
      tracePlayer,
      sensorCapture,
    });
  } catch (error) {
    return {
      reproduced: false,
      trigger: artifact.trigger,
      mismatches: [
        {
          field: "controllers",
          expected: "embedded programs matching the checkpoint identity",
          actual: error instanceof Error ? error.message : String(error),
        },
      ],
    };
  }
  controllers.sensorBank = sensorBank;
  const runRuntime = createSimulationRunRuntime({
    snapshot,
    physics,
    controllers,
    evidence: {
      inputTraceRecorder: null,
      failureEvidenceRecorder: recorder,
      failureEvidenceCaptureCoordinator: captureCoordinator,
    },
    services: {
      resolveChallengeBinding: () => null,
      windEnabled: artifact.runIdentity.environment.windEnabled,
      connectionValid: () => true,
      CheckpointCoordinator: RuntimeCheckpointCoordinator,
    },
  });
  try {
    const topologyFingerprint = compiledTopologyFingerprint(
      runRuntime.multibodyRuntime.compiled,
    );
    if (
      topologyFingerprint !== artifact.runIdentity.compiledTopologyFingerprint
    )
      return {
        reproduced: false,
        trigger: artifact.trigger,
        mismatches: [
          {
            field: "runIdentity.compiledTopologyFingerprint",
            expected: artifact.runIdentity.compiledTopologyFingerprint,
            actual: topologyFingerprint,
          },
        ],
      };
    runRuntime
      .createCheckpointCoordinator(null)
      .restore(artifact.replayAnchorCheckpoint, {
        runConfigurationFingerprint:
          artifact.runIdentity.runConfigurationFingerprint,
        blueprintFingerprint: artifact.runIdentity.blueprintFingerprint,
        compiledTopologyFingerprint:
          artifact.runIdentity.compiledTopologyFingerprint,
      });
    tracePlayer.reset();
    while (runRuntime.session.context.clock.tick < artifact.trigger.tick)
      runRuntime.session.stepFixed();
    const actualArtifact = captureCoordinator.artifact();
    if (
      !actualArtifact ||
      actualArtifact.trigger.tick !== artifact.trigger.tick
    )
      return {
        reproduced: false,
        trigger: artifact.trigger,
        mismatches: [
          {
            field: "trigger",
            expected: artifact.trigger,
            actual: actualArtifact?.trigger || null,
          },
        ],
      };
    const mismatches = compareProjection(
      frameProjection(artifact),
      frameProjection(actualArtifact),
    );
    if (
      stableStringify(artifact.priorEpisodeBoundaries) !==
      stableStringify(actualArtifact.priorEpisodeBoundaries)
    )
      mismatches.push({
        field: "priorEpisodeBoundaries",
        expected: artifact.priorEpisodeBoundaries,
        actual: actualArtifact.priorEpisodeBoundaries,
      });
    if (
      artifact.summary.contributionValidity === "truncated" ||
      artifact.summary.contributionValidity === "unavailable"
    )
      mismatches.push({
        field: "summary.contributionValidity",
        expected: "measured or derived",
        actual: artifact.summary.contributionValidity,
      });
    return {
      reproduced: mismatches.length === 0,
      trigger: actualArtifact.trigger,
      mismatches,
    };
  } finally {
    runRuntime.dispose();
    controllers.runtimeManager.disposeAll();
  }
}
