import { surfaceRegions } from '../model/surfaces.mjs';
import { ROPE_MATERIALS, ROPE_LIMITS } from '../model/rope.mjs';
/** Selected-part controls submit one ordinary atomic connection edit. */
export function ropeInspector({
  part,
  blueprint,
  right,
  editable,
  element,
  send,
  requested = false,
}) {
  const own = blueprint.connections.filter(
    (c) => c.kind === 'rope' && [c.a.part, c.b.part].includes(part.id),
  );
  if (!requested && !own.length) return;
  const panel = element('details', 'rope-controls');
  panel.append(element('summary', '', 'Rope'));
  const help = element(
    'p',
    'parameter-help',
    'Attach two surfaces and choose a length. Rope pulls when stretched and hangs slack. It passes through the floor, bodies and other ropes: no wrapping or knots. Overload stops the run; it does not break the rope. Rope is hidden in exploded view; return to Machine view to inspect its shape.',
  );
  panel.append(help);
  const form = (edge = null) => {
    const box = element('fieldset', 'rope-editor');
    box.disabled = !editable;
    box.append(element('legend', '', edge ? 'Edit rope' : 'Attach rope'));
    const candidates = blueprint.parts.filter((p) => surfaceRegions(p).length);
    const input = (label, control) => {
      const wrap = element('label', 'rope-field', label);
      control.setAttribute('aria-label', label);
      wrap.append(control);
      box.append(wrap);
      return control;
    };
    const select = (label, options, value) => {
      const control = element('select');
      for (const [id, name] of options) {
        const o = element('option', '', name);
        o.value = id;
        control.append(o);
      }
      control.value = value;
      return input(label, control);
    };
    const a = select(
      'Rope end A',
      candidates.map((p) => [p.id, p.name]),
      edge?.a.part ?? part.id,
    );
    const b = select(
      'Rope end B',
      candidates.map((p) => [p.id, p.name]),
      edge?.b.part ?? candidates.find((p) => p.id !== part.id)?.id ?? '',
    );
    const faceA = select('End A surface', [], ''),
      faceB = select('End B surface', [], '');
    const faces = (control, target, binding) => {
      control.replaceChildren();
      const p = candidates.find((p) => p.id === target.value);
      if (!p) return;
      for (const r of surfaceRegions(p)) {
        const o = element('option', '', r.id);
        o.value = r.id;
        control.append(o);
      }
      if (binding?.surface) control.value = binding.surface.region;
    };
    faces(faceA, a, edge?.a);
    faces(faceB, b, edge?.b);
    a.onchange = () => faces(faceA, a);
    b.onchange = () => faces(faceB, b);
    const number = (label, value, min, max, step = 'any') => {
      const control = element('input');
      control.type = 'number';
      control.value = value;
      control.min = min;
      control.max = max;
      control.step = step;
      return input(label, control);
    };
    const length = number(
      'Rope length (m)',
      edge?.rope.restLength ?? 1,
      ROPE_LIMITS.minLength,
      ROPE_LIMITS.maxLength,
    );
    const diameter = number(
      'Rope diameter (m)',
      edge?.rope.diameter ?? 0.02,
      ROPE_LIMITS.minDiameter,
      ROPE_LIMITS.maxDiameter,
    );
    const material = select(
      'Rope material',
      Object.entries(ROPE_MATERIALS).map(([id, m]) => [id, m.name]),
      edge?.rope.material ?? 'nylon',
    );
    const engineering = element(
      'p',
      'parameter-help',
      'Simplified nylon model; 0.25–4 m and up to 4 ropes. Surface centres are used for new attachments. Stretch, damping and load limits are model assumptions, not calibrated product ratings.',
    );
    box.append(engineering);
    const notice = element('p', 'parameter-help');
    notice.setAttribute('role', 'status');
    const save = element('button', '', edge ? 'Apply rope changes' : 'Attach rope');
    save.type = 'button';
    save.onclick = async () => {
      if (
        !length.checkValidity() ||
        !diameter.checkValidity() ||
        !a.value ||
        !b.value ||
        a.value === b.value
      ) {
        notice.textContent = 'Choose two different parts and valid length and diameter.';
        return;
      }
      notice.textContent = '';
      const endpoint = (control, face, old) =>
        old && old.part === control.value && old.surface.region === face.value
          ? structuredClone(old)
          : { part: control.value, surface: { region: face.value, u: 0, v: 0, twist: 0 } };
      let id = edge?.id;
      if (!id) {
        let i = 1;
        while (blueprint.connections.some((c) => c.id === 'rope-' + i)) i++;
        id = 'rope-' + i;
      }
      const result = await send({
        type: 'rope',
        connection: {
          id,
          kind: 'rope',
          a: endpoint(a, faceA, edge?.a),
          b: endpoint(b, faceB, edge?.b),
          rope: {
            restLength: Number(length.value),
            diameter: Number(diameter.value),
            segments: edge?.rope.segments ?? 8,
            material: material.value,
          },
        },
      });
      if (!result?.ok)
        notice.textContent =
          'Could not attach. Keep length near or above the endpoint distance, use valid surfaces, and keep at most four ropes. Previous settings are preserved.';
    };
    box.append(save, notice);
    panel.append(box);
  };
  for (const edge of own) {
    const heading = element('p', '', `Rope · ${edge.id}`);
    panel.append(heading);
    const live = element('p', 'rope-readout');
    live.dataset.ropeId = edge.id;
    panel.append(live);
    if (editable) form(edge);
    const remove = element('button', 'quiet', 'Remove rope');
    remove.disabled = !editable;
    remove.onclick = () => send({ type: 'disconnect', id: edge.id });
    panel.append(remove);
  }
  if (
    editable &&
    surfaceRegions(part).length &&
    blueprint.parts.some((p) => p.id !== part.id && surfaceRegions(p).length)
  )
    form();
  else if (!own.length)
    panel.append(
      element(
        'p',
        'parameter-help',
        'Place two parts with flat surfaces, then select either one to attach a rope.',
      ),
    );
  right.append(panel);
}
