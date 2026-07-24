const PRIMARY_SURFACES = Object.freeze([
  ".remote-console",
  ".demo-browser",
  ".challenge-browser",
  ".environment-panel",
  ".wasm-console",
]);

/** Owns mutual exclusion and focus entry for the workshop's primary panels. */
export function createPrimarySurfaceController({ query, releaseHeld }) {
  const required = (selector) => {
      const element = query(selector);
      if (!element) throw new Error(`Missing primary surface ${selector}`);
      return /** @type {HTMLElement} */ (element);
    },
    hideOthers = (selector) => {
      releaseHeld();
      for (const candidate of PRIMARY_SURFACES)
        if (candidate !== selector) required(candidate).classList.add("hidden");
    },
    toggle = ({
      selector,
      closeSelector,
      openerSelector,
      prepare = () => {},
    }) => {
      const panel = required(selector),
        opening = panel.classList.contains("hidden");
      panel.classList.toggle("hidden", !opening);
      if (opening) {
        hideOthers(selector);
        prepare();
        queueMicrotask(() => required(closeSelector).focus());
      } else required(openerSelector).focus();
    };
  return Object.freeze({ hideOthers, toggle });
}
