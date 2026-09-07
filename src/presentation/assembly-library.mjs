import { CATALOG } from '../model/catalog.mjs';
import { surfaceRegions } from '../model/surfaces.mjs';
import { partPrimitives } from '../model/geometry.mjs';
import { rotateVector, multiplyQuaternion } from '../model/transforms.mjs';
import { captureAssembly, insertAssembly } from '../model/reusable-assemblies.mjs';
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
        label: `${part.name} · ${region.label} (mount)`,
      })),
    ]);
}
function preview(bp) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${bp.name} layout preview`);
  const project = ([x, y, z]) => [x - z * 0.55, -y + (x + z) * 0.25];
  const shapes = bp.parts.flatMap((part) =>
    partPrimitives(part).map((shape) => {
      const points = [],
        localPoints = [];
      if (shape.kind === 'cylinder') {
        for (const x of [-1, 1])
          for (let step = 0; step < 32; step++) {
            const angle = (step * Math.PI) / 16;
            localPoints.push([
              x * shape.halfExtents[0],
              Math.cos(angle) * shape.halfExtents[1],
              Math.sin(angle) * shape.halfExtents[2],
            ]);
          }
      } else {
        for (const x of [-1, 1])
          for (const y of [-1, 1])
            for (const z of [-1, 1])
              localPoints.push([
                x * shape.halfExtents[0],
                y * shape.halfExtents[1],
                z * shape.halfExtents[2],
              ]);
      }
      for (const point of localPoints) {
        const local = rotateVector(shape.rotation, point).map((v, i) => v + shape.position[i]);
        points.push(
          project(rotateVector(part.rotation, local).map((v, i) => v + part.position[i])),
        );
      }
      return {
        points,
        color: { steel: 0x8198a1, aluminium: 0xa6bec7, rubber: 0x3c525b }[
          part.authoredMaterial[shape.id] ?? shape.materialKey
        ],
      };
    }),
  );
  const points = shapes.flatMap((s) => s.points),
    xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x = Math.min(...xs),
    y = Math.min(...ys),
    w = Math.max(0.1, Math.max(...xs) - x),
    h = Math.max(0.1, Math.max(...ys) - y),
    pad = Math.max(w, h) * 0.12;
  svg.setAttribute('viewBox', `${x - pad} ${y - pad} ${w + 2 * pad} ${h + 2 * pad}`);
  for (const shape of shapes) {
    // Convex projected box silhouette from authored primitive frames.
    const sorted = shape.points.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const half = (list) => {
      const out = [];
      for (const p of list) {
        while (out.length > 1 && cross(out.at(-2), out.at(-1), p) <= 0) out.pop();
        out.push(p);
      }
      return out.slice(0, -1);
    };
    const polygon = document.createElementNS(svg.namespaceURI, 'polygon');
    polygon.setAttribute(
      'points',
      [...half(sorted), ...half([...sorted].reverse())].map((p) => p.join(',')).join(' '),
    );
    polygon.setAttribute(
      'fill',
      typeof shape.color === 'number' ? `#${shape.color.toString(16).padStart(6, '0')}` : '#69a4b5',
    );
    polygon.setAttribute('stroke', '#d3e7ec');
    polygon.setAttribute('stroke-width', String(Math.max(w, h) * 0.006));
    svg.append(polygon);
  }
  return svg;
}

