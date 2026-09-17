import { CATALOG } from '../model/catalog.mjs';
import { createPart } from '../model/blueprint.mjs';
import { palettePlacement } from '../model/palette-placement.mjs';
import { validatePlacementGeometry } from '../model/surfaces.mjs';
import { createPlacementLifecycle, placementPresentation } from './placement-lifecycle.mjs';
import { controlTitle } from './workbench-content.mjs';

// This owner keeps a proposal only. The ordinary command path admits authored changes.
// One row over the bench: the part, its state word, the coordinates chip and the two
// actions. The state word and the confirming verb come from the shared placement
// vocabulary, never from this panel, so the strip and the surface panel agree.
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
  const lifecycle = createPlacementLifecycle();
  // Empty-space placement: no face and no rotation, so the strip never says either word.
  const words = () => placementPresentation(lifecycle.read(), { free: true });
  const title = document.createElement('strong');
  title.className = 'placement-part';
  const status = document.createElement('p');
  status.className = 'placement-state';
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
  precise.className = 'placement-precise';
  const preciseLabel = document.createElement('summary');
  // The words stay "Precise position" in both homes; the hover title says which numbers
  // each one holds — world coordinates here, sliding and turning on a face there.
  preciseLabel.textContent = 'Precise position';
  preciseLabel.title = controlTitle({
    name: 'Precise position',
    key: 'type exact X, Y and Z',
  });
  precise.append(preciseLabel, fields);
  const confirm = document.createElement('button');
  confirm.className = 'primary';
  confirm.textContent = words().control;
  confirm.setAttribute('aria-label', 'Place part');
  confirm.title = controlTitle({ name: 'Place part', key: 'Enter' });
  const cancelButton = document.createElement('button');
  const another = document.createElement('button');
  another.className = 'primary';
  another.textContent = 'Place another';
  another.setAttribute('aria-label', 'Place another');
  another.title = 'Place another one of these';
  another.hidden = true;
  // The accessible name is written on every control the strip relabels, so role and name
  // locators keep matching whatever the row shows.
  function endLabel(visible, name, key) {
    cancelButton.textContent = visible;
    cancelButton.setAttribute('aria-label', name);
    cancelButton.title = controlTitle({ name, key });
  }
  endLabel('Cancel', 'Cancel placement', 'Esc');
  panel.append(title, status, precise, confirm, another, cancelButton);
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
    title.textContent = CATALOG[type].name;
    endLabel('Cancel', 'Cancel placement', 'Esc');
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
      ? words().label
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
      endLabel('Done', 'Done', 'Esc');
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
      // Only a coordinate field commits on Enter. Everywhere else in the strip Enter must
      // keep its own default: it opens Precise position on the summary, cancels on Cancel
      // and repeats on Place another. Outside the strip the window handler commits.
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
