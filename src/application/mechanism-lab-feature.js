import { compileAssembly } from "../model/assembly-compiler.js";
import { installMechanismLab } from "../presentation/mechanism-lab.js";

/** Binds the presentation workbench to one run without enlarging its owner. */
export function createRunMechanismLab({
  runtime,
  assembly,
  catalog,
  persistence,
  state,
  playback,
  getSimulation,
  presentation,
  actions,
  notify,
}) {
  return installMechanismLab({
    getTelemetry: () => runtime.telemetry,
    getSession: () => runtime.session,
    getCompiled: () =>
      runtime.multibodyRuntime?.compiled ||
      compileAssembly(assembly.workspace.model.snapshot(), catalog),
    getBlueprint: () =>
      runtime.runBlueprint ||
      persistence.serializeBlueprint("Mechanism experiment"),
    getRuntime: () => runtime,
    selectPart: presentation.selectPart,
    commands: {
      paused: () => state.simulationPaused,
      run: () =>
        state.running ? getSimulation()?.stop() : getSimulation()?.start(),
      pause: playback.togglePause,
      step: playback.step,
      reset: () => getSimulation()?.reset(),
    },
    afterRestore: () => {
      runtime.telemetry = runtime.session.telemetry();
      assembly.telemetry.present(runtime.telemetry);
      actions.render();
    },
    createExperiment: (options) =>
      import("./mechanism-experiment-export.js").then((module) =>
        module.createMechanismExperiment({
          ...options,
          inputTraceRecorder: runtime.inputTraceRecorder,
        }),
      ),
    notify,
  });
}
