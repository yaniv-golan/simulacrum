import { mechanicalGroup } from '../model/connection-graph.mjs';
import { CATALOG } from '../model/catalog.mjs';
import { surfaceRegions } from '../model/surfaces.mjs';
import { multiplyQuaternion } from '../model/transforms.mjs';
import { captureAssembly } from '../model/reusable-assemblies.mjs';
import { DEFAULT_CONTROL_BINDING } from '../model/control-bindings.mjs';
import { explainFailure } from '../model/messages.mjs';

const node = (tag, text = '') => {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
};
function button(text, action) {
  const el = node('button', text);
  el.type = 'button';
  el.onclick = action;
  return el;
}
function input(label, value = '', type = 'text') {
  const el = node('input');
  el.type = type;
  el.value = String(value);
  el.setAttribute('aria-label', label);
  return el;
}
function endpoints(bp, ids) {
  return bp.parts
    .filter((part) => ids.includes(part.id))
    .flatMap((part) => [
      ...CATALOG[part.type].ports
        .filter((port) => port.kind !== 'fixed')
        .map((port) => ({
          endpoint: { part: part.id, port: port.id },
          kind: port.kind,
          direction: port.direction,
          label: `${part.name} · ${port.id} (${port.kind})`,
        })),
      ...surfaceRegions(part).map((region) => ({
        endpoint: { part: part.id, surface: { region: region.id, u: 0, v: 0, twist: 0 } },
        kind: 'fixed',
        label: `${part.name} · ${region.label} (${region.joint ? 'pin' : 'mount'})`,
      })),
    ]);
}
export function createAssemblyLibraryPanel({
  library,
  send,
  getCursor,
  select,
  getSelected,
  mount,
  onState = () => {},
}) {
  const panel = node('section');
  panel.className = 'assembly-library';
  panel.setAttribute('aria-label', 'Selected assembly');
  panel.hidden = true;
  const content = node('div'),
    status = node('p');
  status.setAttribute('role', 'status');
  panel.append(content, status);
  let frame,
    key = '',
    selectedId = null,
    pending = false,
    draft = null,
    disposed = false;
  const say = (text) => {
    status.textContent = text;
  };
  const fail = (error) =>
    say(error.reasonCode ? explainFailure(error, frame.metadata.blueprint) : error.message);
  const bp = () => frame.metadata.blueprint;
  const editable = () => frame?.metadata.mode === 'build';
  const identity = () => JSON.stringify([bp(), frame.metadata.mode, getCursor()]);
  async function act(command) {
    const reply = await send(command);
    if (!reply?.ok) {
      fail(reply ?? { message: 'Command failed' });
      return false;
    }
    return true;
  }
  function edit(group) {
    draft = {
      id: group.id,
      ids: new Set(group.ids),
      name: group.name,
      ports: new Map(group.ports.map((port) => [JSON.stringify(port.endpoint), port.name])),
      source: identity(),
    };
    draw();
    onState();
  }
  function create() {
    if (!editable() || draft || pending) return;
    const candidate = getSelected();
    const selected = (bp().assemblies ?? []).some((group) => group.ids.includes(candidate))
      ? null
      : candidate;
    draft = {
      ids: new Set(selected ? [selected] : []),
      name: 'My assembly',
      ports: new Map(),
      source: identity(),
    };
    draw();
    onState();
    panel.querySelector('input')?.focus();
  }
  function drawDraft() {
    content.append(
      node('h3', draft.id ? 'Edit assembly' : 'Create assembly'),
      node(
        'p',
        'Click parts in the machine or check them below. The first chosen part is the assembly origin.',
      ),
    );
    const name = input('Assembly name', draft.name);
    name.maxLength = 128;
    name.oninput = () => (draft.name = name.value);
    content.append(name);
    const members = node('fieldset');
    members.append(node('legend', 'Parts to include'));
    for (const part of bp().parts) {
      const label = node('label'),
        box = input(`Include ${part.name}`, '', 'checkbox');
      box.checked = draft.ids.has(part.id);
      box.disabled = (bp().assemblies ?? []).some(
        (g) => g.id !== draft.id && g.ids.includes(part.id),
      );
      box.onchange = () => {
        box.checked ? draft.ids.add(part.id) : draft.ids.delete(part.id);
        draw();
        onState();
        panel.querySelector(`[aria-label=${JSON.stringify('Include ' + part.name)}]`)?.focus();
      };
      label.append(
        box,
        node('span', part.name + (box.disabled ? ' · already in another assembly' : '')),
      );
      members.append(label);
    }
    content.append(members);
    const origin = bp().parts.find((p) => p.id === [...draft.ids][0]);
    content.append(
      node(
        'p',
        origin
          ? `Origin: ${origin.name} · highlighted in amber. Removing it uses the next selected part.`
          : 'Choose the first part to set the assembly origin.',
      ),
    );

    const entries = endpoints(bp(), [...draft.ids]);
    // Keep authored noncentral aliases when editing a loaded definition.
    for (const key of draft.ports.keys()) {
      const endpoint = JSON.parse(key);
      if (
        draft.ids.has(endpoint.part) &&
        !entries.some((entry) => JSON.stringify(entry.endpoint) === key)
      ) {
        const base = entries.find(
          (entry) =>
            entry.endpoint.part === endpoint.part &&
            entry.endpoint.surface?.region === endpoint.surface?.region,
        );
        if (base)
          entries.push({
            ...base,
            endpoint,
            label: `${base.label} · ${endpoint.surface.u}, ${endpoint.surface.v}, ${endpoint.surface.twist}`,
          });
      }
    }
    const ports = node('details');
    ports.append(node('summary', 'Named connection points'));
    content.append(ports);
    for (const entry of entries) {
      const label = node('label', entry.label),
        key = JSON.stringify(entry.endpoint),
        field = input(`Expose ${entry.label}`, draft.ports.get(key) ?? '');
      field.placeholder = 'External port name';
      field.maxLength = 128;
      field.oninput = () => draft.ports.set(key, field.value);
      label.append(field);
      ports.append(label);
    }
    const crossing = bp().connections.filter(
      (e) => draft.ids.has(e.a.part) !== draft.ids.has(e.b.part),
    );
    content.append(
      node(
        'p',
        `${crossing.length} outside connection(s) will need reconnecting on new copies. Existing machine connections stay in place.`,
      ),
    );
    for (const edge of crossing)
      content.append(
        node(
          'small',
          `${bp().parts.find((part) => part.id === edge.a.part).name} ↔ ${bp().parts.find((part) => part.id === edge.b.part).name} · ${edge.kind}`,
        ),
      );
    content.append(
      node(
        'p',
        'Receiver keys are copied unchanged. Copies with the same keys respond together until you edit their bindings.',
      ),
    );
    if (draft.source !== identity()) {
      content.append(
        node('p', 'Machine changed. Revalidate your selected parts before applying.'),
        button('Revalidate assembly', () => {
          draft.ids = new Set(
            [...draft.ids].filter(
              (id) =>
                bp().parts.some((p) => p.id === id) &&
                !(bp().assemblies ?? []).some((g) => g.id !== draft.id && g.ids.includes(id)),
            ),
          );
          if (draft.id && !(bp().assemblies ?? []).some((g) => g.id === draft.id)) {
            say('This assembly no longer exists. Cancel to create a new one.');
            return;
          }
          draft.source = identity();
          draw();
          onState();
        }),
      );
    }
    content.append(
      button(draft.id ? 'Apply assembly changes' : 'Create and save assembly', async () => {
        if (pending || !editable() || !draft || draft.source !== identity()) {
          say('Revalidate the assembly before applying.');
          return;
        }
        const spec = {
          name: draft.name.trim(),
          ids: [...draft.ids],
          ports: entries
            .filter((e) => draft.ports.get(JSON.stringify(e.endpoint))?.trim())
            .map((e) => ({
              name: draft.ports.get(JSON.stringify(e.endpoint)).trim(),
              endpoint: e.endpoint,
            })),
        };
        try {
          pending = true;
          for (const field of content.querySelectorAll('input, select, button'))
            field.disabled = true;
          say('Applying assembly…');
          onState();
          if (draft.id) {
            if (await act({ type: 'edit-assembly', id: draft.id, ...spec })) {
              selectedId = draft.id;
              draft = null;
              draw();
              say('Assembly updated. Saved library snapshots keep their own contents.');
            }
            return;
          }
          const { definition } = captureAssembly(bp(), spec);
          if (!(await act({ type: 'create-assembly', ...spec }))) return;
          selectedId =
            (bp().assemblies ?? []).find(
              (g) => g.ids.length === spec.ids.length && g.ids.every((id) => spec.ids.includes(id)),
            )?.id ?? null;
          draft = null;
          try {
            library.add(definition);
            draw();
            say(`Saved ${spec.name}. Place an independent copy from Saved assemblies.`);
          } catch (error) {
            draw();
            fail(error);
            say(
              `${status.textContent} The assembly remains in this machine; use Save to library to retry.`,
            );
          }
        } catch (error) {
          fail(error);
        } finally {
          pending = false;
          draw();
          onState();
        }
      }),
      button('Cancel assembly', () => {
        if (pending) return;
        draft = null;
        draw();
        onState();
      }),
    );
  }
  function poseFields(container, position, rotation, apply, actionLabel) {
    const fields = position.map((value, i) => {
      const field = input(
        `${actionLabel} ${'XYZ'[i]} (m)`,
        Number(value.toPrecision(12)),
        'number',
      );
      field.step = '0.05';
      const label = node('label', `${'XYZ'[i]} (m)`);
      label.append(field);
      container.append(label);
      return field;
    });
    container.append(
      button(actionLabel, () =>
        apply(
          fields.map((f, i) =>
            f.value === String(Number(position[i].toPrecision(12))) ? position[i] : f.valueAsNumber,
          ),
          rotation,
        ),
      ),
    );
    return fields;
  }
  function showInstance(group) {
    const section = node('details');
    section.className = 'assembly-instance';
    section.open = true;
    section.dataset.assemblyId = group.id;
    section.append(node('summary', `${group.name} · ${group.ids.length} parts`));
    section.append(
      node(
        'p',
        'Group actions include mechanically attached parts. Open an internal part to edit or diagnose it.',
      ),
    );
    for (const id of group.ids) {
      const part = bp().parts.find((p) => p.id === id);
      section.append(button(`Inspect ${part.name}`, () => select(id)));
      if (part.type === 'commandReceiver') {
        const binding = part.controlBinding ?? DEFAULT_CONTROL_BINDING;
        const keys = [
          ...new Set(
            ['drive', 'steer'].flatMap((axis) =>
              binding[axis].gain
                ? [...binding[axis].positiveKeys, ...binding[axis].negativeKeys]
                : [],
            ),
          ),
        ];
        section.append(
          node(
            'small',
            `Keys for ${part.name}: ${keys.join(', ') || 'none'}. Inspect to change this instance’s binding.`,
          ),
        );
      }
    }
    for (const alias of group.ports) {
      const row = node('div');
      row.className = 'assembly-port';
      row.append(node('strong', alias.name));
      const endpoint = alias.endpoint,
        part = bp().parts.find((p) => p.id === endpoint.part),
        port = endpoint.surface
          ? {
              kind: surfaceRegions(part).find((r) => r.id === endpoint.surface.region)?.joint
                ? 'pivot'
                : 'fixed',
            }
          : CATALOG[part.type].ports.find((p) => p.id === endpoint.port);
      row.append(node('small', `${part.name} · ${endpoint.port ?? endpoint.surface.region}`));
      const links = bp().connections.filter((e) =>
        [e.a, e.b].some(
          (p) =>
            p.part === endpoint.part &&
            (endpoint.surface
              ? p.surface &&
                ['region', 'u', 'v', 'twist'].every(
                  (key) => p.surface[key] === endpoint.surface[key],
                )
              : p.port === endpoint.port),
        ),
      );
      const peerLabel = (edge) => {
        const peer = edge.a.part === endpoint.part ? edge.b : edge.a;
        return `${bp().parts.find((part) => part.id === peer.part).name} · ${peer.port ?? peer.surface.region}`;
      };
      row.append(
        node(
          'small',
          links.length ? `Connected to ${links.map(peerLabel).join(', ')}` : 'Unconnected',
        ),
      );
      const target = node('select');
      const placeholder = node('option', 'Choose a connection…');
      placeholder.value = '';
      target.append(placeholder);
      target.setAttribute('aria-label', `Connect ${group.name} ${alias.name} to`);
      const rawChoices = endpoints(
        bp(),
        bp()
          .parts.filter((p) => !group.ids.includes(p.id))
          .map((p) => p.id),
      ).filter(
        (e) => e.kind === port.kind && (port.kind !== 'signal' || e.direction !== port.direction),
      );
      const namedChoices = (bp().assemblies ?? [])
        .filter((g) => g.id !== group.id)
        .flatMap((g) =>
          g.ports.flatMap((alias) => {
            const entry = rawChoices.find(
              (entry) =>
                entry.endpoint.part === alias.endpoint.part &&
                (alias.endpoint.surface
                  ? entry.endpoint.surface?.region === alias.endpoint.surface.region
                  : entry.endpoint.port === alias.endpoint.port),
            );
            return entry
              ? [
                  {
                    ...entry,
                    endpoint: alias.endpoint,
                    label: `${g.name} · ${alias.name} (${entry.kind === 'fixed' ? 'mount' : entry.kind})`,
                  },
                ]
              : [];
          }),
        );
      const choices = [
        ...namedChoices,
        ...rawChoices.filter(
          (entry) =>
            !namedChoices.some(
              (named) => JSON.stringify(named.endpoint) === JSON.stringify(entry.endpoint),
            ),
        ),
      ];
      for (const [i, entry] of choices.entries()) {
        const option = node('option', entry.label);
        option.value = String(i);
        target.append(option);
      }
      const connect = button(`Connect ${alias.name}`, async () => {
        const destination = choices[Number(target.value)]?.endpoint;
        if (!destination) return;
        if (endpoint.surface && destination.surface && mount) {
          mount(group, alias, destination);
          return;
        }
        let n = 1;
        while (bp().connections.some((e) => e.id === `assembly-link-${n}`)) n++;
        if (
          await act({
            type: 'connect-assembly',
            id: group.id,
            portName: alias.name,
            target: destination,
            connectionId: `assembly-link-${n}`,
          })
        )
          say(`Connected ${alias.name}.`);
      });
      connect.disabled = true;
      target.onchange = () => {
        connect.disabled = !editable() || target.value === '';
      };
      target.disabled = !editable();
      row.append(target, connect);
      for (const link of links) {
        const disconnect = button(`Disconnect ${alias.name} from ${peerLabel(link)}`, () =>
          act({ type: 'disconnect', id: link.id }),
        );
        disconnect.disabled = !editable();
        row.append(disconnect);
      }
      section.append(row);
    }
    const controls = node('fieldset');
    controls.append(button(`Edit ${group.name}`, () => edit(group)));
    controls.disabled = !editable();
    const origin = bp().parts.find((p) => p.id === group.ids[0]);
    const movement = new Set(group.ids.flatMap((id) => mechanicalGroup(bp(), id)));
    controls.append(
      node(
        'p',
        `Move and rotate affect ${movement.size} highlighted parts, including mechanical connections.`,
      ),
    );
    poseFields(
      controls,
      origin.position,
      origin.rotation,
      async (position, rotation) => {
        if (await act({ type: 'transform-assembly', id: group.id, position, rotation }))
          say(`Moved ${group.name}.`);
      },
      `Move ${group.name}`,
    );
    controls.append(
      button(`Rotate ${group.name} 90°`, () =>
        act({
          type: 'transform-assembly',
          id: group.id,
          position: origin.position,
          rotation: multiplyQuaternion([0, Math.SQRT1_2, 0, Math.SQRT1_2], origin.rotation),
        }),
      ),
      button('Save to library', () => {
        try {
          library.add(
            captureAssembly(bp(), { name: group.name, ids: group.ids, ports: group.ports })
              .definition,
          );
          draw();
          say(`Saved a new library copy of ${group.name}.`);
        } catch (error) {
          fail(error);
        }
      }),
      button(`Ungroup ${group.name}`, () => act({ type: 'ungroup-assembly', id: group.id })),
    );
    section.append(controls);
    content.append(section);
  }
  function draw() {
    if (disposed || !frame) return;
    content.replaceChildren();
    panel.hidden = !draft && !(bp().assemblies ?? []).some((g) => g.id === selectedId);
    if (draft) {
      drawDraft();
      if (pending)
        for (const field of content.querySelectorAll('input, select, button'))
          field.disabled = true;
      return;
    }
    const group = (bp().assemblies ?? []).find((g) => g.id === selectedId);
    if (group) showInstance(group);
  }
  return {
    panel,
    create,
    busy: () => !!draft || pending,
    drafting: () => !!draft,
    selected: () =>
      (frame?.metadata.blueprint.assemblies ?? []).some((g) => g.id === selectedId)
        ? selectedId
        : null,
    contextual: () => !panel.hidden,
    members: () =>
      draft
        ? [...draft.ids]
        : ((bp()?.assemblies ?? []).find((g) => g.id === selectedId)?.ids ?? []),
    selectGroup(id) {
      if (draft || pending) return;
      selectedId = id;
      draw();
      onState();
    },
    selectPart() {
      selectedId = null;
      draw();
    },
    toggle(id) {
      if (
        !draft ||
        pending ||
        !id ||
        !editable() ||
        (bp().assemblies ?? []).some((g) => g.id !== draft.id && g.ids.includes(id))
      )
        return;
      draft.ids.has(id) ? draft.ids.delete(id) : draft.ids.add(id);
      draw();
      onState();
    },
    cancel() {
      if (pending) return;
      draft = null;
      draw();
      onState();
    },
    update(next) {
      frame = next;
      const nextKey = JSON.stringify([
        next.metadata.blueprint,
        next.metadata.mode,
        draft ? getCursor() : null,
      ]);
      if (nextKey !== key) {
        key = nextKey;
        if (draft && (!editable() || draft.source !== identity())) {
          say('Machine changed. Your draft is retained; revalidate before applying.');
        }
        draw();
      }
    },
    dispose() {
      disposed = true;
      panel.remove();
    },
  };
}
