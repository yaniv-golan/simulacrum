/** Coordinates live stepping without owning physics, telemetry, or presentation. */
export function createSimulationPlaybackController({
  state,
  getSession,
  onTelemetry,
  render,
  notify,
}) {
  function consume(previousTime, { forceRecord = false, present = true } = {}) {
    const session = getSession(),
      telemetry = session?.telemetry(),
      completedDt = session ? session.time - previousTime : 0;
    if (!session || completedDt <= 0) return 0;
    state.elapsed = session.time;
    onTelemetry(telemetry, completedDt, { forceRecord, present });
    return completedDt;
  }

  function simulate(dt) {
    const session = getSession();
    if (!state.running || state.simulationPaused || !session) return 0;
    const previousTime = session.time;
    session.step(dt * state.timeScale);
    return consume(previousTime);
  }

  /**
   * Advances several presentation frames through the ordinary fixed-step
   * session while allowing authoritative consumers to inspect every completed
   * frame. Only the final frame is presented; deterministic automation must
   * not repaint the same DOM and Three.js state dozens of times synchronously.
   */
  function simulateFrames(count, dt = 1 / 60) {
    const session = getSession(),
      frames = Math.max(0, Math.floor(count));
    if (
      !state.running ||
      state.simulationPaused ||
      !session ||
      !Number.isFinite(dt) ||
      dt < 0
    )
      return 0;
    let completed = 0;
    for (let index = 0; index < frames; index += 1) {
      const previousTime = session.time;
      session.step(dt * state.timeScale);
      completed += consume(previousTime, { present: index === frames - 1 });
    }
    return completed;
  }

  function step() {
    const session = getSession();
    if (!state.running || !session) return 0;
    state.simulationPaused = true;
    const previousTime = session.time;
    session.stepFixed();
    const completed = consume(previousTime, { forceRecord: true });
    render();
    notify(`Single physics step · T+${session.time.toFixed(3)} s`);
    return completed;
  }

  function togglePause() {
    if (!state.running) return;
    state.simulationPaused = !state.simulationPaused;
    render();
    notify(state.simulationPaused ? "Simulation paused" : "Simulation resumed");
  }

  function cycleSpeed(direction = 1) {
    if (!state.running) return;
    const speeds = [0.1, 0.25, 0.5, 1, 2],
      current = speeds.indexOf(state.timeScale),
      next = Math.max(
        0,
        Math.min(
          speeds.length - 1,
          (current < 0 ? speeds.indexOf(1) : current) + direction,
        ),
      );
    state.timeScale = speeds[next];
    render();
    notify(`Simulation speed ${state.timeScale}×`);
  }

  return { cycleSpeed, simulate, simulateFrames, step, togglePause };
}
