import * as THREE from "three";
import { DirectManipulator } from "./direct-manipulator.js";
import { MarqueeSelector } from "./marquee-selector.js";

/**
 * Owns canvas pointer gestures for selection, direct movement, placement,
 * connection previews, marquee selection, and camera hand-off.
 *
 * The controller deliberately receives explicit read/write ports instead of
 * the application state object. That keeps presentation gestures reusable and
 * prevents them from becoming a second editor model.
 */
export function installWorkshopPointerController({
  target,
  camera,
  scene,
  transform,
  model,
  editor,
  history,
  view,
}) {
  let hovered = null;

  const directManipulator = new DirectManipulator({
    element: target,
    pointOnPlane: camera.pointOnHorizontalPlane,
    onActivate: () => {
      history.record("drag selection");
      transform.detach();
      view.query("#move-tool").classList.add("gesture-active");
    },
    onMove: () => {
      view.updateSelection();
      view.drawConnections();
    },
    onFinish: ({ moved }) => {
      view.query("#move-tool").classList.remove("gesture-active");
      target.style.cursor = hovered ? "pointer" : "default";
      if (!moved) return;
      view.syncAssembly();
      view.showSelection(
        model.parts().find((part) => part.id === model.selectedId()),
      );
      view.notify(
        "Selection moved · drag again or use the axis gizmo for precision",
      );
    },
  });

  const marqueeSelector = new MarqueeSelector({
    element: target,
    camera: scene.camera,
    candidates: () => model.parts().filter((part) => part.mesh.visible),
    onCommit: editor.commitMarquee,
  });

  function pointerDown(event) {
    if (camera.beginPointer(event)) return;
    if (
      event.button !== 0 ||
      model.running() ||
      model.transformDragging() ||
      transform.axis
    )
      return;

    const hit = camera.intersectMachine(event.clientX, event.clientY);
    if (hit) {
      const id = camera.hitPartIdAt(event.clientX, event.clientY),
        additive = event.ctrlKey || event.metaKey || event.shiftKey,
        selectedIds = model.selectedIds(),
        preserveGroup =
          !additive && selectedIds.size > 1 && selectedIds.has(id);
      if (preserveGroup) editor.preserveGroupSelection(id, selectedIds);
      else {
        const targetPart = model.parts().find((part) => part.id === id),
          targetAnchorLocalM = targetPart
            ? targetPart.mesh.worldToLocal(hit.point.clone()).toArray()
            : null;
        editor.selectPart(id, additive, { targetAnchorLocalM });
      }
      directManipulator.begin(event, {
        enabled:
          ["select", "move"].includes(model.tool()) &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey &&
          !model.connectFrom() &&
          !model.placing(),
        primary: model.parts().find((part) => part.id === model.selectedId()),
        parts: editor.selectedParts(),
      });
      return;
    }

    const floorHit = camera.intersectFloor(event.clientX, event.clientY),
      placing = model.placing();
    if (!placing) {
      marqueeSelector.begin(event, {
        enabled: model.tool() === "select" && !model.connectFrom(),
        additive: event.ctrlKey || event.metaKey || event.shiftKey,
      });
      return;
    }
    if (!floorHit) return;

    const point = floorHit.point;
    point.x = Math.round(point.x * 0.5) * 2;
    point.z = Math.round(point.z * 0.5) * 2;
    editor.placePending([point.x, placing.position?.[1] ?? point.y, point.z]);
  }

  function pointerMove(event) {
    if (directManipulator.update(event)) return;
    if (marqueeSelector.update(event)) return;
    if (camera.movePointer(event)) return;
    const id = camera.hitPartIdAt(event.clientX, event.clientY);
    hovered = model.parts().find((part) => part.id === id) || null;
    view.showHover(hovered);
    target.style.cursor =
      model.cameraTool() === "pan"
        ? "grab"
        : model.cameraTool() === "orbit"
          ? "move"
          : hovered
            ? "pointer"
            : model.placing()
              ? "crosshair"
              : "default";
    if (model.connectFrom()) renderConnectionPreview(event);
  }

  function renderConnectionPreview(event) {
    view.clearEffect("previewLine");
    const source = model
        .parts()
        .find((part) => part.id === model.connectFrom()),
      floorHit = camera.intersectFloor(event.clientX, event.clientY),
      destination = hovered?.mesh.position || floorHit?.point;
    if (!source || !destination) return;
    const start = source.mesh.position.clone(),
      end = destination.clone(),
      midpoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    midpoint.y += 0.7;
    const preview = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(
        new THREE.QuadraticBezierCurve3(start, midpoint, end).getPoints(24),
      ),
      new THREE.LineDashedMaterial({
        color: hovered ? 0xffc35d : 0x79efd3,
        dashSize: 0.18,
        gapSize: 0.11,
        transparent: true,
        opacity: 0.9,
        depthTest: false,
      }),
    );
    preview.computeLineDistances();
    preview.name = "previewLine";
    scene.effects.add(preview);
  }

  function finishPointer(event) {
    directManipulator.finish(event);
    marqueeSelector.finish(event);
    camera.endPointer();
  }

  function cancelPointer(event) {
    directManipulator.finish(event);
    marqueeSelector.cancel();
    camera.endPointer();
  }

  function doubleClick(event) {
    const id = camera.hitPartIdAt(event.clientX, event.clientY);
    if (id) editor.selectPart(id);
    camera.frameSelection();
  }

  target.addEventListener("pointerdown", pointerDown);
  target.addEventListener("pointermove", pointerMove);
  target.addEventListener("dblclick", doubleClick);
  window.addEventListener("pointerup", finishPointer);
  window.addEventListener("pointercancel", cancelPointer);

  return {
    directManipulator,
    marqueeSelector,
    dispose() {
      target.removeEventListener("pointerdown", pointerDown);
      target.removeEventListener("pointermove", pointerMove);
      target.removeEventListener("dblclick", doubleClick);
      window.removeEventListener("pointerup", finishPointer);
      window.removeEventListener("pointercancel", cancelPointer);
    },
  };
}
