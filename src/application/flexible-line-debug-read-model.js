import { TYPES } from "../model/component-catalog.js";

/** Bounded automation projection of authored boundaries and completed line state. */
export function flexibleLineDebugReadModel({
  parts,
  connections,
  telemetry,
  running,
}) {
  const runtimeByPart = new Map(
    (telemetry?.systems?.flexibleLines?.lines || []).map((line) => [
      line.sourcePartId,
      line,
    ]),
  );
  return parts
    .filter((part) => TYPES[part.type]?.flexibleLine)
    .map((part) => {
      const capability = TYPES[part.type].flexibleLine,
        runtime = running ? runtimeByPart.get(part.id) : null,
        stoppedBoundaries = [
          capability.endpointPortA,
          capability.endpointPortB,
        ].map((endpointPortId) => {
          const connection = connections.find(
            (candidate) =>
              (candidate.a === part.id && candidate.portA === endpointPortId) ||
              (candidate.b === part.id && candidate.portB === endpointPortId),
          );
          if (!connection) return { endpointPortId, state: "free" };
          const sourceIsA = connection.a === part.id;
          return {
            endpointPortId,
            state: "attached",
            sourceConnectionId: connection.id,
            targetPartId: sourceIsA ? connection.b : connection.a,
            targetPortId: sourceIsA ? connection.portB : connection.portA,
          };
        });
      return {
        sourcePartId: part.id,
        lengthM: part.config.lengthM,
        diameterM: part.config.diameterM,
        materialKey: part.config.materialKey,
        state: runtime?.state || "stopped",
        boundaries: runtime?.boundaries || stoppedBoundaries,
        maximumTensionN: runtime?.maximumTensionN || 0,
        slackM: runtime?.slackM ?? part.config.lengthM,
        extensionM: runtime?.extensionM || 0,
        elasticEnergyJ: runtime?.elasticEnergyJ || 0,
        dissipatedEnergyJ:
          (runtime?.dampingDissipationJ || 0) +
          (runtime?.contactDissipationJ || 0),
        contactCount: runtime?.contactCount || 0,
        failureMargin: runtime?.failureMargin ?? 1,
        governingElementId: runtime?.governingElementId || null,
        validity: runtime?.validity || "not-running",
        unsupportedEffects: runtime?.unsupportedEffects || [],
        solvedCenterline: runtime
          ? {
              nodeCount: runtime.centerline.length,
              start: runtime.centerline[0],
              end: runtime.centerline.at(-1),
            }
          : null,
      };
    });
}
