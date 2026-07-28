import * as THREE from "three";

/**
 * Frames animated subjects around stable object roots. Render-only children may
 * change the required radius, but they must not move the tracking center.
 */
export function cameraTrackingBounds({ subjects, machine, parts }) {
  const bounds = new THREE.Box3(),
    center = new THREE.Vector3(),
    subjectCenter = new THREE.Vector3(),
    subjectPosition = new THREE.Vector3();
  for (const subject of subjects) {
    bounds.expandByObject(subject, true);
    subjectCenter.set(0, 0, 0);
    if (subject === machine) {
      const attachedParts = parts.filter(
        (part) => part.mesh.parent === machine,
      );
      for (const part of attachedParts)
        subjectCenter.add(part.mesh.getWorldPosition(subjectPosition));
      if (attachedParts.length)
        subjectCenter.multiplyScalar(1 / attachedParts.length);
      else subject.getWorldPosition(subjectCenter);
    } else subject.getWorldPosition(subjectCenter);
    center.add(subjectCenter);
  }
  center.multiplyScalar(1 / subjects.length);
  const radius = Math.hypot(
      Math.max(
        Math.abs(bounds.min.x - center.x),
        Math.abs(bounds.max.x - center.x),
      ),
      Math.max(
        Math.abs(bounds.min.y - center.y),
        Math.abs(bounds.max.y - center.y),
      ),
      Math.max(
        Math.abs(bounds.min.z - center.z),
        Math.abs(bounds.max.z - center.z),
      ),
    ),
    sphere = new THREE.Sphere(center, radius);
  return Number.isFinite(sphere.radius) && sphere.radius > 0
    ? { sphere, subjects }
    : null;
}
