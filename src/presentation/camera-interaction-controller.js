import * as THREE from "three";
import { CameraTracker } from "./camera-tracker.js";
import { cameraTrackingBounds } from "./camera-tracking-bounds.js";
import {
  partIdForCameraHit,
  placementIntentForCamera,
} from "./camera-authoring-intent.js";
import { selectionCameraFrame } from "./selection-camera-frame.js";
import { createCameraViewIdentity } from "./camera-view-identity.js";

/**
 * @typedef {{ id: number, type: string, mesh: THREE.Object3D }} CameraPart
 * @typedef {{
 *   camera: THREE.PerspectiveCamera,
 *   element: HTMLCanvasElement,
 *   machine: THREE.Object3D,
 *   floor: THREE.Object3D,
 *   fieldSurface: THREE.Object3D | null,
 *   target: THREE.Vector3,
 * }} CameraScenePort
 * @typedef {{
 *   parts: () => CameraPart[],
 *   selectedId: () => number | null,
 *   selectedIds: () => Set<number>,
 *   running: () => boolean,
 *   focusedEnvironmentObject: () => THREE.Object3D | null,
 *   partName: (type: string) => string,
 * }} CameraAssemblyPort
 * @typedef {{
 *   tool: () => string | null,
 *   setTool: (tool: string | null) => void,
 * }} CameraEditorPort
 * @typedef {{
 *   query: (selector: string) => HTMLElement | null,
 *   notify: (message: string) => void,
 * }} CameraViewPort
 */

/** @type {{ yaw: number, pitch: number, distance: number }} */
const DEFAULT_VIEW = Object.freeze({ yaw: 0.72, pitch: 0.47, distance: 18 });
const CAMERA_DISTANCE_LIMITS_M = Object.freeze({ minimum: 2.5, maximum: 650 });

/**
 * Owns camera navigation, projection, tracking, and camera-specific controls.
 * It deliberately knows nothing about selection mutation or part placement.
 *
 * @param {{
 *   scene: CameraScenePort,
 *   assembly: CameraAssemblyPort,
 *   editor: CameraEditorPort,
 *   view: CameraViewPort,
 * }} ports
 */
