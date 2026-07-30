/** Returns a read-only summary that lets browser evidence pair model identity
 * with the canonical geometry currently projected for each component. */
export function componentVisualDiagnostics(parts) {
  return parts.map((part) => {
    const projection = part.mesh?.userData?.geometryProjection;
    return {
      id: part.id,
      type: part.type,
      detailTier: part.mesh?.userData?.visualDetailTier || null,
      geometryClass: projection?.geometryClass || null,
      bodyPrimitiveIds: projection?.bodyPrimitiveIds || [],
      bodyPrimitiveKinds:
        projection?.bodyPrimitives?.map(({ geometry }) => geometry.kind) || [],
      featureIds: projection?.featureIds || [],
    };
  });
}
