import {
  alignSelection,
  distributeSelection,
  selectionPivot,
  translateSelectionTo,
} from "../model/selection-transforms.js";

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

  function applyPositions(positions, label) {
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
    renderInspector();
    toast(label);
  }

  function markup(selection) {
    const pivot = selectionPivot(selection);
    return `<details class="selection-arrange" ${selection.length > 1 ? "open" : ""}><summary>ARRANGE ${selection.length > 1 ? `${selection.length} COMPONENTS` : "POSITION"}</summary><p>${selection.length > 1 ? "Align uses the mint primary component. Distribute keeps the outer components fixed." : "Enter an exact component position."}</p><div class="numeric-transform">${axes.map((axis, index) => `<label>${axis}<input type="number" step="0.25" data-pivot-axis="${index}" value="${pivot[index].toFixed(2)}"></label>`).join("")}</div>${selection.length > 1 ? `<div class="arrange-actions"><span>ALIGN PRIMARY</span>${axes.map((axis, index) => `<button data-align-axis="${index}">${axis}</button>`).join("")}<span>EQUAL SPACING</span>${axes.map((axis, index) => `<button data-distribute-axis="${index}" ${selection.length < 3 ? "disabled" : ""}>${axis}</button>`).join("")}</div>` : ""}</details>`;
  }

  function bind() {
    $$("[data-pivot-axis]").forEach((input) => {
      input.onchange = () => {
        const selection = selectedParts(),
          pivot = selectionPivot(selection);
        pivot[+input.dataset.pivotAxis] = Number(input.value);
        applyPositions(
          translateSelectionTo(selection, pivot),
          "Position selection",
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
  }

  return { bind, markup };
}