export function createCameraInteractionController({
  scene,
  assembly,
  editor,
  view,
}) {
  const { camera, element, machine, floor, target } = scene;
  const ray = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const tracker = new CameraTracker({
    camera,
    target,
    initialDistance: DEFAULT_VIEW.distance,
  });
  const identity = createCameraViewIdentity();

  let yaw = DEFAULT_VIEW.yaw;
  let pitch = DEFAULT_VIEW.pitch;
  let distance = DEFAULT_VIEW.distance;
  let dragging = false;
  let panMode = false;
  let dollyMode = false;
  let spaceHeld = false;
  let followSelection = false;
  let last = { x: 0, y: 0 };
  function selectedPart() {
    const selectedId = assembly.selectedId();
    return assembly.parts().find((part) => part.id === selectedId) || null;
  }
  function setPointer(clientX, clientY) {
    const rect = element.getBoundingClientRect();
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    ray.setFromCamera(pointer, camera);
  }
  function intersect(objects, clientX, clientY, recursive = true) {
    setPointer(clientX, clientY);
    return ray.intersectObjects(objects, recursive);
  }

  function pointOnHorizontalPlane(clientX, clientY, height) {
    setPointer(clientX, clientY);
    return ray.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 1, 0), -height),
      new THREE.Vector3(),
    );
  }

  function anchorAt(clientX, clientY) {
    const targets = [machine, floor];
    if (scene.fieldSurface) targets.push(scene.fieldSurface);
    return intersect(targets, clientX, clientY)[0]?.point || null;
  }

  function zoom(delta, anchor = null) {
    identity.clearPreset();
    const previousDistance = distance;
    const nextDistance = THREE.MathUtils.clamp(
      previousDistance * Math.exp(delta * 0.00135),
      CAMERA_DISTANCE_LIMITS_M.minimum,
      CAMERA_DISTANCE_LIMITS_M.maximum,
    );
    if (anchor) {
      const anchorWeight = THREE.MathUtils.clamp(
        (1 - nextDistance / previousDistance) * 0.82,
        -0.42,
        0.7,
      );
      target.lerp(anchor, anchorWeight);
    }
    distance = nextDistance;
  }

  function reset() {
    identity.reset();
    followSelection = false;
    target.set(0, 1.2, 0);
    yaw = DEFAULT_VIEW.yaw;
    pitch = DEFAULT_VIEW.pitch;
    distance = DEFAULT_VIEW.distance;
  }

  function frameSelection() {
    identity.clearPreset();
    const frame = selectionCameraFrame({
      parts: assembly.parts(),
      selectedIds: assembly.selectedIds(),
      machine,
      camera,
      partName: assembly.partName,
    });
    if (!frame) {
      reset();
      return;
    }
    followSelection = false;
    target.copy(frame.target);
    distance = frame.distance;
    view.notify(frame.message);
  }

  function restoreSnapshot(viewState) {
    if (!viewState) return;
    ({ distance, yaw, pitch, followSelection } =
      tracker.restoreSnapshot(viewState));
    identity.restore(viewState);
  }

  function toggleFollow() {
    const selected = selectedPart();
    if (!selected) {
      view.notify("Select a component before enabling camera follow");
      return;
    }
    const enable = !followSelection;
    if (enable) frameSelection();
    followSelection = enable;
    view.notify(
      followSelection
        ? "Following selected component"
        : "Camera follow released",
    );
  }

  function setAxisView(axis) {
    identity.clearPreset();
    followSelection = false;
    if (axis === "front") {
      yaw = Math.PI;
      pitch = 0.18;
    } else if (axis === "side") {
      yaw = Math.PI / 2;
      pitch = 0.18;
    } else {
      yaw = 0;
      pitch = 1.52;
    }
    frameSelection();
    identity.setAxisView(axis);
    view.notify(
      `${axis.toUpperCase()} view · ${assembly.selectedId() ? "selection" : "machine"} framed`,
    );
  }

  function setCameraTool(tool) {
    editor.setTool(editor.tool() === tool ? null : tool);
    view
      .query("#orbit-view")
      ?.classList.toggle("active", editor.tool() === "orbit");
    view
      .query("#pan-view")
      ?.classList.toggle("active", editor.tool() === "pan");
    element.style.cursor =
      editor.tool() === "pan"
        ? "grab"
        : editor.tool() === "orbit"
          ? "move"
          : "default";
    view.notify(
      editor.tool()
        ? `${tool.toUpperCase()} active — left-drag anywhere on the workbench`
        : "Camera tool released",
    );
  }

  function clearCameraTool() {
    editor.setTool(null);
    view.query("#orbit-view")?.classList.remove("active");
    view.query("#pan-view")?.classList.remove("active");
  }

  function beginPointer(event) {
    const alternateButton = event.button === 2 || event.button === 1;
    const cameraGesture =
      event.button === 0 && (editor.tool() || event.altKey || spaceHeld);
    if (!alternateButton && !cameraGesture) return false;
    identity.clearPreset();
    dragging = true;
    panMode = alternateButton
      ? event.button === 1 || event.shiftKey
      : editor.tool() === "pan" || spaceHeld;
    dollyMode =
      alternateButton && event.button === 2 && (event.altKey || event.ctrlKey);
    if (panMode) followSelection = false;
    last = { x: event.clientX, y: event.clientY };
    element.setPointerCapture?.(event.pointerId);
    return true;
  }

  function movePointer(event) {
    if (!dragging) return false;
    const dx = event.clientX - last.x;
    const dy = event.clientY - last.y;
    if (dollyMode) {
      zoom(dy * 6.5);
    } else if (panMode) {
      const scale = distance * 0.0018;
      const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
      const screenUp = new THREE.Vector3().setFromMatrixColumn(
        camera.matrix,
        1,
      );
      target
        .addScaledVector(right, -dx * scale)
        .addScaledVector(screenUp, dy * scale);
    } else {
      if (dx || dy) identity.clearAxis();
      yaw -= dx * 0.006;
      pitch = THREE.MathUtils.clamp(pitch + dy * 0.005, 0.08, 1.52);
    }
    last = { x: event.clientX, y: event.clientY };
    return true;
  }

  function endPointer() {
    dragging = false;
    panMode = false;
    dollyMode = false;
  }

  function visibleBounds(selector) {
    const elementNode = view.query(selector);
    if (!elementNode || elementNode.classList.contains("hidden")) return null;
    const style = getComputedStyle(elementNode);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) < 0.05
    )
      return null;
    const rect = elementNode.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 ? rect : null;
  }

  function safeFrame() {
    const viewport = element.getBoundingClientRect();
    const header = visibleBounds("header");
    const catalog = visibleBounds(".catalog");
    const inspector = visibleBounds(".inspector");
    const directController = visibleBounds(".drive-hud");
    const remote = visibleBounds(".remote-console");
    const mission = visibleBounds(".mission");
    const challenge = visibleBounds(".challenge-hud");
    const bottomBar = visibleBounds(".bottom-bar");
    const cameraTools = visibleBounds(".camera-tools");
    const topOccluder = [header, mission, challenge]
      .filter(Boolean)
      .reduce((bottom, rect) => Math.max(bottom, rect.bottom), viewport.top);
    const bottomOccluder = [bottomBar, cameraTools]
      .filter(Boolean)
      .reduce((top, rect) => Math.min(top, rect.top), viewport.bottom);
    const leftOccluders = [catalog, directController].filter(
      (rect) => rect && rect.left < viewport.left + viewport.width * 0.5,
    );
    const rightOccluders = [inspector, remote].filter(
      (rect) => rect && rect.right > viewport.left + viewport.width * 0.5,
    );
    return {
      left:
        leftOccluders.reduce(
          (right, rect) => Math.max(right, rect.right),
          viewport.left,
        ) + 12,
      right:
        rightOccluders.reduce(
          (left, rect) => Math.min(left, rect.left),
          viewport.right,
        ) - 12,
      top: topOccluder + 12,
      bottom: bottomOccluder - 12,
      viewport,
    };
  }

  function activeTrackingBounds() {
    const selected = selectedPart();
    const subjects = followSelection && selected ? [selected.mesh] : [machine];
    const focusedEnvironmentObject = assembly.focusedEnvironmentObject();
    if (!followSelection && focusedEnvironmentObject)
      subjects.push(focusedEnvironmentObject);
    return cameraTrackingBounds({
      subjects,
      machine,
      parts: assembly.parts(),
    });
  }

  function update(dt) {
    const trackingActive = assembly.running() && assembly.parts().length > 0;
    const tracking = trackingActive ? activeTrackingBounds() : null;
    const selected = selectedPart();
    const selectionPosition = selected
      ? selected.mesh.getWorldPosition(new THREE.Vector3())
      : null;
    if (followSelection && !selected) followSelection = false;
    tracker.update({
      dt,
      yaw,
      pitch,
      distance,
      tracking,
      safeFrame: tracking ? safeFrame() : null,
      followSelection,
      selectionPosition,
    });
  }

  function handleNavigationKey(event) {
    const key = event.key.toLowerCase();
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
    const viewForward = camera.getWorldDirection(new THREE.Vector3());
    const step = Math.max(0.25, distance * 0.035) * (event.shiftKey ? 3 : 1);
    if (/^(?:Arrow(?:Left|Right|Up|Down)|Key[ADWQSE])$/.test(event.code))
      identity.clearPreset();
    if (/^Arrow(?:Left|Right|Up|Down)$/.test(event.code)) identity.clearAxis();
    viewForward.y = 0;
    viewForward.normalize();
    if (event.code === "Space") {
      spaceHeld = true;
      event.preventDefault();
    }
    if (key === "o" && !event.repeat) setCameraTool("orbit");
    if (key === "p" && !event.repeat) setCameraTool("pan");
    if (key === "f" && !event.repeat) {
      event.preventDefault();
      if (event.ctrlKey && event.shiftKey)
        document.fullscreenElement
          ? document.exitFullscreen()
          : document.documentElement.requestFullscreen();
      else if (event.shiftKey) toggleFollow();
      else frameSelection();
    }
    if (event.code === "Numpad1" && !event.repeat) setAxisView("front");
    if (event.code === "Numpad3" && !event.repeat) setAxisView("side");
    if (event.code === "Numpad7" && !event.repeat) setAxisView("top");
    if (event.key === "+" || event.key === "=") zoom(-115);
    if (event.key === "-" || event.key === "_") zoom(115);
    if (event.key === "Home") reset();
    if (event.key === "ArrowLeft") yaw += 0.12;
    if (event.key === "ArrowRight") yaw -= 0.12;
    if (event.key === "ArrowUp") pitch = Math.min(1.25, pitch + 0.08);
    if (event.key === "ArrowDown")
      pitch = THREE.MathUtils.clamp(pitch - 0.08, 0.12, 1.25);
    if (["a", "d", "w", "s", "q", "e"].includes(key)) followSelection = false;
    if (key === "a") target.addScaledVector(right, -step);
    if (key === "d") target.addScaledVector(right, step);
    if (key === "w") target.addScaledVector(viewForward, step);
    if (key === "s") target.addScaledVector(viewForward, -step);
    if (key === "q") target.y -= step;
    if (key === "e") target.y += step;
  }

  function bindControls() {
    const bind = (selector, action) => {
      const control = view.query(selector);
      if (control) control.onclick = action;
    };
    bind("#orbit-view", () => setCameraTool("orbit"));
    bind("#pan-view", () => setCameraTool("pan"));
    bind("#zoom-in", () => zoom(-165));
    bind("#zoom-out", () => zoom(165));
    bind("#focus-view", frameSelection);
    bind("#view-front", () => setAxisView("front"));
    bind("#view-side", () => setAxisView("side"));
    bind("#view-top", () => setAxisView("top"));
    bind("#view-home", reset);
    element.addEventListener(
      "wheel",
      (event) => {
        if (event.shiftKey) {
          followSelection = false;
          const right = new THREE.Vector3().setFromMatrixColumn(
            camera.matrix,
            0,
          );
          const amount = -(event.deltaX || event.deltaY) * distance * 0.00125;
          target.addScaledVector(right, amount);
        } else zoom(event.deltaY, anchorAt(event.clientX, event.clientY));
        event.preventDefault();
      },
      { passive: false },
    );
    element.oncontextmenu = (event) => event.preventDefault();
  }

  function snapshot() {
    return {
      ...identity.snapshot(),
      fovDeg: camera.fov,
      position: camera.position.clone(),
      distance,
      renderedDistance: tracker.smoothedDistance,
      yaw,
      pitch,
      followSelection,
      target: tracker.smoothedTarget.clone(),
      trackingError: tracker.smoothedTarget.distanceTo(target),
      tracking: tracker.telemetry,
    };
  }

  return Object.freeze({
    applyPreset(preset) {
      ({ distance, yaw, pitch } = tracker.snapPreset(preset));
      followSelection = false;
      identity.setPreset(preset.id);
      return snapshot();
    },
    anchorAt,
    beginPointer,
    bindControls,
    clearCameraTool,
    duplicatePlacementIntent: () => placementIntentForCamera(camera, target),
    endPointer,
    frameSelection,
    handleNavigationKey,
    hitPartIdAt(clientX, clientY) {
      const hit = intersect(machine.children, clientX, clientY)[0];
      return partIdForCameraHit(hit);
    },
    intersectFloor(clientX, clientY) {
      return intersect([floor], clientX, clientY, false)[0] || null;
    },
    intersectMachine(clientX, clientY) {
      return intersect(machine.children, clientX, clientY)[0] || null;
    },
    movePointer,
    offsetDistance(delta) {
      distance += delta;
    },
    pointOnHorizontalPlane,
    releaseHeld() {
      spaceHeld = false;
    },
    reset,
    restoreSnapshot,
    setCameraTool,
    shiftSmoothedTarget(deltaX, deltaZ) {
      tracker.smoothedTarget.x -= deltaX;
      tracker.smoothedTarget.z -= deltaZ;
    },
    snapshot,
    update,
  });
}
