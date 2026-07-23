import { canonicalizeQuaternion } from "../model/primitives.js";

/**
 * Captures editor state without retaining meshes or mutable collection
 * references. Runtime failure/trust state is intentionally excluded.
 */
export function captureBuildHistorySnapshot({
  store,
  nextId,
  missionName,
  missionDescription,
}) {
  return {
    demo: store.demo,
    mode: store.editor.mode,
    remoteProfile: store.remoteProfile,
    scriptControllerId: store.scriptControllerId,
    missionName: missionName() || "WORKSHOP READY",
    missionDescription: missionDescription() || "Build and test a machine.",
    selected: store.editor.selected,
    selectedIds: [...store.editor.selectedIds],
    idSeq: nextId(),
    blueprintName: store.blueprintName,
    blueprintCreated: store.blueprintCreated,
    remoteProfiles: structuredClone(store.remoteProfiles),
    remoteControlState: structuredClone(store.remoteControlState),
    directSurfaces: structuredClone(store.directSurfaces),
    controllerLayouts: structuredClone(store.controllerLayouts),
    controllerWindowState: structuredClone(store.controllerWindowState),
    parts: store.parts.map((part) => ({
      id: part.id,
      type: part.type,
      pos: [...part.pos],
      orientation: canonicalizeQuaternion([
        part.mesh.quaternion.x,
        part.mesh.quaternion.y,
        part.mesh.quaternion.z,
        part.mesh.quaternion.w,
      ]),
      scale: [part.mesh.scale.x, part.mesh.scale.y, part.mesh.scale.z],
      ...(part.mechanism
        ? { mechanism: structuredClone(part.mechanism) }
        : { config: structuredClone(part.config) }),
      storedEnergyWh: part.storedEnergyWh,
      customColor: part.customColor,
      rigRole: part.rigRole || null,
      rigVisualRotation: part.rigVisualRotation
        ? [...part.rigVisualRotation]
        : null,
      scriptLanguage: part.scriptLanguage,
      scriptSources: part.scriptSources
        ? structuredClone(part.scriptSources)
        : null,
      controllerBindings:
        part.type === "computer"
          ? structuredClone(part.controllerBindings || [])
          : null,
      programAcquisition:
        part.type === "computer" ? part.programAcquisition : undefined,
    })),
    connections: structuredClone(store.connections),
  };
}
