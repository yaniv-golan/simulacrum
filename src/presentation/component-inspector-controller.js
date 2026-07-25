import * as THREE from "three";
import { TYPES } from "../model/component-catalog.js";
import {
  articulatedRolesForType,
  componentInspectorProperties,
  mechanismDisplayField,
  mechanismInspectorProperties,
} from "./component-inspector-properties.js";
import { createAssemblyOutlinerController } from "./assembly-outliner-controller.js";
import {
  bindBreakawayUmbilicalEditor,
  breakawayUmbilicalMarkup,
} from "./breakaway-umbilical-editor.js";
import * as ropeInspector from "./flexible-line-inspector.js";

/**
 * @typedef {{
 *   id: number, type: string, mesh: THREE.Object3D,
 *   config: Record<string, number | boolean | string>, storedEnergyWh?: number,
 *   mechanism?: {
 *     massPropertySource?: { massKg?: number },
 *     config?: Record<string, number | boolean | string | object>,
 *   },
 *   mechanismAuthoringDiagnostic?: {code:string,message:string,path:Array<string|number>}|null,
 *   mechanismDisplayUnit?:string,
 *   rigRole?: string | null, rigVisualRotation?: number[] | null,
 *   sensorValueRpm?: number,
 * }} InspectorPart
 * @typedef {{
 *   id?: string, a: number, b: number, portA?:string, portB?:string, kind: string, failed?: boolean,
 *   releaseCouplerPartId?:number,
 *   capacity?: {ultimateForceN:number, ultimateTorqueNm:number}, lastLoadN?: number,
 *   peakLoadN?: number, lastTorqueNm?: number, peakTorqueNm?: number, aeroLoadN?: number,
 * }} InspectorConnection
 * @typedef {{
 *   parts: () => InspectorPart[], connections: () => InspectorConnection[],
 *   selectedId: () => number | null, selectedParts: () => InspectorPart[],
 *   selectedEntity: () => object | null,
 *   connectFrom: () => number | null, connectPort: () => string | null,
 *   running: () => boolean,
 *   inspection: () => object,
 * }} InspectorModelPort
 * @typedef {{
 *   query: (selector: string) => Element | null,
 *   queryAll: (selector: string) => Element[],
 *   syncSelection: (selected: boolean) => void,
 *   arrangerMarkup: (parts: InspectorPart[]) => string,
 *   bindArranger: () => void,
 * }} InspectorViewPort
 * @typedef {{
 *   recordHistory: (label: string) => void,
 *   configurePart: (part: InspectorPart, patch: Record<string, number | boolean | string>) => void,
 *   configureMechanism: (part: InspectorPart, path: Array<string|number>, value: number) => {ok:boolean,code?:string,message?:string,path?:Array<string|number>},
 *   syncAssembly: () => void,
 *   drawConnections: () => void, updateSelection: () => void,
 *   prepareFoot: (part: InspectorPart) => void,
 *   openController: (part: InspectorPart) => void,
 *   beginConnection: (partId: number, port: string) => void,
 *   completeConnection: (partId: number, port: string) => boolean,
 *   connectWithRope: (partIds:number[], extraSlackM:number) => boolean,
 *   selectPart: (partId: number) => void,
 *   selectConnection: (connectionId: string, partId: number) => void,
 *   setMode: (mode: string) => void, notify: (message: string) => void,
 * }} InspectorActionPort
 */

/**
 * @param {{ model: InspectorModelPort, view: InspectorViewPort, actions: InspectorActionPort }} ports
 */
