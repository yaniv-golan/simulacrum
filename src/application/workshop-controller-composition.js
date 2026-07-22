import { createWorkshopControllerWorkspace } from "./workshop-controller-workspace.js";

/** Maps shell, runtime telemetry, power, and environment into controller tools. */
export function createWorkshopControllerComposition({
  shell,
  runtime,
  definitions,
  power,
  environment,
  view,
}) {
  const state = shell.state;
  return createWorkshopControllerWorkspace({
    state,
    channels: definitions.channels,
    defaultSources: shell.newControllerSources,
    power: { isPowered: power.isPowered },
    telemetry: {
      time: () => runtime.telemetry.time,
      conflicts: () => runtime.telemetry.systems?.commands?.conflicts || [],
    },
    environment: { sampleWind: environment.sampleWind },
    view: {
      query: shell.query,
      queryAll: shell.queryAll,
      schedule: (callback) => requestAnimationFrame(callback),
      pauseForBreakpoint: (hit) => {
        state.simulationPaused = true;
        view.render();
        shell.notify(`Breakpoint · ${hit.name} = ${hit.current.toFixed(3)}`);
      },
      notify: shell.notify,
    },
  });
}
