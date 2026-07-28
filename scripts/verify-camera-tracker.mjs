import * as THREE from "three";
import { CameraTracker } from "../src/presentation/camera-tracker.js";
import { assert } from "./lib/assert.mjs";

const camera = new THREE.PerspectiveCamera(50, 16 / 9, 0.1, 1e7),
  target = new THREE.Vector3(),
  tracker = new CameraTracker({ camera, target, initialDistance: 18 }),
  sphere = new THREE.Sphere(new THREE.Vector3(0, 10, 0), 4),
  safeFrame = {
    left: 260,
    right: 1160,
    top: 90,
    bottom: 760,
    viewport: { left: 0, top: 0, width: 1440, height: 900 },
  };

tracker.update({
  dt: 1 / 60,
  yaw: 0.72,
  pitch: 0.47,
  distance: 18,
  tracking: { sphere, subjects: [{ id: 1 }] },
  safeFrame,
});
assert.equal(tracker.telemetry.active, true, "tracking did not activate");
assert.ok(
  tracker.telemetry.fitDistance >= 4,
  "camera did not derive a physical bounds fit",
);
assert.equal(
  tracker.smoothedTarget.distanceTo(target),
  0,
  "tracked translation must not lag behind the physical subject",
);

sphere.center.set(4000, 5000, -6000);
tracker.update({
  dt: 1 / 120,
  yaw: 0.72,
  pitch: 0.47,
  distance: 18,
  tracking: { sphere, subjects: [{ id: 1 }] },
  safeFrame,
});
assert.equal(
  tracker.smoothedTarget.distanceTo(target),
  0,
  "camera tracking must remain invariant to subject velocity",
);
assert.ok(
  Object.values(camera.position).every(Number.isFinite),
  "camera pose must remain finite at aerospace-scale translation",
);

const animatedSubject = { id: 2 },
  animatedCenter = new THREE.Vector3(4100, 5000, -6000);
tracker.update({
  dt: 1 / 120,
  yaw: 0.72,
  pitch: 0.47,
  distance: 18,
  tracking: {
    sphere: new THREE.Sphere(animatedCenter, 6),
    subjects: [animatedSubject],
  },
  safeFrame,
});
const envelopeDistance = tracker.telemetry.fitDistance;
tracker.update({
  dt: 1 / 120,
  yaw: 0.72,
  pitch: 0.47,
  distance: 18,
  tracking: {
    sphere: new THREE.Sphere(animatedCenter, 3),
    subjects: [animatedSubject],
  },
  safeFrame,
});
assert.equal(
  tracker.telemetry.boundsRadius < 6,
  true,
  "animated child bounds must contract the active tracking envelope",
);
assert.equal(
  tracker.telemetry.fitDistance < envelopeDistance,
  true,
  "camera fit must recover after animated child bounds contract",
);
console.log("camera tracker passed");