export function createComponentInspectorController({ model, view, actions }) {
  let displayUnits = "si";
  const required = (selector) => {
    const element = view.query(selector);
    if (!element) throw new Error(`Missing inspector element ${selector}`);
    return element;
  };
  const outliner = createAssemblyOutlinerController({
    model: {
      parts: model.parts,
      connections: model.connections,
      selectedEntity: model.selectedEntity,
    },
    view: {
      list: () => required("#assembly-outliner-list"),
      queryAll: (selector) =>
        Array.from(
          required("#assembly-outliner-list").querySelectorAll(selector),
        ).map((element) => /** @type {HTMLElement} */ (element)),
    },
    actions: {
      selectPart: actions.selectPart,
      selectPort: armPort,
      selectConnection: actions.selectConnection,
    },
  });

  function armPort(partId, port) {
    const part = model.parts().find((candidate) => candidate.id === partId);
    if (!part) return;
    if (model.connectFrom() && model.connectFrom() !== partId) {
      actions.completeConnection(partId, port);
      render();
      return;
    }
    actions.beginConnection(partId, port);
    actions.setMode("wire");
    required(".connection-banner b").textContent =
      `${TYPES[part.type].name} · ${port}`;
    required(".connection-banner").classList.remove("hidden");
    actions.notify(
      "Choose a target; mechanical parts will snap into alignment",
    );
    render();
  }

  function render() {
    outliner.render();
    const inspection = model.inspection();
    const part =
      model.parts().find((candidate) => candidate.id === model.selectedId()) ||
      null;
    required(".inspector-empty").classList.toggle("hidden", Boolean(part));
    required(".inspector-content").classList.toggle("hidden", !part);
    view.syncSelection(Boolean(part));
    if (!part) return;

    const selection = model.selectedParts();
    const type = TYPES[part.type];
    const powered = inspection.observation?.specialized?.powered !== false,
      misaligned = inspection.relationships.connections.some(
        (connection) => connection.validity === "misaligned",
      );
    /** @type {HTMLElement} */ (
      required(".inspector-content")
    ).dataset.inspectionVersion = String(inspection.version);
    required(".inspect-title small").textContent = inspection.header.subtitle;
    required("#inspect-name").textContent = inspection.header.name;
    required(".part-badge").textContent = type.icon;
    const status = required(".status");
    status.textContent = inspection.status.label;
    status.classList.toggle("warning", inspection.status.warning);

    const articulatedRoles = articulatedRolesForType(part.type);
    const articulatedRoleEditor = articulatedRoles.length
      ? `<label class="assembly-role-field">ARTICULATED ROLE<select id="rig-role"><option value="">NONE</option>${articulatedRoles.map((role) => `<option value="${role}" ${part.rigRole === role ? "selected" : ""}>${role}</option>`).join("")}</select><small>Optional controller metadata. Bodies and joints still come only from your physical connections.</small></label>`
      : "";
    const controllerProgramEditor =
      part.type === "computer"
        ? `<button id="program-controller" class="program-controller"><span>{ }</span><b>PROGRAM THIS CONTROLLER</b><small>${inspection.observation.specialized.powered ? "POWERED" : "CONNECT POWER FIRST"} · ${inspection.observation.specialized.signalConnectionCount} SIGNAL OUTPUTS</small></button>`
        : "";
    const liveMeasurement =
      part.type === "sensor"
        ? `<br><strong id="sensor-live-rpm">MEASURED SHAFT SPEED · ${inspection.observation.specialized.measuredRpm.toFixed(1)} RPM</strong>`
        : "";
    const mechanismFields = mechanismInspectorProperties(part),
      mechanismRows = (fields) =>
        fields
          .map((field) => {
            const fieldId = field.pathKey.replace(/[^a-z0-9]+/gi, "-"),
              display = mechanismDisplayField(field, displayUnits);
            return `<tr><th scope="row"><label for="mechanism-field-${fieldId}">${field.label}</label><small>${field.pathKey}</small></th><td><input id="mechanism-field-${fieldId}" data-mechanism-path="${field.pathKey}" data-si-factor="${display.factor}" type="number" step="any" value="${display.value}" aria-describedby="mechanism-unit-${fieldId} mechanism-error"></td><td id="mechanism-unit-${fieldId}">${display.unit}</td></tr>`;
          })
          .join(""),
      scalarMechanismFields = mechanismFields.filter(
        (field) => !field.curvePoint,
      ),
      curveMechanismFields = mechanismFields.filter(
        (field) => field.curvePoint,
      ),
      mechanismEditor = part.mechanism
        ? `<section class="mechanism-editor" aria-labelledby="mechanism-editor-title"><h4 id="mechanism-editor-title">MECHANISM PARAMETERS · AUTHORITATIVE SI</h4><label>DISPLAY UNITS<select id="mechanism-display-units"><option value="si" ${displayUnits === "si" ? "selected" : ""}>SI base units</option><option value="engineering" ${displayUnits === "engineering" ? "selected" : ""}>Engineering units</option></select></label><p class="component-contract-note">Edits are converted to SI and validated as one strict authored component before they can change the assembly.</p>${scalarMechanismFields.length ? `<table><caption>Scalar physical laws and limits</caption><thead><tr><th>FIELD</th><th>VALUE</th><th>UNIT</th></tr></thead><tbody>${mechanismRows(scalarMechanismFields)}</tbody></table>` : ""}${curveMechanismFields.length ? `<table><caption>Curve and envelope points</caption><thead><tr><th>POINT FIELD</th><th>VALUE</th><th>UNIT</th></tr></thead><tbody>${mechanismRows(curveMechanismFields)}</tbody></table>` : ""}<p id="mechanism-error" class="mechanism-error" role="status" aria-live="polite"></p></section>`
        : "",
      twoEndedWorkflow = ropeInspector.twoEndedRopeWorkflow(selection);
    required("#property-list").innerHTML =
      `<div class="component-desc">${type.desc}<span>${Number(part.mechanism?.massPropertySource?.massKg ?? type.mass ?? 0)} kg · #${String(part.id).padStart(3, "0")}${ropeInspector.flexibleLineMaterialMarkup(part)}${liveMeasurement}${misaligned ? "<br><strong>Mechanical ports are out of alignment. Reconnect to snap them.</strong>" : part.type === "motor" && !powered ? "<br><strong>Requires a POWER connection to a charged Power Cell.</strong>" : ""}</span></div>` +
      componentInspectorProperties(part)
        .map(
          ([label, key, value, min, max, unit, step = 1]) =>
            `<label class="property"><span>${label}<b data-value="${key}">${value}${unit}</b></span><input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-prop="${key}" data-unit="${unit}"></label>`,
        )
        .join("") +
      `${ropeInspector.flexibleLineReadout(part)}${mechanismEditor}${twoEndedWorkflow}${controllerProgramEditor}${view.arrangerMarkup(selection)}<div class="component-construction"><h4>BLUEPRINT CONSTRUCTION</h4>${articulatedRoleEditor}${part.mechanism ? '<p class="component-contract-note">Mechanism scale is identity; edit the explicit physical law above.</p>' : ["x", "y", "z"].map((axis) => `<label class="property"><span>SCALE ${axis.toUpperCase()}<b>${part.mesh.scale[axis].toFixed(2)}×</b></span><input data-scale-axis="${axis}" type="range" min="0.2" max="2.5" step="0.05" value="${part.mesh.scale[axis]}"></label>`).join("")}</div>`;

    const structuralConnections = inspection.relationships.connections.filter(
      (connection) => ["mechanical", "mesh"].includes(connection.kind),
    );
    const structuralMonitor = structuralConnections.length
        ? `<div class="attachment-monitor"><h4>ATTACHMENT LOAD PATHS</h4>${structuralConnections
            .map((connection) => {
              const index = model
                .connections()
                .findIndex(
                  (candidate) => candidate.id === connection.connectionId,
                );
              const otherId = connection.counterpartPartId;
              const other = model
                .parts()
                .find((candidate) => candidate.id === otherId);
              const {
                  failed,
                  forceN,
                  forceRatingN,
                  torqueNm,
                  torqueRatingNm,
                  utilization,
                } = connection.observation,
                boundedUtilization = THREE.MathUtils.clamp(utilization, 0, 2);
              return `<div class="attachment-rating ${failed ? "failed" : boundedUtilization > 0.8 ? "warning" : ""}"><span><b>${other ? TYPES[other.type].name : "Missing component"}</b><em>${(forceN / 1000).toFixed(1)} / ${(forceRatingN / 1000).toFixed(1)} kN · ${torqueNm.toFixed(0)} / ${torqueRatingNm.toFixed(0)} Nm</em></span><i><u style="width:${Math.min(100, boundedUtilization * 100)}%"></u></i><label>FORCE<input data-connection-capacity="force" data-connection-index="${index}" type="range" min="100" max="100000" step="100" value="${forceRatingN}" ${model.running() ? "disabled" : ""}></label><label>TORQUE<input data-connection-capacity="torque" data-connection-index="${index}" type="range" min="10" max="50000" step="10" value="${torqueRatingNm}" ${model.running() ? "disabled" : ""}></label></div>`;
            })
            .join("")}</div>`
        : "",
      breakawayEditor = breakawayUmbilicalMarkup({
        connections: model.connections(),
        parts: model.parts(),
        selectedPartId: part.id,
        running: model.running(),
      });
    required("#load-monitor").innerHTML = structuralMonitor + breakawayEditor;
    required("#port-list").innerHTML = inspection.ports
      .map((portRead, index) => {
        const port = portRead.portId,
          presentation = portRead;
        const armed =
          model.connectFrom() === part.id && model.connectPort() === port;
        const connected = portRead.status === "connected";
        return `<button class="port ${armed ? "armed" : ""}" data-port="${port}" title="${presentation.description}"><i>${index % 2 ? "◆" : "●"}</i><span>${port}<small>${presentation.medium}</small></span><strong>${armed ? "SELECTED" : connected ? "CONNECTED" : "AVAILABLE"}</strong><em>${armed ? "Choose a compatible target component." : presentation.description}</em></button>`;
      })
      .join("");
    bind(part);
  }

  /** @param {InspectorPart} part */
  function bind(part) {
    const recordEdit = (input, label) => {
      if (!input.dataset.historyRecorded) {
        input.dataset.historyRecorded = "true";
        actions.recordHistory(label);
      }
    };
    const displayUnitSelect = /** @type {HTMLSelectElement|null} */ (
      view.query("#mechanism-display-units")
    );
    if (displayUnitSelect)
      displayUnitSelect.onchange = () => {
        displayUnits = displayUnitSelect.value;
        part.mechanismDisplayUnit = displayUnits;
        render();
      };
    for (const element of view.queryAll("[data-mechanism-path]")) {
      const input = /** @type {HTMLInputElement} */ (element);
      input.onblur = () => delete input.dataset.historyRecorded;
      input.onchange = () => {
        recordEdit(input, `edit ${TYPES[part.type].name} mechanism`);
        const value = Number(input.value) / Number(input.dataset.siFactor || 1),
          path = (input.dataset.mechanismPath || "")
            .split("/")
            .map((segment) =>
              /^\d+$/.test(segment) ? Number(segment) : segment,
            ),
          result = Number.isFinite(value)
            ? actions.configureMechanism(part, path, value)
            : {
                ok: false,
                code: "INVALID_FINITE_NUMBER",
                message: "Enter a finite SI value",
                path,
              },
          error = view.query("#mechanism-error");
        input.setAttribute("aria-invalid", String(!result.ok));
        if (!result.ok) {
          if (error)
            error.textContent = `${result.code}: ${result.message} · ${(result.path || path).join(".")}`;
          return;
        }
        if (error) error.textContent = "Mechanism value committed";
        actions.syncAssembly();
        actions.drawConnections();
        actions.updateSelection();
        actions.notify(
          `${TYPES[part.type].name} mechanism updated at ${path.join(".")}`,
        );
      };
    }
    for (const element of view.queryAll("[data-connection-capacity]")) {
      const input = /** @type {HTMLInputElement} */ (element);
      input.onblur = () => delete input.dataset.historyRecorded;
      input.oninput = () => {
        recordEdit(input, "tune attachment rating");
        const connection = model.connections()[+input.dataset.connectionIndex];
        if (!connection) return;
        if (input.dataset.connectionCapacity === "force")
          connection.capacity.ultimateForceN = +input.value;
        else connection.capacity.ultimateTorqueNm = +input.value;
        actions.syncAssembly();
        render();
      };
    }
    bindBreakawayUmbilicalEditor({
      elements: view.queryAll("[data-breakaway-connection-index]"),
      connections: model.connections,
      recordHistory: actions.recordHistory,
      syncAssembly: actions.syncAssembly,
      drawConnections: actions.drawConnections,
      render,
    });
    const rigRoleSelect = /** @type {HTMLSelectElement | null} */ (
      view.query("#rig-role")
    );
    if (rigRoleSelect)
      rigRoleSelect.onchange = () => {
        actions.recordHistory(
          `assign ${TYPES[part.type].name} articulated role`,
        );
        part.rigRole = rigRoleSelect.value || null;
        part.rigVisualRotation = [
          part.mesh.rotation.x,
          part.mesh.rotation.y,
          part.mesh.rotation.z,
        ];
        if (["footL", "footR"].includes(part.rigRole || ""))
          actions.prepareFoot(part);
        actions.syncAssembly();
        render();
      };
    const programController = /** @type {HTMLButtonElement | null} */ (
      view.query("#program-controller")
    );
    if (programController)
      programController.onclick = () => actions.openController(part);
    ropeInspector.bindTwoEndedRopeWorkflow({
      query: view.query,
      selectedParts: model.selectedParts,
      connect: actions.connectWithRope,
      notify: actions.notify,
    });
    view.bindArranger();
    for (const element of view.queryAll("[data-scale-axis]")) {
      const input = /** @type {HTMLInputElement} */ (element);
      input.onblur = () => delete input.dataset.historyRecorded;
      input.oninput = () => {
        recordEdit(input, `scale ${TYPES[part.type].name}`);
        const axis = input.dataset.scaleAxis;
        if (!axis || !["x", "y", "z"].includes(axis)) return;
        part.mesh.scale[axis] = +input.value;
        actions.syncAssembly();
        actions.drawConnections();
        actions.updateSelection();
      };
    }
    for (const element of view.queryAll("[data-prop]")) {
      const input = /** @type {HTMLInputElement} */ (element);
      input.onblur = () => delete input.dataset.historyRecorded;
      input.oninput = () => {
        recordEdit(input, `tune ${TYPES[part.type].name}`);
        const key = input.dataset.prop;
        if (!key) return;
        const nextValue = +input.value;
        actions.configurePart(part, { [key]: nextValue });
        actions.syncAssembly();
        if (key === "capacityWh" && part.type === "battery")
          required(".status").textContent = model.inspection().status.label;
        const value = view.query(`[data-value="${key}"]`);
        if (value) value.textContent = input.value + (input.dataset.unit || "");
      };
    }
    for (const element of view.queryAll(".port")) {
      const button = /** @type {HTMLButtonElement} */ (element);
      button.onclick = () => {
        const port = button.dataset.port;
        if (!port) return;
        armPort(part.id, port);
      };
    }
  }

  return Object.freeze({ render });
}
