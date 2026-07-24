/**
 * Application-owned workshop/camera actions. Bindings use KeyboardEvent.code
 * so the command stays on the same physical key; presentation may additionally
 * show the active KeyboardEvent.key while a player captures a binding.
 */
export const KEYBOARD_ACTION_DEFINITIONS = Object.freeze([
  action(
    "help.open",
    "Open Learn",
    "Workshop",
    ["F1", "Shift+Slash"],
    ["workshop", "operation"],
  ),
  action(
    "workspace.toggle-focus",
    "Toggle canvas focus",
    "Workshop",
    ["KeyH"],
    ["workshop", "operation"],
  ),
  action("history.undo", "Undo", "Editing", ["Primary+KeyZ"], ["workshop"]),
  action(
    "history.redo",
    "Redo",
    "Editing",
    ["Primary+Shift+KeyZ", "Primary+KeyY"],
    ["workshop"],
  ),
  action(
    "selection.all",
    "Select all",
    "Editing",
    ["Primary+KeyA"],
    ["workshop"],
  ),
  action(
    "selection.duplicate",
    "Duplicate selection",
    "Editing",
    ["KeyC", "Primary+KeyD"],
    ["workshop"],
  ),
  action(
    "selection.clear-build",
    "Clear build plate",
    "Editing",
    ["Shift+Delete", "Shift+Backspace"],
    ["workshop"],
  ),
  action(
    "selection.remove",
    "Delete selection",
    "Editing",
    ["KeyX", "Delete", "Backspace"],
    ["workshop"],
  ),
  action(
    "selection.mirror",
    "Mirror selection",
    "Editing",
    ["Shift+KeyM"],
    ["workshop"],
  ),
  action(
    "rope.attach-a",
    "Attach Rope end A",
    "Rope",
    ["Alt+KeyA"],
    ["workshop"],
  ),
  action(
    "rope.attach-b",
    "Attach Rope end B",
    "Rope",
    ["Alt+KeyB"],
    ["workshop"],
  ),
  action(
    "rope.detach-a",
    "Detach Rope end A",
    "Rope",
    ["Alt+Shift+KeyA"],
    ["workshop"],
  ),
  action(
    "rope.detach-b",
    "Detach Rope end B",
    "Rope",
    ["Alt+Shift+KeyB"],
    ["workshop"],
  ),
  action(
    "mode.build",
    "Build mode",
    "Modes",
    ["Digit1"],
    ["workshop", "operation"],
  ),
  action(
    "mode.connect",
    "Connect mode",
    "Modes",
    ["Digit2"],
    ["workshop", "operation"],
  ),
  action(
    "mode.simulate",
    "Simulate mode",
    "Modes",
    ["Digit3"],
    ["workshop", "operation"],
  ),
  action(
    "editor.cancel",
    "Cancel current action",
    "Editing",
    ["Escape"],
    ["workshop", "operation"],
  ),
  action("tool.select", "Select tool", "Tools", ["KeyV"], ["workshop"]),
  action("tool.move", "Move tool", "Tools", ["KeyG"], ["workshop"]),
  action("tool.rotate", "Rotate tool", "Tools", ["KeyR"], ["workshop"]),
  action("view.explode", "Exploded view", "View", ["Shift+KeyX"], ["workshop"]),
  action(
    "simulation.reset",
    "Reset simulation",
    "Simulation",
    ["Shift+KeyR"],
    ["operation"],
  ),
  action(
    "simulation.pause",
    "Pause or resume",
    "Simulation",
    ["KeyK"],
    ["operation"],
  ),
  action(
    "simulation.speed-down",
    "Decrease speed",
    "Simulation",
    ["BracketLeft"],
    ["operation"],
    true,
  ),
  action(
    "simulation.speed-up",
    "Increase speed",
    "Simulation",
    ["BracketRight"],
    ["operation"],
    true,
  ),
  action(
    "simulation.step",
    "Single step",
    "Simulation",
    ["Period"],
    ["operation"],
  ),
]);

function action(id, label, group, bindings, contexts, repeat = false) {
  return Object.freeze({
    id,
    label,
    group,
    bindings: Object.freeze(bindings),
    contexts: Object.freeze(contexts),
    repeat,
    semantics: "press",
  });
}

/** Backward-compatible flat view used by static audits. */
export const KEYBOARD_ACTIONS = Object.freeze(
  KEYBOARD_ACTION_DEFINITIONS.flatMap((definition) =>
    definition.bindings.map((binding) =>
      Object.freeze({
        id: definition.id,
        binding,
        contexts: definition.contexts,
      }),
    ),
  ),
);

const MODIFIER_CODES = new Set([
  "AltLeft",
  "AltRight",
  "ControlLeft",
  "ControlRight",
  "MetaLeft",
  "MetaRight",
  "ShiftLeft",
  "ShiftRight",
]);

const BROWSER_RESERVED_PRIMARY_CODES = new Set([
  "KeyL",
  "KeyN",
  "KeyP",
  "KeyR",
  "KeyT",
  "KeyW",
]);

/** @param {KeyboardEvent} event */
export function keyboardChord(event) {
  return [
    event.ctrlKey || event.metaKey ? "Primary" : null,
    event.altKey ? "Alt" : null,
    event.shiftKey ? "Shift" : null,
    event.code,
  ]
    .filter(Boolean)
    .join("+");
}

