import { createTestingPlaygroundFeature } from "./testing-playground-feature.js";

/** Wires the Test Reserve workflow to the workshop's existing feature facades. */
export function createTestingPlaygroundComposition({
  shell,
  stage,
  assembly,
  persistence,
  editor,
  run,
  actions,
}) {
  return createTestingPlaygroundFeature({
    root: shell.query(".shell"),
    state: shell.state,
    testSite: stage.earth.testSite,
    surfaceHeightAt: stage.earth.surfaceHeightAt,
    parts: () => shell.state.parts,
    history: persistence.buildHistoryFeature,
    workspace: assembly.workspace,
    drawConnections: editor.editorPresentation.drawConnections,
    cameraTarget: stage.cameraTarget,
    render: actions.render,
    setMode: actions.setMode,
    retry: run.simulation.reset,
    courseRecords: run.testCourseRecords,
    runIdentity: run.runIdentity,
    contactEffectsSnapshot: assembly.telemetry.contactEffectsSnapshot,
    notify: shell.notify,
  });
}
