import { PowerNetwork } from "../power-network.js";

export class PowerSystem {
  phase = "networks";

  initialize(context) {
    context.powerNetwork = new PowerNetwork(context.services.catalog || {});
  }

  step(context, fixedDt) {
    context.powerNetwork.resolve(context.runGraph, fixedDt);
    if (!context.services.deferPowerTelemetryUntilCompletion)
      context.telemetry.power = context.powerNetwork.telemetry();
  }

  afterCheckpointRestore(context) {
    context.powerNetwork.resolve(context.runGraph, context.clock.fixedDt, {
      commitBaseline: false,
    });
  }

  dispose(context) {
    delete context.powerNetwork;
  }
}
