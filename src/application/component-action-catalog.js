import { immutableClone } from "../model/primitives.js";

const DEFINITIONS = Object.freeze([
  {
    id: "selection.duplicate",
    keyboardActionId: "selection.duplicate",
    label: "Duplicate",
    destructive: false,
    reversible: true,
    editAction: true,
  },
  {
    id: "selection.mirror-x",
    keyboardActionId: "selection.mirror",
    label: "Mirror",
    destructive: false,
    reversible: true,
    editAction: true,
  },
  {
    id: "selection.remove",
    keyboardActionId: "selection.remove",
    label: "Delete",
    destructive: true,
    reversible: true,
    editAction: true,
  },
  {
    id: "selection.frame",
    keyboardActionId: "selection.frame",
    label: "Frame",
    destructive: false,
    reversible: false,
    presentationAction: true,
  },
  {
    id: "selection.isolate",
    keyboardActionId: null,
    label: "Isolate",
    destructive: false,
    reversible: false,
    presentationAction: true,
  },
  {
    id: "selection.show-all",
    keyboardActionId: null,
    label: "Show all",
    destructive: false,
    reversible: false,
    presentationAction: true,
  },
]);

function quantity(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function impactText(impact = {}) {
  const externalConnectionCount = Number(impact.externalConnectionCount || 0),
    externalControllerBindingCount = Number(
      impact.externalControllerBindingCount || 0,
    );
  return `${quantity(externalConnectionCount, "external connection")} and ${quantity(externalControllerBindingCount, "cross-selection controller binding")}`;
}

/** Application-private selected-context command descriptions and delegation. */
export function createSelectedContextCommandCatalog({ invoke = {} } = {}) {
  let bindings = null,
    revision = 0;

  /**
   * @param {{
   *   selectedPartIds?:number[], running?:boolean, isolationActive?:boolean,
   *   impact?:{externalConnectionCount?:number,externalControllerBindingCount?:number}
   * }} [context]
   */
  function describe({
    selectedPartIds = [],
    running = false,
    impact = {},
    isolationActive = false,
  } = {}) {
    const scope = [...selectedPartIds].sort((left, right) => left - right),
      scopeLabel = quantity(scope.length, "component"),
      directImpact = impactText(impact);
    return immutableClone(
      DEFINITIONS.map((definition) => {
        let disabledReason = null;
        if (!scope.length && definition.id !== "selection.show-all")
          disabledReason = "Select at least one component.";
        else if (running && definition.editAction)
          disabledReason =
            "Stop simulation before editing the authored assembly.";
        else if (definition.id === "selection.isolate" && isolationActive)
          disabledReason = "The current selection is already isolated.";
        else if (definition.id === "selection.show-all" && !isolationActive)
          disabledReason = "All components are already shown.";
        const shortcutBindings = definition.keyboardActionId
          ? bindings?.bindingsFor(definition.keyboardActionId) || []
          : [];
        return {
          ...definition,
          label:
            definition.id === "selection.show-all"
              ? definition.label
              : `${definition.label} ${scopeLabel}`,
          accessibleLabel: `${
            definition.id === "selection.show-all"
              ? "Show all components"
              : `${definition.label} ${scopeLabel}`
          }. Selection scope has ${directImpact}.`,
          availability: disabledReason ? "disabled" : "available",
          disabledReason,
          visible:
            definition.id === "selection.isolate"
              ? !isolationActive
              : definition.id === "selection.show-all"
                ? isolationActive
                : true,
          shortcutBindings,
          scope: {
            selectedPartIds: scope,
            count: scope.length,
            kind: scope.length > 1 ? "selection" : "component",
            impact: {
              externalConnectionCount: Number(
                impact.externalConnectionCount || 0,
              ),
              externalControllerBindingCount: Number(
                impact.externalControllerBindingCount || 0,
              ),
              description: directImpact,
            },
          },
        };
      }),
    );
  }

  function execute(commandId) {
    const callback = invoke[commandId];
    if (typeof callback !== "function")
      throw new Error(`Selected-context command ${commandId} is not bound`);
    return callback();
  }

  return Object.freeze({
    bind(next = {}) {
      Object.assign(invoke, next);
      revision += 1;
    },
    describe,
    execute,
    revision: () => `${revision}:${bindings?.revision?.() || 0}`,
    setKeyboardRegistry(registry) {
      bindings = registry;
      revision += 1;
    },
  });
}
