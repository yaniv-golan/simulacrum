import * as THREE from "three";
import { derivePortReflectionMap } from "../model/reflection-symmetry.js";
import { appendClonedEditorConnection } from "./editor-connection-cloning.js";
import { remapControllerBindings } from "../model/controller-bindings.js";

/**
 * Owns connection-preserving duplicate and reflection transforms. The caller
 * supplies ordinary part cloning so transforms cannot create a second authoring
 * path or bypass component normalization.
 */
export function createAssemblyTransformCommands({
  workspace,
  history,
  view,
  clonePart,
}) {
  function reflectionInput(part) {
    return {
      id: part.id,
      type: part.type,
      pos: [...part.pos],
      orientation: [
        part.mesh.quaternion.x,
        part.mesh.quaternion.y,
        part.mesh.quaternion.z,
        part.mesh.quaternion.w,
      ],
      scale: {
        x: part.mesh.scale.x,
        y: part.mesh.scale.y,
        z: part.mesh.scale.z,
      },
      config: structuredClone(part.config),
      ...(part.mechanism ? { mechanism: structuredClone(part.mechanism) } : {}),
    };
  }

  function selectedParts() {
    return workspace.parts.filter((part) => workspace.selectedIds.has(part.id));
  }

  function appendConnection(connection, left, right, operation) {
    const result = appendClonedEditorConnection({
      connections: workspace.connections,
      connection,
      left,
      right,
      operation,
    });
    if (!result.ok)
      view.notify(
        `Skipped ${operation} link: ${result.error instanceof Error ? result.error.message : "invalid endpoint contract"}`,
      );
    return result;
  }

  function finish(ids, message, operation) {
    workspace.lastTransformOperation = structuredClone(operation);
    view.syncAssembly();
    view.drawConnections();
    const primary = workspace.parts.find((part) => ids.has(part.id)) || null;
    view.showSelection(primary);
    view.render();
    view.notify(message);
  }

  function duplicate() {
    const selection = selectedParts();
    if (!selection.length || workspace.running) return;
    history.record(
      `duplicate ${selection.length} component${selection.length === 1 ? "" : "s"}`,
    );
    const wasSuspended = history.suspended,
      idMap = new Map(),
      connectionMap = [];
    history.suspended = true;
    for (const source of selection) {
      const clone = clonePart(source, [
        source.pos[0] + 2,
        source.pos[1],
        source.pos[2],
      ]);
      idMap.set(source.id, clone.id);
    }
    for (const source of selection.filter((part) => part.type === "computer")) {
      const clone = workspace.parts.find(
        (part) => part.id === idMap.get(source.id),
      );
      clone.controllerBindings = remapControllerBindings(
        source.controllerBindings || [],
        idMap,
      );
    }
    for (const connection of [...workspace.connections])
      if (idMap.has(connection.a) && idMap.has(connection.b)) {
        const left = workspace.parts.find(
            (part) => part.id === idMap.get(connection.a),
          ),
          right = workspace.parts.find(
            (part) => part.id === idMap.get(connection.b),
          ),
          remappedConnection = { ...connection };
        if (connection.releaseCouplerPartId != null) {
          const couplerId = idMap.get(connection.releaseCouplerPartId);
          if (couplerId == null) delete remappedConnection.releaseCouplerPartId;
          else remappedConnection.releaseCouplerPartId = couplerId;
        }
        const result = appendConnection(
          remappedConnection,
          left,
          right,
          "duplicate",
        );
        if (result.ok)
          connectionMap.push({
            sourceConnectionId: connection.id,
            targetConnectionId: result.connection.id,
            portA: connection.portA,
            portB: connection.portB,
          });
      }
    history.suspended = wasSuspended;
    const ids = new Set(idMap.values()),
      primary = idMap.get(workspace.selectedId) || [...ids][0] || null;
    view.select(ids, primary);
    finish(
      ids,
      `Duplicated ${selection.length} component${selection.length === 1 ? "" : "s"}`,
      {
        kind: "duplicate",
        plane: null,
        handedness: "right-handed-frame-preserved",
        partIdMap: Object.fromEntries(idMap),
        connectionMap,
        conflicts: [],
      },
    );
  }

  function mirror() {
    const selection = selectedParts();
    if (!selection.length || workspace.running) return;
    let symmetries;
    try {
      symmetries = new Map(
        selection.map((part) => [
          part.id,
          derivePortReflectionMap(reflectionInput(part)),
        ]),
      );
    } catch (error) {
      view.notify(
        `Mirror rejected: ${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    history.record(
      `mirror ${selection.length} component${selection.length === 1 ? "" : "s"}`,
    );
    const wasSuspended = history.suspended,
      idMap = new Map(),
      connectionMap = [],
      conflicts = [];
    history.suspended = true;
    for (const source of selection) {
      if (Math.abs(source.pos[0]) < 0.05) {
        idMap.set(source.id, source.id);
        continue;
      }
      const reflection = new THREE.Matrix4().makeScale(-1, 1, 1),
        symmetry = symmetries.get(source.id),
        localReflectionScale = [1, 1, 1],
        rotation = new THREE.Matrix4().makeRotationFromQuaternion(
          source.mesh.quaternion,
        );
      localReflectionScale[symmetry.localReflectionAxis] = -1;
      const localReflection = new THREE.Matrix4().makeScale(
          ...localReflectionScale,
        ),
        mirroredOrientation = new THREE.Quaternion().setFromRotationMatrix(
          reflection.clone().multiply(rotation).multiply(localReflection),
        ),
        clone = clonePart(
          source,
          [-source.pos[0], source.pos[1], source.pos[2]],
          mirroredOrientation,
        );
      idMap.set(source.id, clone.id);
    }
    for (const source of selection.filter((part) => part.type === "computer")) {
      const clone = workspace.parts.find(
        (part) => part.id === idMap.get(source.id),
      );
      if (clone && clone !== source)
        clone.controllerBindings = remapControllerBindings(
          source.controllerBindings || [],
          idMap,
        );
    }
    for (const connection of [...workspace.connections]) {
      if (!idMap.has(connection.a) || !idMap.has(connection.b)) continue;
      const leftId = idMap.get(connection.a),
        rightId = idMap.get(connection.b);
      if (
        leftId === rightId ||
        workspace.connections.some(
          (existing) =>
            (existing.a === leftId && existing.b === rightId) ||
            (existing.a === rightId && existing.b === leftId),
        )
      )
        continue;
      const left = workspace.parts.find((part) => part.id === leftId),
        right = workspace.parts.find((part) => part.id === rightId),
        portA = symmetries.get(connection.a).portMap[connection.portA],
        portB = symmetries.get(connection.b).portMap[connection.portB],
        remappedConnection = {
          ...connection,
          portA: portA.targetPort,
          portB: portB.targetPort,
        };
      if (connection.releaseCouplerPartId != null) {
        const couplerId = idMap.get(connection.releaseCouplerPartId);
        if (couplerId == null) delete remappedConnection.releaseCouplerPartId;
        else remappedConnection.releaseCouplerPartId = couplerId;
      }
      const result = appendConnection(
        remappedConnection,
        left,
        right,
        "mirror",
      );
      if (result.ok)
        connectionMap.push({
          sourceConnectionId: connection.id,
          targetConnectionId: result.connection.id,
          portA: {
            source: connection.portA,
            target: portA.targetPort,
            coordinateSign: portA.coordinateSign,
          },
          portB: {
            source: connection.portB,
            target: portB.targetPort,
            coordinateSign: portB.coordinateSign,
          },
        });
      else
        conflicts.push({
          sourceConnectionId: connection.id,
          message:
            result.error instanceof Error
              ? result.error.message
              : "invalid reflected endpoint contract",
        });
    }
    history.suspended = wasSuspended;
    const mirroredIds = [...idMap.values()].filter(
        (id) => !workspace.selectedIds.has(id),
      ),
      ids = new Set(mirroredIds.length ? mirroredIds : idMap.values()),
      primary = ids.values().next().value || null;
    view.select(ids, primary);
    finish(ids, "Mirrored selection across the build centerline", {
      kind: "mirror",
      plane: "YZ",
      handedness: "reflection-restored-to-right-handed-frame",
      partIdMap: Object.fromEntries(idMap),
      connectionMap,
      conflicts,
      portFrameMappings: Object.fromEntries(
        [...symmetries].map(([partId, symmetry]) => [partId, symmetry.ports]),
      ),
    });
  }

  return Object.freeze({ duplicate, mirror });
}
