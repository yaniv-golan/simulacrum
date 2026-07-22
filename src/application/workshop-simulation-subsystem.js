import { createDemoChallengeFeature } from "./demo-challenge-feature.js";
import { createSimulationLifecycleLoader } from "./simulation-lifecycle-loader.js";

/** Composes demo/challenge loading with the unified fixed-step run lifecycle. */
export function createWorkshopSimulationSubsystem({
  state,
  runtime,
  definitions,
  history,
  builder,
  controllers,
  assembly,
  physics,
  presentation,
  persistence,
  view,
}) {
  let requestedRun = 0;
  const stop = () => lifecycleLoader.current()?.stop(),
    demo = createDemoChallengeFeature({
      store: state,
      definitions,
      history,
      builder,
      controllers: {
        stop: controllers.stop,
        ensureControls: controllers.ensureControls,
        resetDriveInput: presentation.resetDriveInput,
        bind: controllers.bind,
        compile: controllers.compile,
      },
      simulation: { stop },
      view,
      persistence,
    });

  const lifecycleLoader = createSimulationLifecycleLoader({
    state,
    runtime,
    assembly,
    physics,
    controllers,
    demo,
    presentation,
  });

  async function start(preserveBaseline = false) {
    const request = ++requestedRun,
      loaded = await lifecycleLoader.load();
    if (request !== requestedRun) return;
    return loaded.start(preserveBaseline);
  }

  function stopRun() {
    requestedRun++;
    lifecycleLoader.current()?.stop();
  }

  return Object.freeze({
    demo,
    get lifecycle() {
      return lifecycleLoader.current();
    },
    loadDemo: (kind) => demo.loadDemo(kind),
    startChallenge: (id, startMode = null) =>
      demo.startChallenge(id, startMode),
    retryChallenge: () => demo.retry(),
    updateChallenge: (dt, telemetry = runtime.telemetry) =>
      demo.update(dt, telemetry),
    start,
    stop: stopRun,
    reset: async () => (await lifecycleLoader.load()).reset(),
    destroyFlightPhysics: () =>
      lifecycleLoader.current()?.destroyFlightPhysics(),
  });
}
