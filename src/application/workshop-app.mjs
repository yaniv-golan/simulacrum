import { createRenderSubmissionTracker, FIRST_TICK_METRIC } from './render-submission.mjs';
import { assertRecordableObservation } from './recording-admission.mjs';
import { createSceneLibrary } from './scene-library.mjs';
import { hasWorkshopContent } from '../model/environment.mjs';
import { createCameraSession } from './camera-session.mjs';
import { createControllerHistory } from './controller-history.mjs';
import { createSensorWorkshop } from '../model/fixtures/sensor-workshop.mjs';
import { createDeliveryEvaluator } from '../model/learning-evaluators.mjs';
import { createLearningWorkspace } from './learning-workspace.mjs';
import { createAssemblyLibrary } from './assembly-library.mjs';
import { palettePlacement } from '../model/palette-placement.mjs';
import { createSpringPlayground, createSpringStrut } from '../model/fixtures/spring-playground.mjs';
import { createRetry } from './retry.mjs';
import { createImpactEvents, createImpactSound } from '../presentation/impact-sound.mjs';
import { CATALOG } from '../model/catalog.mjs';
import { createBallDrop } from '../model/fixtures/ball-drop.mjs';
import { createGearLift } from '../model/fixtures/gear-lift.mjs';
import { createSpringLauncher } from '../model/fixtures/spring-launcher.mjs';
import {
  createSuspensionComparison,
  createGuidedSuspensionModule,
} from '../model/fixtures/guided-suspension.mjs';
import {
  createArticulatedSuspensionBench,
  createPinEndedStrut,
  createActiveSuspensionBench,
} from '../model/fixtures/articulated-suspension.mjs';
import {
  createLearningDelivery,
  DELIVERY_EVALUATION,
} from '../model/fixtures/learning-delivery.mjs';
import { createDrivingMachine } from '../model/fixtures/driving-machine.mjs';
import { createWorkshop } from '../core/workshop.mjs';
import { createEmptyBlueprint, loadSave } from '../model/blueprint.mjs';
import { explainFailure, normalizeFailure } from '../model/messages.mjs';
import { starterSteps } from './starter-guide.mjs';
import { createInteractionRecorder } from './interaction-recorder.mjs';
import { mountRemotePlaytest } from './remote-playtest.mjs';
import { captureFeedbackContext } from './feedback-context.mjs';
import { createClock } from './clock.mjs';
import { createWorkshopView } from '../presentation/workshop-view.mjs';

