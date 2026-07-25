import * as THREE from "three";
import { WORKSHOP_AXIS_PRESENTATION } from "./workshop-axis-presentation.js";

const basis = Object.freeze({
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
});

export function projectWorkshopAxes(cameraQuaternion) {
  const inverse = cameraQuaternion.clone().invert();
  return WORKSHOP_AXIS_PRESENTATION.map((axis) => {
    const view = basis[axis.id].clone().applyQuaternion(inverse);
    return Object.freeze({ id: axis.id, x: view.x, y: view.y, depth: view.z });
  });
}

/** Updates one passive SVG from the completed camera transform. */
export function createWorkshopOrientationIndicator({ root, camera }) {
  const svg = root?.querySelector("svg"),
    groups = new Map(
      [...(root?.querySelectorAll("[data-workshop-axis]") || [])].map(
        (group) => [group.dataset.workshopAxis, group],
      ),
    );
  let lastOrientation = null;
  function update() {
    if (!svg) return;
    if (
      lastOrientation &&
      1 - Math.abs(lastOrientation.dot(camera.quaternion)) < 1e-10
    )
      return;
    lastOrientation = camera.quaternion.clone();
    const projected = projectWorkshopAxes(camera.quaternion);
    for (const axis of projected) {
      const group = groups.get(axis.id);
      if (!group) continue;
      const x = 36 + axis.x * 22,
        y = 36 - axis.y * 22;
      group.querySelector("line").setAttribute("x2", x.toFixed(2));
      group.querySelector("line").setAttribute("y2", y.toFixed(2));
      group.querySelector("circle").setAttribute("cx", x.toFixed(2));
      group.querySelector("circle").setAttribute("cy", y.toFixed(2));
      group.querySelector("text").setAttribute("x", x.toFixed(2));
      group.querySelector("text").setAttribute("y", (y - 4).toFixed(2));
      group.style.opacity = String(0.62 + (1 - axis.depth) * 0.18);
    }
    for (const axis of [...projected].sort(
      (left, right) => right.depth - left.depth,
    ))
      svg.append(groups.get(axis.id));
  }
  return Object.freeze({ update });
}
