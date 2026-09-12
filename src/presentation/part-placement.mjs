import { CATALOG } from '../model/catalog.mjs';
import { createPart } from '../model/blueprint.mjs';
import { palettePlacement } from '../model/palette-placement.mjs';
import { validatePlacementGeometry } from '../model/surfaces.mjs';
import { createPlacementLifecycle } from './placement-lifecycle.mjs';

// This owner keeps a proposal only. The ordinary command path admits authored changes.
export function createPartPlacement({
  getFrame,
  getCursor,
  preview,
  clear,
  send,
  before,
  cancelled,
  finished,
  placed,
  surface,
}) {
  const panel = document.createElement('section');
  panel.className = 'part-placement';
  panel.dataset.partHelpInput = '';
  panel.setAttribute('aria-label', 'Place part');
  panel.hidden = true;
  const title = document.createElement('strong');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const fields = document.createElement('div');
  fields.className = 'placement-coordinates';
  const inputs = ['X', 'Y', 'Z'].map((axis) => {
    const label = document.createElement('label');
    label.textContent = `${axis} (m)`;
    const input = document.createElement('input');
    input.type = 'number';
    input.step = '0.025';
    input.setAttribute('aria-label', `${axis} position`);
    input.oninput = () =>
      move(
        inputs.map((item) => (item.value === '' ? NaN : Number(item.value))),
        false,
      );
    label.append(input);
    fields.append(label);
    return input;
  });
  const precise = document.createElement('details');
  const preciseLabel = document.createElement('summary');
  preciseLabel.textContent = 'Precise position';
  precise.append(preciseLabel, fields);
  const confirm = document.createElement('button');
  confirm.textContent = 'Place part';
  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel placement';
  const another = document.createElement('button');
  another.textContent = 'Place another';
  another.hidden = true;
  panel.append(title, status, precise, confirm, another, cancelButton);
  const lifecycle = createPlacementLifecycle();
  let partType = null,
    identity = null,
    cursor = null,
    position = null;
  const key = () =>
    JSON.stringify([getFrame()?.metadata.mode, getFrame()?.metadata.blueprint, getCursor()]);
  function start(type, { focus = true } = {}) {
    if (getFrame()?.metadata.mode !== 'build' || lifecycle.read().kind === 'committing') return;
    before();
    partType = type;
    identity = key();
    cursor = structuredClone(getCursor());
    lifecycle.begin();
    panel.hidden = false;
    fields.hidden = false;
    precise.hidden = false;
    precise.open = false;
    confirm.hidden = false;
    another.hidden = true;
    title.textContent = `Place ${CATALOG[type].name}`;
    cancelButton.textContent = 'Cancel placement';
    try {
      move(palettePlacement(getFrame().metadata.blueprint, type, 'catalog-preview').position);
    } catch {
      move([0, 0.4, 0]);
    }
    if (focus) confirm.focus({ preventScroll: true });
  }
  function move(next, updateFields = true) {
    if (!active() || lifecycle.read().kind === 'committing') return;
    panel.hidden = false;
    position = next;
    if (updateFields)
      inputs.forEach((input, index) => {
        input.value = String(Number(next[index].toFixed(3)));
      });
    const finite = next.every(Number.isFinite);
    const part = finite ? createPart(partType, 'catalog-preview', next) : null;
    let valid = Boolean(part && identity === key());
    if (valid) {
      try {
        validatePlacementGeometry({
          ...getFrame().metadata.blueprint,
          parts: [...getFrame().metadata.blueprint.parts, part],
        });
      } catch {
        valid = false;
      }
    }
    lifecycle.assess(valid ? part : null);
    confirm.disabled = !valid;
    status.textContent = valid
      ? 'Preview · Click the workbench or Place part to confirm. Esc cancels.'
      : identity !== key()
        ? 'The machine changed. Cancel and choose the part again.'
        : finite
          ? 'Overlaps another part. Move the preview clear.'
          : 'Enter a number for each position.';
    if (part) preview(part, valid);
    else clear();
  }
  async function commit() {
    if (identity !== key()) {
      refresh();
      return;
    }
    const mounting = surface?.read()?.target;
    if (mounting) lifecycle.assess(surface.read().valid ? surface.read() : null);
    const token = lifecycle.commit();
    if (token === null) return;
    confirm.disabled = true;
    cancelButton.disabled = true;
    inputs.forEach((input) => {
      input.disabled = true;
    });
    status.textContent = 'Placing…';
    const type = partType;
    const result = mounting
      ? { ok: await surface.commit() }
      : await send({
          type: 'place',
          partType: type,
          position: [...position],
          expectedCursor: cursor,
        });
    cancelButton.disabled = false;
    inputs.forEach((input) => {
      input.disabled = false;
    });
    if (!lifecycle.settle(token, result?.ok === true)) return;
    if (result?.ok) {
      clear();
      panel.hidden = false;
      placed(type);
      fields.hidden = true;
      precise.hidden = true;
      confirm.hidden = true;
      another.hidden = false;
      status.textContent = `${CATALOG[type].name} placed.`;
      cancelButton.textContent = 'Done';
      another.focus();
    } else {
      status.textContent = result?.message || 'Placement was rejected. Move the preview or cancel.';
      confirm.disabled = true;
    }
  }
  function cancel({ restoreBrowser = true } = {}) {
    if ((!active() && panel.hidden) || lifecycle.read().kind === 'committing') return;
    const complete = lifecycle.read().kind === 'idle';
    const type = partType;
    lifecycle.cancel();
    clear();
    panel.hidden = true;
    if (complete) finished();
    else if (restoreBrowser) cancelled(type);
  }
  function refresh() {
    another.disabled = getFrame()?.metadata.mode !== 'build';
    if (active() && lifecycle.read().kind !== 'committing' && identity !== key()) {
      lifecycle.assess(null);
      clear();
      confirm.disabled = true;
      status.textContent = 'The machine changed. Cancel and choose the part again.';
    }
  }
  function active() {
    return lifecycle.read().kind !== 'idle';
  }
  confirm.onclick = commit;
  cancelButton.onclick = cancel;
  another.onclick = () => start(partType);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancel();
    } else if (event.key === 'Enter' && event.target.tagName === 'INPUT') {
      event.preventDefault();
      commit();
    }
  });
  return {
    panel,
    start,
    move,
    commit,
    cancel,
    refresh,
    active,
    type: () => partType,
    mounting() {
      if (!active() || lifecycle.read().kind === 'committing') return;
      panel.hidden = true;
      lifecycle.assess(surface?.read()?.valid ? surface.read() : null);
    },
    pending: () => lifecycle.read().kind === 'committing',
    dispose() {
      lifecycle.cancel();
      clear();
      panel.remove();
    },
  };
}
