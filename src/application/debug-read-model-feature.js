import {
  buildAssemblyDebugReadModel,
  buildControllerDebugReadModel,
  buildEditorDebugReadModel,
  buildHumanoidDebugReadModel,
  installJsonTextReadModel,
} from "../presentation/text-read-model.js";
import { buildEnvironmentDebugReadModel } from "../presentation/environment-debug-read-model.js";
import { ENVIRONMENT_DEBUG_CONTRACT } from "./environment-debug-contract.js";
import {
  buildMachineDebugReadModel,
  projectProximityMeasurements,
} from "../presentation/machine-debug-read-model.js";
import { projectMachineTelemetry } from "../presentation/machine-telemetry-projection.js";
import { pendingPlacementReadModel } from "./pending-placement-read-model.js";
import { remoteActionTargetPartIds } from "../model/remote-actions.js";
import { flexibleLineDebugReadModel } from "./flexible-line-debug-read-model.js";
import { sensorRpmFromTelemetry as sensorRpm } from "../presentation/sensor-rpm-read-model.js";
import * as workshopAxes from "../presentation/workshop-axis-presentation.js";
/** Installs the stable automation/debug read models from explicit subsystem ports. */
export function installDebugReadModelFeature({
  target,
  state,
  model,
  session,
  telemetry,
  environment,
  editor,
  machine,
  assembly,
  controller,
  testingPlayground,
  view,
}) {
  function controllerTelemetry() {
    return telemetry().systems?.controllers || controller.runtimeTelemetry();
  }
  function environmentReadModel() {
    const frame = telemetry(),
      focus = state.running ? machine.root.position : editor.cameraTarget;
    return buildEnvironmentDebugReadModel({
      focus: { x: focus.x, z: focus.z },
      origin: {
        eastM: state.earthOriginEastM,
        northM: state.earthOriginNorthM,
      },
      localToGlobal: environment.localToGlobal,
      localSurfaceSample: environment.localSurfaceSample,
      detailLod: environment.detailLod,
      chunks: environment.chunks(),
      timeOfDay: state.timeOfDay,
      sunElevationDeg: state.sunElevationDeg || 0,
      spaceBlend: state.spaceBlend,
      skyColor: environment.skyColor(),
      windEnabled: state.windEnabled,
      elapsed: frame.time,
      starOpacity: environment.starOpacity(),
      moonOpacity: environment.moonOpacity(),
      earthOpacity: environment.earthOpacity(),
      meteorite: environment.meteorite(),
      environment: ENVIRONMENT_DEBUG_CONTRACT,
    });
  }
  function editorReadModel() {
    const frame = telemetry(),
      activeSession = session(),
      mechanismLab = editor.mechanismLab();
    return buildEditorDebugReadModel({
      mode: state.editor.mode,
      tool: state.editor.tool,
      cameraTool: state.editor.cameraTool,
      directManipulation: editor.directManipulation(),
      pendingPlacement: pendingPlacementReadModel(state.editor.placing),
      lastPlacement: structuredClone(state.editor.lastPlacementResult),
      lastTransformOperation: structuredClone(
        state.editor.lastTransformOperation,
      ),
      transformGizmo: editor.transformGizmo(),
      marqueeSelection: editor.marqueeSelection(),
      exploded: {
        active: state.exploded,
        amount: state.explodeAmount,
        centerLift: state.explodeCameraLift || 0,
        displayedParts: state.exploded
          ? state.parts.map((part) => ({
              id: part.id,
              x: +part.mesh.position.x.toFixed(2),
              y: +part.mesh.position.y.toFixed(2),
              z: +part.mesh.position.z.toFixed(2),
            }))
          : undefined,
      },
      running: state.running,
      simulationPaused: state.simulationPaused,
      timeScale: state.timeScale,
      simulationTime: frame.time,
      architecture: {
        assemblyRevision: model.revision,
        fixedStepHz: activeSession
          ? Math.round(1 / activeSession.fixedDt)
          : 120,
        session: activeSession?.telemetry() || null,
      },
      engineering: editor.engineering(),
      exchange: editor.exchange(),
      failureAnalysis: editor.failureAnalysis(),
      mechanismLab,
      challenge: state.activeChallenge
        ? {
            id: state.activeChallenge,
            status: state.challengeStatus,
            progress: state.challengeProgress,
            holdSeconds: state.challengeHold,
            score: state.challengeScore,
            best: state.challengeBest[state.activeChallenge] || 0,
            startMode: state.challengeStartMode,
            contract: editor.challengeContract(),
            records: state.challengeRecords,
          }
        : null,
      learning: {
        centerOpen: view.learningOpen(),
        topic: state.learnTopic,
        category: state.learnCategory,
        coachOpen: view.coachOpen(),
        coachStep: state.coachStep,
        topicsAvailable: editor.learningTopicCount,
      },
      tutorialStep: state.tutorial,
      selectedPart: state.editor.selected,
      selectedParts: [...state.editor.selectedIds],
      selectedEntity: state.editor.selectedEntity,
      cameraTarget: editor.cameraTarget,
      camera: editor.camera(),
      componentInspection: editor.inspection(),
    });
  }
  function machineReadModel() {
    const frame = telemetry(),
      wheelCapable = machine.hasWheels(),
      projection = projectMachineTelemetry(
        frame,
        state.parts,
        machine.root.position,
        remoteActionTargetPartIds(
          state.remoteProfiles[state.remoteProfile],
          state.remoteControls[state.remoteProfile] || [],
        ),
      );
    return buildMachineDebugReadModel({
      kind: state.demo,
      position: projection.position,
      rotationY: machine.root.rotation.y,
      parts: projection.parts,
      wheelCapable,
      mobility: projection.mobility,
      flight: projection.flight,
      systems: frame.systems,
      proximityMeasurements: projectProximityMeasurements(frame),
      environmentBodies: frame.systems?.environmentBodies?.bodies || [],
      directControl: machine.directControl(machine.platformReceivesShadows()),
    });
  }
  function assemblyReadModel() {
    return buildAssemblyDebugReadModel({
      parts: state.parts.map((part) => ({
        ...part,
        measuredRpm:
          part.type === "sensor" ? sensorRpm(telemetry(), part.id) : undefined,
        runtimeEnergy:
          part.type === "battery"
            ? assembly.currentPart(part.id)?.energyWh
            : undefined,
        powered:
          part.type === "motor"
            ? state.running
              ? telemetry().systems?.power?.poweredPartIds?.includes(part.id)
              : assembly.powered(part)
            : undefined,
      })),
      connections: assembly.currentConnections().map((connection) => ({
        ...connection,
        valid: assembly.connectionValid(connection),
      })),
    });
  }
  function controllerReadModel() {
    const active = controller.active() || null,
      runtime = controllerTelemetry(),
      controls = state.remoteControls[state.remoteProfile] || [],
      profile = state.remoteProfiles[state.remoteProfile];
    return buildControllerDebugReadModel({
      profile: state.remoteProfile,
      profileDefinition: profile,
      controls: controls.map((control) => ({
        ...control,
        bindingStatus: controller.controlBinding(control).status,
      })),
      layout: state.controllerLayouts[state.remoteProfile] || null,
      directVisible: view.directVisible(),
      directPinned: Boolean(state.directSurfaces[state.remoteProfile]),
      language: state.scriptLanguage,
      controller: active,
      powered: active ? assembly.powered(active) : false,
      signalOutputs: controller.signalOutputCount(active),
      runtimes: runtime.runtimes,
      conflicts: runtime.conflicts,
      status: view.controllerStatus(),
      visualNodes: state.scriptSources.visual?.nodes?.length || 0,
      debug: controller.trace(active?.id),
    });
  }
  installJsonTextReadModel(
    "render_game_to_text",
    () => ({
      coordinateSystem: workshopAxes.workshopCoordinateSystemSummary(),
      coordinateFrames: workshopAxes.workshopCoordinateFrames(),
      environment: environmentReadModel(),
      testingPlayground: testingPlayground.snapshot(),
      ...editorReadModel(),
      demo: machineReadModel(),
      ...assemblyReadModel(),
      ...controllerReadModel(),
      flexibleLines: flexibleLineDebugReadModel({
        parts: state.parts,
        connections: assembly.currentConnections(),
        telemetry: telemetry(),
        running: state.running,
      }),
      mission: view.mission(),
      presentation: view.presentation(),
    }),
    target,
  );
  installJsonTextReadModel(
    "render_humanoid_debug",
    () => buildHumanoidDebugReadModel(telemetry().systems?.articulated),
    target,
  );
}