export function createAssemblyLibraryPanel({
  library,
  send,
  getCursor,
  select,
  getSelected,
  mount,
}) {
  const panel = node('details');
  panel.className = 'assembly-library';
  panel.append(node('summary', 'My assemblies'));
  const content = node('div'),
    status = node('p');
  status.setAttribute('role', 'status');
  panel.append(content, status);
  let frame,
    key = '',
    query = '',
    activeView = 'machine',
    draft = null,
    disposed = false;
  const say = (text) => {
    status.textContent = text;
  };
  const fail = (error) =>
    say(error.reasonCode ? explainFailure(error, frame.metadata.blueprint) : error.message);
  const bp = () => frame.metadata.blueprint;
  const editable = () => frame?.metadata.mode === 'build';
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
      source: JSON.stringify(bp()),
    };
    draw();
  }
  function create() {
    const candidate = getSelected();
    const selected = (bp().assemblies ?? []).some((group) => group.ids.includes(candidate))
      ? null
      : candidate;
    draft = {
      ids: new Set(selected ? [selected] : []),
      name: 'My assembly',
      ports: new Map(),
      source: JSON.stringify(bp()),
    };
    draw();
  }
  function drawDraft() {
    content.append(
      node('h3', draft.id ? 'Edit assembly' : 'Create assembly'),
      node('p', 'Choose parts, then name the connections to expose. Blank names stay internal.'),
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
      };
      label.append(box, node('span', part.name));
      members.append(label);
    }
    content.append(members);
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
    for (const entry of entries) {
      const label = node('label', entry.label),
        key = JSON.stringify(entry.endpoint),
        field = input(`Expose ${entry.label}`, draft.ports.get(key) ?? '');
      field.placeholder = 'External port name';
      field.maxLength = 128;
      field.oninput = () => draft.ports.set(key, field.value);
      label.append(field);
      content.append(label);
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
    content.append(
      button(draft.id ? 'Apply assembly changes' : 'Create and save assembly', async () => {
        if (!draft || draft.source !== JSON.stringify(bp())) {
          draft = null;
          draw();
          say('Machine changed. Choose the parts again.');
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
          if (draft.id) {
            if (await act({ type: 'edit-assembly', id: draft.id, ...spec })) {
              draft = null;
              draw();
              say('Assembly updated. Saved library snapshots keep their own contents.');
            }
            return;
          }
          const { definition } = captureAssembly(bp(), spec);
          if (!(await act({ type: 'create-assembly', ...spec }))) return;
          draft = null;
          try {
            library.add(definition);
            draw();
            say(`Saved ${spec.name}. Place an independent copy from My assemblies.`);
          } catch (error) {
            draw();
            fail(error);
            say(
              `${status.textContent} The assembly remains in this machine; use Save to library to retry.`,
            );
          }
        } catch (error) {
          fail(error);
        }
      }),
      button('Cancel assembly', () => {
        draft = null;
        draw();
      }),
    );
  }
  function poseFields(container, position, rotation, apply, actionLabel) {
    const fields = position.map((value, i) => {
      const field = input(`${actionLabel} ${'XYZ'[i]} (m)`, value, 'number');
      field.step = '0.05';
      const label = node('label', `${'XYZ'[i]} (m)`);
      label.append(field);
      container.append(label);
      return field;
    });
    container.append(
      button(actionLabel, () =>
        apply(
          fields.map((f) => Number(f.value)),
          rotation,
        ),
      ),
    );
    return fields;
  }
  function showInstance(group) {
    const section = node('details');
    section.className = 'assembly-instance';
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
          ? { kind: 'fixed' }
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
    const openGroups = [...content.querySelectorAll('.assembly-instance[open]')].map(
      (el) => el.dataset.assemblyId,
    );
    content.replaceChildren();
    if (draft) {
      drawDraft();
      return;
    }
    const createButton = button('Create assembly…', create);
    createButton.disabled = !editable() || !bp().parts.length;
    const navigation = node('div');
    navigation.className = 'assembly-navigation';
    const instances = node('div'),
      savedPane = node('div');
    instances.className = savedPane.className = 'assembly-workspace';
    const switchView = (view) => {
      activeView = view;
      instances.hidden = view !== 'machine';
      savedPane.hidden = view !== 'saved';
      for (const b of navigation.querySelectorAll('button[data-view]'))
        b.setAttribute('aria-pressed', String(b.dataset.view === view));
    };
    for (const [view, label] of [
      ['machine', 'In this machine'],
      ['saved', 'Saved assemblies'],
    ]) {
      const b = button(label, () => switchView(view));
      b.dataset.view = view;
      navigation.append(b);
    }
    content.append(navigation, createButton);
    for (const group of bp().assemblies ?? []) showInstance(group);
    for (const group of content.querySelectorAll('.assembly-instance'))
      group.open = openGroups.includes(group.dataset.assemblyId);
    instances.append(...content.querySelectorAll('.assembly-instance'));
    content.append(instances, savedPane);
    const search = input('Search my assemblies', query, 'search');
    search.placeholder = 'Search assemblies';
    savedPane.append(search);
    const list = node('div');
    savedPane.append(list);
    function items() {
      list.replaceChildren();
      try {
        const saved = library
          .list()
          .filter((item) => item.definition.name.toLowerCase().includes(query.toLowerCase()));
        if (!saved.length)
          list.append(node('p', 'No saved assemblies. Create one from parts in your machine.'));
        for (const item of saved) {
          const card = node('article');
          card.className = 'assembly-card';
          card.append(
            preview(item.definition),
            node('strong', item.definition.name),
            node(
              'small',
              `${item.definition.parts.length} parts · ${item.definition.assemblies[0].ports.map((p) => p.name).join(', ') || 'No exposed ports'}`,
            ),
          );
          const inspection = node('details');
          inspection.append(node('summary', 'Inspect saved parts'));
          const savedName = input(`Saved name ${item.definition.name}`, item.definition.name);
          inspection.append(
            savedName,
            button('Rename saved assembly', () => {
              try {
                library.rename(item.id, savedName.value.trim());
                items();
                say('Saved assembly renamed.');
              } catch (error) {
                fail(error);
              }
            }),
          );
          for (const part of item.definition.parts) {
            inspection.append(node('strong', part.name));
            for (const [key, value] of Object.entries(part.parameters))
              inspection.append(node('small', `${key}: ${value}`));
            if (part.type === 'commandReceiver') {
              const binding = part.controlBinding ?? DEFAULT_CONTROL_BINDING;
              for (const axis of ['drive', 'steer'])
                inspection.append(
                  node(
                    'small',
                    `${axis}: ${binding[axis].positiveKeys.join(', ') || 'none'} / ${binding[axis].negativeKeys.join(', ') || 'none'} · gain ${binding[axis].gain}`,
                  ),
                );
            }
          }
          card.append(inspection);
          const place = button(`Place ${item.definition.name}`, () => {
            const form = node('fieldset');
            form.append(node('legend', `Place ${item.definition.name}`));
            const source = item.definition.parts.find(
              (p) => p.id === item.definition.assemblies[0].ids[0],
            );
            const position = [...source.position];
            // Suggest the first admitted copy beside the current machine, using the real proposal.
            const right = Math.max(0, ...bp().parts.map((p) => p.position[0]));
            let proposal;
            for (let n = 1; n <= 30; n++) {
              position[0] = right + n;
              try {
                proposal = insertAssembly(bp(), item.definition, position, source.rotation);
                break;
              } catch {}
            }
            const cursor = getCursor();
            poseFields(
              form,
              position,
              source.rotation,
              async (p, r) => {
                if (
                  await act({
                    type: 'insert-assembly',
                    definition: item.definition,
                    position: p,
                    rotation: r,
                    expectedCursor: cursor,
                  })
                ) {
                  say(`Placed ${item.definition.name}. Inspect its ports and receiver keys below.`);
                }
              },
              'Insert assembly',
            );
            if (!proposal)
              form.append(
                node('p', 'Choose a clear position; placement is checked before insertion.'),
              );
            form.append(
              button('Cancel placement', () => {
                form.remove();
                place.disabled = !editable();
              }),
            );
            card.append(form);
            place.disabled = true;
          });
          place.disabled = !editable();
          card.append(
            place,
            button(`Remove saved ${item.definition.name}`, () => {
              try {
                library.remove(item.id);
                items();
                say('Removed the library item. Placed copies remain in the machine.');
              } catch (error) {
                fail(error);
              }
            }),
          );
          list.append(card);
        }
      } catch (error) {
        fail(error);
      }
    }
    search.oninput = () => {
      query = search.value;
      items();
    };
    items();
    switchView(activeView);
  }
  return {
    panel,
    update(next) {
      frame = next;
      const nextKey = JSON.stringify([next.metadata.blueprint, next.metadata.mode]);
      if (nextKey !== key) {
        key = nextKey;
        if (draft && (!editable() || draft.source !== JSON.stringify(bp()))) {
          draft = null;
          say('Assembly creation closed because the machine changed.');
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