/** Browser composition only: the workshop remains the sole authored read model. */
export async function mountWorkshopApp(root) {
  const buildId = document.querySelector('meta[name="build-id"]')?.content ?? 'unidentified';
  const workshop = await createWorkshop(createEmptyBlueprint('machine', 'My machine'), {
    build: buildId,
  });
  const controllerHistory = createControllerHistory();
  let learningEvaluator = null;
  const learning = createLearningWorkspace({
    evaluateAttempt: (attempt, frame) => learningEvaluator?.(attempt, frame) ?? null,
    readFrame: () => frame(),
    send: (c) => onCommand(c),
    storage: localStorage,
    buildId,
    changed: () => view?.refreshLearning?.(),
  });
  const metrics = [];
  const viewRenderMs = [];
  let remote = null;
  let partSequence = 0,
    connectionSequence = 0,
    newSequence = 0,
    placementSequence = 0;
  let view,
    clock,
    lastRenderedCursor = null,
    measurementCursor = undefined,
    runMeasurement = null,
    disposed = false,
    pendingLoads = 0,
    lastInput = null,
    pausedForVisibility = false,
    runSequence = 0;
  const cameraSession = createCameraSession({
    send: (c) => onCommand(c),
    observe: () => workshop.observe(),
    buildId,
    sourceIdentity: {
      head: document.querySelector('meta[name="source-head"]')?.content ?? null,
      workingTreeDigest: document.querySelector('meta[name="source-digest"]')?.content ?? null,
    },
    changed: () => view?.refreshCameras?.(),
  });
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
    if (entry.kind === 'run-first-tick') entry = { ...entry, metric: FIRST_TICK_METRIC };
    metrics.push(entry);
    if (metrics.length > 1000) metrics.shift();
  }
  const submissionTracker = createRenderSubmissionTracker({
    readDraw: () => view.readCompletedDraw(),
    record,
  });
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
  const impactEvents = createImpactEvents(),
    impactSound = createImpactSound();
  const retry = createRetry({
    prepare: async () => {
      clock.pause();
      cancelRun('replaced');
      view.beginRetry();
      await view.clearControls();
    },
    execute: (command) => executeCommand(command),
    finish: () => {
      view.endRetry();
      render();
    },
  });
  function render() {
    if (disposed) return;
    const measurements = workshop.observe('scene', 'full', measurementCursor);
    cameraSession.ingest(measurements);
    controllerHistory.ingest(measurements);
    view.ingestMeasurements(measurements);
    const sounds = [];
    if (!measurements.ok || document.hidden) {
      impactEvents.reset();
      impactSound.stop();
    }
    for (const completed of measurements.frames ?? []) {
      if (!impactSound.enabled() || document.hidden || completed.metadata.mode !== 'run') {
        impactEvents.reset();
        impactSound.stop();
        continue;
      }
      const events = impactEvents.read({
        epoch: measurements.cursor.epoch,
        tick: completed.tick,
        available: completed.contacts.available,
        rows: completed.contacts.rows,
      });
      for (const event of events) {
        const materials = [event.a, event.b].flatMap((index) => {
          const part = completed.metadata.blueprint.parts[index];
          return part
            ? [part.authoredMaterial.body ?? CATALOG[part.type].primitives[0].materialKey]
            : [];
        });
        sounds.push({ ...event, materials });
      }
    }
    impactSound.play(sounds.slice(-4));
    learning.ingest(measurements);
    measurementCursor = measurements.cursor;
    const observation = workshop.observe();
    const viewStart = performance.now();
    view.render(observation.frames[0], observation.cursor);
    viewRenderMs.push(performance.now() - viewStart);
    if (viewRenderMs.length > 240) viewRenderMs.shift();
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
    submissionTracker.measure(
      { kind, ...timing, acceptedAt, buildId, machine: blueprint.id, targetCursor: target },
      (cursor) =>
        cursor.session === target.session &&
        cursor.epoch === target.epoch &&
        (kind === 'run'
          ? frame().metadata.mode === 'run' &&
            JSON.stringify(frame().metadata.blueprint) === blueprintJSON
          : cursor.revision === target.revision),
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
    const blocked =
      (retry.pending() && !['control-release', 'suspend-controls'].includes(input?.type)) ||
      (pendingLoads > 0 && input?.type === 'retry');
    const result = blocked
      ? { ok: false, reasonCode: 'RETRY_PENDING', path: 'mode' }
      : await executeCommand(input, context);
    if (blocked)
      view.setMessage(
        pendingLoads
          ? 'Finish opening the machine before trying again.'
          : 'Wait for this retry to finish, then try the action again.',
      );
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
      if (command.type === 'retry') {
        if (!['run', 'paused'].includes(frame().metadata.mode))
          return { ok: false, reasonCode: 'INVALID_COMMAND', path: 'mode' };
        return await retry.run();
      }
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
      if (
        command.type === 'guided-suspension-module' ||
        command.type === 'pin-ended-strut-module'
      ) {
        const bp = frame().metadata.blueprint;
        const x = bp.parts.length ? Math.max(...bp.parts.map((p) => p.position[0])) + 0.6 : 0;
        command = {
          type: 'insert-assembly',
          definition:
            command.type === 'pin-ended-strut-module'
              ? createPinEndedStrut()
              : createGuidedSuspensionModule({ driven: command.driven === true }),
          position: [x, 0.5, 0],
          rotation: [0, 0, 0, 1],
        };
      }
      let nextLearningEvaluator = learningEvaluator;
      if (
        [
          'load',
          'new',
          'driving-example',
          'spring-example',
          'ball-drop-example',
          'spring-launcher-example',
          'guided-suspension-example',
          'rigid-suspension-example',
          'articulated-suspension-example',
          'active-suspension-example',
        ].includes(command.type)
      )
        nextLearningEvaluator = null;
      const suspensionExample = {
        'guided-suspension-example': createSuspensionComparison,
        'rigid-suspension-example': () => createSuspensionComparison({ rigid: true }),
        'articulated-suspension-example': createArticulatedSuspensionBench,
        'active-suspension-example': createActiveSuspensionBench,
      }[command.type];
      if (suspensionExample) {
        if (hasWorkshopContent(frame().metadata.blueprint) && command.replace !== true)
          return { ok: false, reasonCode: 'INVALID_COMMAND', path: 'machine' };
        command = { type: 'load', save: suspensionExample() };
      }
      if (command.type === 'spring-example') {
        if (hasWorkshopContent(frame().metadata.blueprint) && command.replace !== true)
          return { ok: false, reasonCode: 'INVALID_COMMAND', path: 'machine' };
        command = { type: 'load', save: createSpringPlayground({ damping: command.damping ?? 8 }) };
      }
      if (command.type === 'gear-lift-example') {
        if (hasWorkshopContent(frame().metadata.blueprint) && command.replace !== true)
          return { ok: false, reasonCode: 'INVALID_COMMAND', path: 'machine' };
        command = { type: 'load', save: createGearLift() };
      }
      if (command.type === 'ball-drop-example') {
        if (hasWorkshopContent(frame().metadata.blueprint) && command.replace !== true)
          return { ok: false, reasonCode: 'INVALID_COMMAND', path: 'machine' };
        command = { type: 'load', save: createBallDrop() };
      }
      if (command.type === 'spring-launcher-example') {
        if (hasWorkshopContent(frame().metadata.blueprint) && command.replace !== true)
          return { ok: false, reasonCode: 'INVALID_COMMAND', path: 'machine' };
        command = { type: 'load', save: createSpringLauncher() };
      }
      if (command.type === 'sensor-rule-example') {
        if (hasWorkshopContent(frame().metadata.blueprint) && command.replace !== true)
          return { ok: false, reasonCode: 'INVALID_COMMAND', path: 'machine' };
        nextLearningEvaluator = null;
        command = { type: 'load', save: createSensorWorkshop(command.sensor) };
      }
      if (command.type === 'learning-delivery-example') {
        if (hasWorkshopContent(frame().metadata.blueprint) && command.replace !== true)
          return { ok: false, reasonCode: 'INVALID_COMMAND', path: 'machine' };
        nextLearningEvaluator = createDeliveryEvaluator(DELIVERY_EVALUATION);
        command = {
          type: 'load',
          save: createLearningDelivery({ policy: command.policy ?? 'learning' }),
        };
      }
      if (command.type === 'driving-example') {
        if (hasWorkshopContent(frame().metadata.blueprint) && command.replace !== true)
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
      const resumeAfterRejectedRestore =
        command.type === 'restore-build' && frame().metadata.mode === 'run' && !document.hidden;
      if (command.type === 'restore-build') clock.pause();
      const result = await workshop.act(command);
      if (!result.ok) {
        if (resumeAfterRejectedRestore) clock.start();
        view.setMessage(explainFailure(result, frame().metadata.blueprint));
        return result;
      }
      learningEvaluator = nextLearningEvaluator;
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
      if (['load', 'restore-build'].includes(command.type)) view.clearMeasurements();
      if (command.type === 'restore-build') {
        clock.pause();
        cancelRun('restore-build');
      }
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
    // Reserve document replacement before asynchronous file reading. A retry and
    // a file load cannot each reset or start the other's authored document.
    if (retry.pending()) return onCommand({ type: 'load', save: null });
    pendingLoads++;
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
    } finally {
      pendingLoads--;
    }
  }
  function onRecording(action) {
    if (action === 'toggle') {
      if (!recorder.state().recording) {
        try {
          assertRecordableObservation(frame());
        } catch (error) {
          view.setMessage(error.message);
          return;
        }
      }
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
    learning,
    controllerHistory,
    beforeDraw: (now) => {
      try {
        clock?.frame(now);
      } catch (error) {
        // Stop the failing clock, preserve recovery controls and report the error.
        stopped(error);
        throw error;
      }
    },
    cameraSession,
    onCommand,
    onSound: (enabled) => impactSound.enable(enabled),
    onSave,
    onLoad,
    onFailure,
    onRecording,
    getCursor: () => workshop.observe().cursor,
    getAssemblyFrame: () => ({ ...frame(), cursor: workshop.observe().cursor }),
    onInteraction: logInteraction,
    guideSteps: starterSteps(),
    builtInAssemblies: [{ id: 'builtin-spring-strut', definition: createSpringStrut() }],
    sceneLibrary: createSceneLibrary({
      getItem: (key) => localStorage.getItem(key),
      setItem: (key, value) => localStorage.setItem(key, value),
    }),
    onExportScene: (value) => downloadJSON(value, 'workshop-scene.json'),
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
    {
      requestFrame: requestAnimationFrame,
      cancelFrame: cancelAnimationFrame,
      render,
      externalFrames: true,
    },
  );
  document.addEventListener('visibilitychange', visibilityChanged);
  render();
  remote = await mountRemotePlaytest({
    toolbarHost: view.utilityHost,
    feedbackSnapshot: () =>
      captureFeedbackContext(workshop, () => ({ build: buildId, ...recordingContext() })),
    screenshot: () => view.captureScreenshot(),
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
    readRenderedShapes: () => view.readRenderedShapes(),
    readRenderedSpringEndpoints: () => view.readRenderedSpringEndpoints(),
    readRenderedRopeEndpoints: () => view.readRenderedRopeEndpoints(),
    readRenderedCenters: () => view.readRenderedCenters(),
    readInteractionState: () => {
      const state = view.readInteractionState();
      state.rendering.viewRenderMs = [...viewRenderMs];
      return state;
    },
    metrics: () => structuredClone(metrics),
  });
  return Object.freeze({
    dispose() {
      cameraSession.dispose();
      impactSound.dispose();
      learning.dispose();
      remote?.dispose();
      disposed = true;
      document.removeEventListener('visibilitychange', visibilityChanged);
      for (const type of inputEvents) root.removeEventListener(type, captureInput, true);
      window.removeEventListener('keydown', captureInput, true);
      window.removeEventListener('keyup', captureInput, true);
      clock.pause();
      submissionTracker.dispose();
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
