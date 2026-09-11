import { portLabel } from './port-wording.mjs';
import { controllerDecision } from '../model/controller-decision.mjs';
import { decisionText } from './controller-history.mjs';
import {
  emptyControllerProgram,
  editControllerDraft,
  admitControllerAuthoring,
  generateRules,
  generateRuleSource,
} from '../model/controller-authoring.mjs';
const el = (tag, text = '') => {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
};
export function createControllerEditor({ send }) {
  const drafts = new Map();
  return {
    mount({ part, blueprint, right, editable }) {
      if (part.type !== 'logicController') return;
      const key = blueprint.id + ':' + part.id,
        installed = part.controllerProgram ?? emptyControllerProgram();
      let entry = drafts.get(key);
      if (!entry) {
        entry = { draft: installed, past: [], installed: JSON.stringify(installed) };
        drafts.set(key, entry);
        try {
          const saved = JSON.parse(localStorage.getItem('simulacrum-controller-draft-v1:' + key));
          if (saved?.installed === entry.installed && saved.draft?.version === 1) {
            entry.draft = admitControllerAuthoring(saved.draft);
            entry.past = (saved.past ?? []).slice(-50).map(admitControllerAuthoring);
            if (typeof saved.rawSource === 'string' && saved.rawSource.length > 16384)
              entry.rawSource = saved.rawSource;
          }
        } catch {}
      }
      if (entry.installed !== JSON.stringify(installed)) {
        entry.draft = installed;
        delete entry.rawSource;
        entry.past = [];
        entry.installed = JSON.stringify(installed);
      }
      const box = el('section');
      box.className = 'controller-editor';
      box.append(el('h3', 'Controller behavior'));
      const message = el('p');
      message.setAttribute('role', 'status');
      const live = el('p');
      live.className = 'controller-live';
      live.dataset.controllerId = part.id;
      const body = el('div');
      box.append(live, body, message);
      right.append(box);
      const commitDraft = (next, force = false) => {
        if (!force && JSON.stringify(next) === JSON.stringify(entry.draft)) return true;
        try {
          localStorage.setItem(
            'simulacrum-controller-draft-v1:' + key,
            JSON.stringify({
              installed: entry.installed,
              draft: next,
              past: [...entry.past, entry.draft].slice(-50),
            }),
          );
          entry.past.push(entry.draft);
          if (entry.past.length > 50) entry.past.shift();
          entry.draft = next;
          message.textContent = 'Draft saved. Apply in Build to change the machine.';
          return true;
        } catch {
          message.textContent =
            'Draft could not be saved. Your installed program and saved code are unchanged.';
          return false;
        }
      };
      const change = (action, highlightIndex) => {
        try {
          if (commitDraft(editControllerDraft(entry.draft, action))) render(highlightIndex);
        } catch (error) {
          message.textContent = error.message;
        }
      };
      const button = (text, fn) => {
        const b = el('button', text);
        b.type = 'button';
        b.onclick = fn;
        b.disabled =
          !editable ||
          (entry.rawSource !== undefined && ['Apply program', 'Restore rules'].includes(text));
        return b;
      };
      function render(highlightIndex) {
        body.replaceChildren();
        const draft =
          entry.rawSource === undefined
            ? entry.draft
            : { ...entry.draft, mode: 'code', source: entry.rawSource };
        if (entry.rawSource !== undefined)
          message.textContent =
            'Code exceeds 16,384 characters. Shorten it to apply, export it, or Undo. Rules are disabled.';
        box.dataset.generatedSource = draft.mode === 'rules' ? draft.source : '';
        body.append(
          el(
            'p',
            draft.mode === 'code'
              ? 'Rules are disabled because the code was edited. Restore rules to use them again; your edited code will be saved.'
              : 'Rules generate the TypeScript shown below. Editing that code switches this draft to Code mode.',
          ),
        );
        const fieldset = el('fieldset');
        fieldset.disabled = !editable || draft.mode !== 'rules';
        fieldset.append(
          el('legend', draft.mode === 'code' ? 'Last rules version (historical)' : 'Simple rules'),
        );
        const choices = [];
        for (const edge of blueprint.connections.filter((c) => c.kind === 'signal')) {
          const own = [edge.a, edge.b].find((e) => e.part === part.id);
          if (own && (own.port.startsWith('input') || own.port === 'signal')) {
            const other = edge.a === own ? edge.b : edge.a;
            choices.push({
              port: own.port === 'signal' ? 'input1' : own.port,
              label:
                (blueprint.parts.find((p) => p.id === other.part)?.name ?? other.part) +
                ' · ' +
                portLabel(
                  blueprint.parts.find((p) => p.id === other.part),
                  { id: other.port, kind: 'signal' },
                ),
            });
          }
        }
        const outputs = blueprint.connections
          .filter((c) => c.kind === 'signal')
          .flatMap((c) =>
            [c.a, c.b]
              .filter((e) => e.part === part.id && e.port?.startsWith('out'))
              .map((e) => (e.port === 'out' ? 'out1' : e.port)),
          );
        if (!choices.length || !outputs.length)
          fieldset.append(
            el(
              'p',
              'Wire a sensor output to an input and a controller output to a receiver to create a rule.',
            ),
          );
        draft.rules.forEach((rule, index) => {
          const row = el('div');
          row.className = 'controller-rule';
          row.dataset.ruleIndex = index;
          const select = (label, values, current, onchange) => {
            const l = el('label', label),
              s = el('select');
            s.setAttribute('aria-label', label + ' ' + (index + 1));
            for (const v of values) {
              const o = el('option', v.label ?? v);
              o.value = v.port ?? v;
              s.append(o);
            }
            s.value = current;
            s.onchange = () => onchange(s.value);
            l.append(s);
            row.append(l);
          };
          const update = (k, v) =>
            change(
              {
                type: 'rules',
                rules: draft.rules.map((r, i) => {
                  if (i !== index) return r;
                  const next = { ...r, [k]: v };
                  if (v === undefined) delete next[k];
                  return next;
                }),
              },
              { index, key: k },
            );
          select('When', choices, rule.input, (v) => update('input', v));
          select(
            'Condition type',
            [
              { port: 'value', label: 'Measured value' },
              { port: 'ok', label: 'Reading ready' },
              { port: 'no-return', label: 'No object detected' },
              { port: 'initializing', label: 'Waiting for a second reading' },
            ],
            rule.status ?? 'value',
            (v) => update('status', v === 'value' ? undefined : v),
          );
          select('Comparison', ['<', '<=', '>', '>=', '===', '!=='], rule.operator, (v) =>
            update('operator', v),
          );
          for (const [key, label] of [
            ['threshold', 'Threshold'],
            ['duty', 'Then duty'],
            ['otherwise', 'Otherwise duty'],
          ]) {
            const l = el('label', label),
              n = el('input');
            n.type = 'number';
            n.step = 'any';
            n.value = rule[key];
            n.setAttribute('aria-label', label + ' ' + (index + 1));
            n.disabled = key === 'threshold' && rule.status !== undefined;
            n.onfocus = () => {
              if (key !== 'threshold' || draft.mode !== 'rules' || rule.status !== undefined)
                return;
              details.open = true;
              code.setSelectionRange(...generateRuleSource(draft.rules).rules[index].threshold);
            };
            n.onchange = () => update(key, Number(n.value));
            l.append(n);
            row.append(l);
          }
          select('Command', outputs, rule.output, (v) => update('output', v));
          row.append(
            button('Show rule in code', () => {
              details.open = true;
              code.focus();
              const [start, end] = generateRuleSource(draft.rules).rules[index].block;
              code.setSelectionRange(start, end);
              code.scrollTop = index * 10 * 18;
            }),
            button('Remove rule', () =>
              change({ type: 'rules', rules: draft.rules.filter((_, i) => i !== index) }),
            ),
          );
          fieldset.append(row);
        });
        for (const [name, operator, threshold, duty, otherwise] of [
          ['Touch → reverse', '>', 0.5, -0.4, 0.4],
          ['Close → slow', '<', 1, 0.15, 0.5],
          ['Tilt → stop', '>', 0.3, 0, 0.3],
        ]) {
          const b = button(name, () =>
            change({
              type: 'rules',
              rules: [
                ...draft.rules,
                {
                  input: choices[0].port,
                  operator,
                  threshold,
                  output: outputs.find((o) => !draft.rules.some((r) => r.output === o)),
                  duty,
                  otherwise,
                },
              ],
            }),
          );
          b.disabled =
            fieldset.disabled ||
            !choices.length ||
            !outputs.some((o) => !draft.rules.some((r) => r.output === o));
          fieldset.append(b);
        }
        body.append(fieldset);
        const details = el('details'),
          summary = el('summary', 'Code · TypeScript');
        details.append(summary);
        const modeNotice = el(
          'p',
          draft.mode === 'code'
            ? 'Rules are disabled because the code was edited. Restore rules to use them again.'
            : 'This is the code generated by your rules.',
        );
        modeNotice.className = 'controller-mode-notice';
        details.append(modeNotice);
        const code = el('textarea');
        code.rows = 12;
        code.value = draft.source;
        code.spellcheck = false;
        code.setAttribute('aria-label', 'Controller TypeScript');
        code.disabled = !editable;
        code.oninput = () => {
          if (code.value.length > 16384) {
            entry.rawSource = code.value;
            let saved = true;
            try {
              localStorage.setItem(
                'simulacrum-controller-draft-v1:' + key,
                JSON.stringify({
                  installed: entry.installed,
                  draft: entry.draft,
                  past: entry.past,
                  rawSource: entry.rawSource,
                }),
              );
            } catch {
              saved = false;
            }
            const selection = [code.selectionStart, code.selectionEnd];
            render();
            const replacement = body.querySelector('textarea');
            replacement.closest('details').open = true;
            replacement.focus();
            replacement.setSelectionRange(...selection);
            if (!saved) message.textContent += ' Storage is unavailable; export before closing.';
            return;
          }
          const wasInvalid = entry.rawSource !== undefined;
          try {
            const next = editControllerDraft(entry.draft, { type: 'code', source: code.value });
            delete entry.rawSource;
            if (commitDraft(next, wasInvalid)) {
              fieldset.disabled = true;
              box.dataset.generatedSource = '';
              box.querySelectorAll('[data-rule-index]').forEach((row) => {
                row.removeAttribute('data-fired');
                row.style.outline = '';
              });
              modeNotice.textContent =
                'Rules are disabled because the code was edited. Restore rules to use them again.';
              message.textContent =
                'Rules disabled because the code was edited. Apply this draft in Build, or restore rules.';
            } else {
              entry.past.push(entry.draft);
              if (entry.past.length > 50) entry.past.shift();
              entry.draft = next;
              fieldset.disabled = true;
              box.dataset.generatedSource = '';
              modeNotice.textContent =
                'Code edited. This draft is only in this open session because storage is unavailable. Export it before closing.';
            }
            if (wasInvalid) {
              render();
              const replacement = body.querySelector('textarea');
              replacement.closest('details').open = true;
              replacement.focus();
            }
          } catch (error) {
            message.textContent = error.message;
          }
        };
        details.append(
          code,
          el(
            'p',
            'Use read("input1"), valid("input1"), status("input1"), write("out1", duty), numeric state, and if/else. Status: 0 ready, 1 no power, 2 no return, 3 initializing, 4 unavailable, 5 disconnected.',
          ),
        );
        body.append(details);
        body.append(
          button('Undo draft edit', () => {
            if (entry.rawSource !== undefined) {
              try {
                localStorage.setItem(
                  'simulacrum-controller-draft-v1:' + key,
                  JSON.stringify({
                    installed: entry.installed,
                    draft: entry.draft,
                    past: entry.past,
                  }),
                );
                delete entry.rawSource;
                render();
              } catch {
                message.textContent = 'Could not save the undo. Draft unchanged.';
              }
              return;
            }
            const previous = entry.past.at(-1);
            if (!previous) return;
            try {
              localStorage.setItem(
                'simulacrum-controller-draft-v1:' + key,
                JSON.stringify({
                  installed: entry.installed,
                  draft: previous,
                  past: entry.past.slice(0, -1),
                }),
              );
              entry.past.pop();
              entry.draft = previous;
              render();
            } catch {
              message.textContent = 'Could not save the undo. Draft unchanged.';
            }
          }),
          button('Export code draft', () => {
            const url = URL.createObjectURL(
                new Blob([entry.rawSource ?? entry.draft.source], { type: 'text/plain' }),
              ),
              a = el('a');
            a.href = url;
            a.download = 'controller.ts';
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }),
          button('Restore rules', () => {
            const confirmation = el('div');
            confirmation.setAttribute('role', 'group');
            confirmation.append(
              el(
                'p',
                'Replace this draft with the last rules version? Your current code will be kept in Saved code.',
              ),
              button('Keep editing code', () => {
                confirmation.remove();
                code.focus();
              }),
              button('Restore and save code', () => change({ type: 'restore-rules' })),
            );
            body.append(confirmation);
            confirmation.querySelector('button').focus();
          }),
          button('Apply program', async () => {
            if (entry.rawSource !== undefined) return;
            const candidate = entry.draft;
            const result = await send({
              type: 'install-controller-program',
              id: part.id,
              program: candidate,
            });
            message.textContent = result?.ok
              ? 'Program installed. Run, then enable Automatic on its receiver. Your keys take over immediately.'
              : `Program was not installed. ${result?.path ?? result?.message ?? 'Check the code and wiring.'} The last installed program is preserved.`;
          }),
        );
        if (draft.savedCode.length) {
          const saved = el('details');
          saved.append(el('summary', 'Saved code before restoring rules'));
          draft.savedCode.forEach((source, i) => {
            const pre = el('pre', source);
            pre.setAttribute('aria-label', 'Saved code ' + (i + 1));
            saved.append(
              pre,
              button('Export saved code ' + (i + 1), () => {
                const url = URL.createObjectURL(new Blob([source], { type: 'text/plain' })),
                  a = el('a');
                a.href = url;
                a.download = 'controller-saved-' + (i + 1) + '.ts';
                a.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
              }),
              button('Delete saved code ' + (i + 1), () => {
                const next = structuredClone(entry.draft);
                next.savedCode.splice(i, 1);
                if (commitDraft(next)) render();
              }),
            );
          });
          body.append(saved);
        }
        if (highlightIndex && draft.mode === 'rules') {
          details.open = true;
          const mapping = generateRuleSource(draft.rules).rules[highlightIndex.index];
          code.setSelectionRange(...(mapping[highlightIndex.key] ?? mapping.block));
        }
      }
      render();
    },
  };
}

export function updateControllerEditor(frame, right) {
  const element = right.querySelector('.controller-live');
  if (!element) return;
  const node = frame.metadata.blueprint.parts.findIndex(
      (p) => p.id === element.dataset.controllerId,
    ),
    part = frame.metadata.blueprint.parts[node],
    sample = frame.programs?.find((p) => p.node === node);
  const editor = element.closest('.controller-editor');
  const mapped =
    part?.controllerProgram?.mode === 'rules' &&
    editor.dataset.generatedSource === part.controllerProgram.source;
  editor.querySelectorAll('[data-rule-index]').forEach((row) => {
    const marker = sample?.markers.find((i) => Math.floor(i / 2) === Number(row.dataset.ruleIndex));
    row.dataset.fired =
      mapped && marker !== undefined ? (marker % 2 ? 'otherwise' : 'condition') : '';
    row.style.outline = row.dataset.fired ? '1px solid #e7ae50' : '';
  });
  const decision = controllerDecision(frame, element.dataset.controllerId);
  element.textContent =
    !sample || !decision ? 'Run to see the installed program’s decisions.' : decisionText(decision);
}
