import * as THREE from "three";
import { TYPES } from "../model/component-catalog.js";
import {
  selectCompatibleTargetPort,
  validatePortConnection,
} from "../model/ports.js";
import { disposeObject3D } from "../presentation/render-resources.js";
import { createEditorConnection } from "./editor-connection-authoring.js";
import { geometryDescriptorForPart } from "../model/geometry-descriptors.js";

/** Creates the atomic generic part-plus-two-connections authoring transaction. */
export function createTwoEndedComponentAuthoring({
  workspace,
  history,
  view,
  getNextId,
  setNextId,
  add,
}) {
  const targetWorldPoint = (part, port, anchorLocalM = null) => {
    const local = Array.isArray(anchorLocalM)
      ? anchorLocalM
      : geometryDescriptorForPart(part).portFrames[port]?.framePart.positionM;
    if (!local)
      throw new Error(
        `Port ${part.type}.${port} has no canonical spatial frame`,
      );
    return new THREE.Vector3(...local)
      .applyQuaternion(new THREE.Quaternion(...part.orientation))
      .add(new THREE.Vector3(...part.pos));
  };

  return function addTwoEndedComponent({
    type,
    endpointPorts,
    targets,
    authored = {},
    extraSlackM = 0,
  }) {
    if (
      workspace.running ||
      targets?.length !== 2 ||
      endpointPorts?.length !== 2
    )
      return null;
    const targetParts = targets.map((target) =>
      workspace.parts.find((part) => part.id === target.partId),
    );
    if (targetParts.some((part) => !part)) return null;
    const provisional = { id: getNextId(), type },
      targetPorts = targets.map(
        (target, index) =>
          target.port ||
          selectCompatibleTargetPort(
            provisional,
            endpointPorts[index],
            targetParts[index],
            TYPES,
            workspace.connections,
          ),
      );
    if (targetPorts.some((port) => !port)) {
      view.notify(
        "The selected components do not expose two compatible attachment ports",
      );
      return null;
    }
    try {
      for (let index = 0; index < 2; index++)
        validatePortConnection(
          provisional,
          endpointPorts[index],
          targetParts[index],
          targetPorts[index],
          workspace.connections,
        );
    } catch (error) {
      view.notify(
        error instanceof Error
          ? error.message
          : "Two-ended component endpoints are invalid",
      );
      return null;
    }
    const worldPoints = targetParts.map((part, index) =>
        targetWorldPoint(part, targetPorts[index], targets[index].anchorLocalM),
      ),
      spanM = worldPoints[0].distanceTo(worldPoints[1]),
      position = worldPoints[0].clone().add(worldPoints[1]).multiplyScalar(0.5),
      resolvedAuthored = {
        ...authored,
        ...(Object.hasOwn(authored, "lengthM")
          ? {}
          : { lengthM: Math.max(0.1, spanM + Math.max(0, extraSlackM)) }),
      },
      before = history.capture(),
      originalNextId = getNextId(),
      originalConnectionCount = workspace.connections.length,
      wasHistorySuspended = history.suspended;
    let part = null;
    history.suspended = true;
    try {
      part = add(type, position.toArray(), resolvedAuthored);
      const direction = worldPoints[1].clone().sub(worldPoints[0]);
      if (direction.lengthSq() > 1e-12)
        part.mesh.quaternion.setFromUnitVectors(
          new THREE.Vector3(
            ...(TYPES[type].flexibleLine?.initialAxisPart || [1, 0, 0]),
          ).normalize(),
          direction.normalize(),
        );
      part.orientation = part.mesh.quaternion.toArray();
      part.pos = part.mesh.position.toArray();
      for (let index = 0; index < 2; index++) {
        const candidate = createEditorConnection({
          left: part,
          right: targetParts[index],
          kind: "mechanical",
          sourcePort: endpointPorts[index],
          targetPort: targetPorts[index],
          targetAnchorLocalM: targets[index].anchorLocalM,
          index: workspace.connections.length,
        });
        validatePortConnection(
          part,
          endpointPorts[index],
          targetParts[index],
          targetPorts[index],
          workspace.connections,
          TYPES,
          candidate,
        );
        workspace.connections.push(candidate);
      }
    } catch (error) {
      workspace.connections.splice(originalConnectionCount);
      if (part) {
        disposeObject3D(part.mesh);
        workspace.parts.splice(workspace.parts.indexOf(part), 1);
      }
      setNextId(originalNextId);
      view.syncAssembly();
      view.drawConnections();
      view.render();
      view.notify(
        error instanceof Error
          ? error.message
          : "Two-ended component creation failed",
      );
      return null;
    } finally {
      history.suspended = wasHistorySuspended;
    }
    if (!wasHistorySuspended)
      history.record(`connect with ${TYPES[type]?.name || type}`, before);
    view.syncAssembly();
    view.select([part.id], part.id);
    view.showSelection(part);
    view.drawConnections();
    view.render();
    view.notify(
      `${TYPES[type]?.name || type} created as one component and two attachments`,
    );
    return part;
  };
}
