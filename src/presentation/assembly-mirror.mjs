import { explainFailure } from '../model/messages.mjs';
const node = (tag, text, className) => {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  if (className) el.className = className;
  return el;
};

/** Explicit copy scope. Reference selection never changes workshop selection. */
export function createAssemblyMirror({
  propose,
  send,
  showPreview,
  clearPreview,
  changed,
  getCursor,
  completed = () => {},
}) {
  const panel = node('section', '', 'assembly-mirror');
  panel.setAttribute('aria-label', 'Mirror parts');
  let previewCursor,
    frame,
    selection,
    referenceId,
    axis = 'x',
    ids = new Set(),
    result;
  function cancel() {
    selection = null;
    result = null;
    clearPreview();
    changed();
  }
  function start(next, selected) {
    frame = next;
    previewCursor = JSON.stringify(getCursor());
    selection = selected;
    axis = 'x';
    ids = new Set([selected]);
    const bp = frame.metadata.blueprint;
    let grew = true;
    while (grew) {
      grew = false;
      for (const edge of bp.connections.filter((c) => c.kind === 'shaft')) {
        if (ids.has(edge.a.part) !== ids.has(edge.b.part)) {
          ids.add(edge.a.part);
          ids.add(edge.b.part);
          grew = true;
        }
      }
    }
    const mount = bp.connections.find(
      (c) => c.kind === 'fixed' && ids.has(c.a.part) !== ids.has(c.b.part),
    );
    referenceId = mount
      ? ids.has(mount.a.part)
        ? mount.b.part
        : mount.a.part
      : bp.parts.find((p) => !ids.has(p.id))?.id;
    draw();
    changed();
  }
  function command() {
    return {
      type: 'mirror-assembly',
      ids: [...ids],
      referenceId,
      axis,
      expectedCursor: getCursor(),
    };
  }
  function draw() {
    panel.replaceChildren();
    const bp = frame.metadata.blueprint;
    panel.append(
      node('h3', 'Mirror parts'),
      node('p', 'Choose only the parts to copy. The reference stays in place.', 'parameter-help'),
    );
    const refLabel = node('label', 'Mirror across'),
      ref = node('select');
    ref.setAttribute('aria-label', 'Mirror reference');
    for (const part of bp.parts) {
      const option = node('option', part.name);
      option.value = part.id;
      option.selected = part.id === referenceId;
      ref.append(option);
    }
    ref.onchange = () => {
      referenceId = ref.value;
      ids.delete(referenceId);
      draw();
    };
    refLabel.append(ref);
    panel.append(refLabel);
    const planeLabel = node('label', 'Reference center plane'),
      plane = node('select');
    plane.setAttribute('aria-label', 'Mirror plane');
    for (const [value, label] of [
      ['x', 'Left ↔ right'],
      ['y', 'Top ↔ bottom'],
      ['z', 'Front ↔ back'],
    ]) {
      const option = node('option', label);
      option.value = value;
      option.selected = value === axis;
      plane.append(option);
    }
    plane.onchange = () => {
      axis = plane.value;
      draw();
    };
    planeLabel.append(plane);
    panel.append(planeLabel);
    const group = node('fieldset', '', 'mirror-members');
    group.append(node('legend', `Copy ${ids.size} ${ids.size === 1 ? 'part' : 'parts'}`));
    for (const part of bp.parts) {
      const label = node('label'),
        box = node('input');
      box.type = 'checkbox';
      box.checked = ids.has(part.id);
      box.disabled = part.id === referenceId;
      box.setAttribute('aria-label', `Mirror ${part.name}`);
      box.onchange = () => {
        box.checked ? ids.add(part.id) : ids.delete(part.id);
        draw();
      };
      label.append(box, document.createTextNode(part.name));
      group.append(label);
    }
    panel.append(group);
    const status = node('p', '', 'mirror-status');
    status.setAttribute('role', 'status');
    const confirm = node('button', 'Create mirrored copy'),
      stop = node('button', 'Cancel');
    confirm.type = stop.type = 'button';
    let proposalCommand;
    try {
      proposalCommand = command();
      result = propose(bp, proposalCommand);
      const copies = result.blueprint.parts.filter((p) => result.copiedIds.includes(p.id));
      showPreview(
        copies,
        bp.parts.find((p) => p.id === referenceId),
        axis,
      );
      const omitted = result.omittedExternalConnectionIds.length;
      status.textContent = `Preview · ${copies.length} new parts. ${omitted ? `${omitted} outside wire/connection(s) will need reconnecting.` : 'Internal connections and mounts to the reference are copied.'} Settings stay unchanged; test direction after mirroring.`;
    } catch (error) {
      result = null;
      clearPreview();
      confirm.disabled = true;
      status.textContent = explainFailure(error, error.previewBlueprint ?? bp);
      status.classList.add('blocked');
    }
    confirm.onclick = async () => {
      const copyCount = result.copiedIds.length,
        omittedCount = result.omittedExternalConnectionIds.length;
      const reply = await send(proposalCommand);
      if (reply?.ok) {
        cancel();
        completed(
          `Created ${copyCount} mirrored parts. ${omittedCount ? `Reconnect ${omittedCount} external connection(s). ` : ''}Test the copied drive direction; settings were preserved.`,
        );
      } else {
        status.textContent = explainFailure(reply ?? {}, bp);
      }
    };
    stop.onclick = cancel;
    panel.append(status);
    if (result?.omittedExternalConnectionIds.length) {
      const details = node('details'),
        summary = node('summary', 'Connections to reconnect');
      details.append(summary);
      for (const id of result.omittedExternalConnectionIds) {
        const edge = bp.connections.find((c) => c.id === id);
        const name = (endpoint) =>
          bp.parts.find((p) => p.id === endpoint.part)?.name ?? endpoint.part;
        details.append(node('p', `${name(edge.a)} ↔ ${name(edge.b)} · ${edge.kind}`));
      }
      panel.append(details);
    }
    panel.append(confirm, stop);
  }
  function update(next) {
    if (
      selection &&
      (next.metadata.mode !== 'build' ||
        JSON.stringify(getCursor()) !== previewCursor ||
        JSON.stringify(next.metadata.blueprint) !== JSON.stringify(frame.metadata.blueprint))
    )
      cancel();
    frame = next;
  }
  return { panel, start, cancel, update, active: () => !!selection };
}
