import { createDialogClose, createDialogHeader } from './dialog-close.mjs';
const el = (tag, text = '') => {
  const n = document.createElement(tag);
  n.textContent = text;
  return n;
};
const button = (text, fn) => {
  const n = el('button', text);
  n.type = 'button';
  n.onclick = fn;
  return n;
};
/** Requested camera and photo UI. Commands and byte ownership are injected by application. */
export function createCameraControls({
  root,
  stage,
  service,
  clearControls,
  onViewing,
  onFrustumChange = () => {},
}) {
  const overlay = el('section');
  overlay.className = 'machine-camera';
  overlay.hidden = true;
  overlay.setAttribute('aria-label', 'Machine camera view');
  const image = el('div');
  image.className = 'machine-camera-image';
  const bar = el('div');
  bar.className = 'machine-camera-bar';
  const status = el('output');
  status.setAttribute('aria-live', 'polite');
  const photo = button('Take photo', () => service.photo());
  const photos = button('Photos', openGallery);
  bar.append(
    button('Return to workshop view', () => service.watch(null)),
    photo,
    photos,
    status,
  );
  overlay.append(image, bar);
  stage.append(overlay);
  const dialog = el('dialog');
  dialog.className = 'camera-gallery';
  dialog.setAttribute('aria-label', 'Photos');
  const galleryStatus = el('p'),
    list = el('select'),
    picture = el('img'),
    caption = el('p');
  list.setAttribute('aria-label', 'Choose a photo');
  picture.alt = 'Selected camera photograph';
  const save = button('Save photo', () => {
    const p = service.read().gallery.photos[Number(list.value)];
    if (!p) return;
    try {
      const a = el('a');
      a.href = p.url;
      a.download = `camera-${p.metadata.cameraId}-attempt-${p.metadata.epoch}-tick-${p.metadata.captureTick}.png`;
      a.click();
      galleryStatus.textContent = 'Image download requested. Check your browser downloads.';
    } catch {
      galleryStatus.textContent = 'Image download failed. Your photo is still here.';
    }
  });
  const metadata = button('Save photo details', () => {
    const p = service.read().gallery.photos[Number(list.value)];
    if (!p) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(p.metadata, null, 2)], { type: 'application/json' }),
    );
    const a = el('a');
    a.href = url;
    a.download = `camera-tick-${p.metadata.captureTick}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  dialog.append(
    createDialogHeader(
      el('h2', 'Photos'),
      createDialogClose('Close photos', () => dialog.close()),
    ),
    el('p', 'Session photos are temporary. Save images before closing this page.'),
    galleryStatus,
    list,
    picture,
    caption,
    save,
    metadata,
    button('Clear photos', () => {
      if (confirm('Clear all session photos? Save any photos you want to keep first.'))
        service.clear();
    }),
  );
  root.append(dialog);
  const reopen = button('Photos', openGallery);
  reopen.className = 'camera-photos-reopen';
  reopen.hidden = true;
  stage.append(reopen);
  let frustumId = null;
  let wasViewing = false;
  let listKey = '',
    shortcut = 'KeyP';
  function choose() {
    const p = service.read().gallery.photos[Number(list.value)];
    picture.hidden = !p;
    save.disabled = !p;
    metadata.disabled = !p;
    if (p) {
      picture.src = p.url;
      caption.textContent = `Attempt ${p.metadata.epoch} · tick ${p.metadata.captureTick} · ${p.metadata.timeSeconds.toFixed(2)} s · ${p.metadata.width} × ${p.metadata.height}`;
    } else {
      picture.removeAttribute('src');
      caption.textContent = 'No photos yet.';
    }
  }
  list.onchange = choose;
  function openGallery() {
    clearControls();
    if (!dialog.open) dialog.showModal();
    refresh();
  }
  function refresh() {
    const state = service.read(),
      active = !!state.active;
    overlay.hidden = !active;
    if (active !== wasViewing) {
      wasViewing = active;
      onViewing(active);
    }
    stage.parentElement.classList.toggle('machine-camera-active', active);
    status.textContent =
      state.status +
      (state.captureStatus ? ' · ' + state.captureStatus : '') +
      (/fail|full|busy/i.test(state.gallery.status) ? ' · ' + state.gallery.status : '');
    photo.disabled = !state.canPhoto || state.gallery.pending;
    photo.textContent =
      state.frame?.metadata.mode === 'paused' ? 'Keep paused image' : 'Take photo';
    const canvas = service.canvas();
    if (canvas && canvas.parentNode !== image) image.replaceChildren(canvas);
    reopen.hidden =
      active ||
      (state.gallery.photos.length === 0 &&
        !state.captureStatus &&
        !/fail|busy|full/i.test(state.gallery.status));
    reopen.title = state.captureStatus || state.gallery.status;
    if (dialog.open) {
      galleryStatus.textContent = state.gallery.status;
      const key = JSON.stringify(state.gallery.photos.map((p) => p.url));
      if (key !== listKey) {
        const old = list.value;
        listKey = key;
        list.replaceChildren(
          ...state.gallery.photos.map((p, i) => {
            const o = el(
              'option',
              `Photo ${i + 1} · attempt ${p.metadata.epoch} · tick ${p.metadata.captureTick}`,
            );
            o.value = String(i);
            return o;
          }),
        );
        list.value =
          old !== '' && state.gallery.photos[Number(old)]
            ? old
            : String(state.gallery.photos.length - 1);
        choose();
      }
    }
    for (const actions of root.querySelectorAll('[data-camera-actions]')) actions.hidden = active;
    for (const control of root.querySelectorAll('[data-camera-cone]')) control.disabled = active;
    for (const output of root.querySelectorAll('[data-camera-status]'))
      output.textContent = state.status;
  }
  function inspector(part, right) {
    if (part.type !== 'camera') return;
    const section = el('section');
    section.className = 'camera-inspector';
    const out = el('output');
    out.dataset.cameraStatus = '';
    const keys = el('select');
    keys.setAttribute('aria-label', 'Photo shortcut');
    for (const key of ['KeyP', 'F8', 'F9']) {
      const o = el('option', key.replace('Key', ''));
      o.value = key;
      keys.append(o);
    }
    keys.value = shortcut;
    keys.onchange = () => (shortcut = keys.value);
    const actions = el('div');
    actions.dataset.cameraActions = '';
    actions.append(
      button('View through camera', () => service.watch(part.id)),
      button('Take photo', () => service.photo(part.id)),
      button('Photos', openGallery),
    );
    const cone = button(
      frustumId === part.id ? 'Hide viewing cone' : 'Show viewing cone (1 m)',
      () => {
        frustumId = frustumId === part.id ? null : part.id;
        cone.textContent = frustumId ? 'Hide viewing cone' : 'Show viewing cone (1 m)';
        onFrustumChange();
      },
    );
    cone.dataset.cameraCone = '';
    section.append(
      cone,
      actions,
      el('label', 'Photo shortcut (while viewing)'),
      keys,
      out,
      el('p', 'Chassis in the way? Return to Build, raise or turn the mounting, then retry.'),
    );
    right.append(section);
    refresh();
  }
  const keydown = (event) => {
    if (
      !service.read().active ||
      event.code !== shortcut ||
      event.repeat ||
      event.defaultPrevented ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      dialog.open ||
      document.querySelector('dialog[open]') ||
      event.target.closest?.('input,textarea,select,button,[contenteditable="true"]')
    )
      return;
    // Receiver input owns conflicting keys first. This listener never takes propulsion ownership.
    event.preventDefault();
    event.stopImmediatePropagation();
    service.photo();
  };
  window.addEventListener('keydown', keydown, { capture: true });
  return {
    refresh,
    inspector,
    frustum: () => frustumId,
    selection(id) {
      if (frustumId && frustumId !== id) {
        frustumId = null;
        onFrustumChange();
      }
    },
    active: () => !!service.read().active,
    dispose() {
      window.removeEventListener('keydown', keydown, { capture: true });
      dialog.remove();
      overlay.remove();
      reopen.remove();
    },
  };
}
