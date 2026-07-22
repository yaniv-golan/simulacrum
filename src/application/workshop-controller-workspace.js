import { createControllerBindingEditorAdapter } from "./controller-binding-editor-adapter.js";
import { installExecutableTrustFeature } from "./executable-trust-feature.js";
import { createControllerSubsystem } from "./controller-subsystem.js";

/** Owns independent controller runtimes and their trust/debug presentation. */
export function createWorkshopControllerWorkspace({
  state,
  channels,
  defaultSources,
  power,
  telemetry,
  environment,
  view,
}) {
  let logicWorkbench,
    trust,
    debugRefreshPending = false,
    workbenchOptions;
  const controller = createControllerSubsystem({
    state,
    channels,
    defaultSources,
    power,
    trust: { current: () => trust },
    telemetry,
    environment,
    view: {
      ...view,
      workbench: () => logicWorkbench,
      refreshDebug: () => {
        if (debugRefreshPending) return;
        debugRefreshPending = true;
        view.schedule(() => {
          debugRefreshPending = false;
          logicWorkbench?.refreshDebug();
        });
      },
    },
  });
  async function ensureWorkbench() {
    if (logicWorkbench) return logicWorkbench;
    if (!workbenchOptions)
      throw new Error("Controller tools are not installed");
    const { installLogicWorkbench } =
      await import("../presentation/logic-workbench.js");
    logicWorkbench = installLogicWorkbench(workbenchOptions);
    return logicWorkbench;
  }
  const installTools = ({ simulation, assembly, notify }) => {
    trust = installExecutableTrustFeature({
      getController: controller.activeController,
      saveProgram: controller.save,
      stopRuntime: controller.stop,
      notify,
      query: view.query,
    });
    const bindings = createControllerBindingEditorAdapter({
      getController: controller.activeController,
      parts: assembly.parts,
      connections: assembly.connections,
      invalidate: trust.invalidate,
      notify,
    });
    workbenchOptions = {
      getProgram: () => state.scriptSources.visual,
      setProgram: (program) => {
        state.scriptSources.visual = structuredClone(program);
        const active = controller.activeController();
        if (active) {
          active.scriptSources.visual = structuredClone(program);
          trust.invalidate(active);
        }
      },
      ...bindings,
      getDebug: () =>
        controller.trace.snapshot(controller.activeController()?.id),
      setWatches: (names) =>
        controller.trace.setWatches(controller.activeController()?.id, names),
      setBreakpoint: (breakpoint) =>
        controller.trace.setBreakpoint(
          controller.activeController()?.id,
          breakpoint,
        ),
      clearTrace: () =>
        controller.trace.clear(controller.activeController()?.id),
      stepSimulation: simulation.step,
      toggleSimulation: simulation.toggle,
    };
    return Object.freeze({ trust });
  };

  return Object.freeze({
    ...controller,
    installTools,
    async open(...args) {
      await ensureWorkbench();
      return controller.open(...args);
    },
  });
}
