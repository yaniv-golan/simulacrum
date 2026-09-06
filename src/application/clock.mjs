// Both browser time and deterministic hooks advance the same session accumulator.
// Overload policy preserves simulation debt; it never drops or stretches ticks.
export function createClock(session, { requestFrame, cancelFrame, render }) {
  let handle = null,
    previous = null,
    running = false;
  function frame(now) {
    if (!running) return;
    if (previous !== null) session.advanceTime(now - previous);
    previous = now;
    render();
    if (running) handle = requestFrame(frame);
  }
  return Object.freeze({
    start() {
      if (running) return;
      running = true;
      previous = null;
      handle = requestFrame(frame);
    },
    pause() {
      running = false;
      if (handle !== null) cancelFrame(handle);
      handle = null;
      previous = null;
    },
    advanceTime(ms) {
      session.advanceTime(ms);
      render();
    },
    running: () => running,
  });
}
