import { createComponentInspectionFeature } from "./component-inspection-feature.js";

/** Adapts editor/runtime owners to the immutable inspection projection. */
export function createEditorComponentInspection({
  state,
  assembly,
  connection,
  catalog,
}) {
  return createComponentInspectionFeature({
    assembly: {
      snapshot: assembly.snapshot,
      revision: assembly.revision,
    },
    selection: {
      selectedPartIds: () => state.editor.selectedIds,
      primaryPartId: () => state.editor.selected,
    },
    runtime: {
      running: () => state.running,
      evidenceRevision: assembly.evidenceRevision,
      currentPart: assembly.currentPart,
      currentConnection: (connectionId) =>
        assembly
          .currentConnections()
          .find((entry) => entry.id === connectionId) || null,
      powered: (partId) =>
        assembly.powered(
          state.parts.find((part) => part.id === partId) || null,
        ),
      connectionValidity: (connectionId) => {
        const candidate = assembly
          .currentConnections()
          .find((entry) => entry.id === connectionId);
        return candidate ? connection.valid(candidate) : null;
      },
    },
    catalog,
  });
}
