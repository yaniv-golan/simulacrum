import * as THREE from "three";
import { applyEditorAction } from "../model/application-state.js";
import { BlueprintAcquisition } from "../model/blueprint-acquisition.js";
import { isMechanismComponentType } from "../model/mechanism-component-definitions.js";
import { errorMessage } from "../model/primitives.js";
import { escapeHtml } from "./html.js";
import {
  availableSubassemblyPorts,
  createLocalSubassemblyRecord,
  createSubassemblyTemplate,
  instantiateSubassembly,
  SUBASSEMBLY_EXPOSED_PORT_ROLES,
} from "../model/subassemblies.js";

/** Owns catalog rendering and reusable mini-blueprint creation/placement. */
export function createSubassemblyLibrary({
  state,
  catalog,
  builtIns = [],
  storage,
  storageKey,
  $,
  $$,
  selectedParts,
  editorSnapshot,
  recordHistory,
  history,
  addPart,
  atlasFootPart,
  getNextId,
  setNextId,
  afterPlacement,
  toast,
}) {
  let creatorPorts = [];

  function materializePart(saved, acquisition) {
    const color = saved.customColor,
      authored = isMechanismComponentType(saved.type)
        ? saved.mechanism
        : saved.config,
      part = addPart(saved.type, saved.pos, authored, color, {
        orientation: saved.orientation,
        scale: saved.scale,
      });
    if (saved.type === "battery") part.storedEnergyWh = saved.storedEnergyWh;
    part.rigRole = saved.rigRole || null;
    part.rigVisualRotation = saved.rigVisualRotation
      ? [...saved.rigVisualRotation]
      : null;
    part.scriptLanguage = saved.scriptLanguage || part.scriptLanguage;
    part.scriptSources = saved.scriptSources
      ? structuredClone(saved.scriptSources)
      : part.scriptSources;
    part.controllerBindings = saved.controllerBindings
      ? structuredClone(saved.controllerBindings)
      : saved.type === "computer"
        ? []
        : null;
    part.extensions = saved.extensions
      ? structuredClone(saved.extensions)
      : undefined;
    if (saved.scriptSources) {
      part.programAcquisition = acquisition;
      part.programTrust = null;
    }
    part.rot = part.mesh.rotation.y;
    if (["footL", "footR"].includes(part.rigRole)) atlasFootPart(part);
    return part;
  }

  function render(category = "all") {
    const assemblyEntry = (record, index, builtIn) => {
        const entry = record.asset;
        return {
          name: entry.name,
          type: `${builtIn ? "builtin-" : ""}subassembly-${index}`,
          cat: builtIn ? "motion" : "saved",
          custom: true,
          builtIn,
          record,
          icon:
            entry.parts.length > 1
              ? "▦"
              : catalog[entry.parts[0]?.type]?.icon || "◆",
          mass: entry.parts.reduce(
            (sum, part) => sum + (catalog[part.type]?.mass || 0),
            0,
          ),
          desc: `${entry.parts.length} part${entry.parts.length === 1 ? "" : "s"} · ${entry.connections.length} internal link${entry.connections.length === 1 ? "" : "s"}`,
        };
      },
      builtInEntries = builtIns.map((record, index) =>
        assemblyEntry(record, index, true),
      ),
      custom = state.custom.map((record, index) =>
        assemblyEntry(record, index, false),
      ),
      list = [
        ...builtInEntries,
        ...Object.entries(catalog).map(([type, entry]) => ({
          ...entry,
          type,
        })),
        ...custom,
      ].filter((entry) => category === "all" || entry.cat === category),
      target =
        state.tutorial === 0
          ? "motor"
          : state.tutorial === 1
            ? "gear12"
            : state.tutorial === 3
              ? "battery"
              : state.tutorial === 4
                ? "gear24"
                : "";
    $(".part-grid").innerHTML = list
      .map((entry) => {
        const customIndex =
            entry.custom && !entry.builtIn
              ? Number(entry.type.slice("subassembly-".length))
              : null,
          accent = entry.record?.asset.accent || null;
        return `<button class="part-card ${state.editor.placing?.catalogType === entry.type || state.editor.placing?.type === entry.type ? "active" : ""} ${entry.custom ? "saved-assembly" : ""} ${entry.type === target ? "tutorial-target" : ""}" data-type="${entry.type}">${customIndex != null ? `<span class="saved-assembly-delete" data-delete-subassembly="${customIndex}" title="Delete ${escapeHtml(entry.name)}">×</span>` : ""}<span class="part-visual" ${accent ? `style="--part-accent:${accent}"` : ""}>${entry.icon}</span><span><b>${escapeHtml(entry.name)}</b><small>${escapeHtml(entry.desc || "Reusable custom assembly")}</small></span><em>${entry.mass || "?"}kg</em></button>`;
      })
      .join("");
    $$(".part-card").forEach(
      (button) => (button.onclick = () => begin(button.dataset.type)),
    );
    $$("[data-delete-subassembly]").forEach((button) => {
      button.onclick = (event) => {
        event.stopPropagation();
        const [removed] = state.custom.splice(
          +button.dataset.deleteSubassembly,
          1,
        );
        storage.writeJson(storageKey, state.custom);
        render("saved");
        toast(`${removed.asset.name} removed from My Parts`);
      };
    });
  }

  function begin(type) {
    const returnTool = ["select", "move", "rotate"].includes(state.editor.tool)
        ? state.editor.tool
        : "select",
      builtInPrefix = "builtin-subassembly-",
      localPrefix = "subassembly-",
      subassembly = type.startsWith(builtInPrefix)
        ? builtIns[Number(type.slice(builtInPrefix.length))]
        : type.startsWith(localPrefix)
          ? state.custom[Number(type.slice(localPrefix.length))]
          : null,
      flexibleLineHeight = catalog[type]?.flexibleLine
        ? Number(catalog[type].lengthM || 0) / 2 +
          Number(catalog[type].diameterM || 0) / 2 +
          0.12
        : null,
      placement = subassembly
        ? {
            subassembly,
            catalogType: type,
            returnTool,
            position: [0, 0.03, 0],
          }
        : {
            type,
            returnTool,
            position: [
              0,
              flexibleLineHeight ??
                (catalog[type].teeth
                  ? 1.35
                  : catalog[type].radius
                    ? 0.65
                    : catalog[type].size?.[1] / 2 + 0.12 || 0.6),
              0,
            ],
          };
    applyEditorAction(state.editor, { type: "begin-placement", placement });
    $(".placement-help").classList.remove("hidden");
    ["x", "y", "z"].forEach((axis, index) => {
      $(`#placement-${axis}`).value = String(placement.position[index]);
    });
    render($(".tabs .active")?.dataset.cat || "all");
    toast(
      `Click the workbench to place ${placement.subassembly?.asset?.name || catalog[type].name}`,
    );
    queueMicrotask(() => $("#placement-x").focus());
  }

  function place(template, position) {
    const record = template.asset
        ? template
        : createLocalSubassemblyRecord(template),
      asset = record.asset;
    recordHistory(`place ${asset.name}`);
    const instance = instantiateSubassembly(asset, {
      position,
      nextId: getNextId(),
    });
    const previous = history.suspended;
    history.suspended = true;
    let made;
    try {
      made = instance.parts.map((part, index) => {
        const sourceId = String(asset.parts[index].id),
          acquisition =
            record.programAcquisitionByController[sourceId] ||
            BlueprintAcquisition.UNKNOWN_UNTRUSTED;
        return materializePart(part, acquisition);
      });
    } finally {
      history.suspended = previous;
    }
    state.connections.push(...instance.connections);
    setNextId(instance.nextId);
    state.editor.lastPlacementResult = {
      kind: "subassembly",
      assetName: asset.name,
      idMap: structuredClone(instance.idMap),
      connectionIds: instance.connections.map(({ id }) => id),
      exposedPorts: structuredClone(instance.exposedPorts),
    };
    const selection = new Set(made.map((part) => part.id));
    applyEditorAction(state.editor, {
      type: "select",
      ids: selection,
      id: made[0]?.id || null,
    });
    $("#mission-name").textContent = "WORKSHOP READY";
    $("#mission-desc").textContent =
      `${asset.name} placed with ${made.length} components and its internal connections.`;
    afterPlacement(made);
    toast(
      `Placed ${asset.name} · ${made.length} parts · ${instance.connections.length} links`,
    );
    return made;
  }

  function openCreator() {
    const selection = selectedParts();
    if (!selection.length)
      return toast("Select the connected components you want to reuse");
    const internalCount = state.connections.filter(
      (connection) =>
        state.editor.selectedIds.has(connection.a) &&
        state.editor.selectedIds.has(connection.b),
    ).length;
    $("#custom-name").value =
      selection.length > 1
        ? `My ${selection.length}-part assembly`
        : `My ${catalog[selection[0].type].name}`;
    $("#creator-selection-count").textContent =
      `${selection.length} SELECTED PART${selection.length === 1 ? "" : "S"}`;
    $("#creator-connection-count").textContent =
      `${internalCount} INTERNAL LINK${internalCount === 1 ? "" : "S"}`;
    creatorPorts = availableSubassemblyPorts(
      { parts: editorSnapshot(), connections: state.connections },
      state.editor.selectedIds,
    ).map((port) => ({ ...port, selected: true }));
    renderCreatorPorts();
    $("#creator-modal").classList.remove("hidden");
  }

  function renderCreatorPorts() {
    $("#creator-exposed-port-list").innerHTML = creatorPorts.length
      ? creatorPorts
          .map(
            (entry, index) =>
              `<li data-creator-port-row="${index}"><label><input type="checkbox" data-creator-port-enabled="${index}" ${entry.selected ? "checked" : ""}> EXPOSE ${escapeHtml(entry.port)} ON PART #${entry.partId}</label><label>LABEL<input data-creator-port-label="${index}" maxlength="80" value="${escapeHtml(entry.label)}"></label><label>ROLE<select data-creator-port-role="${index}">${SUBASSEMBLY_EXPOSED_PORT_ROLES.map((role) => `<option value="${role}" ${role === entry.role ? "selected" : ""}>${role}</option>`).join("")}</select></label><button type="button" data-creator-port-move="-1" data-creator-port-index="${index}" aria-label="Move ${escapeHtml(entry.label)} earlier" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-creator-port-move="1" data-creator-port-index="${index}" aria-label="Move ${escapeHtml(entry.label)} later" ${index === creatorPorts.length - 1 ? "disabled" : ""}>↓</button></li>`,
          )
          .join("")
      : "<li>No unoccupied ports are available to expose.</li>";
    $$("[data-creator-port-enabled]").forEach((element) => {
      element.onchange = () => {
        creatorPorts[Number(element.dataset.creatorPortEnabled)].selected =
          element.checked;
      };
    });
    $$("[data-creator-port-label]").forEach((element) => {
      element.oninput = () => {
        creatorPorts[Number(element.dataset.creatorPortLabel)].label =
          element.value;
      };
    });
    $$("[data-creator-port-role]").forEach((element) => {
      element.onchange = () => {
        creatorPorts[Number(element.dataset.creatorPortRole)].role =
          element.value;
      };
    });
    $$("[data-creator-port-move]").forEach((element) => {
      element.onclick = () => {
        const index = Number(element.dataset.creatorPortIndex),
          target = index + Number(element.dataset.creatorPortMove);
        if (target < 0 || target >= creatorPorts.length) return;
        [creatorPorts[index], creatorPorts[target]] = [
          creatorPorts[target],
          creatorPorts[index],
        ];
        renderCreatorPorts();
        $(`[data-creator-port-row="${target}"] input`)?.focus();
      };
    });
  }

  function saveCreator() {
    const selection = selectedParts();
    if (!selection.length) return;
    const bounds = selection.reduce(
        (box, part) => box.expandByObject(part.mesh),
        new THREE.Box3(),
      ),
      center = bounds.getCenter(new THREE.Vector3());
    let reusable;
    try {
      reusable = createSubassemblyTemplate(
        { parts: editorSnapshot(), connections: state.connections },
        state.editor.selectedIds,
        {
          name: $("#custom-name").value,
          accent: $("#custom-color").value,
          origin: [center.x, bounds.min.y, center.z],
          exposedPorts: creatorPorts
            .filter(({ selected }) => selected)
            .map(({ selected: _selected, ...port }) => port),
        },
      );
    } catch (error) {
      return toast(errorMessage(error));
    }
    state.custom.push(createLocalSubassemblyRecord(reusable));
    storage.writeJson(storageKey, state.custom);
    $("#creator-modal").classList.add("hidden");
    $$(".tabs button").forEach((button) =>
      button.classList.toggle("active", button.dataset.cat === "saved"),
    );
    render("saved");
    toast(
      `${reusable.name} saved · ${reusable.parts.length} parts · ${reusable.connections.length} links`,
    );
  }

  $("#library-add").onclick = openCreator;
  $(".modal-close").onclick = () => $("#creator-modal").classList.add("hidden");
  $("#create-component").onclick = saveCreator;
  if (state.subassemblyRecoveryDiagnostics?.length)
    queueMicrotask(() =>
      toast(
        `${state.subassemblyRecoveryDiagnostics.length} damaged My Parts record${state.subassemblyRecoveryDiagnostics.length === 1 ? " was" : "s were"} isolated`,
      ),
    );
  return { begin, place, render };
}
