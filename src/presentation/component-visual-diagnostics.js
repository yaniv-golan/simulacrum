/** Returns a read-only summary that lets browser evidence pair model identity
 * with the canonical geometry currently projected for each component. */
export function componentVisualDiagnostics(parts) {
  return parts.map((part) => {
    const projection = part.mesh?.userData?.geometryProjection,
      deformationRoots = part.mesh?.userData?.mechanismDeformationRoots || {};
    return {
      id: part.id,
      type: part.type,
      detailTier: part.mesh?.userData?.visualDetailTier || null,
      geometryClass: projection?.geometryClass || null,
      bodyPrimitiveIds: projection?.bodyPrimitiveIds || [],
      bodyPrimitiveKinds:
        projection?.bodyPrimitives?.map(({ geometry }) => geometry.kind) || [],
      featureIds: projection?.featureIds || [],
      deformationContract: part.mesh?.userData?.geometryDescriptor
        ?.deformationContract
        ? structuredClone(
            part.mesh.userData.geometryDescriptor.deformationContract,
          )
        : null,
      deformationTransforms: Object.fromEntries(
        Object.entries(deformationRoots).map(([id, root]) => [
          id,
          {
            positionM: root.position.toArray(),
            orientation: root.quaternion.toArray(),
            scale: root.scale.toArray(),
          },
        ]),
      ),
      deformedBodyBoundsWorldM: part.deformedBodyBoundsWorldM
        ? structuredClone(part.deformedBodyBoundsWorldM)
        : null,
    };
  });
}
