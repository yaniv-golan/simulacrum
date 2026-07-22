import { deepFreeze } from "../model/primitives.js";
import { BodyRegistry } from "./body-registry.js";
import { CommandBus } from "./command-bus.js";
import { RunAssemblyGraph } from "./run-assembly-graph.js";
import { createTelemetrySnapshot } from "./telemetry.js";

/** Constructs the typed, transient state owned by one simulation session. */
export function createSimulationContext(
  snapshot,
  services = {},
  { fixedDt = 1 / 120 } = {},
) {
  const runGraph =
      services.runGraph instanceof RunAssemblyGraph
        ? services.runGraph
        : new RunAssemblyGraph(snapshot),
    bodyRegistry =
      services.bodyRegistry instanceof BodyRegistry
        ? services.bodyRegistry
        : new BodyRegistry(runGraph.startSnapshot(), services.catalog),
    commandBus =
      services.commandBus instanceof CommandBus
        ? services.commandBus
        : new CommandBus(),
    clock = { tick: 0, time: 0, fixedDt },
    environment = deepFreeze(
      structuredClone(
        typeof services.environmentSample === "function"
          ? services.environmentSample({ tick: 0, time: 0 })
          : services.environmentSample || {},
      ),
    ),
    telemetry = createTelemetrySnapshot({
      time: 0,
      tick: 0,
      assembly: runGraph.startSnapshot(),
      runGraph,
      bodyRegistry,
    });
  return {
    runGraph,
    bodyRegistry,
    commandBus,
    clock,
    environment,
    services,
    time: 0,
    sensors: new Map(),
    commands: new Map(),
    // Systems assemble a mutable per-tick draft before TelemetrySystem
    // replaces it with the immutable public snapshot.
    telemetry: /** @type {any} */ (telemetry),
    previousTelemetry: telemetry,
  };
}
