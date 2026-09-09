import { CATALOG } from '../model/catalog.mjs';
export function springInspector({ part, right, editable, element, send }) {
  const definition = CATALOG[part.type];
  if (part.type === 'springGuide' || part.type === 'springCarriage') {
    const live = element('p', 'spring-readout');
    right.append(live);
  }
  if (part.type === 'springGuide') {
    right.append(
      element(
        'p',
        'parameter-help',
        'Can you make this settle after one bounce? Change one setting in Build, then Run. Damping resists motion; stiffness supports weight. The long side mark shows zero-force length; short marks show the travel stops.',
      ),
    );
    for (const key of ['stiffness', 'damping', 'restLength', 'minLength', 'maxLength']) {
      const def = definition.parameterDefinitions[key],
        box = element('div', 'spring-setting');
      const names = {
        stiffness: 'Stiffness · Soft / Firm',
        damping: 'Damping · More bounce / Less bounce',
        restLength: 'Zero-force length',
        minLength: 'Minimum length',
        maxLength: 'Maximum length',
      };
      box.append(element('label', '', `${names[key]} (${def.unit})`));
      const input = element('input'),
        range = element('input'),
        notice = element('p', 'parameter-help');
      input.type = 'number';
      range.type = 'range';
      for (const control of [input, range]) {
        control.min = def.minimum;
        control.max = def.maximum;
        control.step =
          control === input ? 'any' : key.includes('Length') || key === 'restLength' ? '.001' : '1';
        control.value = part.parameters[key];
        control.disabled = !editable;
        control.setAttribute('aria-label', `${names[key]}${control === range ? ' slider' : ''}`);
      }
      notice.setAttribute('role', 'status');
      const invalidTravel = (value) => {
        const next = { ...part.parameters, [key]: Number(value) };
        return (
          next.minLength >= next.maxLength ||
          next.restLength < next.minLength ||
          next.restLength > next.maxLength
        );
      };
      const explainDraft = () => {
        notice.textContent = !input.checkValidity()
          ? `Choose ${def.minimum}–${def.maximum} ${def.unit}. Previous setting: ${part.parameters[key]}.`
          : invalidTravel(input.value)
            ? 'Keep minimum below maximum and zero-force length within travel. Previous settings kept.'
            : '';
      };
      input.oninput = explainDraft;
      range.oninput = () => {
        input.value = range.value;
        explainDraft();
      };
      const commit = async (control) => {
        if (!control.checkValidity()) {
          notice.textContent = `Choose ${def.minimum}–${def.maximum} ${def.unit}. Kept ${part.parameters[key]}.`;
          input.value = range.value = part.parameters[key];
          return;
        }
        const next = { ...part.parameters, [key]: Number(control.value) };
        if (
          next.minLength >= next.maxLength ||
          next.restLength < next.minLength ||
          next.restLength > next.maxLength
        ) {
          notice.textContent =
            'Keep minimum below maximum and zero-force length within travel. Previous settings kept.';
          input.value = range.value = part.parameters[key];
          return;
        }
        const result = await send({
          type: 'parameter',
          id: part.id,
          key,
          value: Number(control.value),
        });
        if (!result?.ok) {
          input.value = range.value = part.parameters[key];
          notice.textContent =
            'Keep minimum below maximum, and zero-force length within travel. Current assembled length must also fit. Previous settings are preserved.';
        }
      };
      for (const control of [input, range]) {
        control.onchange = () => commit(control);
        control.onkeydown = (e) => {
          if (e.key === 'Escape') {
            input.value = range.value = part.parameters[key];
            notice.textContent = '';
          }
        };
      }
      box.append(input, range, notice);
      right.append(box);
    }
    right.append(
      element(
        'p',
        'parameter-help',
        'Zero-force length is not the resting height under gravity: carriage and platform weight also compress the spring. Very high damping can settle slowly. Stops do not model breakage.',
      ),
    );
  }
}
