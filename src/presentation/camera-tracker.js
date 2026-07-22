import * as THREE from "three";

/**
 * Presentation-only camera fitting and smoothing. Tracking is derived from
 * scene bounds and the currently visible safe frame, never from demo identity.
 */
export class CameraTracker {
  constructor({ camera, target, initialDistance }) {
    this.camera = camera;
    this.target = target;
    this.smoothedTarget = target.clone();
    this.smoothedDistance = initialDistance;
    this.telemetry = {
      active: false,
      boundsRadius: 0,
      fitDistance: initialDistance,
      safeFrame: null,
      subjects: 0,
    };
  }

  rebase(deltaX, deltaZ) {
    this.smoothedTarget.x -= deltaX;
    this.smoothedTarget.z -= deltaZ;
  }

  update({
    dt,
    yaw,
    pitch,
    distance,
    tracking,
    safeFrame,
    followSelection,
    selectionPosition,
  }) {
    const smoothing = 1 - Math.exp(-Math.max(0.001, dt) * 14);
    let viewDistance = distance;
    this.telemetry.active = Boolean(tracking);
    if (tracking) {
      const { sphere, subjects } = tracking,
        safe = safeFrame,
        width = Math.max(1, safe.viewport.width),
        height = Math.max(1, safe.viewport.height),
        safeWidth = Math.max(80, safe.right - safe.left),
        safeHeight = Math.max(80, safe.bottom - safe.top),
        tanHalfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)),
        verticalFit = sphere.radius / (tanHalfFov * (safeHeight / height)),
        horizontalFit =
          sphere.radius /
          (tanHalfFov * this.camera.aspect * (safeWidth / width)),
        fitDistance = Math.max(verticalFit, horizontalFit) * 1.18,
        viewDirection = new THREE.Vector3(
          -Math.sin(yaw) * Math.cos(pitch),
          -Math.sin(pitch),
          -Math.cos(yaw) * Math.cos(pitch),
        ),
        screenRight = new THREE.Vector3()
          .crossVectors(viewDirection, new THREE.Vector3(0, 1, 0))
          .normalize(),
        screenUp = new THREE.Vector3()
          .crossVectors(screenRight, viewDirection)
          .normalize();
      viewDistance = Math.max(distance, fitDistance);
      const worldHeight = 2 * viewDistance * tanHalfFov,
        worldWidth = worldHeight * this.camera.aspect,
        safeCenterX = (safe.left + safe.right) * 0.5 - safe.viewport.left,
        safeCenterY = (safe.top + safe.bottom) * 0.5 - safe.viewport.top;
      this.target
        .copy(sphere.center)
        .addScaledVector(
          screenRight,
          -((safeCenterX - width * 0.5) / width) * worldWidth,
        )
        .addScaledVector(
          screenUp,
          ((safeCenterY - height * 0.5) / height) * worldHeight,
        );
      // Translation belongs to the tracked body, not to the camera spring.
      this.smoothedTarget.copy(this.target);
      Object.assign(this.telemetry, {
        boundsRadius: sphere.radius,
        fitDistance,
        subjects: subjects.length,
        safeFrame: {
          left: safe.left - safe.viewport.left,
          right: safe.right - safe.viewport.left,
          top: safe.top - safe.viewport.top,
          bottom: safe.bottom - safe.viewport.top,
        },
      });
    } else {
      if (followSelection && selectionPosition)
        this.target.copy(selectionPosition);
      this.smoothedTarget.lerp(this.target, smoothing);
    }
    this.smoothedDistance = THREE.MathUtils.lerp(
      this.smoothedDistance,
      viewDistance,
      smoothing,
    );
    if (tracking)
      this.smoothedDistance = Math.max(
        this.smoothedDistance,
        this.telemetry.fitDistance,
      );
    this.camera.position.set(
      this.smoothedTarget.x +
        Math.sin(yaw) * Math.cos(pitch) * this.smoothedDistance,
      this.smoothedTarget.y + Math.sin(pitch) * this.smoothedDistance + 1.5,
      this.smoothedTarget.z +
        Math.cos(yaw) * Math.cos(pitch) * this.smoothedDistance,
    );
    this.camera.lookAt(this.smoothedTarget);
  }
}
