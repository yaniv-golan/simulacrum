/** Creates the shared pointer, keyboard and exact-form placement command. */
export function createPendingPlacementCommand({
  state,
  catalog,
  editor,
  actions,
  view,
  setTool,
}) {
  return (position = state.editor.placing?.position) => {
    const placing = state.editor.placing;
    if (!placing || state.running || !Array.isArray(position)) return null;
    const returnTool = placing.returnTool || "select",
      placingSubassembly = Boolean(placing.subassembly);
    let made;
    if (placing.subassembly) {
      const parts = editor.placeSubassembly(placing.subassembly, position);
      made = parts[0] || null;
    } else
      made = editor.addPart(
        placing.type,
        position,
        placing.config,
        placing.color,
      );
    actions.applyEditorAction(state.editor, {
      type: "finish-placement",
      returnTool,
    });
    view.query(".placement-help").classList.add("hidden");
    actions.tutorialEvent("placed");
    if (!placingSubassembly && made) editor.selectPart(made.id);
    setTool(returnTool);
    view.notify(
      `Placed ${placing.subassembly?.asset?.name || catalog[placing.type].name} at ${position.map((value) => `${Number(value).toFixed(2)} m`).join(", ")}`,
    );
    return made;
  };
}

export function bindExactPlacementForm({
  view,
  state,
  applyEditorAction,
  placePending,
  cancelPlacement,
}) {
  const inputs = ["x", "y", "z"].map((axis) =>
    view.query(`#placement-${axis}`),
  );
  for (const input of inputs)
    input.oninput = () => {
      const position = inputs.map((candidate) => Number(candidate.value));
      if (position.every(Number.isFinite))
        applyEditorAction(state.editor, {
          type: "update-placement-position",
          position,
        });
    };
  view.query("#place-pending").onclick = () => placePending();
  view.query("#cancel-placement").onclick = cancelPlacement;
}
