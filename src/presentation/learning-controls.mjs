import { inspectLearningPrediction } from '../model/learning-model.mjs';
const el = (tag, text = '', cls = '') => {
  const e = document.createElement(tag);
  e.textContent = text;
  e.className = cls;
  return e;
};
const readingText = (binding, values, index) => {
  const offset = binding.encoding ? index * 4 : index;
  if (binding.encoding && values[offset + 1] !== 1)
    return values[offset + 2] === 1 ? 'no return' : 'initializing';
  return `${values[offset].toFixed(3)} ${binding.unit}`;
};
const button = (text, run) => {
  const b = el('button', text);
  b.type = 'button';
  b.onclick = run;
  return b;
};
export function createLearningControls(root, api, { inspectPart = () => {} } = {}) {
  const panel = el('section', '', 'learning-workspace');
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Teach a controller');
  panel.dataset.partHelpInput = '';
  const header = el('header'),
    title = el('h2', 'Teach a controller'),
    body = el('div', '', 'learning-body'),
    status = el('p', '', 'learning-status'),
    liveReadout = el('p', '', 'learning-readings');
  const moments = new Map();
  status.setAttribute('role', 'status');
  let opener = null,
    openerId = null,
    signature = '',
    activeView = 'teach';
  const close = () => {
    panel.hidden = true;
    const target = opener?.isConnected
      ? opener
      : (root.querySelector(`[data-learning-opener="${openerId}"]`) ??
        root.querySelector('.machine-picker > summary'));
    target?.focus();
  };
  header.append(title, button('Close', close));
  panel.append(header, status, liveReadout, body);
  root.append(panel);
  const strip = el('div', '', 'learning-live');
  strip.hidden = true;
  const live = el('span');
  const invoke = (fn) =>
    Promise.resolve()
      .then(fn)
      .catch(api.error)
      .finally(() => refresh(true));
  const stopTeaching = button('Stop teaching', () => invoke(() => api.stop()));
  const cancelTraining = button('Cancel training', () => invoke(() => api.cancel()));
  strip.append(
    live,
    button('Take over', () => invoke(() => api.takeover())),
    stopTeaching,
    cancelTraining,
  );
  root.append(strip);
  panel.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const action = (label, fn, disabled = false) => {
    const b = button(label, () => invoke(fn));
    b.disabled = disabled;
    body.append(b);
    return b;
  };
  function render(s) {
    body.replaceChildren();
    title.textContent = s.config
      ? `Teach ${s.config.blueprint.parts.find((p) => p.id === s.selected)?.name}`
      : 'Teach a controller';
    const nav = el('nav');
    for (const [id, label] of [
      ['teach', 'Teach & try'],
      ['examples', 'Examples'],
      ['attempts', 'Inspect & compare'],
      ['versions', 'Saved versions'],
    ])
      nav.append(
        button(label, () => {
          activeView = id;
          refresh(true);
        }),
      );
    body.append(nav);
    if (!s.config) {
      body.append(el('p', 'Select a Learning Controller in the machine.'));
      return;
    }
    const c = s.config;
    if (activeView === 'teach') {
      body.append(
        el(
          'p',
          'Drive briefly with your normal keys, train in Build, then let your machine try. Change examples, sensors or the mechanism when it needs a repair.',
        ),
      );
      body.append(
        el(
          'p',
          `${c.inputs.length} wired inputs · ${c.outputs.length} outputs · ${s.data?.samples.length ?? 0} usable teaching samples. ${c.model ? 'A working model is installed.' : 'No model installed; keys still work.'}`,
        ),
      );
      for (const i of c.inputs)
        body.append(
          el(
            'p',
            `${i.port}: ${i.channel} (${i.unit}) · ${c.blueprint.parts[i.node].name}`,
            'parameter-help',
          ),
        );
      action(
        s.recording ? 'Teaching…' : 'Teach / record correction',
        () => api.teach(),
        s.recording || !!s.training,
      );
      action('Stop teaching', () => api.stop(), !s.recording);
      if (s.recording || s.captureBlocked)
        action('Discard this unsaved recording', () => api.discardPending());
      action(
        'Train candidate',
        () => api.train(),
        !!s.training || s.recording || !s.data?.samples.length,
      );
      if (s.training) action('Cancel training', () => api.cancel());
      if (s.candidate) {
        body.append(
          el(
            'p',
            `Candidate teaching error ${s.candidate.loss.toFixed(4)} · ${s.candidate.milliseconds.toFixed(0)} ms. This does not measure delivery success.`,
          ),
        );
        const e = s.candidate.evaluation;
        for (const partition of ['train', 'validation', 'test'])
          body.append(
            el(
              'p',
              `${partition}: ${e[partition] ? `${e[partition].loss.toFixed(4)} mean squared command error · ${e[partition].samples} samples` : 'No compatible reserved examples'}`,
            ),
          );
        body.append(
          el(
            'p',
            !e.test
              ? 'No reserved test attempts. Reserve fresh whole attempts to measure prediction error outside teaching.'
              : s.candidate.training.reusedTest
                ? 'Test examples were used in an earlier retained training/evaluation run. Treat these results as validation; record fresh reserved attempts for a final check.'
                : 'First recorded evaluation of these test examples. This does not prove unfamiliar physical performance. Deleted or imported history may be incomplete.',
          ),
        );
        action('Install candidate', () => api.install());
      }
      action('Try it', () => api.tryModel(), !c.model || !!s.training || s.recording);
      action('Take over', () => api.takeover());
      if (c.model) action('Save model and change wiring', () => api.unlockWiring());
      body.append(
        el(
          'p',
          'Return to Build with the ordinary Build control before training, installing or making a fresh attempt. Keys take over immediately; Teach records only your manual commands.',
        ),
      );
      if (c.model) {
        const details = el('details');
        details.append(el('summary', 'Probe the working model (no movement)'));
        const controls = c.model.inputs.map((i) => {
          const label = el('label', `${i.channel} (${i.unit}) `),
            input = el('input');
          input.type = 'number';
          input.value = '0';
          input.step = 'any';
          input.setAttribute('aria-label', `Probe ${i.channel}`);
          label.append(input);
          details.append(label);
          return input;
        });
        const result = el('pre');
        const probe = () => {
          try {
            const p = inspectLearningPrediction(
              c.model,
              controls.flatMap((i, index) =>
                c.model.inputs[index].encoding ? [Number(i.value), 1, 0, 0] : [Number(i.value)],
              ),
            );
            result.textContent = `Hypothetical command: ${p.output.map((v) => v.toFixed(3)).join(', ')}\nScaled inputs: ${p.inputs.map((v) => v.toFixed(3)).join(', ')}\nActual hidden activations: ${p.hidden.map((v) => v.toFixed(3)).join(', ')}`;
          } catch {
            result.textContent = 'Enter finite sensor values.';
          }
        };
        controls.forEach((i) => (i.oninput = probe));
        probe();
        details.append(result);
        body.append(details);
      }
    } else if (activeView === 'examples') {
      body.append(
        el(
          'p',
          'Every included teaching interval has equal total influence by default. Weight 0 excludes it. Repetition changes influence, not coverage. Reserve whole intervals before training.',
        ),
      );
      for (const r of s.intervals) {
        const card = el('section', '', 'learning-card'),
          contribution = s.data?.contributions.find((x) => x.id === r.id);
        card.append(
          el('strong', `${r.id} · ${r.samples.length} samples`),
          el(
            'p',
            contribution
              ? `${(contribution.weight * 100).toFixed(1)}% of training loss · ${contribution.seconds.toFixed(2)} seconds between first and last samples`
              : (() => {
                  const excluded = s.data?.excluded.find((x) => x.id === r.id);
                  return excluded
                    ? `${excluded.missing.length ? 'Missing ' + excluded.missing.join(', ') : 'Input definitions changed'}${excluded.outputsChanged ? ' · output bindings changed' : ''}. Record new compatible examples; old samples are preserved.`
                    : r.weight === 0
                      ? 'Excluded by weight 0.'
                      : `Reserved for ${r.partition}; excluded from training.`;
                })(),
          ),
        );
        const missing = s.data?.excluded.find((x) => x.id === r.id);
        if (missing)
          card.append(
            button(`Record ${missing.missing.join(' and ') || 'compatible'} examples`, () =>
              invoke(async () => {
                activeView = 'teach';
                await api.teach();
              }),
            ),
          );
        const partition = el('select');
        partition.setAttribute('aria-label', `Partition ${r.id}`);
        for (const value of ['train', 'validation', 'test']) {
          const o = el('option', value);
          o.value = value;
          partition.append(o);
        }
        partition.value = r.partition;
        const weight = el('input');
        weight.type = 'number';
        weight.min = 0;
        weight.max = 100;
        weight.step = 'any';
        weight.value = r.weight;
        weight.setAttribute('aria-label', `Weight ${r.id}`);
        card.append(
          partition,
          weight,
          button('Apply', () =>
            invoke(() => api.reviseInterval(r.id, partition.value, Number(weight.value))),
          ),
          button('Delete interval', () => invoke(() => api.remove('intervals', r.id))),
        );
        const table = el('details');
        table.append(el('summary', 'Recorded examples (full inputs)'));
        const sampleChoice = el('input');
        sampleChoice.type = 'range';
        sampleChoice.min = 0;
        sampleChoice.max = r.samples.length - 1;
        sampleChoice.value = 0;
        sampleChoice.setAttribute('aria-label', `Example sample ${r.id}`);
        const rows = el('pre');
        const showSample = () => {
          const x = r.samples[Number(sampleChoice.value)];
          let prediction = 'No compatible working model';
          try {
            if (c.model)
              prediction = inspectLearningPrediction(c.model, x.values)
                .output.map((v) => v.toFixed(3))
                .join(', ');
          } catch {}
          rows.textContent = `Sample ${Number(sampleChoice.value) + 1}/${r.samples.length} · t ${(x.tick / 120).toFixed(2)}
${r.inputs.map((i, j) => `${i.channel}: ${readingText(i, x.values, j)}`).join(' · ')}
Demonstrated: ${x.targets.map((v) => v.toFixed(3)).join(', ')}
Working-model prediction: ${missing ? 'Incompatible input definitions' : prediction}`;
        };
        sampleChoice.oninput = showSample;
        showSample();
        table.append(sampleChoice);
        table.append(rows);
        card.append(table);
        body.append(card);
      }
    } else if (activeView === 'attempts') {
      body.append(
        el(
          'p',
          'Historical attempts retain their exact starting build and model. Inspecting a moment never changes the live machine. Retry cues do not drive or record.',
        ),
      );
      for (const [attemptIndex, a] of s.attempts.entries()) {
        const card = el('section', '', 'learning-card');
        card.append(
          el(
            'strong',
            `Attempt ${attemptIndex + 1} · ${a.incompleteReason ? 'Incomplete · ' : ''}${a.model ? 'Frozen model' : 'Manual-only'} · ${(a.samples.at(-1)?.tick / 120 || 0).toFixed(1)} seconds`,
          ),
        );
        card.append(
          el(
            'p',
            a.model
              ? `Model: ${a.training?.id ?? 'Historical model; training record unavailable'}`
              : 'Model: manual-only',
          ),
        );
        if (a.fault)
          card.append(
            el(
              'p',
              `Historical sensor fault at ${(a.fault.tick / 120).toFixed(3)} s: ${a.fault.inputs.map((i) => i.port + ' ' + i.status).join(' · ')}. This frame was excluded from teaching.`,
            ),
          );
        const identity = el('details');
        identity.append(
          el('summary', 'Exact model and build'),
          el('pre', JSON.stringify({ model: a.model, blueprint: a.blueprint }, null, 2)),
        );
        card.append(identity);
        const delivery = a.evaluation?.outcome ?? {
          available: false,
          reason: 'No experiment evaluation was recorded.',
        };
        card.append(
          el(
            'p',
            delivery.available
              ? `${delivery.packageRetained ? 'Package retained' : 'Package lost'} · ${delivery.stoppedInBay ? 'Stopped in bay' : 'Not stopped in bay'} · speed ${delivery.speed.toFixed(3)} m/s · marker distance ${delivery.markerDistance.toFixed(3)} m · bay contact ticks ${delivery.bayContactTicks ?? 'unavailable'}`
              : delivery.reason,
          ),
        );
        const slider = el('input');
        slider.type = 'range';
        slider.min = 0;
        slider.max = Math.max(0, a.samples.length - 1);
        slider.value = Math.min(moments.get(a.id) ?? 0, a.samples.length - 1);
        slider.setAttribute('aria-label', `Historical moment ${a.id}`);
        const readout = el('p'),
          diagnosis = el('pre');
        const show = () => {
          const row = a.samples[Number(slider.value)];
          moments.set(a.id, Number(slider.value));
          if (row) {
            const d = api.inspectMoment(a.id, Number(slider.value));
            diagnosis.textContent = `${d.provenance}
${d.coverage}
${d.conflicts ? 'Conflicting commands at identical full inputs. Check teaching intent or missing sensing.' : 'No identical-input conflict found; this does not rule out missing information.'}
Historical-model prediction: ${d.prediction?.map((v) => v.toFixed(3)).join(', ') ?? 'Manual-only'}
${d.nearby.map((n) => `${n.intervalId}, sample ${n.index + 1}: distance ${n.distance.toFixed(3)} · full inputs [${n.values.map((v) => v.toFixed(3))}] · demonstrated [${n.targets.map((v) => v.toFixed(3))}]${n.prediction ? ' · prediction [' + n.prediction.map((v) => v.toFixed(3)) + ']' : ''}`).join('\n')}`;
          }

          readout.textContent = row
            ? `Historical t ${(row.tick / 120).toFixed(2)}: ${a.inputs.map((i, j) => `${i.channel} ${readingText(i, row.values, j)}`).join(' · ')} → ${row.targets.map((v) => v.toFixed(3)).join(', ')} (${row.modes.join(', ')})`
            : 'No samples';
        };
        slider.oninput = show;
        show();
        card.append(
          slider,
          readout,
          diagnosis,
          button(a.model ? 'Restart and teach a correction' : 'Restart manual attempt', () =>
            invoke(() => api.restart(a.id, a.samples[Number(slider.value)]?.tick ?? 0)),
          ),
          button('Restore this start (keeps current build)', () =>
            invoke(() => api.restoreAttempt(a.id)),
          ),
          button('Delete attempt', () => invoke(() => api.remove('attempts', a.id))),
        );
        const sensors = new Set(
          a.blueprint.connections
            .filter((e) => e.kind === 'signal' && e.b.part === a.controller)
            .map((e) => e.a.part),
        );
        for (const partId of [a.controller, ...sensors])
          card.append(
            button(
              `Build: inspect ${a.blueprint.parts.find((p) => p.id === partId)?.name ?? partId}`,
              () =>
                invoke(async () => {
                  await api.returnToBuild(a.id, partId);
                  close();
                  inspectPart(partId);
                }),
            ),
          );
        body.append(card);
      }
      if (s.attempts.length >= 2) {
        const choose = () => {
            const select = el('select');
            for (const [attemptIndex, a] of s.attempts.entries()) {
              const o = el(
                'option',
                `Attempt ${attemptIndex + 1} · ${a.model ? 'Model' : 'Manual'}`,
              );
              o.value = a.id;
              select.append(o);
            }
            return select;
          },
          first = choose(),
          second = choose();
        first.setAttribute('aria-label', 'First comparison attempt');
        second.setAttribute('aria-label', 'Second comparison attempt');
        second.selectedIndex = s.attempts.length - 1;
        const result = el('p');
        body.append(
          first,
          second,
          button('Compare attempts', () => {
            const comparison = api.compareAttempts(first.value, second.value);
            const describe = (x) =>
              `${x.id} · ${x.run ?? (x.modelIdentity ? 'Unrecorded model' : 'Manual-only')} · ${x.seconds.toFixed(2)} s · ${x.manualSamples} manual samples · ${x.outcome.available ? `${x.outcome.packageRetained ? 'cargo retained' : 'cargo lost'}, ${x.outcome.stoppedInBay ? 'stopped in bay' : 'not stopped in bay'}, marker distance ${x.outcome.markerDistance.toFixed(3)} m, bay-contact ticks ${x.outcome.bayContactTicks ?? 'unavailable'}` : x.outcome.reason}`;
            result.textContent = `${comparison.sameStart ? 'Matching authored starts.' : 'Different authored starts: ' + comparison.changes.join('; ')} ${comparison.sameModel ? 'Same model content.' : 'Different model content.'}\n${describe(comparison.first)}\n${describe(comparison.second)}\nManual takeover, duration and changed conditions can affect outcomes. Training error is not physical success.`;
          }),
          result,
        );
      }
    } else {
      const name = el('input');
      name.placeholder = 'Name this model and machine';
      name.maxLength = 128;
      name.setAttribute('aria-label', 'Saved version name');
      body.append(name);
      action('Save model and machine', () => api.saveVersion(name.value));
      for (const v of s.versions) {
        const card = el('section', '', 'learning-card');
        for (const p of v.blueprint.parts.filter((p) => p.learningModel))
          card.append(
            button(`Reuse model from ${p.name}`, () => invoke(() => api.reuseModel(v.id, p.id))),
          );
        if (v.training) {
          const details = el('details');
          details.append(
            el('summary', 'Training provenance'),
            el(
              'pre',
              JSON.stringify(
                {
                  id: v.training.id,
                  seed: v.training.seed,
                  epochs: v.training.epochs,
                  learningRate: v.training.learningRate,
                  milliseconds: v.training.milliseconds,
                  evaluation: v.training.evaluation,
                  reusedTest: v.training.reusedTest,
                  intervals: v.training.dataset.map((r) => ({
                    id: r.id,
                    attempt: r.attemptId,
                    partition: r.partition,
                    weight: r.weight,
                    samples: r.samples.length,
                  })),
                },
                null,
                2,
              ),
            ),
          );
          card.append(details);
        }
        card.append(
          el('strong', v.name),
          button('Restore (keeps current build)', () => invoke(() => api.restoreVersion(v.id))),
          button('Delete version', () => invoke(() => api.remove('versions', v.id))),
        );
        body.append(card);
      }
      action('Export all learning records', () => {
        const url = URL.createObjectURL(
            new Blob([JSON.stringify(api.export())], { type: 'application/json' }),
          ),
          a = el('a');
        a.href = url;
        a.download = 'learning-records.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      if (api.exportLegacy?.())
        action('Export original legacy records', () => {
          const url = URL.createObjectURL(
              new Blob([api.exportLegacy()], { type: 'application/json' }),
            ),
            a = el('a');
          a.href = url;
          a.download = 'learning-records-legacy-original.json';
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        });
      const file = el('input');
      file.type = 'file';
      file.accept = '.json,application/json';
      file.setAttribute('aria-label', 'Import learning records');
      file.onchange = () =>
        invoke(async () => {
          if (file.files[0].size > 4000000) throw Error('Learning import too large.');
          await api.importRecords(await file.files[0].text());
        });
      body.append(button('Import learning records', () => file.click()));
      body.append(
        el(
          'p',
          'Machine downloads contain the executable model. This separate export includes teaching intervals, attempts and saved versions. Saved versions are never silently evicted.',
        ),
      );
    }
  }
  function refresh(force = false) {
    const s = api.status();
    liveReadout.textContent = s.live
      ? `Measured at tick ${s.live.tick}: ${s.live.inputs.map((i) => `${i.channel} ${i.valid && Number.isFinite(i.value) ? i.value.toFixed(3) + ' ' + i.unit : (i.status ?? 'unavailable')}`).join(' · ')} → applied commands ${s.live.outputs.map((v) => (Number.isFinite(v) ? v.toFixed(3) : 'unavailable')).join(', ')}`
      : '';
    status.textContent = s.training
      ? `Training ${s.training.completed}/${s.training.total} updates · Cancel remains available.`
      : s.notice;
    live.textContent = s.training
      ? `Training ${s.training.completed}/${s.training.total}`
      : s.recording
        ? 'Teaching · keyboard control'
        : s.cue?.visible
          ? 'Correction cue · take over, then Teach when ready'
          : s.notice;
    if (s.activeAttempt && !s.recording && !s.training && !s.problem)
      live.textContent += ` · Control: ${[...new Set(s.controlModes)].join(', ')}`;
    strip.hidden = !(s.recording || s.activeAttempt || s.cue?.visible || s.training || s.problem);
    stopTeaching.hidden = !s.recording;
    cancelTraining.hidden = !s.training;
    if (panel.hidden) return;
    const next = JSON.stringify([
      s.selected,
      s.config?.model,
      s.config?.inputs,
      s.config?.outputs,
      s.intervals.map((r) => [r.id, r.weight, r.partition]),
      s.attempts.map((a) => a.id),
      s.versions.map((v) => v.id),
      !!s.training,
      !!s.candidate,
      s.recording,
      activeView,
    ]);
    if (force || next !== signature) {
      signature = next;
      render(s);
    }
  }
  return {
    open(id, from) {
      opener = from;
      openerId = id;
      if (api.select(id) === false) return;
      panel.hidden = false;
      refresh(true);
      header.querySelector('button').focus();
    },
    refresh,
    refreshVisible() {
      if (!panel.hidden) refresh();
    },
    dispose() {
      panel.remove();
      strip.remove();
    },
  };
}

export function targetSensorInspector({ part, blueprint, right, editable, send }) {
  if (part.type !== 'targetSensor') return;
  right.append(
    el(
      'p',
      'Paired centre-to-centre distance and approach speed. Select a target part. This sensor does not detect intervening obstacles. Outside range, readings are unavailable.',
      'parameter-help',
    ),
  );
  const label = el('label', 'Measured target'),
    select = el('select');
  select.setAttribute('aria-label', 'Measured target');
  const none = el('option', 'Choose target');
  none.value = '';
  select.append(none);
  for (const p of blueprint.parts.filter((p) => p.id !== part.id)) {
    const o = el('option', p.name);
    o.value = p.id;
    select.append(o);
  }
  select.value = part.targetBinding ?? '';
  select.disabled = !editable;
  select.onchange = () =>
    send({ type: 'bind-target-sensor', id: part.id, target: select.value || null });
  label.append(select);
  right.append(label);
}
