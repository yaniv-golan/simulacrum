import * as THREE from "three";

/** Derives one bounded camera frame for the exact selected set or machine. */
export function selectionCameraFrame({
  parts,
  selectedIds,
  machine,
  camera,
  partName,
}) {
  const selection = parts.filter((part) => selectedIds.has(part.id));
  if (!selection.length && !parts.length) return null;
  const bounds = new THREE.Box3();
  if (selection.length)
    for (const selected of selection)
      bounds.expandByObject(selected.mesh, true);
  else bounds.setFromObject(machine, true);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius)) return null;
  return {
    target: sphere.center,
    distance: THREE.MathUtils.clamp(
      (sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov * 0.5))) *
        1.35,
      selection.length ? 4 : 7,
      70,
    ),
    message: selection.length
      ? selection.length === 1
        ? `Framed ${partName(selection[0].type)}`
        : `Framed ${selection.length} selected components`
      : "Framed complete machine",
  };
}
