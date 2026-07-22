const FOCUSABLE = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * Adds focus entry, trapping, Escape dismissal, and opener restoration to the
 * modal surfaces. Business actions still own whether a dialog is open; this
 * controller observes only the presentation's `hidden` state.
 */
export function installAccessibleDialogs({ root = document } = {}) {
  const dialogs = Array.from(
      root.querySelectorAll('[role="dialog"][aria-modal="true"]'),
    ),
    application = root.querySelector(".shell"),
    previousFocus = new WeakMap(),
    observers = [];

  const isOpen = (dialog) =>
      dialog.isConnected && !dialog.classList.contains("hidden"),
    refreshApplicationInert = () => {
      if (application instanceof HTMLElement)
        application.inert = dialogs.some((dialog) => isOpen(dialog));
    };

  const visibleFocusables = (dialog) =>
    Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((element) => {
      const closedDetails = element.closest("details:not([open])");
      return (
        !element.hidden &&
        element.getAttribute("aria-hidden") !== "true" &&
        !element.closest(".hidden") &&
        element.getClientRects().length > 0 &&
        (!closedDetails || Boolean(element.closest("summary")))
      );
    });

  function enter(dialog) {
    refreshApplicationInert();
    const active = root.activeElement;
    if (active && !dialog.contains(active)) previousFocus.set(dialog, active);
    queueMicrotask(() => visibleFocusables(dialog)[0]?.focus());
  }

  function leave(dialog) {
    queueMicrotask(refreshApplicationInert);
    const opener = previousFocus.get(dialog);
    previousFocus.delete(dialog);
    if (!opener?.isConnected) return;
    queueMicrotask(() => {
      const visible =
          opener.getClientRects().length > 0 && !opener.closest(".hidden"),
        target = visible
          ? opener
          : opener.closest('[role="menu"]')
            ? root.querySelector('[aria-haspopup="menu"]')
            : null;
      target?.focus();
    });
  }

  function dismiss(dialog) {
    const close = dialog.querySelector(
      "[aria-label^='Close'], .modal-close, #tutorial-skip",
    );
    if (close) close.click();
  }

  for (const dialog of dialogs) {
    let hidden = dialog.classList.contains("hidden");
    const observer = new MutationObserver(() => {
      const nextHidden = dialog.classList.contains("hidden");
      if (nextHidden === hidden) return;
      hidden = nextHidden;
      if (hidden) leave(dialog);
      else enter(dialog);
    });
    observer.observe(dialog, { attributes: true, attributeFilter: ["class"] });
    observers.push(observer);
    if (!hidden) enter(dialog);
    /** @param {Event} event */
    const handleKeydown = (event) => {
      if (!(event instanceof KeyboardEvent)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        dismiss(dialog);
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = visibleFocusables(dialog);
      if (!focusables.length) {
        event.preventDefault();
        return;
      }
      const first = focusables[0],
        last = focusables.at(-1);
      if (event.shiftKey && root.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && root.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener("keydown", handleKeydown);
  }

  const removalObserver = new MutationObserver(refreshApplicationInert);
  removalObserver.observe(root, { childList: true, subtree: true });
  observers.push(removalObserver);
  refreshApplicationInert();

  return {
    dispose() {
      for (const observer of observers) observer.disconnect();
    },
  };
}
