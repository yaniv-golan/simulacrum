import { ControllerTraceBuffer } from "../model/controller-debugger.js";
import { ControllerSensorBank } from "../simulation/controller-sensors.js";
import { createCommandCandidateReader } from "./command-candidate-reader.js";
import { createControllerLifecycleFeature } from "./controller-lifecycle-feature.js";

/**
 * Composes controller state adaptation, deterministic runtimes, sensor history,
 * tracing, and command reads behind one application boundary.
 */
export function createControllerSubsystem({
  state,
  channels,
  defaultSources,
  power,
  trust,
  telemetry,
  environment,
  view,
}) {
  const trace = new ControllerTraceBuffer({ capacity: 360 }),
    sensorBank = new ControllerSensorBank(),
    workspace = {
      get parts() {
        return state.parts;
      },
      get connections() {
        return state.connections;
      },
      get selected() {
        return state.editor.selected;
      },
      get running() {
        return state.running;
      },
      get scriptControllerId() {
        return state.scriptControllerId;
      },
      set scriptControllerId(value) {
        state.scriptControllerId = value;
      },
      get scriptLanguage() {
        return state.scriptLanguage;
      },
      set scriptLanguage(value) {
        state.scriptLanguage = value;
      },
      get scriptSources() {
        return state.scriptSources;
      },
      set scriptSources(value) {
        state.scriptSources = value;
      },
    },
    lifecycle = createControllerLifecycleFeature({
      workspace,
      channels,
      defaultSources,
      traceBuffer: trace,
      sensorBank,
      power,
      trust,
      telemetry,
      environment,
      view,
    }),
    readCommandCandidates = createCommandCandidateReader({
      getState: () => state,
      runtimeManager: lifecycle.runtimeManager,
      runtimeReadModel: lifecycle.runtimeReadModel,
    });

  return Object.freeze({
    ...lifecycle,
    trace,
    sensorBank,
    readCommandCandidates,
  });
}
