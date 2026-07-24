import * as THREE from "three";
import { TYPES } from "../model/component-catalog.js";
import { geometryDescriptorForPart } from "../model/geometry-descriptors.js";
import { componentDefinition } from "../model/component-contracts.js";
import {
  compatibleTargetPorts,
  inferConnectionKind,
  portDefinition,
  portPresentation,
  selectCompatibleTargetPort,
  validatePortConnection,
} from "../model/ports.js";
import { createEditorConnection } from "./editor-connection-authoring.js";
import { canonicalizeQuaternion } from "../model/primitives.js";

/**
 * @typedef {{
 *   id: number,
 *   type: string,
 *   config: Record<string, number>,
 *   mesh: THREE.Object3D,
 *   pos: number[],
 *   rot?: number,
 *   scale?: {x: number, y: number, z: number},
 *   axleEnd?: number,
 * }} ConnectionPart
 * @typedef {{
 *   id?: string,
 *   a: number,
 *   b: number,
 *   kind: string,
 *   portA?: string | null,
 *   portB?: string | null,
 *   failed?: boolean,
 *   explodeValid?: boolean,
 *   stress?: number,
 *   fatigue?: number,
 *   capacity?: {ultimateForceN:number, ultimateTorqueNm:number},
 * }} EditorConnection
 * @typedef {{
 *   parts: () => ConnectionPart[],
 *   connections: () => EditorConnection[],
 *   replaceConnections: (connections: EditorConnection[]) => void,
 *   connectFrom: () => number | null,
 *   connectPort: () => string | null,
 *   selectedId: () => number | null,
 *   exploded: () => boolean,
 *   explodeAmount: () => number,
 * }} ConnectionWorkspacePort
 * @typedef {{
 *   suspended: () => boolean,
 *   capture: () => object,
 *   record: (label: string, snapshot?: object | null) => void,
 * }} ConnectionHistoryPort
 * @typedef {{
 *   wires: THREE.Group,
 *   showSelection: (part: ConnectionPart | null) => void,
 *   syncAssembly: () => void,
 *   render: () => void,
 *   notify: (message: string) => void,
 * }} ConnectionViewPort
 */

/**
 * Owns authoring-time port validation, physical snapping, connection mutation,
 * and the connection overlay. Runtime mechanisms consume the resulting graph
 * but never enter this editor-only boundary.
 *
 * @param {{
 *   workspace: ConnectionWorkspacePort,
 *   history: ConnectionHistoryPort,
 *   view: ConnectionViewPort,
 * }} ports
 */
