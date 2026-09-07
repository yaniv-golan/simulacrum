import { controlCommand } from '../model/workshop-command.mjs';
import { receiverControlOwner } from '../model/connection-test-paths.mjs';
import {
  CONTROL_KEYS,
  DEFAULT_CONTROL_BINDING,
  controlBindingPreset,
  evaluateControlBinding,
} from '../model/control-bindings.mjs';
const el = (tag, text = '', className = '') => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
const keyName = (code) =>
  ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' })[code] ??
  code.replace(/^Key|^Digit/, '');
const bindingOf = (part) => part.controlBinding ?? DEFAULT_CONTROL_BINDING;
const keysOf = (binding) =>
  ['drive', 'steer']
    .filter((axis) => binding[axis].gain !== 0)
    .flatMap((axis) => [...binding[axis].positiveKeys, ...binding[axis].negativeKeys]);
const keyText = (binding) =>
  ['drive', 'steer']
    .filter((axis) => binding[axis].gain !== 0)
    .map(
      (axis) =>
        `${binding[axis].positiveKeys.map(keyName).join('/')} / ${binding[axis].negativeKeys.map(keyName).join('/') || '—'}`,
    )
    .join(' · ');

// This owner maps browser inputs into ordinary receiver commands. It never
// reads physical poses or selects an actuator on behalf of a vehicle type.
export function createVehicleControls({ send, select, container }) {
  let frame,
    signature = '',
    sequence = Promise.resolve();
  const overrides = new Map(),
    pressed = new Set(),
    states = new Map(),
    duties = new Map(),
    rows = new Map();
  const panel = el('details', '', 'vehicle-controls');
  panel.append(el('summary', 'Machine controls'));
  const list = el('div');
  panel.append(list);
  container.append(panel);
  const receivers = () =>
    frame?.metadata.blueprint.parts.filter((p) => p.type === 'commandReceiver') ?? [];
  const owner = (id) => receiverControlOwner(frame.metadata.blueprint, id);
  const eligible = (id) => receivers().some((part) => part.id === id) && !owner(id);
  const enqueue = (command) => {
    sequence = sequence.then(() => {
      // A load or mode change may finish before an already queued key event.
      if (!eligible(command.id)) return;
      if (command.duty !== 0 && frame.metadata.mode !== 'run') return;
      return send(command);
    });
    return sequence;
  };
  function clear() {
    overrides.clear();
    pressed.clear();
    states.clear();
    for (const [id, duty] of duties) if (duty !== 0) enqueue(controlCommand(id, 0));
    duties.clear();
    return sequence;
  }
  function emit(id, duty) {
    if (!eligible(id) || (duties.get(id) ?? 0) === duty) return sequence;
    duties.set(id, duty);
    return enqueue(controlCommand(id, duty));
  }
  function apply() {
    for (const part of receivers()) {
      if (!eligible(part.id)) continue;
      const output = evaluateControlBinding(bindingOf(part), pressed, states.get(part.id));
      states.set(part.id, output.state);
      emit(part.id, overrides.get(part.id) ?? output.duty);
    }
  }
  function update(next) {
    const oldMode = frame?.metadata.mode;
    frame = next;
    if (oldMode === 'run' && frame.metadata.mode !== 'run') clear();
    for (const id of duties.keys())
      if (!eligible(id)) {
        duties.delete(id);
        overrides.delete(id);
        states.delete(id);
      }
    const parts = receivers(),
      blueprint = frame.metadata.blueprint;
    const nextSignature = JSON.stringify([parts, blueprint.connections, frame.metadata.mode]);
    if (nextSignature !== signature) {
      signature = nextSignature;
      rows.clear();
      list.replaceChildren();
      panel.hidden = parts.length === 0;
      if (frame.metadata.mode === 'run' && oldMode !== 'run') panel.open = true;
      list.append(
        el(
          'p',
          frame.metadata.mode === 'run'
            ? 'Use the listed keys · Space pauses'
            : 'Run to use these keys. Select an action to configure it.',
        ),
      );
      for (const part of parts) {
        const row = el('button', '', 'vehicle-control-row');
        row.type = 'button';
        row.onclick = () => select(part.id);
        const inverted = bindingOf(part).drive.gain < 0;
        const wired = blueprint.connections.some(
          (c) =>
            c.kind === 'signal' &&
            [c.a, c.b].some((end) => end.part === part.id && end.port === 'signal'),
        );
        row.append(
          el('strong', part.name),
          el(
            'span',
            owner(part.id) ? `Controlled by ${owner(part.id).name}` : keyText(bindingOf(part)),
          ),
          el(
            'small',
            owner(part.id)
              ? 'Wired controller owns this receiver · keyboard and manual input unavailable'
              : wired
                ? bindingOf(part).mode === 'toggle'
                  ? 'Toggle · resets when paused'
                  : `Hold · release sends zero${inverted ? ' · reversed drive' : ''}`
                : 'Not wired · connect Control output to a motor or hinge',
          ),
        );
        const level = el('output', '0');
        row.append(level);
        rows.set(part.id, level);
        list.append(row);
      }
    }
    for (const part of parts) {
      const index = blueprint.parts.findIndex((p) => p.id === part.id);
      const source = frame.power?.sources?.find((s) => s.node === index);
      if (rows.has(part.id))
        rows.get(part.id).textContent =
          frame.metadata.mode === 'paused' ? 'Paused' : source ? source.duty.toFixed(2) : '0';
    }
  }
  function keydown(event) {
    if (
      frame?.metadata.mode !== 'run' ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      document.querySelector('dialog[open]')
    )
      return;
    if (event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (!receivers().some((p) => eligible(p.id) && keysOf(bindingOf(p)).includes(event.code)))
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.repeat || pressed.has(event.code)) return;
    pressed.add(event.code);
    apply();
  }
  function keyup(event) {
    if (!pressed.has(event.code)) return;
    event.preventDefault();
    pressed.delete(event.code);
    apply();
  }
  function focus(event) {
    if (event.target.closest?.('input,textarea,select,[contenteditable="true"],dialog')) clear();
  }
  function visibility() {
    if (document.hidden) clear();
  }
  window.addEventListener('keydown', keydown, true);
  window.addEventListener('keyup', keyup, true);
  window.addEventListener('blur', clear);
  document.addEventListener('focusin', focus);
  document.addEventListener('visibilitychange', visibility);
  return {
    update,
    clear,
    canDrive: (id) => frame?.metadata.mode === 'run' && eligible(id),
    hold(id, duty) {
      if (frame?.metadata.mode !== 'run' || !eligible(id)) return;
      overrides.set(id, duty);
      return emit(id, duty);
    },
    releaseHold(id) {
      if (!overrides.delete(id)) return sequence;
      apply();
      return sequence;
    },
    drive(id, duty) {
      if (frame?.metadata.mode !== 'run' || !eligible(id)) return;
      states.delete(id);
      return emit(id, overrides.get(id) ?? duty);
    },
    inspector(part, target, editable) {
      const section = el('details', '', 'receiver-controls');
      section.append(el('summary', `Keyboard settings · ${keyText(bindingOf(part))}`));
      if (owner(part.id))
        section.append(
          el(
            'p',
            `Controlled by ${owner(part.id).name}. Keyboard and manual input are unavailable while its command wire is connected.`,
          ),
        );
      section.append(
        el(
          'p',
          'Name this receiver for its action. Connect Control output to a motor or hinge’s Control input.',
        ),
      );
      const binding = structuredClone(bindingOf(part));
      const save = (next) => send({ type: 'bind-control', id: part.id, binding: next });
      function dropdown(label, options, value, change) {
        const field = el('label', label),
          input = el('select');
        input.setAttribute('aria-label', label);
        input.disabled = !editable;
        for (const [id, text] of options) {
          const option = el('option', text);
          option.value = id;
          input.append(option);
        }
        input.value = value;
        input.onchange = () => change(input.value);
        field.append(input);
        section.append(field);
        return input;
      }
      dropdown(
        'Control preset',
        [
          ['', 'Custom configuration'],
          ['drive', 'Forward / reverse'],
          ['steer', 'Steering'],
          ['leftDrive', 'Left drive + steering'],
          ['rightDrive', 'Right drive + steering'],
          ['custom', 'Custom keys'],
        ],
        ['drive', 'steer', 'leftDrive', 'rightDrive', 'custom'].find((name) => {
          const preset = controlBindingPreset(name);
          return (
            JSON.stringify(preset.drive) === JSON.stringify(binding.drive) &&
            JSON.stringify(preset.steer) === JSON.stringify(binding.steer)
          );
        }) ?? '',
        (value) => {
          if (value) save(controlBindingPreset(value));
        },
      );
      section.append(el('p', `Keys: ${keyText(binding)}`, 'binding-summary'));
      dropdown(
        'Key behavior',
        [
          ['hold', 'Hold — release returns to zero'],
          ['toggle', 'Toggle — press again to stop'],
        ],
        binding.mode,
        (value) => save({ ...binding, mode: value }),
      );
      const reverse = el('button', 'Reverse output direction');
      reverse.type = 'button';
      reverse.disabled = !editable;
      reverse.onclick = () =>
        save({
          ...binding,
          drive: { ...binding.drive, gain: -binding.drive.gain },
          steer: { ...binding.steer, gain: -binding.steer.gain },
        });
      section.append(reverse);
      const advanced = el('details', '', 'receiver-key-mixing');
      advanced.append(el('summary', 'Edit keys & mixing'));
      section.append(advanced);
      const anchor = section;
      for (const axis of ['drive', 'steer']) {
        const group = el('div');
        advanced.append(group);
        const title = el('strong', axis === 'drive' ? 'Primary input' : 'Secondary input');
        group.append(title);
        for (const side of ['positiveKeys', 'negativeKeys']) {
          const label = el('label', side === 'positiveKeys' ? 'Positive key' : 'Negative key'),
            input = el('select');
          input.disabled = !editable;
          input.setAttribute(
            'aria-label',
            `${axis} ${side === 'positiveKeys' ? 'positive' : 'negative'} key`,
          );
          for (const code of ['', ...CONTROL_KEYS]) {
            const option = el('option', code ? keyName(code) : 'None');
            option.value = code;
            input.append(option);
          }
          input.value = binding[axis][side][0] ?? '';
          input.onchange = () =>
            save({
              ...binding,
              [axis]: { ...binding[axis], [side]: input.value ? [input.value] : [] },
            });
          label.append(input);
          group.append(label);
        }
        const label = el('label', 'Output strength'),
          input = el('input');
        input.type = 'number';
        input.min = '-1';
        input.max = '1';
        input.step = '0.1';
        input.value = String(binding[axis].gain);
        input.disabled = !editable;
        input.setAttribute('aria-label', `${axis} output strength`);
        input.onchange = () => {
          if (input.checkValidity())
            save({ ...binding, [axis]: { ...binding[axis], gain: Number(input.value) } });
        };
        label.append(input);
        group.append(label);
      }
      section.append(
        el(
          'small',
          'Shared keys intentionally operate every bound receiver. F frames the machine; Space pauses. Pausing or leaving the tab resets keyboard outputs. Zero command lets the mechanism coast; it is not a brake.',
        ),
      );
      target.append(anchor);
    },
    dispose() {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', clear);
      document.removeEventListener('focusin', focus);
      document.removeEventListener('visibilitychange', visibility);
      panel.remove();
    },
  };
}
