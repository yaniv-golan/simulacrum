import { controllerBindingOptions } from "../model/controller-bindings.js";
import { TYPES } from "../model/component-catalog.js";
import { sensorDefinitionsForPart } from "../model/sensor-contracts.js";

/** Projects strict physical controller bindings into editor-facing options. */
export function createControllerBindingEditorAdapter({
  getController,
  parts,
  connections,
  invalidate,
  notify,
}) {
  const getBindings = () =>
    structuredClone(getController()?.controllerBindings || []);

  function getBindingOptions() {
    const allParts = parts();
    return controllerBindingOptions(
      getController(),
      allParts,
      connections(),
    ).map((option) => {
      const endpoint = allParts.find(
          (part) => part.id === option.endpointPartId,
        ),
        value = option.reading || option.channel;
      return {
        ...option,
        label: `${TYPES[endpoint?.type]?.name || endpoint?.type || "Missing"} #${option.endpointPartId} · ${option.endpointPortId} · ${value}`,
      };
    });
  }

  function setBindings(bindings) {
    const controller = getController(),
      ids = bindings.map((binding) => binding.id);
    if (!controller) return;
    if (
      ids.some((id) => !/^[A-Za-z0-9._:/-]+$/.test(id)) ||
      new Set(ids).size !== ids.length
    ) {
      notify("Binding aliases must be unique names without spaces");
      return;
    }
    controller.controllerBindings = structuredClone(bindings);
    invalidate(controller, "I/O BINDINGS CHANGED — REVIEW REQUIRED");
  }

  function getSensors() {
    const byId = new Map(parts().map((part) => [part.id, part]));
    return (getController()?.controllerBindings || [])
      .filter((binding) => binding.direction === "input")
      .map((binding) => {
        const endpoint = byId.get(binding.endpointPartId),
          definition = sensorDefinitionsForPart(endpoint)?.find(
            (candidate) => candidate.key === binding.reading,
          );
        return {
          key: binding.id,
          instanceKey: binding.id,
          label:
            definition?.label ||
            `${endpoint?.type || "Sensor"} #${binding.endpointPartId}`,
          unit: definition?.unit || "scalar",
        };
      });
  }

  const getChannels = () =>
    (getController()?.controllerBindings || [])
      .filter((binding) => binding.direction === "output")
      .map((binding) => binding.id);

  return Object.freeze({
    getBindings,
    getBindingOptions,
    setBindings,
    getSensors,
    getChannels,
  });
}
