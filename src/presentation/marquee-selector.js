import * as THREE from "three";
import { applyEditorAction } from "../model/application-state.js";

const intersects = (a, b) =>
  a.left <= b.right &&
  a.right >= b.left &&
  a.top <= b.bottom &&
  a.bottom >= b.top;
const contains = (outer, inner) =>
  outer.left <= inner.left &&
  outer.right >= inner.right &&
  outer.top <= inner.top &&
  outer.bottom >= inner.bottom;

export function createMarqueeCommitHandler({
  state,
  showSelection,
  renderInspector,
  toast,
}) {
  return ({ ids, active, additive, mode }) => {
    if (!active) {
      if (!additive) {
        applyEditorAction(state.editor, { type: "select", id: null });
        showSelection(null);
        renderInspector();
      }
      return;
    }
    const selection = additive ? new Set(state.editor.selectedIds) : new Set();
    for (const id of ids) selection.add(id);
    applyEditorAction(state.editor, {
      type: "select",
      ids: selection,
      id:
        ids.at(-1) ||
        state.editor.selected ||
        selection.values().next().value ||
        null,
    });
    showSelection(
      state.parts.find((part) => part.id === state.editor.selected),
    );
    renderInspector();
    toast(
      ids.length
        ? `${selection.size} components selected · ${mode === "crossing" ? "touching box" : "inside box"}`
        : "No components in selection box",
    );
  };
}

function orderedRect(start, end) {
  return {
    left: Math.min(start.x, end.x),
    right: Math.max(start.x, end.x),
    top: Math.min(start.y, end.y),
    bottom: Math.max(start.y, end.y),
  };
}

/** Owns neutral-canvas drag selection and its viewport presentation. */
export class MarqueeSelector {
  constructor({
    element,
    camera,
    candidates,
    thresholdPx = 6,
    onCommit = (_result) => {},
  }) {
    this.element = element;
    this.camera = camera;
    this.candidates = candidates;
    this.thresholdPx = thresholdPx;
    this.onCommit = onCommit;
    this.gesture = null;
    this.overlay = document.createElement("div");
    this.overlay.className = "selection-marquee hidden";
    this.overlay.innerHTML = "<span></span>";
    element.parentElement.append(this.overlay);
  }

  begin(event, { enabled = false, additive = false } = {}) {
    if (!enabled || event.button !== 0) return false;
    const bounds = this.element.getBoundingClientRect();
    this.gesture = {
      pointerId: event.pointerId,
      start: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
      current: {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      },
      active: false,
      additive,
      crossing: false,
    };
    this.element.setPointerCapture?.(event.pointerId);
    return true;
  }

  update(event) {
    const gesture = this.gesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return false;
    const bounds = this.element.getBoundingClientRect();
    gesture.current = {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top,
    };
    if (
      !gesture.active &&
      Math.hypot(
        gesture.current.x - gesture.start.x,
        gesture.current.y - gesture.start.y,
      ) >= this.thresholdPx
    ) {
      gesture.active = true;
      this.overlay.classList.remove("hidden");
    }
    if (!gesture.active) return true;
    gesture.crossing = gesture.current.x < gesture.start.x;
    const rectangle = orderedRect(gesture.start, gesture.current);
    Object.assign(this.overlay.style, {
      left: `${rectangle.left}px`,
      top: `${rectangle.top}px`,
      width: `${rectangle.right - rectangle.left}px`,
      height: `${rectangle.bottom - rectangle.top}px`,
    });
    this.overlay.classList.toggle("crossing", gesture.crossing);
    this.overlay.querySelector("span").textContent = gesture.crossing
      ? "TOUCHING"
      : "ENCLOSED";
    return true;
  }

  projectedBounds(candidate) {
    const canvas = this.element.getBoundingClientRect(),
      bounds = new THREE.Box3().setFromObject(candidate.mesh),
      points = [];
    for (const x of [bounds.min.x, bounds.max.x])
      for (const y of [bounds.min.y, bounds.max.y])
        for (const z of [bounds.min.z, bounds.max.z]) {
          const point = new THREE.Vector3(x, y, z).project(this.camera);
          if (point.z < -1 || point.z > 1) continue;
          points.push({
            x: ((point.x + 1) / 2) * canvas.width,
            y: ((1 - point.y) / 2) * canvas.height,
          });
        }
    if (!points.length) return null;
    return {
      left: Math.min(...points.map((point) => point.x)),
      right: Math.max(...points.map((point) => point.x)),
      top: Math.min(...points.map((point) => point.y)),
      bottom: Math.max(...points.map((point) => point.y)),
    };
  }

  finish(event) {
    const gesture = this.gesture;
    if (
      !gesture ||
      (event?.pointerId != null && gesture.pointerId !== event.pointerId)
    )
      return false;
    const rectangle = orderedRect(gesture.start, gesture.current),
      ids = gesture.active
        ? this.candidates()
            .filter((candidate) => {
              const bounds = this.projectedBounds(candidate);
              return (
                bounds &&
                (gesture.crossing
                  ? intersects(rectangle, bounds)
                  : contains(rectangle, bounds))
              );
            })
            .map((candidate) => candidate.id)
        : [];
    this.element.releasePointerCapture?.(gesture.pointerId);
    this.overlay.classList.add("hidden");
    this.gesture = null;
    this.onCommit({
      ids,
      active: gesture.active,
      additive: gesture.additive,
      mode: gesture.crossing ? "crossing" : "enclosed",
    });
    return true;
  }

  cancel() {
    if (!this.gesture) return;
    this.element.releasePointerCapture?.(this.gesture.pointerId);
    this.gesture = null;
    this.overlay.classList.add("hidden");
  }

  snapshot() {
    return this.gesture
      ? {
          active: this.gesture.active,
          mode: this.gesture.crossing ? "crossing" : "enclosed",
        }
      : null;
  }
}
