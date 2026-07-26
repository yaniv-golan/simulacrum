import { componentDefinition } from "../model/component-contracts.js";
import { immutableClone } from "../model/primitives.js";
import { portDefinition, validatePortConnection } from "../model/ports.js";

/** Creates mutation-free, code-preserving target-port assessments. */
export function createEditorConnectionAssessment({ workspace, catalog }) {
  return function assessTarget(
    targetPartId,
    { targetAnchorLocalM = null } = {},
  ) {
    const sourcePartId = workspace.connectFrom(),
      sourcePort = workspace.connectPort(),
      source = workspace.parts().find((part) => part.id === sourcePartId),
      target = workspace.parts().find((part) => part.id === targetPartId);
    if (!source || !sourcePort || !target) return immutableClone([]);
    if (source.id === target.id)
      return immutableClone([
        {
          version: 1,
          targetPartId,
          targetPortId: null,
          status: "ineligible",
          code: "MISSING_DISTINCT_TARGET",
          message: "Choose a different target component",
          details: { sourcePartId: source.id },
        },
      ]);
    return immutableClone(
      componentDefinition(target, catalog).ports.map((targetPort) => {
        const targetDefinition = portDefinition(target, targetPort.id, catalog),
          sourceDefinition = portDefinition(source, sourcePort, catalog);
        if (
          targetAnchorLocalM === null &&
          [sourceDefinition.behavior, targetDefinition.behavior].includes(
            "structural-surface",
          )
        )
          return {
            version: 1,
            targetPartId,
            targetPortId: targetPort.id,
            status: "requires-anchor",
            code: "MISSING_SURFACE_ANCHOR",
            message:
              "Choose an exact surface point to validate this attachment",
            details: null,
          };
        try {
          validatePortConnection(
            source,
            sourcePort,
            target,
            targetPort.id,
            workspace.connections(),
            catalog,
            {
              a: source.id,
              b: target.id,
              portA: sourcePort,
              portB: targetPort.id,
              ...(targetAnchorLocalM
                ? { capacity: {}, anchorB: targetAnchorLocalM }
                : {}),
            },
          );
          return {
            version: 1,
            targetPartId,
            targetPortId: targetPort.id,
            status: "eligible",
            code: null,
            message: "Compatible target port",
            details: null,
          };
        } catch (error) {
          const diagnostic = /** @type {{code?:string,details?:unknown}} */ (
            error
          );
          return {
            version: 1,
            targetPartId,
            targetPortId: targetPort.id,
            status: "ineligible",
            code: diagnostic?.code || "INVALID_CONNECTION",
            message:
              error instanceof Error ? error.message : "Connection is invalid",
            details: diagnostic?.details || null,
          };
        }
      }),
    );
  };
}
