import {
  machineMotion,
  machineBoundary,
  createBodyMotionAccumulator,
} from '../model/motion-readout.mjs';
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
  const heading = document.createElement('b');
  heading.textContent = 'Whole-machine motion';
  const explanation = document.createElement('details');
  const summary = document.createElement('summary');
  summary.textContent = 'What is measured?';
  const description = document.createElement('p');
  description.textContent =
    'Speed and horizontal displacement of the mass-weighted machine center, including detached parts. Distance from start is not distance traveled. A spring can move while this value stays near zero. Runs with different controls or durations are not directly comparable. The selected body uses every completed physics tick: vertical displacement starts at the labelled origin, and RMS summarizes the size of vertical acceleration after 100 ms averaging. This averaging smooths short shocks, so RMS is not the peak acceleration. Missing samples make the measurement unavailable.';
  explanation.append(summary, description);
  const bodyHeading = document.createElement('b'),
    bodyCurrent = document.createElement('span'),
    bodyWindow = document.createElement('small');
  bodyHeading.className = 'selected-motion-heading';
  bodyCurrent.className = 'selected-motion-values';
  bodyWindow.className = 'selected-motion-window';
  values.append(bodyHeading, bodyCurrent, bodyWindow, heading, current, previous, explanation);
  panel.append(values, warning);
  container.append(panel);
  let origin = null,
    startTick = 0,
    lastMachine,
    lastMode,
    lastTick = 0,
    latest = null,
    previousText = '',
    requested = false,
    hasMotion = false;
  const bodyRecorder = createBodyMotionAccumulator();
  let selectedId = null,
    latestFrame = null,
    bodyEpoch = null,
    bodySession = null,
    bodyMode = null,
    blueprintKey = null,
    blueprintReference = null,
    selectionTick = null,
    windowReason = 'New selection';
  function resetBody(reason) {
    bodyRecorder.reset();
    selectionTick = null;
    windowReason = reason;
  }
  function displayBody() {
    if (!requested) return;
    const part = latestFrame?.metadata.blueprint.parts.find((p) => p.id === selectedId),
      measured = bodyRecorder.read();
    bodyHeading.textContent = part ? `Selected body: ${part.name}` : 'Selected body';
    if (!part) {
      bodyCurrent.textContent = 'Select a part to measure its vertical motion.';
      bodyWindow.textContent = '';
      return;
    }
    if (latestFrame.metadata.mode === 'build') {
      bodyCurrent.textContent = 'Run to measure this body. New runs start a new window.';
      bodyWindow.textContent = '';
      return;
    }
    if (measured.status === 'invalid') {
      bodyCurrent.textContent = `Measurement unavailable: ${measured.reason}. Choose a different body or return to Build to start a new window.`;
    } else {
      bodyCurrent.textContent = `Vertical displacement ${measured.displacement.toFixed(4)} m · ${measured.accelerationRms === null ? 'Waiting for 12 tick intervals' : `RMS of 100 ms-average vertical acceleration ${measured.accelerationRms.toFixed(3)} m/s²`}`;
    }
    bodyWindow.textContent =
      measured.startTick === null
        ? windowReason
        : `${windowReason} · origin tick ${measured.startTick} · through tick ${measured.endTick} · ${((measured.endTick - measured.startTick) / 120).toFixed(3)} s · ${measured.accelerationSamples} acceleration samples. Different origins, loads or controls are not directly comparable.`;
  }
  function recordBody(frame) {
    if (selectionTick !== null && frame.tick < selectionTick) return;
    latestFrame = frame;
    const blueprint = frame.metadata.blueprint,
      mode = frame.metadata.mode;
    if (blueprint !== blueprintReference) {
      const key = JSON.stringify(blueprint);
      if (key !== blueprintKey) {
        resetBody('New configuration');
        blueprintKey = key;
      }
      blueprintReference = blueprint;
    }
    if (mode === 'build') {
      if (bodyMode !== 'build') resetBody('New run');
      bodyMode = mode;
      return;
    }
    if (bodyMode === 'build') resetBody('New run');
    bodyMode = mode;
    const index = frame.metadata.blueprint.parts.findIndex((p) => p.id === selectedId),
      pose = frame.physics[index];
    if (index < 0) return;
    if (!pose) {
      bodyRecorder.invalidate('Selected body unavailable');
      return;
    }
    bodyRecorder.add({ tick: frame.tick, y: pose.position[1], vy: pose.velocity[1] });
  }
  function refreshVisibility() {
    values.hidden = !requested || !hasMotion;
    panel.hidden = values.hidden && warning.hidden;
  }
  return {
    selectBody(id, frame) {
      if (id === selectedId) return;
      selectedId = id;
      resetBody('New selection');
      if (frame) {
        recordBody(frame);
        selectionTick = frame.tick;
      }
      displayBody();
    },
    ingest(observation) {
      const changedEpoch =
        bodyEpoch !== null &&
        (observation.cursor.epoch !== bodyEpoch || observation.cursor.session !== bodySession);
      bodySession = observation.cursor.session;
      bodyEpoch = observation.cursor.epoch;
      if (changedEpoch) resetBody('New window after reset');
      if (!observation.ok) {
        if (changedEpoch) {
          if (observation.frame) recordBody(observation.frame);
        } else {
          bodyRecorder.invalidate('Completed history unavailable');
          if (observation.frame) latestFrame = observation.frame;
        }
      } else for (const frame of observation.frames) recordBody(frame);
      displayBody();
    },
    readBody: () => ({ selectedId, windowReason, ...bodyRecorder.read() }),
    clear() {
      origin = null;
      latest = null;
      resetBody('New configuration');
      previousText = '';
      previous.textContent = '';
      current.textContent = 'No run measured yet';
    },
    setVisible(value) {
      requested = value;
      if (requested) {
        displayBody();
        if (latestFrame) this.update(latestFrame);
      }
      refreshVisibility();
    },
    update(frame) {
      if (lastMachine !== frame.metadata.blueprint.id) {
        origin = null;
        latest = null;
        previousText = '';
        lastMode = undefined;
        lastMachine = frame.metadata.blueprint.id;
      }
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
        if (requested)
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
