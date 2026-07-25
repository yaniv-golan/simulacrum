const BUTTON_COMMANDS = Object.freeze({
  "#delete-part": "selection.remove",
  "#duplicate-part": "selection.duplicate",
  "#mirror-selection": "selection.mirror-x",
  "#frame-selection": "selection.frame",
  "#isolate-selection": "selection.isolate",
  "#show-all-components": "selection.show-all",
});

/** Binds static Inspector buttons to the one selected-context dispatcher. */
export function bindSelectedCommandButtons(required, execute) {
  for (const [selector, commandId] of Object.entries(BUTTON_COMMANDS))
    required(selector).onclick = () => execute(commandId);
}
