import { immutableClone } from "../model/primitives.js";

const finite = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

/**
 * Application-private adapters for facts already exposed by the current
 * editor/runtime. Every value declares its source; unsupported observations
 * stay explicit instead of being guessed from component identity.
 */
export function projectCurrentComponentObservation({
  part,
  currentPart,
  running,
  powered,
  directConnections,
}) {
  if (!part) return null;
  const provenance = running ? "completed-telemetry" : "authored-analysis",
    common = {
      adapter: "generic",
      provenance,
      supported: true,
    };
  /** @type {Record<string, any>} */
  let specialized = {
    kind: "unsupported",
    supported: false,
    reason: "No component-specific observation is available.",
  };
  if (part.type === "motor")
    specialized = { kind: "motor", supported: true, powered: Boolean(powered) };
  else if (part.type === "battery") {
    const capacityWh = finite(part.config?.capacityWh),
      energyWh = running
        ? finite(currentPart?.energyWh ?? currentPart?.storedEnergyWh)
        : finite(part.storedEnergyWh),
      stateOfCharge = Number.isFinite(currentPart?.stateOfCharge)
        ? Number(currentPart.stateOfCharge)
        : capacityWh > 0
          ? energyWh / capacityWh
          : 0;
    specialized = {
      kind: "battery",
      supported: true,
      energyWh,
      capacityWh,
      stateOfCharge,
    };
  } else if (part.type === "sensor")
    specialized = {
      kind: "sensor",
      supported: true,
      measuredRpm: finite(currentPart?.sensorValueRpm ?? part.sensorValueRpm),
    };
  else if (part.type === "computer")
    specialized = {
      kind: "controller",
      supported: true,
      powered: Boolean(powered),
      signalConnectionCount: directConnections.filter(
        ({ kind }) => kind === "signal",
      ).length,
    };
  else if (part.mechanism)
    specialized = {
      kind: part.type === "rope" ? "rope" : "mechanism",
      supported: true,
      componentType: part.mechanism.componentType,
    };
  return immutableClone({ ...common, specialized });
}

/** Projects current direct-connection evidence without claiming a route. */
export function projectCurrentConnectionObservation({
  relationship,
  connection,
  validity,
  running,
}) {
  const capacity = connection?.capacity || {},
    forceRatingN = finite(capacity.ultimateForceN),
    torqueRatingNm = finite(capacity.ultimateTorqueNm),
    forceN = finite(
      connection?.lastLoadN ?? connection?.peakLoadN ?? connection?.aeroLoadN,
    ),
    torqueNm = finite(connection?.lastTorqueNm ?? connection?.peakTorqueNm),
    utilization = Math.max(
      forceRatingN > 0 ? forceN / forceRatingN : 0,
      torqueRatingNm > 0 ? torqueNm / torqueRatingNm : 0,
    );
  return immutableClone({
    ...relationship,
    validity:
      validity === true
        ? "valid"
        : validity === false
          ? "misaligned"
          : "not-checked",
    observation: {
      provenance: running ? "completed-telemetry" : "authored",
      failed: Boolean(connection?.failed),
      forceN,
      torqueNm,
      forceRatingN,
      torqueRatingNm,
      utilization,
      supported: Boolean(connection),
    },
  });
}
