/** Requested comfort controls in the existing machine region; mounted-session state only. */
export function createSoundControls({ onSound, onVolume }) {
  const root = document.createElement('span');
  root.className = 'sound-controls';
  root.dataset.soundControls = '';
  const toggle = document.createElement('button'),
    opener = document.createElement('button'),
    panel = document.createElement('div'),
    label = document.createElement('label'),
    slider = document.createElement('input'),
    value = document.createElement('output'),
    status = document.createElement('span');
  toggle.type = opener.type = 'button';
  toggle.textContent = 'Sound off';
  toggle.setAttribute('aria-pressed', 'false');
  opener.innerHTML =
    '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M2 4h12M2 12h12M5 2v4M11 10v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  opener.className = 'sound-settings';
  opener.title = 'Sound volume';
  opener.setAttribute('aria-expanded', 'false');
  opener.setAttribute('aria-label', 'Sound volume');
  panel.hidden = true;
  panel.className = 'sound-volume';
  panel.setAttribute('popover', 'manual');
  panel.setAttribute('aria-label', 'Sound settings');
  label.textContent = 'Volume ';
  slider.type = 'range';
  slider.min = '0';
  slider.max = '100';
  slider.value = '35';
  slider.setAttribute('aria-label', 'Sound volume');
  value.textContent = '35%';
  label.append(slider, value);
  panel.append(label);
  status.className = 'sound-status';
  status.setAttribute('role', 'status');
  status.hidden = true;
  root.append(toggle, opener, panel, status);
  let requested = false,
    generation = 0,
    disposed = false;
  const close = (focus = true) => {
    if (panel.matches(':popover-open')) panel.hidePopover();
    panel.hidden = true;
    opener.setAttribute('aria-expanded', 'false');
    if (focus) opener.focus();
  };
  const update = ({ enabled, state, problem }) => {
    requested = enabled;
    toggle.textContent = enabled ? 'Sound on' : 'Sound off';
    toggle.setAttribute('aria-pressed', String(enabled));
    if (!enabled && (state === 'interrupted' || problem)) {
      status.hidden = false;
      status.textContent = problem ?? 'Sound interrupted. Try Sound on.';
    }
  };
  toggle.onclick = async () => {
    const request = ++generation;
    requested = !requested;
    toggle.setAttribute('aria-pressed', String(requested));
    toggle.textContent = requested ? 'Sound on' : 'Sound off';
    const wanted = requested,
      enabled = await onSound?.(wanted);
    if (disposed || request !== generation) return;
    update({ enabled: !!enabled });
    status.hidden = !wanted || !!enabled;
    status.textContent = 'Sound unavailable. Try Sound on.';
  };
  const place = () => {
    if (panel.hidden) return;
    const anchor = opener.getBoundingClientRect(),
      box = panel.getBoundingClientRect();
    panel.style.left = `${Math.max(12, Math.min(innerWidth - box.width - 12, anchor.right - box.width))}px`;
    panel.style.top = `${Math.max(12, anchor.top - box.height - 10)}px`;
  };
  window.addEventListener('resize', place);
  opener.onclick = () => {
    const open = panel.hidden;
    panel.hidden = !open;
    opener.setAttribute('aria-expanded', String(open));
    if (open) {
      panel.showPopover();
      place();
      slider.focus();
    } else close();
  };
  slider.oninput = () => {
    value.textContent = `${slider.value}%${slider.value === '0' ? ' (silent)' : ''}`;
    slider.setAttribute('aria-valuetext', value.textContent);
    onVolume?.(Number(slider.value) / 100);
  };
  root.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });
  const outside = (event) => {
    if (!panel.hidden && !root.contains(event.target)) close();
  };
  document.addEventListener('pointerdown', outside);
  return {
    root,
    update,
    dispose() {
      disposed = true;
      generation++;
      window.removeEventListener('resize', place);
      if (panel.matches(':popover-open')) panel.hidePopover();
      document.removeEventListener('pointerdown', outside);
      root.remove();
    },
  };
}
