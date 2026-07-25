import * as THREE from "three";

const AXES = Object.freeze({
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
});

/** Returns read-only viewport targets for the rendered positive-axis pickers. */
export function projectTransformGizmoTargets({ transform, camera, element }) {
  const object = transform.object,
    helper = transform.getHelper();
  if (!object || !helper.parent || transform.mode !== "translate") return null;
  const rect = element.getBoundingClientRect(),
    pivot = object.getWorldPosition(new THREE.Vector3()),
    pivotPixel = projectPixel(pivot, camera, rect),
    factor = camera.isOrthographicCamera
      ? (camera.top - camera.bottom) / camera.zoom
      : pivot.distanceTo(camera.getWorldPosition(new THREE.Vector3())) *
        Math.min(
          (1.9 * Math.tan((Math.PI * camera.fov) / 360)) / camera.zoom,
          7,
        ),
    pickerDistance = (factor * transform.size * 0.3) / 4,
    orientation =
      transform.space === "local"
        ? object.getWorldQuaternion(new THREE.Quaternion())
        : null,
    axes = {};
  for (const [id, basis] of Object.entries(AXES)) {
    const direction = basis.clone();
    if (orientation) direction.applyQuaternion(orientation);
    const pixel = projectPixel(
        pivot.clone().addScaledVector(direction, pickerDistance),
        camera,
        rect,
      ),
      dx = pixel.x - pivotPixel.x,
      dy = pixel.y - pivotPixel.y,
      length = Math.hypot(dx, dy);
    axes[id] = Object.freeze({
      x: +pixel.x.toFixed(2),
      y: +pixel.y.toFixed(2),
      dx: +(dx / Math.max(length, 1)).toFixed(4),
      dy: +(dy / Math.max(length, 1)).toFixed(4),
      hittable: length >= 8,
    });
  }
  return Object.freeze({
    center: Object.freeze({
      x: +pivotPixel.x.toFixed(2),
      y: +pivotPixel.y.toFixed(2),
    }),
    axes: Object.freeze(axes),
  });
}

function projectPixel(point, camera, rect) {
  const ndc = point.clone().project(camera);
  return {
    x: rect.left + ((ndc.x + 1) * rect.width) / 2,
    y: rect.top + ((1 - ndc.y) * rect.height) / 2,
  };
}
