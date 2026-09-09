import { createAssemblyLibrary } from './assembly-library.mjs';
import { palettePlacement } from '../model/palette-placement.mjs';
import { createSpringPlayground, createSpringStrut } from '../model/fixtures/spring-playground.mjs';
import { createDrivingMachine } from '../model/fixtures/driving-machine.mjs';
import { createWorkshop } from '../core/workshop.mjs';
import { createEmptyBlueprint, loadSave } from '../model/blueprint.mjs';
import { explainFailure, normalizeFailure } from '../model/messages.mjs';
import { starterSteps } from './starter-guide.mjs';
import { createInteractionRecorder } from './interaction-recorder.mjs';
import { mountRemotePlaytest } from './remote-playtest.mjs';
import { createClock } from './clock.mjs';
import { createWorkshopView } from '../presentation/workshop-view.mjs';

/** Browser composition only: the workshop remains the sole authored read model. */
export async function mountWorkshopApp(root) {
  const buildId = document.querySelector('meta[name="build-id"]')?.content ?? 'unidentified';
  const workshop = await createWorkshop(createEmptyBlueprint('machine', 'My machine'), {
    build: buildId,
  });
  const metrics = [];
  let remote = null;
  let partSequence = 0,
    connectionSequence = 0,
    newSequence = 0,
    placementSequence = 0;
  let view,
    clock,
    lastRenderedCursor = null,
    runMeasurement = null,
    disposed = false,
    lastInput = null,
    pausedForVisibility = false,
    runSequence = 0;
  const recorder = createInteractionRecorder({
    build: buildId,
    now: () => performance.now(),
    wallNow: () => Date.now(),
    idFactory: () => crypto.randomUUID(),
    storage: {
      setItem: (key, value) => localStorage.setItem(key, value),
      getItem: (key) => localStorage.getItem(key),
    },
  });
  let lastCommandResult = null;
  let commandResultSequence = 0;
  let lastRecordedInput = null,
    lastPointerSample = -Infinity;
  const seenEvents = new WeakSet();
  const recordingContext = () => ({
    cursor: workshop.observe().cursor,
    mode: frame().metadata.mode,
    status: frame().status,
    ui: view?.readInteractionState?.() ?? null,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
  });
  function refreshRecording() {
    const state = recorder.state();
    view?.setRecordingState({
      ...state,
      available:
        state.eventCount > 0 || recorder.snapshot() !== null || recorder.readLast() !== null,
    });
  }
  function logInteraction(kind, data) {
    const remoteSeq = remote?.emit(kind, data);
    if (!recorder.state().recording) return remoteSeq;
    recorder.record(kind, data, recordingContext());
    refreshRecording();
    return remoteSeq ?? recorder.state().eventCount;
  }
  const inputEvents = [
    'pointerdown',
    'pointerup',
    'pointercancel',
    'pointermove',
    'wheel',
    'click',
    'keydown',
    'keyup',
    'change',
    'input',
    'dragstart',
    'dragover',
    'drop',
    'dragend',
  ];
  function captureInput(event) {
    if (!event.isTrusted) {
      lastInput = null;
      return;
    }
    if (
      !seenEvents.has(event) &&
      (recorder.state().recording || remote?.active()) &&
      (root.contains(event.target) || event.target === document.body)
    ) {
      seenEvents.add(event);
      const sampled = ['pointermove', 'dragover', 'wheel'].includes(event.type),
        time = performance.now();
      if (
        (event.type !== 'pointermove' || event.buttons) &&
        (!sampled || time - lastPointerSample >= 100)
      ) {
        if (sampled) lastPointerSample = time;
        const target = event.target.closest?.('button,input,select,canvas,summary') ?? event.target;
        const editing = target.matches?.('input,textarea,[contenteditable=true]');
        const data = {
          type: event.type,
          target: {
            tag: target.tagName ?? null,
            command: target.dataset?.command ?? null,
            partId: target.dataset?.partId ?? null,
            partType: target.dataset?.partType ?? null,
            label: target.getAttribute?.('aria-label') ?? null,
          },
          key: editing ? null : (event.key ?? null),
          code: editing ? null : (event.code ?? null),
          ctrl: !!event.ctrlKey,
          alt: !!event.altKey,
          meta: !!event.metaKey,
          shift: !!event.shiftKey,
          repeat: !!event.repeat,
          x: Number.isFinite(event.clientX) ? event.clientX : null,
          y: Number.isFinite(event.clientY) ? event.clientY : null,
          buttons: event.buttons ?? null,
          value: target.type === 'number' ? target.value : null,
        };
        lastRecordedInput = logInteraction('input', data);
      }
    }
    if (!['pointerdown', 'click', 'keydown', 'change', 'drop'].includes(event.type)) return;
    const now = performance.now(),
      raw = event.timeStamp;
    const inputTime = raw > now + 1000 ? raw - performance.timeOrigin : raw;
    lastInput =
      Number.isFinite(inputTime) && inputTime >= 0 && inputTime <= now
        ? { inputTime, eventType: event.type, event }
        : null;
  }
  for (const type of inputEvents) root.addEventListener(type, captureInput, true);
  window.addEventListener('keydown', captureInput, true);
  window.addEventListener('keyup', captureInput, true);
  const frame = () => workshop.observe().frames[0];
  function record(entry) {
    metrics.push(entry);
    if (metrics.length > 1000) metrics.shift();
  }
  function cancelRun(cause) {
    if (runMeasurement) {
      record({
        ...runMeasurement,
        kind: 'run-first-tick',
        outcome: 'cancelled',
        cause,
        durationMs: null,
        completedAt: performance.now(),
      });
      runMeasurement = null;
    }
  }
  function stopped(error) {
    clock?.pause();
    cancelRun('failure');
    view?.setMessage(
      explainFailure(normalizeFailure(error, 'SESSION_FAILED'), frame()?.metadata.blueprint),
    );
  }
  function render() {
    if (disposed) return;
    const observation = workshop.observe();
    view.render(observation.frames[0]);
    lastRenderedCursor = observation.cursor;
    if (runMeasurement && observation.cursor.tick > runMeasurement.startTick) {
      record({
        ...runMeasurement,
        kind: 'run-first-tick',
        outcome: 'completed',
        tick: observation.cursor.tick,
        durationMs:
          runMeasurement.timestampSource === 'input-event'
            ? performance.now() - runMeasurement.inputTime
            : null,
        completedAt: performance.now(),
      });
      runMeasurement = null;
    }
  }
  function eventTiming(context) {
    const now = performance.now(),
      captured = lastInput;
    lastInput = null;
    // Capture runs before the view's handler. Programmatic callbacks without an
    // input event may act, but cannot manufacture an F2 input-latency sample.
    if (captured?.event.isTrusted && captured.event.eventPhase !== Event.NONE)
      return {
        inputTime: captured.inputTime,
        eventType: captured.eventType,
        timestampSource: 'input-event',
      };
    return { inputTime: now, timestampSource: 'callback' };
  }
  function reflection(kind, timing) {
    const target = lastRenderedCursor,
      acceptedAt = performance.now(),
      blueprint = frame().metadata.blueprint,
      blueprintJSON = JSON.stringify(blueprint);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (disposed) return;
        const reflected =
          lastRenderedCursor?.epoch === target.epoch &&
          (kind === 'run'
            ? frame().metadata.mode === 'run' &&
              JSON.stringify(frame().metadata.blueprint) === blueprintJSON
            : lastRenderedCursor.revision === target.revision);
        record({
          kind,
          ...timing,
          acceptedAt,
          completedAt: performance.now(),
          durationMs:
            reflected && timing.timestampSource === 'input-event'
              ? performance.now() - timing.inputTime
              : null,
          superseded: !reflected,
          buildId,
          machine: blueprint.id,
          targetCursor: target,
          reflectingCursor: lastRenderedCursor,
        });
      }),
    );
  }
  function availableId(prefix, sequence, existing) {
    let id;
    do {
      id = `${prefix}-${sequence.next()}`;
    } while (existing.some((item) => item.id === id));
    return id;
  }
  async function onCommand(input, context) {
    const trigger = lastRecordedInput;
    logInteraction('command-request', { input, trigger });
    const result = await executeCommand(input, context);
    lastCommandResult = structuredClone({
      sequence: ++commandResultSequence,
      input,
      result,
      cursor: workshop.observe().cursor,
    });
    logInteraction('command-result', { input, result, trigger });
    return result;
  }
  async function executeCommand(input, context) {
    const timing = eventTiming(context);
    if (disposed) return { ok: false, reasonCode: 'SESSION_DISPOSED', path: '' };
    let command = { ...input };
    if (command.type === 'guide-step') {
      const step = starterSteps().find((s) => !s.done(frame().metadata.blueprint));
      if (!step) return { ok: true, reasonCode: 'OK', path: '' };
      for (const edit of step.commands) {
        const result = await onCommand(edit);
        if (!result.ok) return result;
      }
      return { ok: true, reasonCode: 'OK', path: '' };
    }
    try {
      if (command.type === 'step') {
        if (clock.running() || frame().metadata.mode !== 'paused') {
          view.setMessage('Pause a running machine before stepping one tick.');
          return { ok: false, reasonCode: 'EDIT_REQUIRES_BUILD', path: 'mode' };
        }
        workshop.step(1);
        render();
        return { ok: true, reasonCode: 'OK', path: '' };
      }
      if (command.type === 'spring-strut') {
        const bp = frame().metadata.blueprint;
        const x = bp.parts.length ? Math.max(...bp.parts.map((p) => p.position[0])) + 0.6 : 0;
        command = {
          type: 'insert-assembly',
          definition: createSpringStrut(),
          position: [x, 0.02, 0],
          rotation: [0, 0, 0, 1],
        };
      }
      if (command.type === 'spring-example') {
        if (frame().metadata.blueprint.parts.length && command.replace !== true)
          return { ok: false, reasonCode: 'INVALID_COMMAND', path: 'machine' };
        command = { type: 'load', save: createSpringPlayground({ damping: command.damping ?? 8 }) };
      }
      if (command.type === 'driving-example') {
        if (frame().metadata.blueprint.parts.length && command.replace !== true)
          return { ok: false, reasonCode: 'INVALID_COMMAND', path: 'machine' };
        command = { type: 'load', save: createDrivingMachine() };
      }
      if (command.type === 'new') {
        clock.pause();
        cancelRun('paused');
        if (frame().metadata.mode !== 'build') await workshop.act({ type: 'build' });
        command = {
          type: 'load',
          save: createEmptyBlueprint(`machine-${++newSequence}`, 'My machine'),
        };
        placementSequence = 0;
      }
      if (command.type === 'place') {
        if (command.id === undefined)
          command.id = availableId(
            'part',
            { next: () => ++partSequence },
            frame().metadata.blueprint.parts,
          );
        if (command.position === undefined) {
          const placement = palettePlacement(
            frame().metadata.blueprint,
            command.partType,
            command.id,
            placementSequence,
          );
          command.position = placement.position;
          placementSequence = placement.index;
        }
      }
      if (command.type === 'connect' && command.id === undefined)
        command.id = availableId(
          'connection',
          { next: () => ++connectionSequence },
          frame().metadata.blueprint.connections,
        );
      if (['pause', 'build', 'load'].includes(command.type)) {
        clock.pause();
        cancelRun('paused');
      }
      const before = frame().metadata.blueprint;
      let editMessage = '';
      if (command.type === 'delete') {
        const part = before.parts.find((part) => part.id === command.id);
        if (part)
          editMessage = `Deleted ${part.name}. Choose Undo to restore it and its connections.`;
      }
      if (command.type === 'disconnect') {
        const connection = before.connections.find((connection) => connection.id === command.id);
        const endpointLabel = (endpoint) =>
          `${before.parts.find((part) => part.id === endpoint.part)?.name ?? endpoint.part} (${endpoint.surface?.region ?? endpoint.port})`;
        if (connection)
          editMessage = `Disconnected ${endpointLabel(connection.a)} from ${endpointLabel(connection.b)}. Choose Undo to reconnect them.`;
      }
      if (command.type === 'undo') editMessage = 'Last edit undone. Choose Redo to apply it again.';
      if (command.type === 'redo') editMessage = 'Edit reapplied. Choose Undo to reverse it.';
      logInteraction('command-execute', { command, trigger: lastRecordedInput });
      const result = await workshop.act(command);
      if (!result.ok) {
        view.setMessage(explainFailure(result, frame().metadata.blueprint));
        return result;
      }
      if (command.type === 'place') placementSequence++;
      if (command.type === 'run') {
        cancelRun('replaced');
        runMeasurement = {
          attempt: ++runSequence,
          ...timing,
          buildId,
          machine: frame().metadata.blueprint.id,
          startTick: workshop.observe().cursor.tick,
        };
        if (document.hidden) {
          cancelRun('hidden');
          await workshop.act({ type: 'pause' });
          pausedForVisibility = true;
        } else clock.start();
      }
      render();
      if (command.type === 'load') view.clearMeasurements();
      if (['place', 'connect', 'run'].includes(command.type)) reflection(command.type, timing);
      view.setMessage(
        command.type === 'run'
          ? 'Running. Watch the motor current, charge and movement.'
          : command.type === 'pause'
            ? 'Paused. Step one tick or choose Run to continue.'
            : command.type === 'build'
              ? 'Build mode. Your machine is reset and ready to edit.'
              : editMessage,
      );
      return result;
    } catch (error) {
      stopped(error);
      render();
      return normalizeFailure(error, 'SESSION_FAILED');
    }
  }
  function downloadJSON(value, filename) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
      url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  function onSave() {
    const blueprint = workshop.save();
    downloadJSON(
      blueprint,
      `${blueprint.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-') || 'machine'}.json`,
    );
    view.setMessage('Machine download started. Check your browser downloads for the saved file.');
  }
  function onFailure() {
    const bundle = workshop.failureBundle();
    if (!bundle) {
      view.setMessage('There is no failure record for this run.');
      return;
    }
    downloadJSON(bundle, 'machine-failure.json');
    view.setMessage('Failure record saved. It includes the inputs needed to replay this failure.');
  }
  async function visibilityChanged() {
    logInteraction('visibility', { hidden: document.hidden });
    if (disposed) return;
    if (document.hidden) {
      if (clock.running() || frame().metadata.mode === 'run') {
        pausedForVisibility = true;
        clock.pause();
        cancelRun('hidden');
        await workshop.act({ type: 'pause' });
        render();
      }
    } else if (pausedForVisibility) {
      pausedForVisibility = false;
      view.setMessage('Paused while this tab was hidden. Choose Run to continue.');
    }
  }
  async function onLoad(file) {
    if (!file) return;
    try {
      const text = await file.text(),
        loaded = loadSave(text);
      if (!loaded.ok) {
        let candidate;
        try {
          candidate = JSON.parse(text);
        } catch {}
        view.setMessage(explainFailure(loaded, candidate));
        return loaded;
      }
      clock.pause();
      cancelRun('paused');
      if (frame().metadata.mode !== 'build') {
        const result = await workshop.act({ type: 'build' });
        if (!result.ok) {
          view.setMessage(explainFailure(result, frame().metadata.blueprint));
          return result;
        }
      }
      const result = await onCommand({ type: 'load', save: loaded.blueprint });
      if (result.ok) {
        placementSequence = loaded.blueprint.parts.length;
        view.setMessage('Machine opened. Choose Run to try it.');
      }
      return result;
    } catch (error) {
      view.setMessage('The file could not be opened. Choose a saved machine JSON file.');
      return { ok: false, reasonCode: 'INVALID_JSON', path: '' };
    }
  }
  function onRecording(action) {
    if (action === 'toggle') {
      if (recorder.state().recording)
        recorder.stop({ context: recordingContext(), observation: frame() });
      else
        recorder.start({
          timeOrigin: performance.timeOrigin,
          context: recordingContext(),
          checkpoint: workshop.checkpoint(),
          observation: frame(),
          capturePolicy: {
            pointerSamplingMs: 100,
            textInputs: 'not captured',
            scope: 'this workshop only',
            maxEvents: 10000,
            maxBytes: 2000000,
          },
        });
    } else {
      const data = recorder.snapshot() ?? recorder.readLast();
      if (data) downloadJSON(data, `workshop-recording-${data.id}.json`);
    }
    refreshRecording();
  }
  view = createWorkshopView(root, {
    onCommand,
    onSave,
    onLoad,
    onFailure,
    onRecording,
    getCursor: () => workshop.observe().cursor,
    onInteraction: logInteraction,
    guideSteps: starterSteps(),
    assemblyLibrary: createAssemblyLibrary({
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    }),
  });
  refreshRecording();
  clock = createClock(
    {
      advanceTime(ms) {
        try {
          workshop.advanceTime(ms);
        } catch (error) {
          stopped(error);
        }
      },
    },
    { requestFrame: requestAnimationFrame, cancelFrame: cancelAnimationFrame, render },
  );
  document.addEventListener('visibilitychange', visibilityChanged);
  render();
  remote = await mountRemotePlaytest({
    context: () => ({ build: buildId, ...recordingContext(), observation: frame() }),
    checkpoint: () => workshop.checkpoint(),
  });
  window.render_game_to_text = () => JSON.stringify(workshop.observe().frames[0]);
  window.advanceTime = (milliseconds) => {
    clock.pause();
    cancelRun('paused');
    clock.advanceTime(milliseconds);
    return workshop.observe();
  };
  window.workshopProbe = Object.freeze({
    observe: () => workshop.observe(),
    readLastCommandResult: () => structuredClone(lastCommandResult),
    readRenderedTransforms: () => view.readRenderedTransforms(),
    readRenderedCenters: () => view.readRenderedCenters(),
    readInteractionState: () => view.readInteractionState(),
    metrics: () => structuredClone(metrics),
  });
  return Object.freeze({
    dispose() {
      remote?.dispose();
      disposed = true;
      document.removeEventListener('visibilitychange', visibilityChanged);
      for (const type of inputEvents) root.removeEventListener(type, captureInput, true);
      window.removeEventListener('keydown', captureInput, true);
      window.removeEventListener('keyup', captureInput, true);
      clock.pause();
      workshop.dispose();
      view.dispose?.();
      delete window.render_game_to_text;
      delete window.advanceTime;
      delete window.workshopProbe;
    },
  });
}

const root = document.getElementById('app');
if (root)
  mountWorkshopApp(root).catch((error) => {
    root.textContent = `The workshop could not start: ${explainFailure(normalizeFailure(error, 'SESSION_FAILED'))}`;
    console.error(error);
  });
