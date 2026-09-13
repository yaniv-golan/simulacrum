// Both browser time and deterministic hooks advance the same session accumulator.
// Overload policy preserves simulation debt; it never drops or stretches ticks.
export function createClock(
  session,
  { requestFrame, cancelFrame, render, externalFrames = false },
) {
  let handle = null,
    previous = null,
    running = false;
  function frame(now) {
    if (!running) return;
    if (previous !== null) session.advanceTime(now - previous);
    previous = now;
    render();
    if (running && !externalFrames) handle = requestFrame(frame);
  }
  return Object.freeze({
    start() {
      if (running) return;
      running = true;
      previous = null;
      if (!externalFrames) handle = requestFrame(frame);
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
    frame,
    running: () => running,
  });
}
