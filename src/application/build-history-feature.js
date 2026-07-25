import { BlueprintAcquisition } from "../model/blueprint-acquisition.js";
import { captureBuildHistorySnapshot } from "./build-history-snapshot.js";
import { runtimeControlsFromProfiles } from "./remote-control-state.js";

/**
 * @typedef {[number,number,number]} Vector3Tuple
 * @typedef {{
 *   id:number, type:string, pos:Vector3Tuple, mesh:import("three").Object3D,
 *   config:Record<string,unknown>, storedEnergyWh?:number, customColor?:unknown,
 *   rigRole?:string|null, rigVisualRotation?:Vector3Tuple|null,
 *   scriptLanguage?:string|null, scriptSources?:Record<string,unknown>|null,
 *   controllerBindings?:unknown[]|null, extensions?:Record<string,unknown>,
 *   programAcquisition?:string, programTrust?:unknown,
 * }} HistoryPart
 * @typedef {{
 *   id:number, type:string, pos:Vector3Tuple, orientation:[number,number,number,number],
 *   scale:Vector3Tuple, config:Record<string,unknown>, energy:number,
 *   customColor?:unknown, rigRole?:string|null,
 *   rigVisualRotation?:Vector3Tuple|null, scriptLanguage?:string|null,
 *   scriptSources?:Record<string,unknown>|null, controllerBindings?:unknown[]|null,
 *   extensions?:Record<string,unknown>,
 * }} SavedHistoryPart
 * @typedef {{
 *   demo:string|null, mode:string, remoteProfile:string,
 *   scriptControllerId:number|null, missionName:string,
 *   missionDescription:string, selected:number|null, selectedIds:number[],
 *   idSeq:number, parts:SavedHistoryPart[], connections:unknown[],
 *   remoteProfiles:Record<string,unknown>, remoteControlState:Record<string,unknown>,
 *   directSurfaces:Record<string,boolean>, controllerLayouts:Record<string,unknown>,
 *   controllerWindowState:Record<string,unknown>,
 * }} BuildHistorySnapshot
 * @typedef {{
 *   demo:string|null, mode:string, remoteProfile:string,
 *   scriptControllerId:number|null,
 *   editor:{mode:string,selected:number|null,selectedIds:Set<number>},
 *   parts:HistoryPart[], connections:unknown[],
 *   running:boolean, remoteProfiles:Record<string,unknown>,
 *   remoteControls:Record<string,unknown[]>, remoteControlState:Record<string,unknown>,
 *   directSurfaces:Record<string,boolean>, controllerLayouts:Record<string,unknown>,
 *   controllerWindowState:Record<string,unknown>,
 *   blueprintName:string, blueprintCreated:string,
 * }} HistoryStorePort
 * @typedef {{
 *   suspended:boolean, canUndo:boolean, canRedo:boolean,
 *   undoStack:Array<{label:string,snapshot:BuildHistorySnapshot}>,
 *   redoStack:Array<{label:string,snapshot:BuildHistorySnapshot}>,
 *   record:(label:string,snapshot:BuildHistorySnapshot)=>boolean,
 *   undo:(snapshot:BuildHistorySnapshot)=>{label:string,snapshot:BuildHistorySnapshot}|null,
 *   redo:(snapshot:BuildHistorySnapshot)=>{label:string,snapshot:BuildHistorySnapshot}|null,
 * }} HistoryStackPort
 * @typedef {{
 *   nextId:()=>number, setNextId:(id:number)=>void, stopSimulation:()=>void,
 *   clear:()=>void, setMode:(mode:string)=>void,
 *   add:(type:string,pos:Vector3Tuple,config:Record<string,unknown>,color?:unknown)=>HistoryPart,
 *   prepareAtlasFoot:(part:HistoryPart)=>void,
 *   select:(ids:Set<number>,primary:number|null)=>void,
 *   sync:()=>void, showSelection:(part:HistoryPart|undefined)=>void,
 * }} HistoryPartsPort
 * @typedef {{
 *   saveActive:()=>void, active:()=>HistoryPart|null|undefined,
 *   bind:(part:HistoryPart,open:boolean)=>void, render:()=>void,
 * }} HistoryControllerPort
 * @typedef {{
 *   missionName:()=>string, missionDescription:()=>string,
 *   presentHistory:(model:{canUndo:boolean,canRedo:boolean,undoLabel:string|null,redoLabel:string|null})=>void,
 *   setMission:(name:string,description:string)=>void, render:()=>void,
 *   renderRemote:()=>void, notify:(message:string)=>void,
 *   persistWorkspace:()=>void,
 * }} HistoryViewPort
 */

/**
 * Owns reversible editor snapshots and restoration transactions. Part creation,
 * selection, controller binding, and presentation are explicit ports so the
 * history model does not know about meshes, DOM selectors, or simulation.
 *
 * @param {{
 *   store:HistoryStorePort, history:HistoryStackPort, parts:HistoryPartsPort,
 *   controllers:HistoryControllerPort, view:HistoryViewPort,
 * }} options
 */
