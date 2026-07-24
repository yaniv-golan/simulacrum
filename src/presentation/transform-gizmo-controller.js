import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { AUTHORING_TRANSLATION_SNAP_M } from "../model/authoring-space-policy.js";

/** Owns snapped single- and multi-part transform-gizmo interaction. */
export function createTransformGizmoController({
  camera,
  element,
  scene,
  machine,
  model,
  actions,
  view,
}) {
  const groupPivot = new THREE.Object3D(),
    transform = new TransformControls(camera, element);
  groupPivot.name = "groupTransformPivot";
  machine.add(groupPivot);
  transform.setTranslationSnap(AUTHORING_TRANSLATION_SNAP_M);
  transform.setRotationSnap(THREE.MathUtils.degToRad(15));
  transform.setSize(0.78);
  scene.add(transform.getHelper());

  let dragging = false;
  let groupStart = null;
  transform.addEventListener("dragging-changed", (event) => {
    dragging = event.value;
    if (event.value) return;
    groupStart = null;
    actions.syncAssembly();
    view.showSelection(
      model.parts().find((part) => part.id === model.selectedId()),
    );
  });
  transform.addEventListener("mouseDown", () => {
    if (dragging) return;
    actions.recordHistory("transform selection");
    const selected = model
      .parts()
      .filter((part) => model.selectedIds().has(part.id));
    if (selected.length > 1)
      groupStart = {
        center: groupPivot.position.clone(),
        parts: selected.map((part) => ({
          part,
          position: part.mesh.position.clone(),
          quaternion: part.mesh.quaternion.clone(),
        })),
      };
  });
  transform.addEventListener("objectChange", () => {
    if (groupStart && transform.object === groupPivot) {
      for (const entry of groupStart.parts) {
        const offset = entry.position
          .clone()
          .sub(groupStart.center)
          .applyQuaternion(groupPivot.quaternion);
        entry.part.mesh.position.copy(groupPivot.position).add(offset);
        entry.part.mesh.quaternion
          .copy(groupPivot.quaternion)
          .multiply(entry.quaternion);
        entry.part.pos = entry.part.mesh.position.toArray();
        entry.part.rot = entry.part.mesh.rotation.y;
      }
      view.updateSelection();
      view.drawConnections();
      view.refreshEngineering();
      return;
    }
    const part = model
      .parts()
      .find((candidate) => candidate.id === model.selectedId());
    if (!part) return;
    part.pos = part.mesh.position.toArray();
    part.rot = part.mesh.rotation.y;
    view.showSelection(part);
    view.drawConnections();
    view.refreshEngineering();
  });

  return Object.freeze({
    transform,
    groupPivot,
    dragging: () => dragging,
  });
}
