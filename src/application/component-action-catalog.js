import { immutableClone } from "../model/primitives.js";

const DEFINITIONS = Object.freeze([
  {
    id: "selection.duplicate",
    keyboardActionId: "selection.duplicate",
    label: "Duplicate selection",
    destructive: false,
    reversible: true,
  },
  {
    id: "selection.mirror-x",
    keyboardActionId: "selection.mirror",
    label: "Mirror selection across X",
    destructive: false,
    reversible: true,
  },
  {
    id: "selection.remove",
    keyboardActionId: "selection.remove",
    label: "Delete selection",
    destructive: true,
    reversible: true,
  },
]);

/** Application-private selected-context command descriptions and delegation. */
export function createSelectedContextCommandCatalog({ invoke = {} } = {}) {
  function describe({ selectedPartIds = [], running = false } = {}) {
    const scope = [...selectedPartIds].sort((left, right) => left - right),
      unavailableReason = running
        ? "Stop simulation before editing the authored assembly."
        : scope.length
          ? null
          : "Select at least one component.";
    return immutableClone(
      DEFINITIONS.map((definition) => ({
        ...definition,
        availability: unavailableReason ? "disabled" : "available",
        disabledReason: unavailableReason,
        scope: {
          selectedPartIds: scope,
          count: scope.length,
          kind: scope.length > 1 ? "selection" : "component",
        },
      })),
    );
  }

  function execute(commandId) {
    const callback = invoke[commandId];
    if (typeof callback !== "function")
      throw new Error(`Selected-context command ${commandId} is not bound`);
    return callback();
  }

  return Object.freeze({ describe, execute });
}
