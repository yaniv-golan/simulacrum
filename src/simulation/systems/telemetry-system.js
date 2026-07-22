/** Publishes the immutable read model after every completed physics step. */
import { publishTelemetrySnapshot } from "../telemetry.js";

export class TelemetrySystem {
  phase = "telemetry";

  step(context) {
    if (context.powerNetwork)
      context.telemetry.power = context.powerNetwork.telemetry();
    if (context.signalNetwork)
      context.telemetry.signals = context.signalNetwork.telemetry();
    context.telemetry.commands = {
      ...context.commandBus.entries(),
      capabilities: [...(context.commandCapabilities || [])].sort(),
    };
    const captured = context.services.captureTelemetry?.(context),
      systems = captured?.systems || captured || context.telemetry;
    context.telemetry = publishTelemetrySnapshot(context, systems);
  }
}
