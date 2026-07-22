/** Lazily constructs the heavy run lifecycle from explicit application ports. */
export function createSimulationLifecycleLoader({
  state,
  runtime,
  assembly,
  physics,
  controllers,
  demo,
  presentation,
}) {
  let lifecycle = null,
    pending = null;
  async function load() {
    pending ||= import("./simulation-lifecycle-feature.js").then(
      ({ createSimulationLifecycleFeature }) =>
        createSimulationLifecycleFeature({
          run: state,
          runtime,
          assembly,
          physics,
          controllers: {
            isPowered: controllers.isPowered,
            resetSensors: controllers.resetSensors,
            captureSensors: controllers.captureSensors,
            tick: controllers.tick,
            readCommandCandidates: controllers.readCommandCandidates,
            telemetry: controllers.telemetry,
            compile: controllers.compile,
            stopAll: controllers.stopAll,
            sensorBank: controllers.sensorBank,
            runtimeManager: controllers.runtimeManager,
          },
          challenges: {
            get buildBaseline() {
              return demo.buildBaseline;
            },
            set buildBaseline(value) {
              demo.buildBaseline = value;
            },
            get proofContext() {
              return demo.proofContext;
            },
            set proofContext(value) {
              demo.proofContext = value;
            },
            begin: () => demo.begin(),
            abort: () => demo.abort(),
            resolveBinding: (telemetry) => demo.resolveBinding(telemetry),
          },
          presentation,
        }),
    );
    lifecycle ||= await pending;
    return lifecycle;
  }
  return Object.freeze({
    load,
    current: () => lifecycle,
  });
}
