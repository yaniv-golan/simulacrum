import { machineMotion, machineBoundary } from '../model/motion-readout.mjs';
export function createMotionReadout(container) {
  const panel = document.createElement('div');
  panel.className = 'motion-readout';
  panel.hidden = true;
  const current = document.createElement('span'),
    previous = document.createElement('small'),
    warning = document.createElement('strong');
  warning.setAttribute('role', 'status');
  const values = document.createElement('div');
  values.className = 'motion-values';
  values.hidden = true;
  values.append(current, previous);
  panel.append(values, warning);
  container.append(panel);
  let origin = null,
    startTick = 0,
    lastMode,
    lastTick = 0,
    latest = null,
    previousText = '',
    requested = false,
    hasMotion = false;
  function refreshVisibility() {
    values.hidden = !requested || !hasMotion;
    panel.hidden = values.hidden && warning.hidden;
  }
  return {
    setVisible(value) {
      requested = value;
      refreshVisibility();
    },
    update(frame) {
      const mode = frame.metadata.mode,
        motion = machineMotion(frame);
      if (mode === 'build') {
        if (lastMode && lastMode !== 'build' && latest)
          previousText = `Last run: ${latest.distance.toFixed(2)} m from start in ${latest.seconds.toFixed(1)} s`;
        origin = null;
        latest = null;
        current.textContent = previousText ? '' : 'No run measured yet';
      } else if (motion) {
        if (!origin || frame.tick < lastTick) {
          origin = motion.center;
          startTick = frame.tick;
        }
        latest = {
          distance: Math.hypot(motion.center[0] - origin[0], motion.center[2] - origin[2]),
          seconds: (frame.tick - startTick) / 120,
        };
        current.textContent = `${motion.speed.toFixed(2)} m/s · ${latest.distance.toFixed(2)} m from start · ${latest.seconds.toFixed(1)} s`;
      }
      const boundary = mode === 'build' ? null : machineBoundary(frame);
      warning.textContent = boundary?.message ?? '';
      warning.hidden = !boundary;
      hasMotion = Boolean(motion);
      refreshVisibility();
      panel.title =
        'Mass-weighted machine center. Distance is horizontal displacement, not path length. Detached parts are included. Last run may have different controls or duration.';
      previous.textContent = previousText;
      lastMode = mode;
      lastTick = frame.tick;
    },
    dispose() {
      panel.remove();
    },
  };
}
