import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { transformGroup } from '../model/editing.mjs';
import { CATALOG } from '../model/catalog.mjs';

/** Preview objects never overwrite authoritative rendered body poses. */
export function createEditingControls({
  scene,
  camera,
  renderer,
  orbit,
  getPart,
  getBlueprint,
  getMode,
  getMeshes,
  onCommit,
  getViewportInsets = () => ({}),
}) {
  const proxy = new THREE.Object3D(),
    preview = new THREE.Group();
  scene.add(proxy, preview);
  const gizmo = new TransformControls(camera, renderer.domElement);
  scene.add(gizmo.getHelper());
  gizmo.setTranslationSnap(0.025);
  gizmo.setRotationSnap(Math.PI / 12);
  gizmo.setSize(0.8);
  let selected = null,
    tool = 'select',
    dragging = false,
    dragOrigin = null;
  function clearPreview() {
    for (const mesh of [...preview.children]) {
      preview.remove(mesh);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
  }
  function showPreview(parts, { color = 0x8cf5cf } = {}) {
    clearPreview();
    for (const part of parts) {
      const shape = CATALOG[part.type].primitives[0],
        h = shape.halfExtents;
      const geometry =
        shape.kind === 'cylinder'
          ? new THREE.CylinderGeometry(h[1], h[1], 2 * h[0], 24).rotateZ(-Math.PI / 2)
          : new THREE.BoxGeometry(...h.map((v) => 2 * v));
      const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }),
      );
      mesh.position.fromArray(part.position);
      mesh.quaternion.fromArray(part.rotation);
      preview.add(mesh);
    }
  }
  function hitPreview(event) {
    const rect = renderer.domElement.getBoundingClientRect(),
      ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        1 - ((event.clientY - rect.top) / rect.height) * 2,
      ),
      camera,
    );
    preview.updateMatrixWorld(true);
    return ray.intersectObjects(preview.children, true).length > 0;
  }
  function refresh() {
    if (dragging) return;
    const part = getPart(selected);
    if (!part || getMode() !== 'build' || tool === 'select') {
      gizmo.detach();
      return;
    }
    proxy.position.fromArray(part.position);
    proxy.quaternion.fromArray(part.rotation);
    gizmo.setMode(tool);
    gizmo.attach(proxy);
  }
  gizmo.addEventListener('dragging-changed', (event) => {
    dragging = event.value;
    orbit.enabled = !dragging;
    if (dragging) {
      const part = getPart(selected);
      dragOrigin = part && structuredClone(part);
    } else refresh();
  });
  gizmo.addEventListener('objectChange', () => {
    const part = getPart(selected);
    if (dragging && part) {
      const before = getBlueprint(),
        next = transformGroup(
          before,
          part.id,
          proxy.position.toArray(),
          proxy.quaternion.toArray(),
        );
      showPreview(
        next.parts.filter((p, i) => JSON.stringify(p) !== JSON.stringify(before.parts[i])),
      );
    }
  });
  gizmo.addEventListener('mouseUp', async () => {
    if (!dragOrigin) return;
    const origin = dragOrigin;
    dragOrigin = null;
    const position = proxy.position.toArray(),
      rotation = proxy.quaternion.toArray();
    clearPreview();
    if (
      position.some((v, i) => Math.abs(v - origin.position[i]) > 1e-8) ||
      rotation.some((v, i) => Math.abs(v - origin.rotation[i]) > 1e-8)
    )
      await onCommit({ type: 'transform', id: origin.id, position, rotation });
    refresh();
  });
  function cancel() {
    dragOrigin = null;
    if (dragging) gizmo.reset();
    clearPreview();
    refresh();
  }
  function focus({ recover = true } = {}) {
    const meshes = [...getMeshes().values()];
    if (!meshes.length) return;
    const bounds = new THREE.Box3();
    for (const mesh of meshes) bounds.expandByObject(mesh);
    frameBounds(camera, orbit, bounds, {
      width: renderer.domElement.clientWidth,
      height: renderer.domElement.clientHeight,
      ...getViewportInsets(),
      recover,
    });
  }
  return {
    select(id) {
      selected = id;
      clearPreview();
      refresh();
    },
    setTool(value) {
      tool = value;
      clearPreview();
      refresh();
    },
    refresh,
    showPreview,
    hitPreview,
    clearPreview,
    cancel,
    focus,
    isDragging: () => dragging,
    isHandleActive: () => gizmo.axis !== null,
    dispose() {
      gizmo.dispose();
      scene.remove(gizmo.getHelper(), proxy, preview);
      clearPreview();
    },
  };
}

/** Fit in the visible canvas, retaining heading except when recovering from below. */
export function frameBounds(
  camera,
  orbit,
  bounds,
  { width = 1, height = 1, top = 0, bottom = 0, left = 0, right = 0, recover = true } = {},
) {
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3()),
    radius = Math.max(0.15, bounds.getSize(new THREE.Vector3()).length() * 0.5);
  const direction = camera.position.clone().sub(orbit.target);
  if (direction.lengthSq() < 1e-8) direction.set(1, 0.7, 1);
  direction.normalize();
  if (recover && direction.y < 0.15) {
    direction.y = 0.65;
    direction.normalize();
  }
  const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)),
    horizontal = vertical * camera.aspect;
  const usableX = Math.max(0.1, 1 - (left + right) / Math.max(1, width)),
    usableY = Math.max(0.1, 1 - (top + bottom) / Math.max(1, height));
  const angle = Math.atan(Math.min(horizontal * usableX, vertical * usableY)),
    distance = (radius / Math.sin(angle)) * 1.15;
  const screenX = (left - right) / Math.max(1, width),
    screenY = (bottom - top) / Math.max(1, height);
  const rightAxis = new THREE.Vector3(0, 1, 0).cross(direction).normalize(),
    upAxis = direction.clone().cross(rightAxis).normalize();
  const target = center
    .clone()
    .addScaledVector(rightAxis, -screenX * distance * horizontal)
    .addScaledVector(upAxis, -screenY * distance * vertical);
  orbit.target.copy(target);
  camera.position.copy(target).addScaledVector(direction, distance);
  orbit.update();
}
