import {
  alignSelection,
  distributeSelection,
  selectionPivot,
  translateSelectionTo,
} from "../model/selection-transforms.js";
import { AUTHORING_TRANSLATION_SNAP_M } from "../model/authoring-space-policy.js";

/** Renders and wires precise position, primary alignment, and distribution. */
export function createSelectionArranger({
  state,
  $$,
  selectedParts,
  recordHistory,
  syncAssembly,
  drawWires,
  updateSelectionVisuals,
  showSelection,
  renderInspector,
  toast,
}) {
  const axes = ["X", "Y", "Z"];
  let arrangementExpanded = false;

  function applyPositions(positions, label, render = true) {
    if (!positions.size || state.running) return;
    recordHistory(label);
    for (const part of selectedParts()) {
      const position = positions.get(part.id);
      if (!position) continue;
      part.pos = [...position];
      part.mesh.position.set(...position);
    }
    syncAssembly();
    drawWires();
    updateSelectionVisuals();
    showSelection(
      state.parts.find((part) => part.id === state.editor.selected),
    );
    if (render) renderInspector();
    toast(label);
  }

  function applyYaw(part, degrees) {
    if (!part || state.running || !Number.isFinite(degrees)) return;
    recordHistory("Rotate selection");
    const radians = (degrees * Math.PI) / 180;
    part.mesh.rotation.y = radians;
    part.rot = radians;
    syncAssembly();
    drawWires();
    updateSelectionVisuals();
    showSelection(part);
    toast(`Rotated selection to ${degrees.toFixed(0)}° yaw`);
  }

  function markup(selection) {
    const pivot = selectionPivot(selection),
      yaw =
        selection.length === 1
          ? (selection[0].mesh.rotation.y * 180) / Math.PI
          : null;
    return `<details class="selection-arrange" ${selection.length > 1 || arrangementExpanded ? "open" : ""}><summary>ARRANGE ${selection.length > 1 ? `${selection.length} COMPONENTS` : "POSITION & ROTATION"}</summary><p>${selection.length > 1 ? "Align uses the mint primary component. Distribute keeps the outer components fixed." : "Enter an exact component position and snapped yaw."}</p><div class="numeric-transform">${axes.map((axis, index) => `<label>${axis}<input type="number" step="${AUTHORING_TRANSLATION_SNAP_M}" data-pivot-axis="${index}" value="${pivot[index].toFixed(2)}"></label>`).join("")}${yaw === null ? "" : `<label>YAW°<input type="number" step="15" data-selection-yaw value="${yaw.toFixed(0)}"></label>`}</div>${selection.length > 1 ? `<div class="arrange-actions"><span>ALIGN PRIMARY</span>${axes.map((axis, index) => `<button data-align-axis="${index}">${axis}</button>`).join("")}<span>EQUAL SPACING</span>${axes.map((axis, index) => `<button data-distribute-axis="${index}" ${selection.length < 3 ? "disabled" : ""}>${axis}</button>`).join("")}</div>` : ""}</details>`;
  }

  function bind() {
    const details = $$(".selection-arrange")[0];
    if (details)
      details.ontoggle = () => {
        arrangementExpanded = details.open;
      };
    $$("[data-pivot-axis]").forEach((input) => {
      input.onchange = () => {
        const selection = selectedParts(),
          pivot = selectionPivot(selection);
        pivot[+input.dataset.pivotAxis] = Number(input.value);
        applyPositions(
          translateSelectionTo(selection, pivot),
          "Position selection",
          false,
        );
      };
    });
    $$("[data-align-axis]").forEach(
      (button) =>
        (button.onclick = () =>
          applyPositions(
            alignSelection(
              selectedParts(),
              state.editor.selected,
              +button.dataset.alignAxis,
            ),
            `Align ${axes[+button.dataset.alignAxis]} to primary`,
          )),
    );
    $$("[data-distribute-axis]").forEach(
      (button) =>
        (button.onclick = () =>
          applyPositions(
            distributeSelection(
              selectedParts(),
              +button.dataset.distributeAxis,
            ),
            `Distribute ${axes[+button.dataset.distributeAxis]}`,
          )),
    );
    const yaw = $$("[data-selection-yaw]")[0];
    if (yaw)
      yaw.onchange = () => applyYaw(selectedParts()[0], Number(yaw.value));
  }

  return { bind, markup };
}
