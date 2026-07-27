import { geometryDescriptorForPart } from "./geometry-descriptors.js";
import { flexibleRuntimeBoundsWorldM } from "./component-geometry-contract.js";
import { worldPortFrame } from "./connection-frame-invariants.js";
import { TYPES } from "./component-catalog.js";

const BUILT_IN_GEOMETRY_CATALOG =
  /** @type {import("./component-geometry-contract.js").ComponentGeometryCatalog} */ (
    /** @type {unknown} */ (TYPES)
  );

/** @param {number[]} point */
function pointRecord(point) {
  const [x, y, z] = point;
  return { x, y, z };
}

/**
 * Resolves an editor-only flexible preview from canonical endpoint frames.
 * Attached endpoints use their target component frame; free endpoints retain
 * the authored line endpoint. No presentation curve or attachment offset is
 * invented here.
 */
export function flexibleLinePreviewReadModel({
  part,
  parts,
  connections,
  catalog = BUILT_IN_GEOMETRY_CATALOG,
}) {
  const descriptor = geometryDescriptorForPart(part, catalog);
  if (descriptor.geometryClass !== "runtime-flexible-v1") return null;
  const byId = new Map(parts.map((candidate) => [candidate.id, candidate])),
    endpointIds = descriptor.runtimeGeometryContract.endpointPortIds,
    points = endpointIds.map((portId) => {
      const connection = connections.find(
        (candidate) =>
          !candidate.failed &&
          ((candidate.a === part.id && candidate.portA === portId) ||
            (candidate.b === part.id && candidate.portB === portId)),
      );
      if (!connection)
        return worldPortFrame(part, descriptor, portId).positionWorld;
      const lineIsA = connection.a === part.id,
        target = byId.get(lineIsA ? connection.b : connection.a),
        targetPortId = lineIsA ? connection.portB : connection.portA,
        targetAnchor = lineIsA ? connection.anchorB : connection.anchorA;
      if (!target)
        throw new Error(
          `Flexible preview connection ${connection.id} has no target part`,
        );
      return worldPortFrame(
        target,
        geometryDescriptorForPart(target, catalog),
        targetPortId,
        targetAnchor,
      ).positionWorld;
    }),
    centerline = points.map(pointRecord),
    radiusM = descriptor.runtimeGeometryContract.diameterM / 2;
  return Object.freeze({
    schemaVersion: 1,
    sourcePartId: part.id,
    centerline: Object.freeze(centerline.map(Object.freeze)),
    previewBoundsWorldM: flexibleRuntimeBoundsWorldM(centerline, radiusM),
  });
}
