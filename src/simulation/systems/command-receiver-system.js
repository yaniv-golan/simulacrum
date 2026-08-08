import { componentHasControlContract } from "../../model/component-contracts.js";
import { registerOwnedImmutable } from "../../model/owned-immutable-value.js";

/** Commits powered, route-valid remote commands into ordinary receiver state. */
export class CommandReceiverSystem {
  phase = "networks";

  initialize(context) {
    context.commands = new Map();
  }

  step(context) {
    this.#resolve(context, true);
  }

  afterCheckpointRestore(context) {
    this.#resolve(context, false);
  }

  #resolve(context, publishTelemetry) {
    const states = [];
    for (const receiver of context.runGraph
      .parts()
      .filter((part) =>
        componentHasControlContract(
          part,
          "command-sink-v1",
          context.services.catalog,
        ),
      )) {
      const powered = context.powerNetwork.isPowered(receiver.id),
        routedControllers = context.signalNetwork
          .controllersForSensor(receiver.id)
          .filter((controllerId) =>
            context.signalNetwork.hasSensorRoute(
              controllerId,
              receiver.id,
              "SIGNAL",
            ),
          ),
        online = powered && !receiver.detached && routedControllers.length > 0,
        command = online
          ? context.commandBus.read(receiver.id, "command", 0)
          : { value: 0, conflict: false, source: "none" },
        state = Object.freeze({
          partId: receiver.id,
          channel: "command",
          value: Number(command.value || 0),
          valid: online && !command.conflict,
          powered,
          routedControllerIds: Object.freeze([...routedControllers]),
          source: command.source,
          conflict: command.conflict,
          tick: context.clock.tick,
        });
      context.commands.set(receiver.id, state);
      states.push(state);
    }
    if (publishTelemetry)
      context.telemetry.commandReceivers = registerOwnedImmutable(
        Object.freeze({
          states: Object.freeze(states),
        }),
      );
  }

  dispose(context) {
    context.commands.clear();
  }
}
