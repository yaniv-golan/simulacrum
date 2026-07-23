import { sharedRenderResourceStats } from "../presentation/render-resources.js";
import { installDebugReadModelFeature } from "./debug-read-model-feature.js";
import { installWorkshopRuntimeLoop } from "./workshop-runtime-loop.js";

/** Installs the frame loop, diagnostics read model, resize, and initial paint. */
export function installWorkshopRuntimeSubsystem({
  target,
  state,
  model,
  runtime,
  simulation,
  presentation,
  environment,
  editor,
  machine,
  assembly,
  controller,
  testingPlayground,
  view,
}) {
  installWorkshopRuntimeLoop({
    target,
    simulation,
    presentation: {
      streamEarth: presentation.streamEarth,
      updateExploded: presentation.updateExploded,
      updateEnvironment: presentation.updateEnvironment,
      updateWater: (time) =>
        presentation.waterTexture()?.offset.set(time * 0.012, time * -0.007),
      updateCamera: presentation.updateCamera,
      updateBatch: presentation.updateBatch,
      render: presentation.render,
    },
    diagnostics: () => ({
      renderer: {
        calls: presentation.renderer.info.render.calls,
        triangles: presentation.renderer.info.render.triangles,
        geometries: presentation.renderer.info.memory.geometries,
        textures: presentation.renderer.info.memory.textures,
        programs: presentation.renderer.info.programs?.length || 0,
        pixelRatio: presentation.renderer.getPixelRatio(),
      },
      shared: sharedRenderResourceStats(),
      parts: state.parts.length,
      heatBindings: state.parts.reduce(
        (sum, part) => sum + (part.ambientHeatBindings?.length || 0),
        0,
      ),
      controllers: controller.runtimeCount(),
      reducedComponentShadows: assembly.reducedShadows(),
      largeAssemblyBatch: presentation.batchSnapshot(),
    }),
  });

  installDebugReadModelFeature({
    target,
    state,
    model,
    session: () => runtime.session,
    telemetry: () => runtime.telemetry,
    environment,
    editor,
    machine,
    assembly,
    controller: {
      active: controller.active,
      runtimeTelemetry: controller.telemetry,
      controlBinding: controller.controlBinding,
      signalOutputCount: controller.signalOutputCount,
      trace: controller.trace,
    },
    testingPlayground,
    view: view.debug,
  });

  target.addEventListener("resize", () => {
    presentation.camera.aspect = target.innerWidth / target.innerHeight;
    presentation.camera.updateProjectionMatrix();
    presentation.renderer.setSize(target.innerWidth, target.innerHeight);
  });
  view.renderUi();
  view.renderRemote();
  view.renderScriptEditor();
}
