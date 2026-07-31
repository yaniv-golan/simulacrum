import {
  acceptsActuatorChannel,
  actuatorChannel,
  clampActuatorCommand,
} from "../../model/actuator-contracts.js";
import { componentControlContract } from "../../model/component-contracts.js";
import { portIds } from "../../model/ports.js";

function candidatesFrom(services) {
  const candidates = services.readCommandCandidates?.() || {};
  return {
    remote: Array.isArray(candidates.remote) ? candidates.remote : [],
    scripts: Array.isArray(candidates.scripts) ? candidates.scripts : [],
    unknownExternalSources: Object.entries(candidates)
      .filter(
        ([key, value]) =>
          key !== "remote" &&
          key !== "scripts" &&
          Array.isArray(value) &&
          value.length,
      )
      .map(([key]) => key),
  };
}

function fanoutTargets(anchor, channel, controllerIds, context) {
  const catalog = context.services.catalog,
    contract = actuatorChannel(anchor, channel, catalog);
  if (!contract?.fanout) return [anchor.id];
  const ids = new Set([anchor.id]);
  for (const controllerId of controllerIds)
    for (const targetId of context.signalNetwork.targetsForController(
      controllerId,
    )) {
      const target = context.runGraph.part(targetId);
      if (
        componentControlContract(target, catalog) ===
          componentControlContract(anchor, catalog) &&
        acceptsActuatorChannel(target, channel, catalog)
      )
        ids.add(targetId);
    }
  return [...ids];
}

/** Merges route-valid remote and script candidates into the production bus. */
export class CommandRoutingSystem {
  phase = "networks";

  step(context) {
    const bus = context.commandBus,
      { remote, scripts, unknownExternalSources } = candidatesFrom(
        context.services,
      );
    if (
      unknownExternalSources.length ||
      remote.some(
        (candidate) =>
          candidate.replayable === false ||
          (candidate.sourceId && candidate.sourceId !== "operator"),
      )
    )
      context.services.failureEvidenceRecorder?.setReplayability({
        supported: false,
        reasonCode: "UNREGISTERED_EXTERNAL_INPUT_SOURCE",
      });
    bus.clearTick();
    context.services.inputTraceRecorder?.recordTick(
      context.clock.tick,
      remote.map((candidate) => ({
        ...candidate,
        value: candidate.active ? candidate.value : 0,
      })),
    );
    context.commandCapabilities = new Set(
      remote.map((candidate) => candidate.channel).filter(Boolean),
    );

    for (const candidate of remote) {
      if (!candidate.active) continue;
      const target = context.runGraph.part(candidate.targetId);
      if (!target || target.detached) {
        bus.reject(candidate, "missing or detached target");
        continue;
      }
      if (
        !acceptsActuatorChannel(
          target,
          candidate.channel,
          context.services.catalog,
        )
      ) {
        bus.reject(candidate, "channel is not accepted by target type");
        continue;
      }
      const controllers =
        componentControlContract(target, context.services.catalog) ===
        "command-sink-v1"
          ? context.signalNetwork.controllersForSensor(target.id)
          : context.signalNetwork.controllersForTarget(target.id);
      if (!controllers.length) {
        bus.reject(candidate, "no powered directed controller route");
        continue;
      }
      const value = clampActuatorCommand(
        target,
        candidate.channel,
        candidate.value,
        context.services.catalog,
      );
      for (const targetId of fanoutTargets(
        target,
        candidate.channel,
        controllers,
        context,
      ))
        bus.writeRemote(targetId, candidate.channel, value);
    }

    for (const candidate of scripts) {
      if (!context.powerNetwork.isPowered(candidate.controllerId)) {
        bus.reject(candidate, "controller has no allocated power");
        continue;
      }
      const target = context.runGraph.part(candidate.targetId);
      if (!candidate.bindingId || !target || target.detached) {
        bus.reject(candidate, "binding has no live actuator endpoint");
        continue;
      }
      if (
        !portIds(target, context.services.catalog).includes(
          candidate.endpointPortId,
        )
      ) {
        bus.reject(candidate, "binding endpoint port is unavailable");
        continue;
      }
      if (
        !acceptsActuatorChannel(
          target,
          candidate.channel,
          context.services.catalog,
        )
      ) {
        bus.reject(candidate, "binding channel is not accepted by endpoint");
        continue;
      }
      if (
        !context.signalNetwork.hasRoute(
          candidate.controllerId,
          candidate.targetId,
          candidate.endpointPortId,
        )
      ) {
        bus.reject(candidate, "binding has no powered directed signal route");
        continue;
      }
      bus.writeScript(
        candidate.controllerId,
        candidate.bindingId,
        candidate.targetId,
        candidate.channel,
        clampActuatorCommand(
          target,
          candidate.channel,
          candidate.value,
          context.services.catalog,
        ),
      );
    }
    context.telemetry.commands = Object.freeze({
      ...bus.entries(),
      capabilities: Object.freeze([...context.commandCapabilities].sort()),
    });
    context.services.failureEvidenceRecorder?.recordCommandStage({
      tick: context.clock.tick,
      timeS: context.time,
      commandLedger: context.telemetry.commands,
    });
  }

  dispose(context) {
    delete context.commandCapabilities;
  }
}
