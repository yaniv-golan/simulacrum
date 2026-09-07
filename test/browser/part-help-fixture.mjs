import { createPartHelp } from '../../src/presentation/part-help.mjs';
// Test-only accounting around the real owner's browser resources.
const listeners = [],
  observers = new Set();
const add = EventTarget.prototype.addEventListener;
const remove = EventTarget.prototype.removeEventListener;
const capture = (options) => (typeof options === 'boolean' ? options : Boolean(options?.capture));
EventTarget.prototype.addEventListener = function (type, callback, options) {
  if (
    [window, document].includes(this) &&
    !listeners.some(
      (row) =>
        row.target === this &&
        row.type === type &&
        row.callback === callback &&
        row.capture === capture(options),
    )
  )
    listeners.push({ target: this, type, callback, capture: capture(options) });
  return add.call(this, type, callback, options);
};
EventTarget.prototype.removeEventListener = function (type, callback, options) {
  const index = listeners.findIndex(
    (row) =>
      row.target === this &&
      row.type === type &&
      row.callback === callback &&
      row.capture === capture(options),
  );
  if (index >= 0) listeners.splice(index, 1);
  return remove.call(this, type, callback, options);
};
const OriginalObserver = ResizeObserver;
window.ResizeObserver = class extends OriginalObserver {
  observe(target, options) {
    observers.add(this);
    return super.observe(target, options);
  }
  disconnect() {
    observers.delete(this);
    return super.disconnect();
  }
};
const root = document.querySelector('#fixture');
let help;
window.helpFixture = {
  mount() {
    const fallback = document.createElement('h2');
    fallback.textContent = 'Parts';
    fallback.tabIndex = -1;
    root.append(fallback);
    help = createPartHelp({
      container: root,
      fallback,
      busy: () => false,
      icon: () => {
        const img = document.createElement('img');
        img.className = 'part-icon';
        img.alt = '';
        return img;
      },
    });
    root.append(help.about('gripWheel'), help.about('distributionBus'), help.panel);
  },
  dispose() {
    help.dispose();
    root.replaceChildren();
  },
  resources() {
    return { listeners: listeners.length, observers: observers.size };
  },
};
