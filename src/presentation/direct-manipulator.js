import * as THREE from "three";

/** Owns click-drag promotion and snapped multi-part movement in the viewport. */
export class DirectManipulator {
  constructor({
    element,
    pointOnPlane,
    thresholdPx = 6,
    snap = 0.25,
    onActivate = (_gesture) => {},
    onMove = (_gesture, _delta) => {},
    onFinish = (_result) => {},
  }) {
    this.element = element;
    this.pointOnPlane = pointOnPlane;
    this.thresholdPx = thresholdPx;
    this.snap = snap;
    this.onActivate = onActivate;
    this.onMove = onMove;
    this.onFinish = onFinish;
    this.gesture = null;
  }

  begin(event, { enabled, primary, parts }) {
    if (!enabled || !primary || !parts.length) return false;
    const planeHeight = primary.mesh.position.y,
      startPoint = this.pointOnPlane(event.clientX, event.clientY, planeHeight);
    if (!startPoint) return false;
    this.gesture = {
      pointerId: event.pointerId,
      startClient: new THREE.Vector2(event.clientX, event.clientY),
      startPoint,
      planeHeight,
      active: false,
      parts: parts.map((part) => ({
        part,
        position: part.mesh.position.clone(),
      })),
    };
    this.element.setPointerCapture?.(event.pointerId);
    return true;
  }

  update(event) {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return false;
    const distance = gesture.startClient.distanceTo(
      new THREE.Vector2(event.clientX, event.clientY),
    );
    if (!gesture.active && distance >= this.thresholdPx) {
      gesture.active = true;
      this.onActivate(gesture);
    }
    if (!gesture.active) return true;
    const current = this.pointOnPlane(
      event.clientX,
      event.clientY,
      gesture.planeHeight,
    );
    if (!current) return true;
    const delta = current.sub(gesture.startPoint);
    delta.x = Math.round(delta.x / this.snap) * this.snap;
    delta.y = 0;
    delta.z = Math.round(delta.z / this.snap) * this.snap;
    for (const entry of gesture.parts) {
      entry.part.mesh.position.copy(entry.position).add(delta);
      entry.part.pos = entry.part.mesh.position.toArray();
    }
    this.element.style.cursor = "grabbing";
    this.onMove(gesture, delta);
    return true;
  }

  finish(event) {
    const gesture = this.gesture;
    if (
      !gesture ||
      (event?.pointerId != null && gesture.pointerId !== event.pointerId)
    )
      return false;
    const moved = gesture.active;
    this.element.releasePointerCapture?.(gesture.pointerId);
    this.gesture = null;
    this.onFinish({ moved, gesture });
    return moved;
  }

  snapshot() {
    const gesture = this.gesture;
    return gesture
      ? {
          pending: !gesture.active,
          active: gesture.active,
          thresholdPx: this.thresholdPx,
          partIds: gesture.parts.map((entry) => entry.part.id),
        }
      : null;
  }
}
