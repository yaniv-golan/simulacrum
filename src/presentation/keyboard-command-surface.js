import { escapeHtml } from "./html.js";

function displayBinding(binding) {
  if (!binding) return "UNBOUND";
  const primary = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  return binding
    .replace("Primary", primary)
    .replace("Shift", "⇧")
    .replace("Alt", /Mac/.test(navigator.platform) ? "⌥" : "Alt")
    .replace(/Key([A-Z])/, "$1")
    .replace(/Digit([0-9])/, "$1")
    .replace("BracketLeft", "[")
    .replace("BracketRight", "]")
    .replace("Period", ".")
    .replace("Slash", "/");
}

/**
 * Renders command discovery and remapping from the one application registry.
 * Overrides live only in that registry instance and never touch browser or
 * blueprint storage.
 */
export function installKeyboardCommandSurface({
  root = document,
  registry,
  activeContext,
  validateBinding,
}) {
  const panel = root.querySelector("#keyboard-command-surface"),
    opener = root.querySelector("#keyboard-commands-btn"),
    close = root.querySelector("#close-keyboard-commands"),
    search = /** @type {HTMLInputElement|null} */ (
      root.querySelector("#keyboard-command-search")
    ),
    context = /** @type {HTMLSelectElement|null} */ (
      root.querySelector("#keyboard-command-context")
    ),
    list = /** @type {HTMLElement|null} */ (
      root.querySelector("#keyboard-command-list")
    ),
    status = root.querySelector("#keyboard-command-status"),
    reset = root.querySelector("#reset-keyboard-commands");
  let capture = null;

  if (
    !(panel instanceof HTMLElement) ||
    !(opener instanceof HTMLButtonElement) ||
    !(close instanceof HTMLButtonElement) ||
    !(search instanceof HTMLInputElement) ||
    !(context instanceof HTMLSelectElement) ||
    !(list instanceof HTMLElement) ||
    !(status instanceof HTMLElement) ||
    !(reset instanceof HTMLButtonElement)
  )
    throw new Error("Keyboard command surface template is incomplete");

  function selectedContext() {
    return context.value === "active" ? activeContext() : context.value;
  }

  function filteredActions() {
    const query = search.value.trim().toLocaleLowerCase(),
      requested = selectedContext();
    return registry
      .actions(requested === "all" ? null : requested)
      .filter((action) =>
        `${action.label} ${action.group} ${action.id}`
          .toLocaleLowerCase()
          .includes(query),
      );
  }

  function bindingButton(action, slot) {
    const binding = action.bindings[slot] || null,
      label = binding
        ? displayBinding(binding)
        : slot === 0
          ? "UNBOUND"
          : "+ SECONDARY";
    return `<button type="button" class="keyboard-binding${binding ? "" : " unbound"}" data-keyboard-action="${escapeHtml(action.id)}" data-keyboard-slot="${slot}" title="${escapeHtml(binding || "No physical-key binding")}" aria-label="${escapeHtml(`${action.label}, ${slot ? "secondary" : "primary"} binding: ${label}`)}">${escapeHtml(label)}</button>`;
  }

  function render({ restoreAction = null, restoreSlot = 0 } = {}) {
    const actions = filteredActions(),
      groups = actions.reduce((result, action) => {
        const entries = result.get(action.group) || [];
        entries.push(action);
        result.set(action.group, entries);
        return result;
      }, new Map());
    list.innerHTML = actions.length
      ? [...groups]
          .map(
            ([group, entries]) =>
              `<section><h3>${escapeHtml(group)}</h3>${entries
                .map(
                  (action) =>
                    `<div class="keyboard-command-row"><div><b>${escapeHtml(action.label)}</b><small>${escapeHtml(action.contexts.join(" · "))}</small></div><div>${bindingButton(action, 0)}${bindingButton(action, 1)}</div></div>`,
                )
                .join("")}</section>`,
          )
          .join("")
      : '<p class="keyboard-command-empty">No registered commands match.</p>';
    capture = null;
    if (restoreAction)
      queueMicrotask(() => {
        const target = list.querySelector(
          `[data-keyboard-action="${CSS.escape(restoreAction)}"][data-keyboard-slot="${restoreSlot}"]`,
        );
        if (target instanceof HTMLElement) target.focus();
      });
  }

  function beginCapture(button) {
    capture = {
      actionId: button.dataset.keyboardAction,
      slot: Number(button.dataset.keyboardSlot),
      button,
    };
    button.textContent = "PRESS KEY…";
    status.textContent =
      "Press a key or chord. Escape cancels; Delete or Backspace clears this slot.";
  }

  opener.addEventListener("click", () => {
    context.value = "active";
    status.textContent = `Showing commands available in ${activeContext() === "operation" ? "Simulate" : "Build / Connect"}.`;
    render();
    panel.classList.remove("hidden");
  });
  close.addEventListener("click", () => {
    capture = null;
    panel.classList.add("hidden");
  });
  list.addEventListener("click", (event) => {
    const button =
      event.target instanceof Element &&
      event.target.closest("[data-keyboard-action]");
    if (button instanceof HTMLButtonElement) beginCapture(button);
  });
  list.addEventListener("keydown", (event) => {
    if (!capture || event.target !== capture.button) return;
    event.preventDefault();
    event.stopPropagation();
    const validation = validateBinding(event, capture.actionId, capture.slot);
    if (validation.status === "cancel") {
      const { actionId, slot } = capture;
      status.textContent = "Binding unchanged.";
      render({ restoreAction: actionId, restoreSlot: slot });
      return;
    }
    if (validation.status === "clear") {
      const { actionId, slot } = capture;
      registry.clearBinding(actionId, slot);
      status.textContent = "Binding cleared for this session.";
      render({ restoreAction: actionId, restoreSlot: Math.max(0, slot - 1) });
      return;
    }
    if (validation.status !== "eligible") {
      status.textContent = validation.reason || "That binding is unavailable.";
      return;
    }
    const { actionId, slot } = capture;
    registry.setBinding(actionId, slot, validation.binding);
    status.textContent = `${displayBinding(validation.binding)} assigned for this session.`;
    render({ restoreAction: actionId, restoreSlot: slot });
  });
  search.addEventListener("input", () => render());
  context.addEventListener("change", () => render());
  reset.addEventListener("click", () => {
    registry.reset();
    status.textContent = "Default bindings restored for this session.";
    render();
    reset.focus();
  });
  render();
  return Object.freeze({ render });
}
