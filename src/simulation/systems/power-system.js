import { PowerNetwork } from "../power-network.js";

export class PowerSystem {
  phase = "networks";

  initialize(context) {
    context.powerNetwork = new PowerNetwork(context.services.catalog || {});
  }

  step(context, fixedDt) {
    context.powerNetwork.resolve(context.runGraph, fixedDt);
    context.telemetry.power = context.powerNetwork.telemetry();
  }

  dispose(context) {
    delete context.powerNetwork;
  }
}
