/** Maps the run lifecycle onto presentation owners without simulation policy. */
export function createWorkshopRunPresentationPort({
  shell,
  state,
  runtime,
  stage,
  assembly,
  editor,
  aerothermal,
  failure,
  direct,
  testCourseRecords,
  actions,
}) {
  return {
    aerothermal,
    failure,
    notify: shell.notify,
    render: actions.render,
    tutorialEvent: actions.tutorialEvent,
    setExploded: editor.exploded.set,
    setEditorTestMode: () =>
      actions.applyEditorAction(state.editor, {
        type: "set-mode",
        mode: "test",
      }),
    workspaceFocused: () => shell.chrome.focused,
    focusWorkspace: (focused) => shell.chrome.toggleFocus(focused),
    hasWheels: assembly.capabilities.hasWheels,
    hasArticulation: assembly.capabilities.hasArticulation,
    hasPoweredFlight: assembly.capabilities.hasPoweredFlight,
    setWiresVisible: (visible) => {
      stage.wires.visible = visible;
    },
    setMission: (name, description) => {
      shell.query("#mission-name").textContent = name;
      shell.query("#mission-desc").textContent = description;
    },
    clearSelection: () => editor.editorPresentation.showSelection(null),
    resetDriveInput: direct.resetDriveInput,
    resetMachineFrame: () => {
      stage.machine.position.set(0, 0, 0);
      stage.machine.rotation.set(0, 0, 0);
      stage.wires.position.set(0, 0, 0);
      stage.wires.rotation.set(0, 0, 0);
    },
    attachPartToMachine: (part) => {
      if (part.mesh.parent !== stage.machine) stage.machine.attach(part.mesh);
      const flexible = part.mesh.userData?.flexibleLineVisual;
      if (flexible) {
        flexible.preview.visible = true;
        flexible.runtime.visible = false;
        flexible.runtime.count = 0;
        part.flexibleLineTelemetry = null;
      }
    },
    syncLargeAssembly: (parts) =>
      stage.largeAssemblyBatcher.sync(parts, { enabled: true }),
    drawWires: editor.editorPresentation.drawConnections,
    resetCameraTarget: () => stage.cameraTarget.set(0, 1.2, 0),
    clearTestSiteEffects: assembly.telemetry.clearContactEffects,
    beginTestCourseAttempt: testCourseRecords.begin,
    finishTestCourseAttempt: () => testCourseRecords.abort(runtime.telemetry),
  };
}
