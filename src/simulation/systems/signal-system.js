import { SignalNetwork } from "../signal-network.js";

export class SignalSystem {
  phase = "networks";

  initialize(context) {
    context.signalNetwork = new SignalNetwork(context.services.catalog || {});
  }

  step(context) {
    context.signalNetwork.resolve(context.runGraph, context.powerNetwork);
    context.telemetry.signals = context.signalNetwork.telemetry();
  }

  afterCheckpointRestore(context) {
    context.signalNetwork.resolve(context.runGraph, context.powerNetwork);
  }

  dispose(context) {
    delete context.signalNetwork;
  }
}
