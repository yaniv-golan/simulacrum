/**
 * Coordinates the always-visible workshop read model. Panel-local markup and
 * event handling remain with their own presenters; this class only refreshes
 * shared chrome from the current read model.
 */
export function createWorkshopUiPresenter({ model, view }) {
  function render() {
    const engineering = view.refreshEngineering();
    view.renderLibrary(view.activeCategory() || "all");
    view.renderInspector();
    view.setText("#part-count", model.parts().length);
    view.setText("#connection-count", model.connections().length);
    view.setText("#total-mass", engineering.totalMass);
    view.setDisabled(
      "#clear-build",
      model.running() || model.parts().length === 0,
    );
    view.setText(
      "#run-btn",
      model.starting()
        ? "■ CANCEL STARTUP"
        : model.running()
          ? "■ STOP SIMULATION"
          : "▶ START SIMULATION",
    );
    view.toggleHidden(".sim-controls", !model.running());
    view.setDisabled("#sim-pause", model.starting());
    view.setDisabled("#sim-speed", model.starting());
    view.setDisabled("#sim-reset", model.starting());
    view.setText("#sim-pause", model.paused() ? "▶" : "Ⅱ");
    view.toggleClass("#sim-pause", "active", model.paused());
    view.setText("#sim-speed", `${model.timeScale()}×`);
    view.setProgress(
      ".mission-progress i",
      Math.min(100, model.connections().length * 34),
    );
    view.updateDriveHud();
    view.refreshHistory();
    view.renderChallengeHud();
    view.setEngineeringRunning(model.running());
  }

  return Object.freeze({ render });
}

/** Creates the concrete DOM/panel adapter consumed by the pure presenter. */
export function createWorkshopUiView({
  query,
  library,
  inspector,
  driveHud,
  history,
  challenge,
  engineering,
}) {
  return Object.freeze({
    activeCategory: () => query(".tabs .active")?.dataset.cat,
    renderLibrary: library,
    renderInspector: inspector,
    setText(selector, value) {
      query(selector).textContent = String(value);
    },
    setDisabled(selector, disabled) {
      query(selector).disabled = disabled;
    },
    toggleHidden: (selector, hidden) =>
      query(selector).classList.toggle("hidden", hidden),
    toggleClass: (selector, name, enabled) =>
      query(selector).classList.toggle(name, enabled),
    setProgress(selector, percent) {
      query(selector).style.width = `${percent}%`;
    },
    updateDriveHud: driveHud,
    refreshHistory: history,
    renderChallengeHud: challenge,
    setEngineeringRunning: engineering.setRunning,
    refreshEngineering: engineering.refresh,
  });
}
