/** Creates the authored connection-removal use case for the assembly editor. */
export function createEditorConnectionRemoval({ workspace, history, view }) {
  return function disconnectConnection(connectionId) {
    if (workspace.running) return false;
    const connection = workspace.connections.find(
      (candidate) => candidate.id === connectionId,
    );
    if (!connection) return false;
    history.record("delete connection");
    workspace.connections = workspace.connections.filter(
      (candidate) => candidate.id !== connectionId,
    );
    view.syncAssembly();
    if (
      workspace.selectedEntity?.kind === "connection" &&
      workspace.selectedEntity.connectionId === connectionId
    ) {
      const selectedPart = workspace.parts.find(
        (part) => part.id === workspace.selectedId,
      );
      view.select(
        selectedPart ? [selectedPart.id] : [],
        selectedPart?.id ?? null,
      );
      view.showSelection(selectedPart || null);
    }
    view.drawConnections();
    view.render();
    view.notify(
      `Disconnected #${connection.a}:${connection.portA || "?"} from #${connection.b}:${connection.portB || "?"}`,
    );
    return true;
  };
}
