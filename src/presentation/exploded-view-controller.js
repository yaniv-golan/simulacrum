import * as THREE from "three";

/**
 * @typedef {{ id: number, pos: number[], mesh: THREE.Object3D, explodeOffset?: THREE.Vector3 }} ExplodedPart
 * @typedef {{ explodeValid?: boolean }} ExplodedConnection
 * @typedef {{
 *   exploded: boolean, amount: number, cameraLift: number,
 *   framingLift: number, distanceLift: number,
 * }} ExplodedState
 * @typedef {{
 *   state: ExplodedState,
 *   running: () => boolean, parts: () => ExplodedPart[],
 *   connections: () => ExplodedConnection[], selectedId: () => number | null,
 *   humanoidLayout: () => boolean,
 * }} ExplodedModelPort
 * @typedef {{
 *   cameraTarget: THREE.Vector3, offsetCameraDistance: (delta: number) => void,
 *   transform: import("three/addons/controls/TransformControls.js").TransformControls,
 *   query: (selector: string) => Element | null,
 * }} ExplodedViewPort
 * @typedef {{
 *   connectionValid: (connection: ExplodedConnection) => boolean,
 *   drawConnections: () => void, updateSelection: () => void,
 *   updateHover: () => void, showSelection: (part: ExplodedPart | null) => void,
 *   updateDriveHud: () => void, notify: (message: string) => void,
 * }} ExplodedActionPort
 */

/**
 * @param {{ model: ExplodedModelPort, view: ExplodedViewPort, actions: ExplodedActionPort }} ports
 */
export function createExplodedViewController({ model, view, actions }) {
  const panelSelectors = [
    ".remote-console",
    ".demo-browser",
    ".wasm-console",
    ".environment-panel",
  ];

  function button() {
    return view.query("#explode-view");
  }

  function applyCameraDelta(delta) {
    view.cameraTarget.y += model.state.framingLift * delta;
    view.offsetCameraDistance(model.state.distanceLift * delta);
  }

  function reset() {
    applyCameraDelta(-model.state.amount);
    model.state.exploded = false;
    model.state.amount = 0;
    model.state.cameraLift = 0;
    model.state.framingLift = 0;
    model.state.distanceLift = 0;
    button()?.classList.remove("active");
    const label = view.query("#explode-view span");
    if (label) label.textContent = "EXPLODE";
  }

  function set(on, immediate = false) {
    if (on && model.running()) {
      actions.notify("Stop simulation before exploding parts");
      return;
    }
    const parts = model.parts();
    if (on && parts.length < 2) {
      actions.notify("Add at least two parts to use Exploded View");
      return;
    }
    if (on) {
      for (const selector of panelSelectors)
        view.query(selector)?.classList.add("hidden");
      for (const connection of model.connections())
        connection.explodeValid = actions.connectionValid(connection);
      const center = parts
        .reduce(
          (sum, part) => sum.add(new THREE.Vector3(...part.pos)),
          new THREE.Vector3(),
        )
        .multiplyScalar(1 / parts.length);
      const spread = THREE.MathUtils.clamp(
        1.15 + Math.sqrt(parts.length) * 0.16,
        1.35,
        2.25,
      );
      parts.forEach((part, index) => {
        const radial = new THREE.Vector3(...part.pos).sub(center);
        const originalDistance = radial.length();
        if (originalDistance < 0.18) {
          const angle = index * 2.399963;
          radial.set(
            Math.cos(angle),
            ((index % 3) - 1) * 0.48,
            Math.sin(angle),
          );
        }
        radial.normalize();
        part.explodeOffset = radial.multiplyScalar(
          spread + Math.min(2.2, originalDistance * 0.42),
        );
      });
      model.state.cameraLift = 0;
      model.state.framingLift = 0;
      model.state.distanceLift = 0;
      if (model.humanoidLayout()) {
        const lowestSurface = parts.reduce((lowest, part) => {
          const bounds = new THREE.Box3().setFromObject(part.mesh);
          return Math.min(lowest, bounds.min.y + (part.explodeOffset?.y || 0));
        }, Infinity);
        model.state.cameraLift = Math.max(0, 0.75 - lowestSurface);
        for (const part of parts)
          if (part.explodeOffset)
            part.explodeOffset.y += model.state.cameraLift;
        model.state.framingLift = model.state.cameraLift + 1.15;
        model.state.distanceLift = 4;
      }
    }
    model.state.exploded = Boolean(on);
    button()?.classList.toggle("active", model.state.exploded);
    const label = view.query("#explode-view span");
    if (label)
      label.textContent = model.state.exploded ? "COLLAPSE" : "EXPLODE";
    actions.updateDriveHud();
    if (immediate) {
      const previous = model.state.amount;
      model.state.amount = model.state.exploded ? 1 : 0;
      applyCameraDelta(model.state.amount - previous);
      positionParts();
      if (!model.state.exploded) clearOffsets();
      actions.drawConnections();
    }
    view.transform.detach();
    actions.showSelection(
      parts.find((part) => part.id === model.selectedId()) || null,
    );
    actions.notify(
      model.state.exploded
        ? "Exploded View — select parts and trace their color-coded connections"
        : "Assembly restored to its exact build positions",
    );
  }

  function positionParts() {
    for (const part of model.parts()) {
      const offset = part.explodeOffset || new THREE.Vector3();
      part.mesh.position
        .set(...part.pos)
        .addScaledVector(offset, model.state.amount);
      if (model.state.amount === 0) delete part.explodeOffset;
    }
  }

  function clearOffsets() {
    model.state.cameraLift = 0;
    model.state.framingLift = 0;
    model.state.distanceLift = 0;
  }

  function update(dt) {
    const target = model.state.exploded ? 1 : 0;
    const previous = model.state.amount;
    model.state.amount = THREE.MathUtils.lerp(
      model.state.amount,
      target,
      1 - Math.exp(-8 * dt),
    );
    if (Math.abs(model.state.amount - target) < 0.001)
      model.state.amount = target;
    if (Math.abs(previous - model.state.amount) < 0.00001) return;
    applyCameraDelta(model.state.amount - previous);
    positionParts();
    if (model.state.amount === 0) clearOffsets();
    actions.drawConnections();
    actions.updateSelection();
    actions.updateHover();
  }

  return Object.freeze({
    reset,
    set,
    toggle: () => set(!model.state.exploded),
    update,
  });
}