export function createBuildHistoryFeature({
  store,
  history,
  parts,
  controllers,
  view,
}) {
  /** @returns {BuildHistorySnapshot} */
  function capture() {
    controllers.saveActive();
    return captureBuildHistorySnapshot({
      store,
      nextId: parts.nextId,
      missionName: view.missionName,
      missionDescription: view.missionDescription,
    });
  }

  function refresh() {
    view.presentHistory({
      canUndo: history.canUndo && !store.running,
      canRedo: history.canRedo && !store.running,
      undoLabel: history.undoStack.at(-1)?.label || null,
      redoLabel: history.redoStack.at(-1)?.label || null,
    });
  }

  function record(label, snapshot = null) {
    if (history.suspended || store.running) return;
    history.record(label, snapshot || capture());
    refresh();
  }

  function restore(snapshot) {
    const wasSuspended = history.suspended;
    history.suspended = true;
    try {
      parts.stopSimulation();
      parts.clear();
      store.demo = snapshot.demo;
      parts.setMode(snapshot.mode === "wire" ? "build" : snapshot.mode);
      store.remoteProfile = snapshot.remoteProfile;
      store.blueprintName = snapshot.blueprintName;
      store.blueprintCreated = snapshot.blueprintCreated;
      store.remoteProfiles = structuredClone(snapshot.remoteProfiles);
      store.remoteControlState = structuredClone(snapshot.remoteControlState);
      store.remoteControls = runtimeControlsFromProfiles(
        store.remoteProfiles,
        store.remoteControlState,
      );
      store.directSurfaces = structuredClone(snapshot.directSurfaces);
      store.controllerLayouts = structuredClone(snapshot.controllerLayouts);
      store.controllerWindowState = structuredClone(
        snapshot.controllerWindowState,
      );
      const restoredNextId = Math.max(
        snapshot.idSeq,
        ...snapshot.parts.map((part) => part.id + 1),
        1,
      );
      parts.setNextId(restoredNextId);
      for (const saved of snapshot.parts) {
        const part = parts.add(
          saved.type,
          saved.pos,
          saved.mechanism || saved.config,
          saved.customColor,
        );
        part.id = saved.id;
        part.pos = /** @type {Vector3Tuple} */ ([...saved.pos]);
        part.storedEnergyWh = saved.storedEnergyWh;
        part.rigRole = saved.rigRole;
        part.rigVisualRotation = saved.rigVisualRotation;
        part.scriptLanguage = saved.scriptLanguage || part.scriptLanguage;
        part.scriptSources = saved.scriptSources
          ? structuredClone(saved.scriptSources)
          : part.scriptSources;
        part.controllerBindings = saved.controllerBindings
          ? structuredClone(saved.controllerBindings)
          : part.type === "computer"
            ? []
            : null;
        part.extensions = saved.extensions
          ? structuredClone(saved.extensions)
          : undefined;
        if (part.type === "computer") {
          part.programAcquisition =
            saved.programAcquisition || BlueprintAcquisition.UNKNOWN_UNTRUSTED;
          part.programTrust = null;
        }
        if (["footL", "footR"].includes(saved.rigRole))
          parts.prepareAtlasFoot(part);
        part.mesh.position.set(...saved.pos);
        part.mesh.quaternion.set(...saved.orientation);
        part.mesh.scale.set(...saved.scale);
        part.mesh.userData.partId = part.id;
        part.mesh.traverse((object) => (object.userData.partId = part.id));
      }
      parts.setNextId(restoredNextId);
      store.connections = structuredClone(snapshot.connections);
      store.scriptControllerId = store.parts.some(
        (part) =>
          part.id === snapshot.scriptControllerId && part.type === "computer",
      )
        ? snapshot.scriptControllerId
        : null;
      const restoredSelection = new Set(
        snapshot.selectedIds.filter((id) =>
          store.parts.some((part) => part.id === id),
        ),
      );
      parts.select(
        restoredSelection,
        store.parts.some((part) => part.id === snapshot.selected)
          ? snapshot.selected
          : restoredSelection.values().next().value || null,
      );
      const scriptController = controllers.active();
      if (scriptController) controllers.bind(scriptController, false);
      else controllers.render();
      parts.sync();
      view.setMission(
        snapshot.missionName || "WORKSHOP READY",
        snapshot.missionDescription || "Build and test a machine.",
      );
      parts.showSelection(
        store.parts.find((part) => part.id === store.editor.selected),
      );
      view.render();
      view.renderRemote();
      view.persistWorkspace();
    } finally {
      history.suspended = wasSuspended;
      refresh();
    }
  }

  function undo() {
    if (store.running) return;
    const entry = history.undo(capture());
    if (!entry) return;
    restore(entry.snapshot);
    view.notify(`Undid ${entry.label}`);
  }

  function redo() {
    if (store.running) return;
    const entry = history.redo(capture());
    if (!entry) return;
    restore(entry.snapshot);
    view.notify(`Redid ${entry.label}`);
  }

  return { capture, record, redo, refresh, restore, undo };
}
