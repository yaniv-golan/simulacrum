import * as THREE from "three";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { AUTHORING_TRANSLATION_SNAP_M } from "../model/authoring-space-policy.js";
import { createTransformControlsDomAdapter } from "./transform-controls-dom-adapter.js";
import { createTransformGizmoOperation } from "./transform-gizmo-operation.js";
import { projectTransformGizmoTargets } from "./transform-gizmo-target-projection.js";

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
    transform = new TransformControls(camera, element),
    helper = transform.getHelper();
  groupPivot.name = "groupTransformPivot";
  machine.add(groupPivot);
  transform.setTranslationSnap(AUTHORING_TRANSLATION_SNAP_M);
  transform.setRotationSnap(THREE.MathUtils.degToRad(15));
  transform.setSize(0.78);
  scene.add(helper);

  const adapter = createTransformControlsDomAdapter({ transform, element }),
    operation = createTransformGizmoOperation({
      control: transform,
      groupPivot,
      model,
      actions,
      view,
    });
  let disposed = false;

  function onMouseDown() {
    operation.begin();
  }
  function onObjectChange() {
    operation.change();
  }
  function onMouseUp() {
    operation.finish("library-pointer-up");
  }
  transform.addEventListener("mouseDown", onMouseDown);
  transform.addEventListener("objectChange", onObjectChange);
  transform.addEventListener("mouseUp", onMouseUp);

  function finish(reason = "application") {
    if (disposed) return false;
    adapter.commitActiveOperation();
    return operation.finish(reason);
  }

  function cancelPointer(pointerId) {
    if (disposed || !adapter.commitPointerCancel(pointerId)) return false;
    operation.finish("pointer-cancel");
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    adapter.beginDispose();
    operation.finish("dispose");
    transform.removeEventListener("mouseDown", onMouseDown);
    transform.removeEventListener("objectChange", onObjectChange);
    transform.removeEventListener("mouseUp", onMouseUp);
    transform.detach();
    groupPivot.removeFromParent();
    helper.removeFromParent();
    transform.dispose();
  }

  return Object.freeze({
    transform,
    groupPivot,
    cancelPointer,
    dispose,
    dragging: () => transform.dragging,
    finish,
    operation: () => ({
      ...operation.read(),
      handleTargets: projectTransformGizmoTargets({
        transform,
        camera,
        element,
      }),
    }),
  });
}
