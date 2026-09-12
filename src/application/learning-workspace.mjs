import { admitAttemptEvaluation } from '../model/learning-evaluators.mjs';
import {
  evaluateLearningModel,
  inspectLearningMoment,
  compareLearningAttempts,
} from '../model/learning-analysis.mjs';
import { compileAssembly } from '../model/assembly.mjs';
import { loadSave } from '../model/blueprint.mjs';
import { immutableCopy } from '../model/observation.mjs';
import {
  learningIdentity,
  learningValues,
  prepareLearningData,
  trainLearningModel,
} from '../model/learning-model.mjs';

/** Training and historical records have one application owner. Executable models live in the blueprint. */
export function createLearningWorkspace({
  readFrame,
  send,
  storage,
  changed = () => {},
  evaluateAttempt = () => null,
  buildId = 'unidentified',
  now = () => performance.now(),
  yieldWork = () => new Promise((resolve) => setTimeout(resolve, 0)),
}) {
  let state = { version: 2, intervals: [], attempts: [], versions: [] },
    selected = null,
    recording = null,
    attempt = null,
    training = null,
    candidate = null,
    notice = '',
    problem = false,
    cue = null,
    serial = 0,
    captureBlocked = false,
    captureBytes = 0,
    pendingHandover = false;
  const installedTraining = new Map();
  const copy = (x) => structuredClone(x);
  let configKey = '',
    cachedConfig = null,
    statusState = null,
    statusConfig = null,
    statusCandidate = null,
    statusSnapshot = null,
    storageUnreadable = false;
  function checkedStore(input) {
    const next = immutableCopy(input);
    if (
      Object.keys(next).sort().join(',') !== 'attempts,intervals,version,versions' ||
      ![1, 2].includes(next.version) ||
      !Array.isArray(next.intervals) ||
      next.intervals.length > 64 ||
      !Array.isArray(next.attempts) ||
      next.attempts.length > 12 ||
      !Array.isArray(next.versions) ||
      next.versions.length > 12
    )
      throw Error('Invalid learning records');
    for (const kind of ['intervals', 'attempts', 'versions'])
      if (new Set(next[kind].map((x) => x.id)).size !== next[kind].length)
        throw Error('Duplicate learning records');
    for (const r of next.intervals) {
      if (typeof r.owner !== 'string' || r.owner.length > 140) throw Error('Invalid example owner');
      const { owner, ...interval } = r;
      prepareLearningData({ inputs: r.inputs, outputs: r.outputs, intervals: [interval] });
    }
    for (const owner of new Set(next.intervals.map((r) => r.owner))) {
      const intervals = next.intervals.filter((r) => r.owner === owner).map(({ owner, ...r }) => r);
      prepareLearningData({
        inputs: intervals[0].inputs,
        outputs: intervals[0].outputs,
        intervals,
      });
    }
    for (const v of [...next.versions, ...next.attempts]) {
      if (
        typeof v.id !== 'string' ||
        v.id.length > 100 ||
        typeof v.buildId !== 'string' ||
        v.buildId.length > 200
      )
        throw Error('Invalid saved version');
      const loaded = loadSave(v.blueprint);
      if (!loaded.ok) throw Error('Invalid saved build');
      compileAssembly(loaded.blueprint);
      validateTraining(v.training, loaded.blueprint);
    }
    for (const v of next.versions)
      if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 128)
        throw Error('Invalid version name');
    for (const a of next.attempts) {
      admitAttemptEvaluation(a);
      if (
        a.fault &&
        (!Number.isSafeInteger(a.fault.tick) ||
          a.fault.tick < 1 ||
          !Array.isArray(a.fault.inputs) ||
          a.fault.inputs.length !== a.inputs.length ||
          !a.fault.inputs.every(
            (r, i) =>
              r.port === a.inputs[i].port &&
              [
                'ok',
                'no-power',
                'no-return',
                'initializing',
                'unavailable',
                'disconnected',
              ].includes(r.status) &&
              (r.status === 'ok' ? Number.isFinite(r.value) : !Object.hasOwn(r, 'value')),
          ))
      )
        throw Error('Invalid fault observations');
      const installed = a.blueprint.parts.find((p) => p.id === a.controller)?.learningModel;
      if (
        a.model !== null &&
        (!installed || learningIdentity(a.model) !== learningIdentity(installed))
      )
        throw Error('Attempt model does not match its saved build');
      if (
        !Array.isArray(a.samples) ||
        a.samples.length > 1200 ||
        (!a.samples.length && (!a.fault || a.incompleteReason !== 'SENSOR_UNAVAILABLE')) ||
        a.initialTick !== 0 ||
        a.complete !== true ||
        !a.blueprint.parts.some((p) => p.id === a.controller && p.type === 'learningController')
      )
        throw Error('Invalid saved attempt');
      const physicalBodyCount = compileAssembly(a.blueprint).configuration.bodies.length;
      for (const x of a.samples)
        if (
          !Array.isArray(x.modes) ||
          x.modes.length !== a.outputs.length ||
          !x.modes.every((m) => ['manual', 'automatic', 'learned', 'off'].includes(m)) ||
          !Array.isArray(x.physics) ||
          x.physics.length > 8192 ||
          x.physics.length !== physicalBodyCount ||
          !x.physics.every(
            (b) =>
              b &&
              [
                ['position', 3],
                ['rotation', 4],
                ['velocity', 3],
              ].every(
                ([key, size]) =>
                  Array.isArray(b[key]) && b[key].length === size && b[key].every(Number.isFinite),
              ),
          )
        )
          throw Error('Invalid attempt observations');
      prepareLearningData({
        inputs: a.inputs,
        outputs: a.outputs,
        intervals: a.samples.length
          ? [
              {
                id: a.id,
                attemptId: a.id,
                partition: 'test',
                weight: 1,
                inputs: a.inputs,
                outputs: a.outputs,
                samples: a.samples.map(({ tick, values, targets, durationTicks }) => ({
                  tick,
                  values,
                  targets,
                  ...(durationTicks ? { durationTicks } : {}),
                })),
              },
            ]
          : [],
      });
    }
    return { ...copy(next), version: 2 };
  }
  function config(id = selected) {
    const bp = readFrame().metadata.blueprint,
      node = bp.parts.findIndex((p) => p.id === id);
    if (node < 0 || bp.parts[node].type !== 'learningController')
      throw Error('Select a Learning Controller.');
    const identity = JSON.stringify([id, bp]);
    if (identity === configKey) return cachedConfig;
    const l = compileAssembly(bp).configuration.power.controllers.find(
      (c) => c.node === node,
    )?.learning;
    if (!l) throw Error('Select a Learning Controller.');
    configKey = identity;
    cachedConfig = {
      ...l,
      blueprint: bp,
      id,
      receiverIds: l.outputs.map((o) => bp.parts[o.node].id),
      inputs: l.inputs,
      outputs: l.outputs,
    };
    return cachedConfig;
  }
  const definitions = (items) => items.map(({ node, ...rest }) => rest);
  function key(c) {
    return `${c.blueprint.id}/${c.id}`;
  }
  function dataset(c) {
    return state.intervals.filter((r) => r.owner === key(c)).map(({ owner, ...r }) => r);
  }
  function persist(next) {
    if (storageUnreadable)
      throw Error(
        'Unreadable saved records are preserved. Export the original stored data before resetting storage.',
      );
    const text = JSON.stringify(next);
    if (text.length > 4000000)
      throw Error('Learning storage is full. Export your work, then remove records explicitly.');
    storage.setItem('simulacrum-learning-v2', text);
    if (attempt) captureBytes += text.length - JSON.stringify(state).length;
    state = next;
    candidate = null;
  }
  function message(text, failed = false) {
    problem = failed;
    notice = text;
    changed();
  }
  try {
    const text =
      storage.getItem('simulacrum-learning-v2') ?? storage.getItem('simulacrum-learning-v1');
    if (text) {
      const parsed = JSON.parse(text);
      if (
        ![1, 2].includes(parsed.version) ||
        !Array.isArray(parsed.intervals) ||
        parsed.intervals.length > 64 ||
        !Array.isArray(parsed.attempts) ||
        parsed.attempts.length > 12 ||
        !Array.isArray(parsed.versions) ||
        parsed.versions.length > 12 ||
        text.length > 4000000
      )
        throw Error();
      // Saved executable content still passes ordinary save/compiler admission on restoration.
      state = checkedStore(parsed);
    }
  } catch (error) {
    storageUnreadable = true;
    notice =
      'Saved learning records could not be read: ' +
      error.message +
      '. Existing storage is preserved; export it before saving new work.';
  }
  async function command(value) {
    const r = await send(value);
    if (!r?.ok) throw Error(r?.reasonCode ?? 'Command failed');
  }
  function trainingFor(model) {
    if (!model) return null;
    const t = installedTraining.get(`${readFrame().metadata.blueprint.id}/${selected}`);
    return t?.modelIdentity === learningIdentity(model) ? t : null;
  }
  function rememberTraining(t, id = selected) {
    installedTraining.set(`${readFrame().metadata.blueprint.id}/${id}`, t ?? null);
  }
  function restoreTraining(record, id = record.trainingController) {
    installedTraining.clear();
    if (!record.training) return;
    const matches = record.blueprint.parts.filter(
      (p) =>
        p.learningModel &&
        learningIdentity(p.learningModel) === record.training.modelIdentity &&
        (!id || p.id === id),
    );
    if (matches.length === 1) rememberTraining(record.training, matches[0].id);
  }
  function validateTraining(t, bp) {
    if (!t) return;
    if (
      !bp.parts.some(
        (p) => p.learningModel && learningIdentity(p.learningModel) === t.modelIdentity,
      ) ||
      typeof t.id !== 'string' ||
      t.id.length > 100 ||
      typeof t.owner !== 'string' ||
      t.owner.length > 140 ||
      typeof t.reusedTest !== 'boolean' ||
      !Number.isFinite(t.milliseconds) ||
      t.milliseconds < 0 ||
      t.datasetIdentity !== learningIdentity(t.dataset) ||
      !Number.isInteger(t.seed) ||
      t.seed < 0 ||
      t.seed > 0xffffffff ||
      !Number.isInteger(t.epochs) ||
      t.epochs < 1 ||
      t.epochs > 1200 ||
      !Number.isFinite(t.learningRate) ||
      t.learningRate <= 0 ||
      t.learningRate > 0.5
    )
      throw Error('Invalid training provenance');
    const model = bp.parts.find(
      (p) => p.learningModel && learningIdentity(p.learningModel) === t.modelIdentity,
    ).learningModel;
    const prepared = prepareLearningData({
      inputs: model.inputs,
      outputs: model.outputs,
      intervals: t.dataset,
    });
    if (prepared.trainingIdentity !== t.trainingIdentity)
      throw Error('Invalid training dataset identity');
    if (
      learningIdentity(t.evaluation) !== learningIdentity(evaluateLearningModel(model, t.dataset))
    )
      throw Error('Invalid training evaluation');
  }
  function captureDefinition(c) {
    return {
      version: 1,
      buildId,
      blueprintIdentity: learningIdentity(c.blueprint),
      controllerId: c.id,
      initialTick: readFrame().tick,
      sampling: 'periodic-plus-events-v1',
      inputs: c.inputs.map((i) => ({
        port: i.port,
        partId: c.blueprint.parts[i.node].id,
        channel: i.channel,
        kind: i.kind ?? null,
        frame: i.frame ?? null,
      })),
      outputs: c.outputs.map((o) => ({
        port: o.port,
        partId: c.blueprint.parts[o.node].id,
        channel: o.channel,
      })),
    };
  }
  function beginAttempt(c, learned = false) {
    if (attempt) return;
    if (state.attempts.length >= 12)
      throw Error('Attempt history is full. Export or delete an attempt before starting another.');
    attempt = {
      id: `attempt-${Date.now()}-${serial++}`,
      owner: key(c),
      blueprint: copy(c.blueprint),
      buildId,
      controller: c.id,
      model: learned ? c.model : null,
      training: learned ? trainingFor(c.model) : null,
      inputs: definitions(c.inputs),
      outputs: definitions(c.outputs),
      samples: [],
      initialTick: readFrame().tick,
      complete: false,
      evaluation: null,
      capture: captureDefinition(c),
    };
    // Reserve metadata/interval headers; account sample bytes before admitting them.
    captureBytes =
      JSON.stringify(state).length +
      JSON.stringify(attempt).length +
      JSON.stringify(captureDefinition(c)).length +
      JSON.stringify(definitions(c.inputs)).length +
      JSON.stringify(definitions(c.outputs)).length +
      4096;
  }
  function finishInterval() {
    if (!recording) return;
    captureBlocked = true;
    const next = copy(state),
      r = recording;
    if (r.samples.length) {
      next.intervals.push(r);
      const c = config();
      prepareLearningData({
        inputs: definitions(c.inputs),
        outputs: definitions(c.outputs),
        intervals: next.intervals.filter((x) => x.owner === r.owner).map(({ owner, ...x }) => x),
      });
      persist(next);
    }
    recording = null;
    captureBlocked = false;
  }
  function finishAttempt() {
    pendingHandover = false;
    if (!attempt) return;
    captureBlocked = true;
    if (attempt.samples.length || attempt.fault) {
      const next = copy(state);
      next.attempts.push({ ...attempt, complete: true });
      persist(next);
    }
    attempt = null;
    cue = null;
    captureBlocked = false;
  }
  const api = {
    select(id) {
      if ((attempt || recording) && selected !== id) {
        message('Finish the current attempt before switching learning controllers.');
        return false;
      }
      selected = id;
      changed();
    },
    status() {
      let c = null;
      try {
        c = config();
      } catch {}
      if (
        !statusSnapshot ||
        statusState !== state ||
        statusConfig !== c ||
        statusCandidate !== candidate
      ) {
        let data = null;
        try {
          if (c)
            data = prepareLearningData({
              inputs: definitions(c.inputs),
              outputs: definitions(c.outputs),
              intervals: dataset(c),
            });
        } catch {}
        // Completed records are immutable between explicit edits. Share them across live
        // progress refreshes instead of copying every saved physics sample each frame.
        statusSnapshot = immutableCopy({
          candidate,
          config: c,
          data,
          intervals: c ? state.intervals.filter((r) => r.owner === key(c)) : [],
          attempts: state.attempts,
          versions: state.versions,
        });
        statusState = state;
        statusConfig = c;
        statusCandidate = candidate;
      }
      return Object.freeze({
        ...statusSnapshot,
        ...immutableCopy({
          live: c
            ? {
                tick: readFrame().tick,
                inputs: c.inputs.map((i) => ({
                  partId: c.blueprint.parts[i.node].id,
                  channel: i.channel,
                  unit: i.unit,
                  value:
                    readFrame().sensors.readings.find((r) => r.node === i.node)?.channels?.[
                      i.channel
                    ]?.value ?? null,
                  status:
                    readFrame().sensors.readings.find((r) => r.node === i.node)?.channels?.[
                      i.channel
                    ]?.status ?? 'disconnected',
                  valid:
                    readFrame().sensors.readings.find((r) => r.node === i.node)?.channels?.[
                      i.channel
                    ]?.status === 'ok',
                })),
                outputs: c.outputs.map(
                  (o) => readFrame().receiverControl.receivers.find((r) => r.node === o.node)?.duty,
                ),
              }
            : null,
          selected,
          notice,
          problem,
          recording: !!recording,
          captureBlocked,
          training: training ? { completed: training.completed, total: training.total } : null,
          cue,
          activeAttempt: attempt ? { samples: attempt.samples.length } : null,
          controlModes: c
            ? c.outputs.map(
                (o) =>
                  readFrame().receiverControl?.receivers.find((r) => r.node === o.node)?.mode ??
                  'off',
              )
            : [],
        }),
      });
    },
    async teach() {
      if (training) throw Error('Cancel training first.');
      if (captureBlocked) throw Error('Save, export or discard the pending recording first.');
      const c = config();
      if (!c.inputs.length || !c.outputs.length)
        throw Error('Wire a sensor input and receiver output first.');
      if (state.intervals.length >= 64)
        throw Error('Example storage is full. Export or delete intervals first.');
      if (recording) return;
      if (readFrame().metadata.mode === 'build') beginAttempt(c);
      else if (!attempt) throw Error('Return to Build before beginning a recorded attempt.');
      for (const id of c.receiverIds) await command({ type: 'control', id, duty: 0 });
      recording = {
        owner: key(c),
        id: `teach-${Date.now()}-${serial++}`,
        attemptId: attempt.id,
        capture: captureDefinition(c),
        partition: 'train',
        weight: 1,
        inputs: definitions(c.inputs),
        outputs: definitions(c.outputs),
        samples: [],
      };
      await command({ type: 'run' });
      message('Teaching · your keys own the receiver. Stop teaching when you have shown enough.');
    },
    async stop() {
      pendingHandover = false;
      finishInterval();
      await command({ type: 'pause' });
      finishAttempt();
      message('Teaching stopped. Return to Build to train or change the machine.');
    },
    async train() {
      if (readFrame().metadata.mode !== 'build' || recording || training)
        throw Error('Return to Build and stop teaching before training.');
      if (state.versions.length >= 12)
        throw Error('Version storage is full. Export or delete a retained run before training.');
      const c = config(),
        source = learningIdentity(c.blueprint),
        started = now();
      training = { cancelled: false, completed: 0, total: 600 };
      const job = training;
      message('Training a candidate. Your working controller is preserved.');
      try {
        const result = await trainLearningModel({
          inputs: definitions(c.inputs),
          outputs: definitions(c.outputs),
          intervals: dataset(c),
          cancelled: () => job.cancelled,
          yieldWork,
          onProgress: (p) => {
            Object.assign(job, p);
            changed();
          },
        });
        if (learningIdentity(readFrame().metadata.blueprint) !== source)
          throw Error(
            'Build changed during training. Working controller preserved; train again on the intended build.',
          );
        const evaluation = evaluateLearningModel(result.model, dataset(c));
        const reusedTest = dataset(c).some(
          (r) =>
            r.partition === 'test' &&
            state.versions.some(
              (v) =>
                v.training?.owner === key(c) &&
                v.training.dataset.some((old) => old.attemptId === r.attemptId),
            ),
        );
        const runRecord = {
          id: `training-${Date.now()}-${serial++}`,
          owner: key(c),
          modelIdentity: learningIdentity(result.model),
          dataset: copy(dataset(c)),
          datasetIdentity: learningIdentity(dataset(c)),
          trainingIdentity: result.trainingIdentity,
          seed: result.seed,
          epochs: result.epochs,
          learningRate: result.learningRate,
          milliseconds: now() - started,
          evaluation,
          reusedTest,
        };
        const next = copy(state),
          blueprint = copy(c.blueprint);
        blueprint.parts.find((p) => p.id === c.id).learningModel = result.model;
        next.versions.push({
          id: runRecord.id,
          name: `Training run ${state.versions.filter((v) => v.training).length + 1}`,
          blueprint,
          buildId,
          training: runRecord,
          trainingController: c.id,
        });
        persist(next);
        candidate = {
          ...result,
          source,
          controller: c.id,
          milliseconds: runRecord.milliseconds,
          datasetIdentity: runRecord.datasetIdentity,
          evaluation,
          training: runRecord,
        };
        message(
          `Candidate ready. Teaching error ${result.loss.toFixed(4)}; try it to measure physical performance.`,
        );
      } finally {
        training = null;
        changed();
      }
    },
    cancel() {
      if (training) training.cancelled = true;
      message('Cancellation requested. Working controller preserved.');
    },
    async install() {
      const c = config();
      if (
        !candidate ||
        candidate.source !== learningIdentity(c.blueprint) ||
        candidate.controller !== c.id ||
        candidate.datasetIdentity !== learningIdentity(dataset(c))
      )
        throw Error('Candidate belongs to a different build. Train again or restore that build.');
      const installed = candidate;
      await command({ type: 'install-learning-model', id: c.id, model: installed.model });
      rememberTraining(installed.training);
      candidate = null;
      message('Candidate installed. Use Try it from Build. Undo restores the prior controller.');
    },
    async tryModel() {
      if (captureBlocked) throw Error('Save, export or discard the pending recording first.');
      const c = config();
      if (!c.model || readFrame().metadata.mode !== 'build')
        throw Error('Install a model and return to Build first.');
      beginAttempt(c, true);
      pendingHandover = { stage: 'waiting', attemptId: attempt.id };
      await command({ type: 'run' });
      message('Powering sensors before handover. Your driving keys remain available.');
    },
    async takeover() {
      const c = config();
      pendingHandover = false;
      for (const id of c.receiverIds) await command({ type: 'control', id, duty: 0 });
      message('Manual control. Press Teach to record a correction interval.');
    },
    ingest(observation) {
      if (captureBlocked || (!attempt && !recording)) return;
      if (!observation.ok) {
        if (attempt) attempt.incompleteReason = observation.reasonCode;
        try {
          finishInterval();
          finishAttempt();
        } catch (error) {
          captureBlocked = true;
          message(error.message, true);
          return;
        }
        message(
          'Recording stopped: completed history was unavailable. This attempt is incomplete.',
        );
        return;
      }
      try {
        const c = config();
        for (const f of observation.frames) {
          if (attempt && f.metadata.mode === 'run') {
            const evaluation = evaluateAttempt(attempt, f);
            captureBytes +=
              JSON.stringify(evaluation).length - JSON.stringify(attempt.evaluation).length;
            attempt.evaluation = evaluation;
          }
          if (f.metadata.mode !== 'run' || f.sensors.tick !== f.tick - 1) continue;
          const values = learningValues(c.inputs, f.sensors.readings);
          if (
            !values &&
            f.tick === 1 &&
            c.inputs.every((i) => f.power.sensors?.find((s) => s.node === i.node)?.powered)
          )
            continue;
          if (
            pendingHandover &&
            f.receiverControl.receivers.some(
              (r) =>
                c.outputs.some((o) => o.node === r.node) && r.mode === 'manual' && r.duty !== 0,
            )
          ) {
            pendingHandover = false;
            message('Manual input cancelled handover. Your keys own the receiver.');
          }
          if (pendingHandover?.stage === 'waiting' && values) {
            const request = pendingHandover;
            request.stage = 'arming';
            (async () => {
              for (const id of c.receiverIds) {
                if (
                  pendingHandover !== request ||
                  readFrame().metadata.mode !== 'run' ||
                  attempt?.id !== request.attemptId
                )
                  return;
                await command({ type: 'control-mode', id, mode: 'learned' });
              }
              if (pendingHandover === request) {
                pendingHandover = false;
                message('Handover requested. Your keys take over immediately.');
              }
            })().catch((error) => {
              if (pendingHandover === request) pendingHandover = false;
              message(error.message, true);
            });
          }
          if (pendingHandover && values) continue;
          const controls = c.outputs.map((o) =>
            f.receiverControl.receivers.find((r) => r.node === o.node),
          );
          if (!values || controls.some((r) => !r)) {
            if (attempt) {
              attempt.incompleteReason = 'SENSOR_UNAVAILABLE';
              attempt.fault = {
                tick: f.tick,
                inputs: c.inputs.map((i) => {
                  const r = f.sensors.readings.find((r) => r.node === i.node)?.channels[i.channel];
                  return {
                    port: i.port,
                    status: r?.status ?? 'disconnected',
                    ...(r?.status === 'ok' ? { value: r.value } : {}),
                  };
                }),
              };
            }
            finishInterval();
            finishAttempt();
            message(
              'Recording stopped: sensor unavailable. Attempt is incomplete; check target, range and wiring.',
            );
            break;
          }
          const targets = controls.map((r) => r.duty),
            previousSample = attempt?.samples.at(-1);
          const transient =
            c.inputs.some((input, index) => {
              const offset = input.encoding ? index * 4 : index;
              return (
                (['touching', 'normalLoad'].includes(input.channel) || input.encoding) &&
                previousSample &&
                (input.encoding
                  ? values
                      .slice(offset + 1, offset + 4)
                      .some((v, i) => v !== previousSample.values[offset + 1 + i]) ||
                    (['touching', 'normalLoad'].includes(input.channel) &&
                      values[offset] !== previousSample.values[offset])
                  : values[offset] !== previousSample.values[offset])
              );
            }) || previousSample?.targets.some((v, i) => v !== targets[i]);
          if (
            f.tick <= 0 ||
            (previousSample && f.tick % 6 !== 0 && !transient) ||
            (previousSample?.tick ?? 0) >= f.tick
          )
            continue;
          const sample = {
            tick: f.tick,
            values,
            targets,
            durationTicks: Math.min(120, Math.max(1, f.tick - (previousSample?.tick ?? 0))),
          };
          const historicalSample = {
            ...sample,
            modes: controls.map((r) => r.mode),
            physics: f.physics.map((b) => ({
              position: b.position,
              rotation: b.rotation,
              velocity: b.velocity,
            })),
          };
          const bytes = JSON.stringify(historicalSample).length + JSON.stringify(sample).length + 2;
          if (captureBytes + bytes > 4000000) {
            if (attempt) attempt.incompleteReason = 'STORAGE_LIMIT';
            finishInterval();
            finishAttempt();
            message('Recording storage limit reached. Export your work before recording more.');
            break;
          }
          captureBytes += bytes;
          if (attempt) attempt.samples.push(historicalSample);
          if (recording && controls.every((r) => r.mode === 'manual'))
            recording.samples.push(sample);
          if ((attempt?.samples.length ?? 0) >= 1200 || (recording?.samples.length ?? 0) >= 1200) {
            finishInterval();
            finishAttempt();
            message('Recording sample limit reached. Run controls remain available.');
            break;
          }
          if (cue && f.tick >= cue.tick - 120) cue = { ...cue, visible: true };
        }
        const latest = readFrame();
        if (attempt && latest.status === 'failed') attempt.incompleteReason = 'SIMULATION_FAILED';
        if (
          (attempt?.samples.length || recording?.samples.length) &&
          (latest.metadata.mode !== 'run' || latest.status === 'failed')
        ) {
          finishInterval();
          finishAttempt();
        }
        changed();
      } catch (error) {
        captureBlocked = true;
        message(error.message, true);
      }
    },
    inspectMoment(id, index) {
      const past = state.attempts.find((a) => a.id === id),
        row = past?.samples[index];
      if (!row) throw Error('Historical moment unavailable');
      const intervals =
        past.training?.dataset ??
        state.intervals.filter((r) => r.owner === past.owner).map(({ owner, ...r }) => r);
      return {
        ...inspectLearningMoment({
          model: past.model,
          inputs: past.inputs,
          outputs: past.outputs,
          values: row.values,
          intervals,
        }),
        provenance: past.training
          ? 'Examples frozen with this model'
          : 'Current examples; historical training provenance unavailable',
      };
    },
    compareAttempts(a, b) {
      return compareLearningAttempts(
        state.attempts.find((x) => x.id === a),
        state.attempts.find((x) => x.id === b),
      );
    },
    async returnToBuild(id, partId) {
      const past = state.attempts.find((a) => a.id === id);
      if (
        !past ||
        !past.blueprint.parts.some((p) => p.id === partId) ||
        !readFrame().metadata.blueprint.parts.some((p) => p.id === partId)
      )
        throw Error(
          'That component is no longer in this machine. Restore the saved start to inspect it.',
        );
      finishInterval();
      finishAttempt();
      await command({ type: 'build' });
      return partId;
    },
    async restart(id, tick) {
      const past = state.attempts.find((a) => a.id === id);
      if (!past) throw Error('Attempt unavailable.');
      if (learningIdentity(readFrame().metadata.blueprint) !== learningIdentity(past.blueprint))
        throw Error(
          'Different build or model. Restore this attempt’s saved start explicitly before retrying.',
        );
      finishInterval();
      finishAttempt();
      await command({ type: 'build' });
      selected = past.controller;
      cue = { tick, visible: false };
      if (past.model) await api.tryModel();
      else {
        beginAttempt(config());
        await command({ type: 'run' });
        message(
          'Manual retry: the original attempt had no frozen model. Drive to the selected moment, then Teach.',
        );
      }
    },
    async restoreAttempt(id) {
      const past = state.attempts.find((a) => a.id === id);
      if (!past) throw Error('Attempt unavailable.');
      await api.saveVersion('Before restoring attempt');
      finishAttempt();
      await command({ type: 'restore-build', save: past.blueprint });
      selected = past.controller;
      restoreTraining(past, past.controller);
      message('Saved start restored. Your prior build is in Saved versions.');
    },
    async saveVersion(name) {
      if (recording || training)
        throw Error('Stop teaching or cancel training before saving a version.');
      if (state.versions.length >= 12)
        throw Error('Version storage is full. Export or delete a saved version explicitly.');
      if (typeof name !== 'string' || !name.trim() || name.length > 128)
        throw Error('Choose a name of 1–128 characters.');
      const next = copy(state);
      next.versions.push({
        id: `version-${Date.now()}-${serial++}`,
        name,
        blueprint: copy(readFrame().metadata.blueprint),
        buildId,
        trainingController: selected,
        training: trainingFor(
          readFrame().metadata.blueprint.parts.find((p) => p.id === selected)?.learningModel,
        ),
      });
      persist(next);
      changed();
    },
    async restoreVersion(id) {
      const v = state.versions.find((v) => v.id === id);
      if (!v) throw Error('Version unavailable.');
      const loaded = loadSave(v.blueprint);
      if (!loaded.ok) throw Error(loaded.reasonCode);
      compileAssembly(loaded.blueprint);
      await api.saveVersion('Before restoring ' + v.name);
      finishAttempt();
      await command({ type: 'restore-build', save: v.blueprint });
      restoreTraining(v);
      changed();
    },
    reviseInterval(id, partition, weight) {
      if (recording || training) throw Error('Stop teaching or cancel training first.');
      if (
        !['train', 'validation', 'test'].includes(partition) ||
        !Number.isFinite(weight) ||
        weight < 0 ||
        weight > 100
      )
        throw Error('Choose a partition and weight from 0 to 100.');
      const next = copy(state),
        r = next.intervals.find((r) => r.id === id);
      if (!r) throw Error('Interval unavailable.');
      for (const interval of next.intervals)
        if (interval.owner === r.owner && interval.attemptId === r.attemptId)
          interval.partition = partition;
      r.weight = weight;
      persist(next);
      candidate = null;
      changed();
    },
    remove(kind, id) {
      if (recording || training) throw Error('Stop teaching or cancel training first.');
      if (!['intervals', 'attempts', 'versions'].includes(kind))
        throw Error('Invalid history kind');
      const next = copy(state);
      next[kind] = next[kind].filter((r) => r.id !== id);
      persist(next);
      candidate = null;
      changed();
    },
    async unlockWiring() {
      const c = config();
      await api.saveVersion('Before changing learning inputs');
      await command({ type: 'install-learning-model', id: c.id, model: null });
      message(
        'Working model saved. Change wiring, then record examples for the new inputs; old incomplete examples stay excluded.',
      );
    },
    async reuseModel(versionId, controllerId) {
      const version = state.versions.find((v) => v.id === versionId),
        model = version?.blueprint.parts.find((p) => p.id === controllerId)?.learningModel;
      if (!model) throw Error('Saved model unavailable.');
      const c = config();
      await command({ type: 'install-learning-model', id: c.id, model });
      const matching = version.blueprint.parts.filter(
        (p) => p.learningModel && learningIdentity(p.learningModel) === learningIdentity(model),
      );
      const origin = version.trainingController ?? (matching.length === 1 ? matching[0].id : null);
      rememberTraining(origin === controllerId ? version.training : null);
      message(
        'Saved model installed through the existing port bindings. Different mechanics may need new teaching.',
      );
    },
    importRecords(text) {
      if (recording || training) throw Error('Stop teaching or training first.');
      if (typeof text !== 'string' || text.length > 4000000)
        throw Error('Learning import too large.');
      const imported = checkedStore(JSON.parse(text)),
        next = copy(state);
      for (const kind of ['intervals', 'attempts', 'versions']) {
        for (const row of imported[kind]) {
          if (next[kind].some((x) => learningIdentity(x) === learningIdentity(row))) continue;
          if (next[kind].some((x) => x.id === row.id))
            throw Error(
              'An imported ID conflicts with a retained record. Existing work is preserved.',
            );
          next[kind].push(row);
        }
      }
      checkedStore(next);
      persist(next);
      candidate = null;
      changed();
    },
    exportLegacy: () => storage.getItem('simulacrum-learning-v1'),
    export: () =>
      storageUnreadable
        ? (storage.getItem('simulacrum-learning-v2') ?? storage.getItem('simulacrum-learning-v1'))
        : immutableCopy({
            ...state,
            intervals: [...state.intervals, ...(recording?.samples.length ? [recording] : [])],
            attempts: [
              ...state.attempts,
              ...(attempt?.samples.length
                ? [{ ...attempt, complete: true, incompleteReason: 'EXPORTED_DURING_ATTEMPT' }]
                : []),
            ],
          }),
    async discardPending() {
      captureBlocked = false;
      recording = null;
      attempt = null;
      cue = null;
      await command({ type: 'pause' });
      message('Unsaved recording discarded. Existing examples and versions are preserved.');
    },
    error: (error) =>
      message(
        {
          LEARNING_CANCELLED: 'Training cancelled. Your working controller is preserved.',
          EDIT_REQUIRES_BUILD: 'Return to Build before training, installing or restoring.',
          INVALID_CONTROLLER_CONFIGURATION:
            'The model does not match the connected input and output channels. Your working model is preserved.',
          DUPLICATE_LEARNING_INTERVAL:
            'These examples repeat an existing interval. Export or discard this unsaved recording, then explicitly change the existing interval weight if you want more influence.',
          LEARNING_TRAINING_LIMIT:
            'This dataset exceeds the training work limit. Exclude some intervals and train again.',
          NO_COMPLETE_TEACHING_EXAMPLES:
            'Record examples with all current sensor inputs before training.',
        }[error.message] ?? error.message,
        true,
      ),
    dispose() {
      if (training) training.cancelled = true;
    },
  };
  return Object.freeze(api);
}