/** @param {KeyboardEvent} event @param {string} binding */
export function keyboardBindingMatches(event, binding) {
  return keyboardChord(event) === binding;
}

/** Session-scoped mutable bindings for workshop and camera actions. */
export function createKeyboardActionRegistry() {
  const overrides = new Map();

  function bindingsFor(actionId) {
    const definition = KEYBOARD_ACTION_DEFINITIONS.find(
      (candidate) => candidate.id === actionId,
    );
    if (!definition) return [];
    return [...(overrides.get(actionId) ?? definition.bindings)];
  }

  function actions(context = null) {
    return KEYBOARD_ACTION_DEFINITIONS.filter(
      (definition) => !context || definition.contexts.includes(context),
    ).map((definition) => ({
      ...definition,
      bindings: bindingsFor(definition.id),
      defaultBindings: [...definition.bindings],
      customized: overrides.has(definition.id),
    }));
  }

  function resolve({ event, context }) {
    const definition = actions(context).find((candidate) =>
        candidate.bindings.some((binding) =>
          keyboardBindingMatches(event, binding),
        ),
      ),
      binding = definition?.bindings.find((candidate) =>
        keyboardBindingMatches(event, candidate),
      );
    return definition
      ? {
          status: "handled",
          actionId: definition.id,
          binding,
          repeat: definition.repeat,
        }
      : { status: "unbound" };
  }

  function conflictFor(actionId, binding, ignoredSlot = -1) {
    const definition = KEYBOARD_ACTION_DEFINITIONS.find(
      (candidate) => candidate.id === actionId,
    );
    if (!definition) return null;
    return actions().find((candidate) => {
      const slot = candidate.bindings.indexOf(binding);
      if (slot < 0) return false;
      if (candidate.id === actionId) return slot !== ignoredSlot;
      return candidate.contexts.some((context) =>
        definition.contexts.includes(context),
      );
    });
  }

  function setBinding(actionId, slot, binding) {
    const current = bindingsFor(actionId);
    while (current.length <= slot) current.push(null);
    current[slot] = binding;
    overrides.set(actionId, current.filter(Boolean));
  }

  function clearBinding(actionId, slot) {
    const current = bindingsFor(actionId);
    current.splice(slot, 1);
    overrides.set(actionId, current);
  }

  return Object.freeze({
    actions,
    bindingsFor,
    clearBinding,
    conflictFor,
    reset() {
      overrides.clear();
    },
    resolve,
    setBinding,
    snapshot() {
      return actions().map(({ id, bindings, customized }) => ({
        id,
        bindings,
        customized,
      }));
    },
  });
}

const DEFAULT_REGISTRY = createKeyboardActionRegistry();

/**
 * @param {{event:KeyboardEvent, context:"workshop"|"operation", registry?:ReturnType<typeof createKeyboardActionRegistry>}} input
 */
export function resolveRegisteredKeyboardAction({
  event,
  context,
  registry = DEFAULT_REGISTRY,
}) {
  return registry.resolve({ event, context });
}

function validateBaseShortcut(event) {
  if (MODIFIER_CODES.has(event.code))
    return {
      status: "unavailable",
      reason: "Modifier keys cannot stand alone",
    };
  if (["Tab", "Enter"].includes(event.code))
    return {
      status: "unavailable",
      reason: `${event.key || event.code} is reserved for focus navigation`,
    };
  if (
    (event.ctrlKey || event.metaKey) &&
    BROWSER_RESERVED_PRIMARY_CODES.has(event.code)
  )
    return {
      status: "unavailable",
      reason: "That browser shortcut is reserved",
    };
  return null;
}

/** Validates one session-scoped workshop/camera binding. */
export function validateWorkshopShortcut({
  event,
  actionId,
  slot = 0,
  registry,
}) {
  if (event.code === "Escape") return { status: "cancel" };
  if (["Backspace", "Delete"].includes(event.code) && !event.shiftKey)
    return { status: "clear" };
  const unavailable = validateBaseShortcut(event);
  if (unavailable) return unavailable;
  const binding = keyboardChord(event),
    conflict = registry.conflictFor(actionId, binding, slot);
  if (conflict)
    return {
      status: "conflicting",
      binding,
      conflict,
      reason: `${binding} is already assigned to ${conflict.label}`,
    };
  return { status: "eligible", binding };
}

/**
 * Validates one authored machine shortcut before it enters the strict
 * blueprint. Machine shortcuts intentionally store a physical code without
 * modifiers; Shift remains available at runtime for range decrement/toggle
 * off behavior.
 *
 * @param {KeyboardEvent} event
 */
export function validateMachineShortcut(event) {
  if (["Escape", "Backspace", "Delete"].includes(event.code))
    return { status: "clear" };
  const unavailable = validateBaseShortcut(event);
  if (unavailable) return unavailable;
  if (event.altKey || event.ctrlKey || event.metaKey)
    return {
      status: "unavailable",
      reason: "Machine shortcuts cannot include Ctrl, Command, or Alt",
    };
  if (/^F(?:[1-9]|1[0-2])$/.test(event.code))
    return {
      status: "unavailable",
      reason: "Function keys are reserved for browser and help commands",
    };
  return { status: "eligible", code: event.code };
}
