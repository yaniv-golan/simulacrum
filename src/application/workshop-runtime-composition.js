import { installWorkshopRuntimeSubsystem } from "./workshop-runtime-subsystem.js";

/** Maps completed feature facades into the frame-loop and debug read-model ports. */
export function installWorkshopRuntimeComposition({
  target,
  shell,
  model,
  runtime,
  stage,
  editor,
  input,
  engineering,
  exchange,
  failure,
  mechanismLab,
  challenge,
  learningTopicCount,
  assembly,
  controllers,
  playback,
  testingPlayground,
  view,
  environment,
}) {
  const world = editor.world,
    cameraController = world.cameraController,
    streamer = world.streamer,
    directControl = assembly.controls.directControl;
  return installWorkshopRuntimeSubsystem({
    target,
    state: shell.state,
    model,
    runtime,
    simulation: {
      simulate: playback.simulate,
      simulateFrames: playback.simulateFrames,
      updateFailure: failure.update,
      elapsed: () => shell.state.elapsed,
    },
    presentation: {
      streamEarth: world.updateEarth,
      updateExploded: editor.exploded.update,
      updateEnvironment: world.updateEnvironment,
      waterTexture: () => world.waterNormalTexture,
      updateCamera: cameraController.update,
      updateBatch: () => stage.largeAssemblyBatcher.update(),
      render: () => stage.renderer.render(stage.scene, stage.camera),
      renderer: stage.renderer,
      camera: stage.camera,
      batchSnapshot: () => stage.largeAssemblyBatcher.snapshot(),
    },
    environment: {
      localToGlobal: stage.earth.localToGlobal,
      localSurfaceSample: stage.earth.surfaceSampleAt,
      detailLod: world.detailLodSnapshot,
      chunks: () => [...streamer.chunks.values()],
      skyColor: () => `#${stage.scene.background.getHexString()}`,
      starOpacity: () => stage.starMaterial.opacity,
      moonOpacity: () => stage.moonMaterial.opacity,
      earthOpacity: () => stage.earthMaterial.opacity,
      meteorite: () => ({
        x: stage.meteorite.position.x,
        y: stage.meteorite.position.y,
        z: stage.meteorite.position.z,
      }),
      ...environment,
    },
    editor: {
      cameraTarget: stage.cameraTarget,
      directManipulation: () => input.directManipulator.snapshot(),
      marqueeSelection: () => input.marqueeSelector.snapshot(),
      engineering: () => engineering.snapshot(),
      exchange: () => exchange?.snapshot() || null,
      failureAnalysis: () => failure.snapshot(),
      mechanismLab: () => mechanismLab.snapshot(),
      challengeContract: () => challenge?.snapshot() || null,
      learningTopicCount,
      camera: () => cameraController.snapshot(),
    },
    machine: {
      root: stage.machine,
      hasWheels: assembly.capabilities.hasWheels,
      directControl: (receivesShadows) =>
        directControl.snapshot(receivesShadows),
      platformReceivesShadows: () => stage.floor.receiveShadow,
    },
    assembly: {
      currentPart: assembly.workspace.currentPart,
      currentConnections: assembly.workspace.currentConnections,
      connectionValid: editor.editorPresentation.connectionValid,
      powered: assembly.workspace.powered,
      reducedShadows: assembly.workspace.reducedShadows,
    },
    controller: {
      active: controllers.activeController,
      telemetry: controllers.telemetry,
      controlBinding: assembly.workspace.controlBinding,
      controlOnline: assembly.controls.controlOnline,
      signalOutputCount: controllers.outputCount,
      trace: (id) =>
        controllers.trace.snapshot(id, {
          includeTraces: false,
        }),
      runtimeCount: () => controllers.runtimeManager.ids().length,
    },
    testingPlayground,
    view: {
      debug: {
        learningOpen: () =>
          !shell.query(".learn-center").classList.contains("hidden"),
        coachOpen: () =>
          !shell.query(".discovery-coach").classList.contains("hidden"),
        directVisible: () =>
          !shell.query(".drive-hud").classList.contains("hidden"),
        controllerStatus: () =>
          shell.query("#wasm-status")?.textContent || null,
        mission: () => shell.query("#mission-name").textContent,
      },
      renderUi: view.renderUi,
      renderRemote: assembly.controls.renderRemote,
      renderScriptEditor: controllers.render,
    },
  });
}