export function createEditorConnectionFeature({ workspace, history, view }) {
  const coordinateBehaviors = new Set([
    "rotary-coupling",
    "revolute-support",
    "rotary-actuator-output",
    "rotary-position-actuator-output",
    "rotary-measurement",
    "linear-guide-output",
    "linear-position-actuator-output",
  ]);

  function partName(part) {
    return componentDefinition(part, TYPES)?.name || `Component #${part.id}`;
  }

  function partGeometry(part) {
    return geometryDescriptorForPart(
      {
        ...part,
        pos: part.mesh ? part.mesh.position.toArray() : part.pos,
        orientation: part.mesh
          ? canonicalizeQuaternion([
              part.mesh.quaternion.x,
              part.mesh.quaternion.y,
              part.mesh.quaternion.z,
              part.mesh.quaternion.w,
            ])
          : part.orientation,
        scale: part.mesh
          ? {
              x: part.mesh.scale.x,
              y: part.mesh.scale.y,
              z: part.mesh.scale.z,
            }
          : part.scale,
      },
      TYPES,
    );
  }

  function worldFrameOffset(part, port) {
    const position = partGeometry(part).portFrames[port]?.position || [0, 0, 0];
    return new THREE.Vector3(...position).applyQuaternion(part.mesh.quaternion);
  }

  function worldFrameAxis(part, port) {
    const frame = partGeometry(part).portFrames[port],
      axis = frame?.axis || frame?.normal || [0, 0, 1];
    return new THREE.Vector3(...axis)
      .applyQuaternion(part.mesh.quaternion)
      .normalize();
  }

  function alignTargetFrame(left, sourcePort, right, targetPort) {
    const sourceAxis = worldFrameAxis(left, sourcePort),
      targetAxis = worldFrameAxis(right, targetPort),
      rotation = new THREE.Quaternion().setFromUnitVectors(
        targetAxis,
        sourceAxis,
      );
    right.mesh.quaternion.premultiply(rotation).normalize();
    const sourceWorld = left.mesh.position
      .clone()
      .add(worldFrameOffset(left, sourcePort));
    right.mesh.position.copy(
      sourceWorld.sub(worldFrameOffset(right, targetPort)),
    );
  }

  function meshPitchDistance(left, right) {
    const leftFrame = partGeometry(left).portFrames.MESH;
    const rightFrame = partGeometry(right).portFrames.MESH;
    return (
      new THREE.Vector3(...leftFrame.position).length() +
      new THREE.Vector3(...rightFrame.position).length() +
      leftFrame.clearanceM +
      rightFrame.clearanceM
    );
  }

  function valid(connection) {
    if (
      (workspace.exploded() || workspace.explodeAmount() > 0.001) &&
      connection.explodeValid != null
    )
      return connection.explodeValid;
    if (connection.failed) return false;
    const left = workspace.parts().find((part) => part.id === connection.a);
    const right = workspace.parts().find((part) => part.id === connection.b);
    if (!left || !right) return false;
    if (connection.kind === "mesh") {
      const distance = Math.hypot(
        left.mesh.position.x - right.mesh.position.x,
        left.mesh.position.y - right.mesh.position.y,
      );
      const pitchDistance = meshPitchDistance(left, right);
      return (
        Math.abs(distance - pitchDistance) < 0.13 &&
        Math.abs(left.mesh.position.z - right.mesh.position.z) < 0.13
      );
    }
    if (connection.kind !== "mechanical") return true;
    if (!connection.portA || !connection.portB) return false;
    const leftDefinition = portDefinition(left, connection.portA),
      rightDefinition = portDefinition(right, connection.portB);
    if (
      !coordinateBehaviors.has(leftDefinition.behavior) &&
      !coordinateBehaviors.has(rightDefinition.behavior)
    )
      return true;
    const leftWorld = left.mesh.position
        .clone()
        .add(worldFrameOffset(left, connection.portA)),
      rightWorld = right.mesh.position
        .clone()
        .add(worldFrameOffset(right, connection.portB)),
      axisAlignment = Math.abs(
        worldFrameAxis(left, connection.portA).dot(
          worldFrameAxis(right, connection.portB),
        ),
      );
    return leftWorld.distanceTo(rightWorld) < 0.14 && axisAlignment > 0.995;
  }

  function isMechanicallyAnchored(part) {
    return workspace
      .connections()
      .some(
        (connection) =>
          connection.kind === "mechanical" &&
          valid(connection) &&
          (connection.a === part.id || connection.b === part.id),
      );
  }

  function snap(left, right, kind, sourcePort, targetPort) {
    let moved = null;
    if (kind === "mechanical") {
      const leftBehavior = portDefinition(left, sourcePort).behavior,
        rightBehavior = portDefinition(right, targetPort).behavior;
      if (
        coordinateBehaviors.has(leftBehavior) ||
        coordinateBehaviors.has(rightBehavior)
      ) {
        alignTargetFrame(left, sourcePort, right, targetPort);
        moved = right;
      }
    } else if (kind === "mesh" && left.config?.teeth && right.config?.teeth) {
      const leftAnchored = isMechanicallyAnchored(left);
      const rightAnchored = isMechanicallyAnchored(right);
      const fixed = rightAnchored && !leftAnchored ? right : left;
      const mobile = fixed === left ? right : left;
      const delta = new THREE.Vector2(
        mobile.mesh.position.x - fixed.mesh.position.x,
        mobile.mesh.position.y - fixed.mesh.position.y,
      );
      if (delta.length() < 0.01) delta.set(1, 0);
      delta.normalize().multiplyScalar(meshPitchDistance(fixed, mobile));
      mobile.mesh.position.set(
        fixed.mesh.position.x + delta.x,
        fixed.mesh.position.y + delta.y,
        fixed.mesh.position.z,
      );
      mobile.mesh.quaternion.copy(fixed.mesh.quaternion);
      moved = mobile;
    }
    if (moved) {
      moved.pos = moved.mesh.position.toArray();
      moved.rot = moved.mesh.rotation.y;
      view.showSelection(
        workspace.parts().find((part) => part.id === workspace.selectedId()) ||
          null,
      );
      view.notify(`${partName(moved)} snapped to the authored port frame`);
    }
    return true;
  }

  function connect(
    leftId,
    rightId,
    requestedKind = "auto",
    requestedTargetPort = null,
  ) {
    const existing = workspace.connections();
    if (leftId === rightId) {
      view.notify("A component cannot connect a port to itself");
      return false;
    }
    const left = workspace.parts().find((part) => part.id === leftId);
    const right = workspace.parts().find((part) => part.id === rightId);
    if (!left || !right) return false;
    if (
      existing.some(
        (connection) =>
          (connection.a === leftId && connection.b === rightId) ||
          (connection.a === rightId && connection.b === leftId),
      )
    ) {
      view.notify(
        `${partName(left)} and ${partName(right)} already share a connection`,
      );
      return false;
    }
    const historySnapshot = history.suspended() ? null : history.capture();
    const sourcePort = workspace.connectPort();
    let kind = requestedKind;
    let targetPort = requestedTargetPort;
    if (kind === "auto") {
      if (
        sourcePort &&
        !targetPort &&
        !compatibleTargetPorts(left, sourcePort, right, TYPES, existing).length
      ) {
        view.notify(
          `${partName(right)} has no ${portPresentation(left, sourcePort).medium.toLowerCase()} port`,
        );
        return false;
      }
      targetPort ||= selectCompatibleTargetPort(
        left,
        sourcePort,
        right,
        TYPES,
        existing,
      );
      if (!targetPort) {
        view.notify(`${partName(right)} has no available compatible port`);
        return false;
      }
      kind = inferConnectionKind(left, right, sourcePort);
    }
    try {
      validatePortConnection(left, sourcePort, right, targetPort, existing);
    } catch (error) {
      view.notify(
        error instanceof Error ? error.message : "Connection is invalid",
      );
      return false;
    }
    const preSnapTransforms = [left, right].map((part) => ({
      part,
      position: part.mesh.position.clone(),
      rotation: part.mesh.rotation.clone(),
      pos: [...part.pos],
      rot: part.rot,
    }));
    if (!snap(left, right, kind, sourcePort, targetPort)) return false;
    const candidate = createEditorConnection({
      left,
      right,
      kind,
      sourcePort,
      targetPort,
      index: existing.length,
    });
    try {
      validatePortConnection(
        left,
        sourcePort,
        right,
        targetPort,
        existing,
        TYPES,
        candidate,
      );
    } catch (error) {
      for (const before of preSnapTransforms) {
        before.part.mesh.position.copy(before.position);
        before.part.mesh.rotation.copy(before.rotation);
        before.part.pos = before.pos;
        before.part.rot = before.rot;
      }
      view.notify(
        error instanceof Error ? error.message : "Connection is invalid",
      );
      return false;
    }
    if (historySnapshot)
      history.record(`connect ${partName(left)}`, historySnapshot);
    existing.push(candidate);
    workspace.replaceConnections(existing);
    view.syncAssembly();
    draw();
    view.render();
    return true;
  }

  function draw() {
    while (view.wires.children.length) {
      const child = view.wires.children[0];
      view.wires.remove(child);
      child.geometry?.dispose();
      if (Array.isArray(child.material))
        child.material.forEach((material) => material.dispose());
      else child.material?.dispose();
    }
    for (const connection of workspace.connections()) {
      const left = workspace.parts().find((part) => part.id === connection.a);
      const right = workspace.parts().find((part) => part.id === connection.b);
      if (!left || !right) continue;
      const isValid = valid(connection);
      const midpoint = new THREE.Vector3()
        .addVectors(left.mesh.position, right.mesh.position)
        .multiplyScalar(0.5);
      midpoint.y += connection.kind === "mechanical" ? 0.18 : 0.55;
      const curve = new THREE.QuadraticBezierCurve3(
        left.mesh.position.clone(),
        midpoint,
        right.mesh.position.clone(),
      );
      const radius = workspace.exploded()
        ? connection.kind === "mechanical"
          ? 0.045
          : 0.055
        : connection.kind === "mechanical"
          ? 0.025
          : 0.035;
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, 24, radius, 6, false),
        new THREE.MeshBasicMaterial({
          color: !isValid
            ? 0xff3f49
            : connection.kind === "power"
              ? 0xff8b48
              : connection.kind === "resource"
                ? 0xb787ff
                : connection.kind === "signal"
                  ? 0x67b9ff
                  : connection.kind === "mesh"
                    ? 0xffc75b
                    : 0x65ddbb,
          transparent: true,
          opacity: isValid ? 0.9 : 1,
        }),
      );
      view.wires.add(tube);
    }
  }

  return Object.freeze({ connect, draw, isMechanicallyAnchored, valid });
}
