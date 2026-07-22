/** Projects an inert, automation-safe description of the current placement. */
export function pendingPlacementReadModel(placing) {
  if (!placing) return null;
  const asset = placing.subassembly?.asset;
  return {
    kind: asset ? "ordinary-subassembly" : "ordinary-component",
    componentType: placing.type || null,
    assetName: asset?.name || null,
    partCount: asset?.parts?.length || 1,
    connectionCount: asset?.connections?.length || 0,
    exposedPorts: structuredClone(asset?.exposedPorts || []),
    position: [...(placing.position || [0, 0, 0])],
  };
}
