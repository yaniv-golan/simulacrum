/**
 * Owns the transient presentation-only Hide Others filter. Authored parts,
 * selection, networks, physics, history, and persistence are never mutated.
 */
export function createSelectionVisibilityController({
  model,
  scene,
  camera,
  actions,
}) {
  let isolation = null;

  function snapshot() {
    const parts = model.parts();
    return {
      active: Boolean(isolation),
      isolatedPartIds: isolation ? [...isolation.partIds] : [],
      hiddenPartIds: isolation
        ? parts
            .filter((part) => !part.mesh.visible)
            .map((part) => part.id)
            .sort((left, right) => left - right)
        : [],
    };
  }

  function isolate() {
    if (isolation) return snapshot();
    const partIds = new Set(model.selectedIds());
    if (!partIds.size) return snapshot();
    const parts = model.parts();
    isolation = {
      partIds,
      visibility: new Map(parts.map((part) => [part.id, part.mesh.visible])),
      wiresVisible: scene.wires.visible,
      cameraView: camera.snapshot(),
    };
    for (const part of parts) part.mesh.visible = partIds.has(part.id);
    scene.wires.visible = false;
    camera.frameSelection();
    actions.renderInspector();
    queueMicrotask(() => actions.focus?.("#show-all-components"));
    actions.notify(
      `Isolated ${partIds.size} component${partIds.size === 1 ? "" : "s"} visually · machine state is unchanged`,
    );
    return snapshot();
  }

  function showAll({
    restoreCamera = true,
    silent = false,
    restoreFocus = !silent,
  } = {}) {
    if (!isolation) return snapshot();
    const previous = isolation;
    isolation = null;
    for (const part of model.parts())
      part.mesh.visible = previous.visibility.get(part.id) ?? true;
    scene.wires.visible = previous.wiresVisible;
    if (restoreCamera) camera.restoreSnapshot(previous.cameraView);
    actions.renderInspector();
    if (restoreFocus)
      queueMicrotask(() => actions.focus?.("#isolate-selection"));
    if (!silent)
      actions.notify("Showing all components · previous camera view restored");
    return snapshot();
  }

  return Object.freeze({
    active: () => Boolean(isolation),
    isolate,
    selectionChanged() {
      if (!isolation) return;
      const nextPartIds = new Set(model.selectedIds());
      if (
        nextPartIds.size === isolation.partIds.size &&
        [...nextPartIds].every((partId) => isolation.partIds.has(partId))
      )
        return;
      showAll({ silent: true, restoreFocus: false });
    },
    showAll,
    snapshot,
  });
}
