export function createControllerDiagnostics({
  traceBuffer,
  getState,
  getTime,
  normalizeCommands,
  powered,
  commandConflicts = () => [],
  onBreakpoint,
  onRefresh,
}) {
  function record(event) {
    const state = getState(),
      sensors = Object.fromEntries(
        Object.entries(event.sensors || {}).filter(
          ([key, value]) => key !== "__bindings" && Number.isFinite(value),
        ),
      ),
      hit = traceBuffer.ingest({
        ...event,
        time: getTime(),
        sensors,
        provenance: structuredClone(event.sensors?.__bindings || []),
        commands: normalizeCommands(Object.entries(event.commands)),
      });
    if (hit && state.running) onBreakpoint(hit);
    if (event.controllerId === state.scriptControllerId) onRefresh();
  }

  function telemetry(runtimeManager, runtimeReadModel) {
    const state = getState();
    return {
      runtimes: runtimeManager.ids().map((controllerId) => {
        const controller = state.parts.find((part) => part.id === controllerId);
        return {
          controllerId,
          language: controller?.scriptLanguage || null,
          powered: !!controller && !!powered(controller),
          ready: runtimeManager.ready(controllerId),
          commands: structuredClone(
            runtimeReadModel.get(controllerId)?.commands || {},
          ),
        };
      }),
      conflicts: [
        ...new Set(
          commandConflicts().map((entry) =>
            String(entry).slice(String(entry).indexOf(":") + 1),
          ),
        ),
      ],
    };
  }

  return { record, telemetry };
}
