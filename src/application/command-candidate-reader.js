/** Adapts mutable UI/runtime state into inert per-tick command candidates. */
export function createCommandCandidateReader({
  getState,
  runtimeManager,
  runtimeReadModel,
}) {
  return function readCommandCandidates() {
    const state = getState();
    return {
      remote: (state.remoteControls[state.remoteProfile] || []).map(
        (control) => {
          const value = Number(control.value || 0),
            latched = ["range", "toggle"].includes(control.type) && value !== 0;
          return {
            targetId: control.targetId,
            channel: control.channel,
            value,
            active: Boolean(control.active) || latched,
          };
        },
      ),
      scripts: state.parts.flatMap((controller) => {
        if (
          controller.type !== "computer" ||
          !runtimeManager.ready(controller.id)
        )
          return [];
        const outputs = runtimeReadModel.get(controller.id)?.commands || {},
          bindings = new Map(
            (controller.controllerBindings || [])
              .filter((binding) => binding.direction === "output")
              .map((binding) => [binding.id, binding]),
          );
        return Object.entries(outputs).map(([bindingId, value]) => {
          const binding = bindings.get(bindingId);
          return {
            controllerId: controller.id,
            bindingId,
            targetId: binding?.endpointPartId ?? null,
            endpointPortId: binding?.endpointPortId ?? null,
            channel: binding?.channel ?? null,
            value,
          };
        });
      }),
    };
  };
}
