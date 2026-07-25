import { BlueprintAcquisition } from "../model/blueprint-acquisition.js";
import { authoredComponentFields } from "../model/component-authoring.js";
import { TYPES } from "../model/component-catalog.js";
import { disposeObject3D } from "../presentation/render-resources.js";
import { createAssemblyTransformCommands } from "./assembly-transform-commands.js";
import { createTwoEndedComponentAuthoring } from "./two-ended-component-authoring.js";

/**
 * @typedef {{
 *   id: number, type: string, pos: number[], rot: number,
 *   config: Record<string, number | boolean | string>, mesh: import("three").Object3D,
 *   phase: number, storedEnergyWh?: number, customColor: number | null,
 *   rigRole?: string | null, rigVisualRotation?: number[] | null,
 *   scriptLanguage?: string | null, scriptSources?: Record<string, unknown> | null,
 *   controllerBindings?: object[], extensions?: Record<string, unknown>,
 *   programAcquisition?: string | null, programTrust?: object | null,
 * }} EditorPart
 * @typedef {{ id:string, a:number, b:number, kind:string, portA:string, portB:string, releaseCouplerPartId?:number, stress?:number, fatigue?:number, failed?:boolean }} EditorLink
 * @typedef {{
 *   parts: EditorPart[], connections: EditorLink[], running: boolean,
 *   selectedId: number | null, selectedIds: Set<number>,
 *   selectedEntity: {kind?:string,connectionId?:string}|null,
 *   scriptControllerId: number | null, demo: string | null,
 *   activeChallenge: string | null, challengeStatus: string, lastTransformOperation:object|null,
 *   challengeStartMode: string | null,
 * }} AssemblyWorkspace
 * @typedef {{
 *   suspended: boolean,
 *   capture: () => object,
 *   restore: (snapshot: object) => void,
 *   record: (label: string, snapshot?: object) => void,
 * }} AssemblyHistoryPort
 * @typedef {{
 *   stopAll: (message: string) => void, stopOne: (message: string, id: number) => void,
 * }} AssemblyControllerPort
 * @typedef {{
 *   destroyFlight: () => void, disposeTerrain: () => void,
 *   disposeMultibody: () => void, clearRuntimeTelemetry: () => void,
 * }} AssemblySimulationPort
 * @typedef {{
 *   machine: import("three").Group, createMesh: (type: string, color: number | null) => import("three").Object3D,
 *   newControllerSources: () => Record<string, unknown>,
 *   prepareFoot: (part: EditorPart) => EditorPart, resetExploded: () => void,
 *   select: (ids: Iterable<number>, primary: number | null) => void,
 *   showSelection: (part: EditorPart | null) => void, clearEffect: (name: string) => void,
 *   syncAssembly: () => void, drawConnections: () => void, render: () => void,
 *   setMode: (mode: string) => void, setMission: (title: string, description: string) => void,
 *   hideDriveHud: () => void, notify: (message: string) => void,
 *   showAllComponents: (options?:object) => void,
 * }} AssemblyViewPort
 * @typedef {{
 *   resetChallenge: () => void, assemblyReplaced: () => void,
 * }} AssemblyContextPort
 */

/**
 * Owns construction-time part creation, cloning, group edits, deletion, and
 * assembly replacement. Runtime disposal and presentation are explicit ports.
 *
 * @param {{
 *   workspace: AssemblyWorkspace, history: AssemblyHistoryPort,
 *   controllers: AssemblyControllerPort, simulation: AssemblySimulationPort,
 *   view: AssemblyViewPort, context: AssemblyContextPort,
 *   catalog?: Record<string, unknown>, workspaceSnapshot?: () => object,
 *   getNextId: () => number, setNextId: (value: number) => void,
 * }} ports
 */
