import { canonicalizeQuaternion } from "../model/primitives.js";
import {
  projectPortableAuthoredConnection,
  projectPortableAuthoredPart,
} from "../model/authored-assembly-content.js";

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
    parts: store.parts.map((part) => {
      const projected = projectPortableAuthoredPart({
        ...part,
        pos: [...part.pos],
        orientation: canonicalizeQuaternion([
          part.mesh.quaternion.x,
          part.mesh.quaternion.y,
          part.mesh.quaternion.z,
          part.mesh.quaternion.w,
        ]),
        scale: {
          x: part.mesh.scale.x,
          y: part.mesh.scale.y,
          z: part.mesh.scale.z,
        },
      });
      return {
        ...projected,
        scale: [projected.scale.x, projected.scale.y, projected.scale.z],
        programAcquisition:
          part.type === "computer" ? part.programAcquisition : undefined,
      };
    }),
    connections: store.connections.map(projectPortableAuthoredConnection),
  };
}
