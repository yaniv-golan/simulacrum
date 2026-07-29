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
    this.trackedSubjects = [];
    this.trackingRadius = 0;
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

  snap(target, distance) {
    this.target.copy(target);
    this.smoothedTarget.copy(target);
    this.smoothedDistance = distance;
  }

  snapPreset(preset) {
    const desiredPosition = new THREE.Vector3(...preset.positionM),
      desiredTarget = new THREE.Vector3(...preset.targetM),
      offset = desiredPosition.clone().sub(desiredTarget);
    offset.y -= 1.5;
    const distance = offset.length(),
      yaw = Math.atan2(offset.x, offset.z),
      pitch = Math.asin(
        THREE.MathUtils.clamp(offset.y / Math.max(distance, 1e-6), -1, 1),
      );
    this.camera.fov = preset.fovDeg;
    this.camera.updateProjectionMatrix();
    this.snap(desiredTarget, distance);
    this.update({
      dt: 1,
      yaw,
      pitch,
      distance,
      tracking: null,
      safeFrame: null,
      followSelection: false,
      selectionPosition: null,
    });
    return { distance, yaw, pitch };
  }

  restoreSnapshot(viewState) {
    return {
      ...this.snapPreset({
        positionM: viewState.position.toArray(),
        targetM: viewState.target.toArray(),
        fovDeg: viewState.fovDeg,
      }),
      followSelection: viewState.followSelection,
      presetId: viewState.presetId,
    };
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
        sameSubjects =
          subjects.length === this.trackedSubjects.length &&
          subjects.every(
            (subject, index) => subject === this.trackedSubjects[index],
          ),
        radiusSmoothing = 1 - Math.exp(-Math.max(0.001, dt) * 8),
        trackingRadius = sameSubjects
          ? THREE.MathUtils.lerp(
              this.trackingRadius,
              sphere.radius,
              radiusSmoothing,
            )
          : sphere.radius,
        safe = safeFrame,
        width = Math.max(1, safe.viewport.width),
        height = Math.max(1, safe.viewport.height),
        safeWidth = Math.max(80, safe.right - safe.left),
        safeHeight = Math.max(80, safe.bottom - safe.top),
        tanHalfFov = Math.tan(THREE.MathUtils.degToRad(this.camera.fov * 0.5)),
        verticalFit = trackingRadius / (tanHalfFov * (safeHeight / height)),
        horizontalFit =
          trackingRadius /
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
      this.trackedSubjects = [...subjects];
      this.trackingRadius = trackingRadius;
      Object.assign(this.telemetry, {
        boundsRadius: trackingRadius,
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
      this.trackedSubjects = [];
      this.trackingRadius = 0;
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
