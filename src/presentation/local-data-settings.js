/**
 * Wires the explicit, two-step local-data reset recovery flow.
 * @param {{
 *   query:(selector:string)=>HTMLElement|null,
 *   reset:()=>{ok:boolean,logicalReset?:boolean,warnings:unknown[]},
 *   reload?:()=>void, notify?:(message:string)=>void,
 * }} options
 */
export function installLocalDataSettings({
  query,
  reset,
  reload = () => globalThis.location.reload(),
  notify = () => {},
}) {
  const required = (selector) => {
      const element = query(selector);
      if (!element) throw new Error(`Missing local-data control ${selector}`);
      return /** @type {HTMLElement} */ (element);
    },
    panel = required(".local-data-panel"),
    confirmation = required("#confirm-local-reset"),
    status = required("#local-reset-status"),
    confirmButton = /** @type {HTMLButtonElement} */ (
      required("#confirm-local-reset-button")
    );

  const close = () => {
    panel.classList.add("hidden");
    confirmation.classList.add("hidden");
    status.textContent = "";
  };
  const open = () => {
    for (const selector of [
      ".environment-panel",
      ".remote-console",
      ".demo-browser",
      ".challenge-browser",
      ".learn-center",
    ])
      query(selector)?.classList.add("hidden");
    panel.classList.remove("hidden");
    confirmation.classList.add("hidden");
    status.textContent = "";
  };

  required("#settings-btn").onclick = open;
  required("#close-local-data").onclick = close;
  required("#request-local-reset").onclick = () => {
    confirmation.classList.remove("hidden");
    required("#cancel-local-reset").focus();
  };
  required("#cancel-local-reset").onclick = () => {
    confirmation.classList.add("hidden");
    required("#request-local-reset").focus();
  };
  confirmButton.onclick = () => {
    confirmButton.disabled = true;
    status.textContent = "Resetting and verifying local data…";
    const result = reset();
    if (!result.ok) {
      confirmButton.disabled = false;
      status.textContent = result.logicalReset
        ? "Data was reset, but verification could not finish. Reload manually."
        : "Reset failed safely. Existing local data is still active.";
      notify(status.textContent);
      return;
    }
    status.textContent = result.warnings.length
      ? "Local data reset. Some unreachable records could not be cleaned up; reloading safely."
      : "Local data reset and verified. Reloading…";
    notify(status.textContent);
    reload();
  };

  return Object.freeze({ close, open });
}
