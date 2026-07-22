import { componentHasControlContract } from "../model/component-contracts.js";

/**
 * Projects the same controller routes from either completed telemetry or the
 * editor's resolved SignalNetwork. This keeps remote availability independent
 * of whether a simulation session is running.
 */
export function routedControllerIdsForPart({
  part,
  liveSignals = null,
  signalNetwork,
  catalog,
}) {
  if (!part) return [];
  const commandSink = componentHasControlContract(
    part,
    "command-sink-v1",
    catalog,
  );
  if (liveSignals)
    return commandSink
      ? (liveSignals.controllerSensors || [])
          .filter((entry) =>
            entry.endpoints.some((endpoint) => endpoint.partId === part.id),
          )
          .map((entry) => entry.controllerId)
      : liveSignals.routes.find((route) => route.targetId === part.id)
          ?.controllerIds || [];
  return commandSink
    ? signalNetwork.controllersForSensor(part.id)
    : signalNetwork.controllersForTarget(part.id);
}
