import {
  assertBlueprintAcquisition,
  BlueprintAcquisition,
} from "../model/blueprint-acquisition.js";
import { decodeBlueprint } from "../model/blueprint-decoder.js";
import { resolveComponentConfig } from "../model/component-resolver.js";
import { isMechanismComponentType } from "../model/mechanism-component-definitions.js";
import { createWorkspace, decodeWorkspace } from "../model/workspaces.js";
import { BlueprintLoadTransaction } from "./blueprint-load-transaction.js";
import { STORAGE_KEYS } from "./browser-storage.js";
import { disposeObject3D } from "../presentation/render-resources.js";

/**
 * Owns the complete blueprint decode, detached staging, persistence, swap, and
 * recovery workflow. The workshop coordinator supplies presentation actions;
 * the transaction itself remains reusable and independently testable.
 * @param {any} dependencies
 */
export function createBlueprintLoadingFeature(dependencies) {
  const {
    state,
    storage,
    types,
    componentMesh,
    atlasFootPart,
    machine,
    buildHistory,
    getIdSeq,
    setIdSeq,
    stopAllControllerRuntimes,
    stopSimulation,
    bindScriptController,
    renderScriptEditor,
    getBlueprintExchange,
    syncAssemblyModel,
    drawWires,
    showSelection,
    renderUI,
    renderRemote,
    refreshHistoryUI,
    captureBuildState,
    toast,
    applyEditorAction,
  } = dependencies;

  function disposePartPresentation(part) {
    disposeObject3D(part?.mesh);
  }

  function stageEditor(
    decoded,
    { acquisition, runtimeIdSeed = getIdSeq(), workspace = null },
  ) {
    assertBlueprintAcquisition(acquisition);
    const wire = decoded.wire,
      domainById = new Map(
        decoded.assembly.parts.map((part) => [part.id, part]),
      );
    const maxPartId = Math.max(-1, ...wire.parts.map((part) => part.id));
    const nextId = Math.max(maxPartId + 1, Number(runtimeIdSeed) || 1);
    const parts = wire.parts.map((wirePart) => {
      const domainPart = domainById.get(wirePart.id);
      return {
        ...structuredClone(domainPart),
        pos: [...wirePart.pos],
        orientation: [...wirePart.orientation],
        scale: structuredClone(wirePart.scale),
        ...(isMechanismComponentType(domainPart.type)
          ? { mechanism: structuredClone(domainPart.mechanism) }
          : { config: resolveComponentConfig(domainPart, undefined, types) }),
        ...(wirePart.type === "battery"
          ? { storedEnergyWh: wirePart.storedEnergyWh }
          : {}),
        customColor: wirePart.customColor ?? null,
        rigRole: wirePart.rigRole || null,
        rigVisualRotation: wirePart.rigVisualRotation
          ? [...wirePart.rigVisualRotation]
          : null,
        scriptLanguage:
          wirePart.type === "computer" ? wirePart.scriptLanguage : null,
        scriptSources:
          wirePart.type === "computer"
            ? structuredClone(wirePart.scriptSources)
            : null,
        controllerBindings:
          wirePart.type === "computer"
            ? structuredClone(wirePart.controllerBindings)
            : null,
        programAcquisition:
          wirePart.type === "computer"
            ? workspace?.programAcquisitionByController?.[wirePart.id] ||
              acquisition
            : null,
        programTrust: null,
      };
    });
    const connections = structuredClone(decoded.assembly.connections),
      remoteControls = Object.fromEntries(
        Object.entries(wire.remoteProfiles).map(([profileId, profile]) => [
          profileId,
          profile.controls.map((control) => ({
            ...structuredClone(control),
            value:
              workspace?.remoteControlState?.[profileId]?.[control.id] ??
              control.defaultValue,
          })),
        ]),
      ),
      controllerWindowState = workspace?.controllerWindowState || {
        visible:
          wire.remoteProfiles[wire.defaultRemoteProfile]?.design.style ===
          "drive-pad",
        collapsed: false,
        pinned: false,
        x: 24,
        y: 24,
        width: 360,
        height: 520,
      },
      activeRemoteProfile =
        workspace?.activeRemoteProfile ?? wire.defaultRemoteProfile,
      directSurfaces = Object.fromEntries(
        Object.keys(wire.remoteProfiles).map((profileId) => [
          profileId,
          profileId === activeRemoteProfile && controllerWindowState.visible,
        ]),
      ),
      controllerLayouts = Object.fromEntries(
        Object.entries(wire.remoteProfiles).map(([profileId, profile]) => [
          profileId,
          {
            ...structuredClone(profile.design),
            collapsed: workspace?.controllerWindowState?.collapsed || false,
          },
        ]),
      ),
      scriptControllerId =
        workspace?.selectedControllerId ??
        parts.find((part) => part.type === "computer")?.id ??
        null,
      selectedIds =
        workspace?.selectedPartIds || (parts.length ? [parts.at(-1).id] : []),
      selected = selectedIds.at(-1) ?? null,
      acquisitionMap = Object.fromEntries(
        parts
          .filter((part) => part.type === "computer")
          .map((part) => [part.id, part.programAcquisition]),
      ),
      remoteControlState = workspace?.remoteControlState || {},
      workspaceWire = createWorkspace({
        blueprint: wire,
        idSeed: nextId,
        selectedPartIds: selectedIds,
        selectedControllerId: selectedIds.includes(scriptControllerId)
          ? scriptControllerId
          : null,
        activeRemoteProfile,
        programAcquisitionByController: acquisitionMap,
        remoteControlState,
        controllerWindowState,
        extensions: workspace?.extensions,
      });
    return {
      name: wire.name || "Blueprint",
      created: wire.created || null,
      demo: wire.demo || null,
      parts,
      connections,
      idSeq: nextId,
      selected,
      selectedIds,
      remoteProfile:
        workspaceWire.activeRemoteProfile || wire.defaultRemoteProfile,
      remoteProfiles: structuredClone(wire.remoteProfiles),
      remoteControls,
      remoteControlState: structuredClone(remoteControlState),
      directSurfaces,
      controllerLayouts,
      controllerWindowState: structuredClone(controllerWindowState),
      scriptControllerId,
      scriptLanguage:
        parts.find((part) => part.id === scriptControllerId)?.scriptLanguage ||
        "visual",
      scriptSources: structuredClone(
        parts.find((part) => part.id === scriptControllerId)?.scriptSources ||
          {},
      ),
      blueprintExtensions: structuredClone(decoded.extensions),
      acquisition,
      workspace: workspaceWire,
    };
  }

  function stagePresentation(editor, _options, candidate) {
    const parts = [];
    candidate.presentation = { parts };
    for (const saved of editor.parts) {
      const part = {
        ...structuredClone(saved),
        mesh: componentMesh(saved, saved.customColor),
        phase: 0,
      };
      parts.push(part);
      part.mesh.position.set(...saved.pos);
      part.mesh.quaternion.set(...saved.orientation);
      if (["footL", "footR"].includes(part.rigRole)) atlasFootPart(part);
      part.mesh.scale.set(1, 1, 1);
      part.rot = part.mesh.rotation.y;
      part.mesh.userData.partId = part.id;
      part.mesh.traverse((object) => (object.userData.partId = part.id));
    }
    return candidate.presentation;
  }

  function persistCandidate(candidate) {
    const editor = candidate.editor;
    return storage.commitBatch([
      {
        key: STORAGE_KEYS.workspace,
        encoding: "json",
        value: editor.workspace,
      },
    ]);
  }

  function commitCandidate(candidate, _persistence, options = {}) {
    const editor = candidate.editor,
      parts = candidate.presentation.parts,
      previousParts = [...state.parts],
      wasSuspended = buildHistory.suspended;
    buildHistory.suspended = true;
    try {
      stopAllControllerRuntimes("ASSEMBLY REPLACED");
      stopSimulation();
      for (const part of previousParts) part.mesh.removeFromParent();
      for (const part of parts) machine.add(part.mesh);
      state.parts = parts;
      state.connections = structuredClone(editor.connections);
      state.demo = editor.demo;
      state.blueprintName = editor.name;
      state.blueprintCreated = editor.created;
      state.remoteProfile = editor.remoteProfile;
      state.remoteProfiles = structuredClone(editor.remoteProfiles);
      state.remoteControls = structuredClone(editor.remoteControls);
      state.remoteControlState = structuredClone(editor.remoteControlState);
      state.directSurfaces = structuredClone(editor.directSurfaces);
      state.controllerLayouts = structuredClone(editor.controllerLayouts);
      state.controllerWindowState = structuredClone(
        editor.controllerWindowState,
      );
      state.scriptLanguage = editor.scriptLanguage;
      state.scriptSources = structuredClone(editor.scriptSources);
      state.scriptControllerId = null;
      state.blueprintExtensions = structuredClone(editor.blueprintExtensions);
      setIdSeq(editor.idSeq);
      applyEditorAction(state.editor, {
        type: "select",
        ids: editor.selectedIds,
        id: editor.selected,
      });
      const scriptController = state.parts.find(
        (part) => part.id === editor.scriptControllerId,
      );
      if (scriptController) bindScriptController(scriptController, false);
      else renderScriptEditor();
      getBlueprintExchange()?.assemblyReplaced();
      syncAssemblyModel();
      drawWires();
      showSelection(
        state.parts.find((part) => part.id === state.editor.selected),
      );
      renderUI();
      renderRemote();
      document.body.classList.remove("load-recovery");
    } finally {
      buildHistory.suspended = wasSuspended;
      refreshHistoryUI();
    }
    if (!wasSuspended && options.historySnapshot)
      buildHistory.record(`load ${editor.name}`, options.historySnapshot);
    refreshHistoryUI();
    return {
      value: editor,
      disposePrevious: () => {
        for (const part of previousParts) disposePartPresentation(part);
      },
    };
  }

  function restoreCommittedWorkspace() {
    const workspace = storage.readJson(STORAGE_KEYS.workspace, null);
    if (workspace?.format !== "simulacrum-workspace")
      return {
        ok: false,
        error: new Error("Committed workspace is missing"),
      };
    const decodedWorkspace = decodeWorkspace(workspace);
    if (!decodedWorkspace.ok)
      return {
        ok: false,
        error: new Error(
          decodedWorkspace.errors[0]?.message || "Recovery decode failed",
        ),
      };
    const editor = stageEditor(decodedWorkspace.value.blueprint, {
        acquisition: BlueprintAcquisition.UNKNOWN_UNTRUSTED,
        runtimeIdSeed: decodedWorkspace.value.wire.idSeed,
        workspace: decodedWorkspace.value.wire,
      }),
      candidate = {
        decoded: decodedWorkspace.value.blueprint,
        editor,
        presentation: null,
      };
    candidate.presentation = stagePresentation(
      editor,
      { recovery: true },
      candidate,
    );
    const committed = commitCandidate(
      candidate,
      { manifestId: null },
      { recovery: true },
    );
    committed.disposePrevious?.();
    return { ok: true, value: committed.value };
  }

  const transaction = new BlueprintLoadTransaction({
    decode: (input) => decodeBlueprint(input),
    stageEditor,
    stagePresentation,
    persist: persistCandidate,
    commit: commitCandidate,
    disposeCandidate: (candidate) => {
      for (const part of candidate.presentation?.parts || [])
        disposePartPresentation(part);
    },
    freeze: () => {
      document.body.classList.add("load-recovery");
      stopAllControllerRuntimes("WORKSPACE RECOVERY");
    },
    disposeUncertain: (candidate) => {
      const uncertain = new Set([
        ...state.parts,
        ...(candidate.presentation?.parts || []),
      ]);
      for (const part of uncertain) disposePartPresentation(part);
      state.parts = [];
      state.connections = [];
    },
    recover: restoreCommittedWorkspace,
  });

  return {
    restoreWorkspace: restoreCommittedWorkspace,
    /** @param {unknown} data @param {{acquisition?:string}} [options] */
    loadBlueprint(data, { acquisition } = {}) {
      assertBlueprintAcquisition(acquisition);
      const historySnapshot = buildHistory.suspended
          ? null
          : captureBuildState(),
        result = /** @type {any} */ (
          transaction.execute(data, {
            acquisition,
            historySnapshot,
            runtimeIdSeed: getIdSeq(),
          })
        );
      if (!result.ok) throw result.error;
      if (result.status === "recovered")
        toast(
          "Workspace recovered from the committed blueprint after a load error",
        );
      else toast(`${result.value.name || "Blueprint"} loaded`);
      return result;
    },
  };
}
