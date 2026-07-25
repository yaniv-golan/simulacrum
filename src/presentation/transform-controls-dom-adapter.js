/** Bridges TransformControls' public pointer APIs to application lifecycle. */
export function createTransformControlsDomAdapter({ transform, element }) {
  let activePointerId = null,
    observersInstalled = false,
    committing = false,
    disposing = false;

  function observePointerDown(event) {
    if (
      activePointerId === null &&
      transform.dragging &&
      transform.axis !== null
    )
      activePointerId = event.pointerId;
  }

  function observePointerUp(event) {
    if (event.pointerId === activePointerId) activePointerId = null;
  }

  function installObservers() {
    if (observersInstalled) return;
    element.addEventListener("pointerdown", observePointerDown);
    element.addEventListener("pointerup", observePointerUp);
    observersInstalled = true;
  }

  function removeObservers() {
    if (!observersInstalled) return;
    element.removeEventListener("pointerdown", observePointerDown);
    element.removeEventListener("pointerup", observePointerUp);
    observersInstalled = false;
  }

  function releaseOwnedCapture() {
    const pointerId = activePointerId;
    activePointerId = null;
    if (pointerId !== null && element.hasPointerCapture?.(pointerId))
      element.releasePointerCapture(pointerId);
  }

  function commitActiveOperation() {
    if (
      committing ||
      disposing ||
      (activePointerId === null &&
        !transform.dragging &&
        transform.axis === null)
    )
      return false;
    committing = true;
    try {
      releaseOwnedCapture();
      removeObservers();
      transform.disconnect();
      transform.pointerUp(null);
      if (!disposing) {
        transform.connect(element);
        installObservers();
      }
      return true;
    } finally {
      committing = false;
    }
  }

  function commitPointerCancel(pointerId) {
    return pointerId === activePointerId && commitActiveOperation();
  }

  function beginDispose() {
    if (disposing) return false;
    disposing = true;
    releaseOwnedCapture();
    removeObservers();
    transform.pointerUp(null);
    return true;
  }

  installObservers();
  return Object.freeze({
    activePointer: () => activePointerId,
    beginDispose,
    commitActiveOperation,
    commitPointerCancel,
  });
}
