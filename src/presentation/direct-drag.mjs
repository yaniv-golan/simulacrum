import * as THREE from 'three';
import { transformGroup } from '../model/editing.mjs';
import { findPlacementOverlap } from '../model/surfaces.mjs';

/** Owns a canvas drag and its pointer capture; only sends ordinary edit commands. */
export function createDirectDrag({
  renderer,
  camera,
  controls,
  editing,
  surface,
  getFrame,
  getMeshes,
  canStart,
  select,
  send,
  placementCue,
  showPlacementCue,
  setMessage,
  onSurfaceStart,
}) {
  const abort = new AbortController(),
    raycaster = new THREE.Raycaster(),
    pointer = new THREE.Vector2();
  let directDrag = null;
  function setRay(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      (-(event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
  }
  function endDirectDrag(commit = false, event) {
    if (!directDrag) return;
    const frame = getFrame();
    commit =
      commit &&
      dragBlueprintCurrent(directDrag, frame.metadata.blueprint) &&
      canReleaseDrag(directDrag, event, renderer.domElement.getBoundingClientRect());
    const drag = directDrag;
    directDrag = null;
    placementCue.hidden = true;
    renderer.domElement.style.cursor = '';
    editing.clearPreview();
    if (drag.surface) {
      controls.enabled = true;
      if (renderer.domElement.hasPointerCapture(drag.pointerId))
        renderer.domElement.releasePointerCapture(drag.pointerId);
      if (commit) surface.endPointer(event);
      else surface.cancel();
      return;
    }
    surface.cancel(false);
    if (!commit && drag.position) setMessage('Move cancelled. Your machine is unchanged.');
    controls.enabled = true;
    if (renderer.domElement.hasPointerCapture(drag.pointerId))
      renderer.domElement.releasePointerCapture(drag.pointerId);
    if (commit && drag.position && frame.metadata.mode === 'build')
      send({
        type: 'transform',
        id: drag.part.id,
        position: drag.position,
        rotation: drag.part.rotation,
      });
  }
  renderer.domElement.addEventListener(
    'pointerdown',
    (event) => {
      const frame = getFrame();
      if (directDrag || !canStart(event)) return;
      setRay(event);
      const hit = raycaster
        .intersectObjects([...getMeshes().values()])
        .find((hit) => hit.object.isMesh);
      if (!hit) return;
      const id = hit.object.userData.partId,
        part = frame.metadata.blueprint.parts.find((part) => part.id === id);
      if (!part) return;
      select(id);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -part.position[1]),
        start = raycaster.ray.intersectPlane(plane, new THREE.Vector3());
      if (!start) return;
      event.stopImmediatePropagation();
      controls.enabled = false;
      directDrag = {
        part: structuredClone(part),
        blueprint: frame.metadata.blueprint,
        plane,
        start,
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        position: null,
      };
      renderer.domElement.setPointerCapture(event.pointerId);
    },
    { capture: true, signal: abort.signal },
  );
  renderer.domElement.addEventListener(
    'pointermove',
    (event) => {
      if (!ownsDragPointer(directDrag, event)) return;
      const frame = getFrame();
      event.stopImmediatePropagation();
      if (!dragBlueprintCurrent(directDrag, frame.metadata.blueprint)) {
        endDirectDrag(false);
        setMessage('Machine changed. Start the drag again.');
        return;
      }
      if (
        Math.hypot(event.clientX - directDrag.x, event.clientY - directDrag.y) < 5 &&
        !directDrag.position
      )
        return;
      if (surface.enabled() && !surface.active()) {
        surface.start(directDrag.part.id, { drag: true });
        onSurfaceStart();
      }
      if (surface.active() && surface.point(event, { lock: true })) {
        placementCue.hidden = true;
        renderer.domElement.style.cursor = '';
        editing.clearPreview();
        directDrag.surface = true;
        controls.enabled = false;
        return;
      }
      setRay(event);
      const point = raycaster.ray.intersectPlane(directDrag.plane, new THREE.Vector3());
      if (!point) return;
      const delta = point.sub(directDrag.start);
      directDrag.position = directDrag.part.position.map((value, axis) =>
        axis === 1 ? value : value + Math.round(delta.getComponent(axis) / 0.025) * 0.025,
      );
      const next = transformGroup(
        directDrag.blueprint,
        directDrag.part.id,
        directDrag.position,
        directDrag.part.rotation,
      );
      const overlap = findPlacementOverlap(next.parts);
      editing.showPreview(
        next.parts.filter(
          (part, i) => JSON.stringify(part) !== JSON.stringify(directDrag.blueprint.parts[i]),
        ),
        { color: overlap ? 0xff836f : 0x8cf5cf },
      );
      renderer.domElement.style.cursor = 'grabbing';
      showPlacementCue(
        event,
        overlap
          ? `${overlap[0].name} overlaps ${overlap[1].name} · Move clear`
          : 'Release to move · Esc cancels',
      );
      setMessage(
        overlap
          ? 'Placement blocked. Move clear or press Esc to cancel.'
          : 'Release to move the attached parts here. Esc cancels.',
      );
    },
    { capture: true, signal: abort.signal },
  );
  renderer.domElement.addEventListener(
    'pointerup',
    (event) => {
      if (!ownsDragPointer(directDrag, event)) return;
      const frame = getFrame();
      event.stopImmediatePropagation();
      endDirectDrag(true, event);
    },
    { capture: true, signal: abort.signal },
  );
  return {
    active: () => directDrag !== null,
    hasMoved: () => Boolean(directDrag?.position),
    end: endDirectDrag,
    dispose() {
      endDirectDrag(false);
      abort.abort();
    },
  };
}
export const ownsDragPointer = (drag, event) => !!drag && event?.pointerId === drag.pointerId;
export const canReleaseDrag = (drag, event, rect) =>
  ownsDragPointer(drag, event) &&
  event.clientX >= rect.left &&
  event.clientX <= rect.right &&
  event.clientY >= rect.top &&
  event.clientY <= rect.bottom;

export const dragBlueprintCurrent = (drag, blueprint) =>
  drag.blueprint === blueprint || JSON.stringify(drag.blueprint) === JSON.stringify(blueprint);