export function createAssemblyEditorFeature({
  workspace,
  history,
  controllers,
  simulation,
  view,
  context,
  catalog = TYPES,
  workspaceSnapshot = () => ({ parts: [], connections: [] }),
  getNextId,
  setNextId,
}) {
  let duplicateIntentProvider = () => null,
    duplicateCommitted = () => {};
  function add(type, pos = [0, 1, 0], authored = {}, customColor = null) {
    if (!history.suspended) history.record(`add ${TYPES[type]?.name || type}`);
    const authoredFields = authoredComponentFields(type, authored),
      normalizedConfig = authoredFields.config;
    const id = getNextId();
    setNextId(id + 1);
    const part = /** @type {EditorPart} */ ({
      id,
      type,
      pos: [...pos],
      rot: 0,
      ...authoredFields,
      mesh: view.createMesh(type, customColor),
      phase: 0,
      ...(type === "battery"
        ? {
            storedEnergyWh: Number(
              authored.storedEnergyWh ?? normalizedConfig.capacityWh,
            ),
          }
        : {}),
      customColor,
      scriptLanguage: type === "computer" ? "visual" : null,
      scriptSources: type === "computer" ? view.newControllerSources() : null,
      controllerBindings: type === "computer" ? [] : null,
      programAcquisition:
        type === "computer" ? BlueprintAcquisition.LOCAL_AUTHORING : null,
      programTrust: null,
    });
    part.mesh.position.set(...pos);
    part.mesh.userData.partId = part.id;
    part.mesh.traverse((object) => (object.userData.partId = part.id));
    view.machine.add(part.mesh);
    workspace.parts.push(part);
    view.syncAssembly();
    view.select([part.id], part.id);
    view.showSelection(part);
    view.render();
    return part;
  }

  const addTwoEndedComponent = createTwoEndedComponentAuthoring({
    workspace,
    history,
    view,
    getNextId,
    setNextId,
    add,
  });

  function clear() {
    view.showAllComponents({ restoreCamera: false, silent: true });
    controllers.stopAll("IDLE");
    workspace.scriptControllerId = null;
    simulation.destroyFlight();
    simulation.disposeTerrain();
    simulation.disposeMultibody();
    view.resetExploded();
    for (const part of workspace.parts) disposeObject3D(part.mesh);
    workspace.parts = [];
    workspace.connections = [];
    view.select([], null);
    view.syncAssembly();
    simulation.clearRuntimeTelemetry();
    view.hideDriveHud();
    view.showSelection(null);
    view.clearEffect("hoverBox");
    view.clearEffect("previewLine");
    view.drawConnections();
    view.render();
  }

  function clonePart(source, position, orientation = null) {
    const clone = add(
      source.type,
      position,
      structuredClone(source.mechanism || source.config),
      source.customColor,
    );
    if (source.type === "battery") clone.storedEnergyWh = source.storedEnergyWh;
    clone.rigRole = source.rigRole;
    clone.rigVisualRotation = source.rigVisualRotation
      ? [...source.rigVisualRotation]
      : null;
    clone.scriptLanguage = source.scriptLanguage;
    clone.scriptSources = source.scriptSources
      ? structuredClone(source.scriptSources)
      : null;
    clone.controllerBindings = source.controllerBindings
      ? structuredClone(source.controllerBindings)
      : source.type === "computer"
        ? []
        : null;
    clone.extensions = source.extensions
      ? structuredClone(source.extensions)
      : undefined;
    if (source.type === "computer") {
      clone.programAcquisition = BlueprintAcquisition.LOCAL_AUTHORING;
      clone.programTrust = null;
    }
    if (["footL", "footR"].includes(source.rigRole || ""))
      view.prepareFoot(clone);
    clone.mesh.quaternion.copy(orientation || source.mesh.quaternion);
    clone.mesh.scale.copy(source.mesh.scale);
    clone.pos = [...position];
    clone.rot = clone.mesh.rotation.y;
    clone.mesh.traverse((object) => (object.userData.partId = clone.id));
    return clone;
  }

  function removeSelection() {
    if (
      !workspace.running &&
      workspace.selectedEntity?.kind === "connection" &&
      workspace.selectedEntity.connectionId
    ) {
      const connectionId = workspace.selectedEntity.connectionId,
        retained = workspace.connections.filter(
          (connection) => connection.id !== connectionId,
        );
      if (retained.length === workspace.connections.length) return;
      history.record("delete connection");
      workspace.connections = retained;
      view.syncAssembly();
      view.select([], null);
      view.showSelection(null);
      view.drawConnections();
      view.render();
      view.notify(`Deleted connection ${connectionId}`);
      return;
    }
    const ids = new Set(
      workspace.selectedIds.size
        ? workspace.selectedIds
        : [workspace.selectedId],
    );
    ids.delete(null);
    if (!ids.size || workspace.running) return;
    for (const id of ids) controllers.stopOne("CONTROLLER REMOVED", id);
    if (
      workspace.scriptControllerId != null &&
      ids.has(workspace.scriptControllerId)
    )
      workspace.scriptControllerId = null;
    history.record(`delete ${ids.size} component${ids.size === 1 ? "" : "s"}`);
    for (const controller of workspace.parts)
      if (controller.type === "computer" && !ids.has(controller.id))
        controller.controllerBindings = (
          controller.controllerBindings || []
        ).filter((binding) => !ids.has(binding.endpointPartId));
    for (let index = workspace.parts.length - 1; index >= 0; index--)
      if (ids.has(workspace.parts[index].id)) {
        disposeObject3D(workspace.parts[index].mesh);
        workspace.parts.splice(index, 1);
      }
    workspace.connections = workspace.connections
      .filter((connection) => !ids.has(connection.a) && !ids.has(connection.b))
      .map((connection) => {
        if (!ids.has(connection.releaseCouplerPartId)) return connection;
        const retained = { ...connection };
        delete retained.releaseCouplerPartId;
        return retained;
      });
    view.syncAssembly();
    view.select([], null);
    view.showSelection(null);
    view.drawConnections();
    view.render();
    view.notify(
      `Deleted ${ids.size} component${ids.size === 1 ? "" : "s"} · Undo is available`,
    );
  }

  function clearBuildPlate() {
    if (workspace.running) {
      view.notify("Stop simulation before clearing the build plate");
      return;
    }
    if (!workspace.parts.length) {
      view.notify("Build plate is already clear");
      return;
    }
    const partCount = workspace.parts.length;
    history.record("clear build plate");
    workspace.activeChallenge = null;
    workspace.challengeStatus = "idle";
    workspace.challengeStartMode = null;
    context.resetChallenge();
    workspace.demo = null;
    context.assemblyReplaced();
    clear();
    view.setMode("build");
    view.setMission(
      "BUILD PLATE CLEAR",
      "Choose components from the library or load a saved blueprint.",
    );
    view.notify(`Cleared ${partCount} components · Undo is available`);
  }

  function selectAll() {
    if (!workspace.parts.length) return;
    const primary = workspace.parts.at(-1);
    view.select(
      workspace.parts.map((part) => part.id),
      primary.id,
    );
    view.showSelection(primary);
    view.render();
    view.notify(`Selected all ${workspace.parts.length} components`);
  }

  const transforms = createAssemblyTransformCommands({
    workspace,
    history,
    view,
    clonePart,
    placement: {
      catalog,
      snapshot: workspaceSnapshot,
      intent: () => duplicateIntentProvider(),
      committed: () => duplicateCommitted(),
    },
  });

  return Object.freeze({
    add,
    addTwoEndedComponent,
    clear,
    clearBuildPlate,
    clonePart,
    /** @param {{ intent?:()=>object|null, committed?:()=>void }} [options] */
    configureDuplicatePlacement({ intent, committed } = {}) {
      duplicateIntentProvider =
        typeof intent === "function" ? intent : () => null;
      duplicateCommitted =
        typeof committed === "function" ? committed : () => {};
    },
    duplicate: transforms.duplicate,
    mirror: transforms.mirror,
    removeSelection,
    selectAll,
  });
}
