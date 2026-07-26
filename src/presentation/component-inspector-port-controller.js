import { escapeHtml } from "./html.js";

/** Owns progressive port disclosure and counterpart/path actions. */
export function createComponentInspectorPortController({
  model,
  view,
  actions,
  armPort,
  render,
}) {
  let activePortKey = null;

  function markup(part, inspection) {
    if (
      activePortKey &&
      !inspection.ports.some(
        (portRead) => activePortKey === `${part.id}:${portRead.portId}`,
      )
    )
      activePortKey = null;
    return inspection.ports
      .map((portRead, index) => {
        const port = portRead.portId,
          key = `${part.id}:${port}`,
          active = activePortKey === key,
          statusId = `port-status-${part.id}-${port.replace(/[^A-Za-z0-9_-]/g, "-")}`,
          armed =
            model.connectFrom() === part.id && model.connectPort() === port,
          connected = Boolean(portRead.counterpart),
          counterparts =
            portRead.counterparts ||
            (portRead.counterpart ? [portRead.counterpart] : []),
          routeTargets = portRead.routeTargets || {
            status: "unsupported",
            totalCount: 0,
            options: [],
          },
          counterpart = connected
            ? portRead.counterpartCount > 1
              ? `${portRead.counterpartCount} connected components`
              : `${portRead.counterpart.name} · ${portRead.counterpart.portId}`
            : "No connected component",
          assessment = inspection.connectionTargetAssessment?.find(
            (entry) => entry.targetPortId === port,
          ),
          routeStatus =
            inspection.routeEvidence?.partId === part.id &&
            inspection.routeEvidence?.portId === port
              ? inspection.routeEvidence.summary
              : "",
          assessmentStatus = assessment
            ? `${assessment.code || assessment.status}: ${assessment.message}`
            : "",
          displayedStatus = assessment?.status || portRead.status,
          networkPort = ["power", "signal"].includes(portRead.kind),
          traceDisabled =
            networkPort &&
            (routeTargets.status !== "available" ||
              routeTargets.options.length === 0),
          traceUnavailable =
            routeTargets.status === "over-limit"
              ? "Trace over-limit · more than 512 eligible path destinations"
              : traceDisabled
                ? `Trace ${routeTargets.status === "available" ? "unreachable" : routeTargets.status}`
                : "";
        return `<div class="port-row ${armed ? "armed" : ""} ${active ? "active" : ""}" data-port-row="${escapeHtml(port)}"><button type="button" class="port-control" data-port-control="${escapeHtml(port)}" aria-expanded="${active}" aria-controls="${statusId}-actions" aria-describedby="${statusId}" title="${escapeHtml(portRead.description)}"><i>${index % 2 ? "◆" : "●"}</i><span>${escapeHtml(port)}<small>${escapeHtml(portRead.medium)} · ${escapeHtml(portRead.direction || portRead.behavior || "")}</small></span><strong>${armed ? "SELECTED" : displayedStatus.toUpperCase()}</strong><em>${armed ? "Choose a compatible target component." : escapeHtml(counterpart)}</em></button><p id="${statusId}" class="port-assessment-status" role="status">${escapeHtml(assessmentStatus)}</p><div id="${statusId}-actions" class="port-actions" ${active ? "" : "hidden"}>${connected ? `${counterparts.length > 1 ? `<label class="port-route-target">CONNECTED COMPONENT<select data-counterpart-target="${escapeHtml(port)}">${counterparts.map((entry) => `<option value="${escapeHtml(entry.connectionId)}">${escapeHtml(entry.name)} · ${escapeHtml(entry.portId)}</option>`).join("")}</select></label>` : ""}${networkPort && routeTargets.options.length > 1 ? `<label class="port-route-target">PATH DESTINATION<select data-route-target="${escapeHtml(port)}">${routeTargets.options.map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.name)} · ${escapeHtml(entry.portId)}</option>`).join("")}</select></label>` : ""}<button type="button" data-port-action="select" data-port="${escapeHtml(port)}">SELECT COUNTERPART</button><button type="button" data-port-action="frame" data-port="${escapeHtml(port)}">FRAME</button><button type="button" data-port-action="trace" data-port="${escapeHtml(port)}" ${traceDisabled ? `disabled title="${escapeHtml(traceUnavailable)}"` : ""}>TRACE PATH</button><button type="button" class="danger" data-port-action="disconnect" data-port="${escapeHtml(port)}">DISCONNECT</button>` : `<button type="button" data-port-action="connect" data-port="${escapeHtml(port)}">CONNECT FROM THIS PORT</button>`}<p class="port-inline-status" role="status" aria-live="polite">${escapeHtml(traceUnavailable || routeStatus)}</p></div></div>`;
      })
      .join("");
  }

  function chainMarkup(part, inspection) {
    const chains = inspection.configuredControlChains || {
        status: "unsupported",
        totalCount: 0,
        options: [],
      },
      evidence =
        inspection.routeEvidence?.kind ===
          "configured-control-chain-explanation-v1" &&
        inspection.routeEvidence?.partId === part.id
          ? inspection.routeEvidence
          : null;
    if (chains.status === "over-limit")
      return '<p class="configured-chain-status" role="status">Configured chain chooser over-limit · more than 512 eligible binding pairs.</p>';
    if (!chains.options.length) return "";
    const selectedId = evidence?.optionId || chains.options[0].id,
      segmentMarkup = (label, segment, className) => {
        if (!segment) return "";
        return `<li class="${className}"><b>${label}</b><span>${escapeHtml(segment.binding?.id || "unbound")}</span><strong>${escapeHtml(segment.availability || segment.status || "unsupported")}</strong><small>${Number.isSafeInteger(segment.totalHopCount) ? `${segment.totalHopCount} hop${segment.totalHopCount === 1 ? "" : "s"}` : "No complete witness"}</small></li>`;
      };
    return `<details class="configured-chain" ${evidence ? "open" : ""}><summary>CONFIGURED CONTROL CHAINS <small>${chains.totalCount}</small></summary><p>Shows configured signal routes on both sides of one controller. It does not claim the program read one binding and caused the other.</p><label>CHAIN TARGET<select data-configured-chain-target>${chains.options.map((option) => `<option value="${escapeHtml(option.id)}" ${option.id === selectedId ? "selected" : ""}>${escapeHtml(option.inputName)} · ${escapeHtml(option.inputBinding.id)} → ${escapeHtml(option.controllerName)} → ${escapeHtml(option.outputName)} · ${escapeHtml(option.outputBinding.id)}</option>`).join("")}</select></label><button type="button" data-chain-action="trace">TRACE CONFIGURED CHAIN</button><div class="configured-chain-result" role="status" aria-live="polite">${evidence ? `<p>${escapeHtml(evidence.summary)}</p><ol>${segmentMarkup("INPUT SEGMENT", evidence.input, "chain-input")}<li class="chain-boundary"><b>CONTROLLER BOUNDARY</b><span>Authored binding pair</span><strong>PROGRAM CAUSALITY NOT EVALUATED</strong></li>${segmentMarkup("OUTPUT SEGMENT", evidence.output, "chain-output")}</ol>` : ""}</div></details>`;
  }

  function bind(part, inspection) {
    for (const element of view.queryAll("[data-port-control]")) {
      const button = /** @type {HTMLButtonElement} */ (element);
      button.onclick = () => {
        const port = button.dataset.portControl;
        if (!port) return;
        activePortKey =
          activePortKey === `${part.id}:${port}` ? null : `${part.id}:${port}`;
        render();
      };
      button.onkeydown = (event) => {
        if (
          event.key !== "Escape" ||
          activePortKey !== `${part.id}:${button.dataset.portControl}`
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        activePortKey = null;
        render();
        queueMicrotask(() =>
          /** @type {HTMLElement|null} */ (
            view.query(`[data-port-control="${button.dataset.portControl}"]`)
          )?.focus(),
        );
      };
    }
    for (const element of view.queryAll("[data-port-action]")) {
      const button = /** @type {HTMLButtonElement} */ (element);
      button.onclick = async () => {
        const action = button.dataset.portAction,
          port = button.dataset.port,
          portRead = inspection.ports.find(
            (candidate) => candidate.portId === port,
          ),
          selectedConnectionId = /** @type {HTMLSelectElement|null} */ (
            view.query(`[data-counterpart-target="${port}"]`)
          )?.value,
          selectedCounterpart =
            portRead?.counterparts?.find(
              (entry) => entry.connectionId === selectedConnectionId,
            ) || portRead?.counterpart;
        if (action === "connect" && port) return armPort(part.id, port);
        const counterpartPartId = Number(selectedCounterpart?.partId);
        if (action === "select") {
          model.clearRouteEvidence();
          return actions.selectPart(counterpartPartId);
        }
        if (action === "frame") {
          model.clearRouteEvidence();
          return actions.framePart(counterpartPartId);
        }
        if (action === "disconnect") {
          actions.clearRelationshipTrace();
          if (actions.disconnectConnection(selectedCounterpart?.connectionId)) {
            activePortKey = null;
            model.clearRouteEvidence();
          }
          return;
        }
        if (action !== "trace" || !selectedCounterpart) return;
        if (!["power", "signal"].includes(portRead.kind)) {
          actions.showRelationshipTrace([selectedCounterpart.connectionId]);
          model.setRouteEvidence({
            version: 1,
            partId: part.id,
            portId: portRead.portId,
            status: "resolved",
            summary: `Authored direct link · ${selectedCounterpart.connectionId}`,
            connectionIds: [selectedCounterpart.connectionId],
            identity: {
              phase: "authored",
              assemblyRevision: inspection.source.assemblyRevision,
            },
          });
          render();
          return;
        }
        const selectedRouteId = /** @type {HTMLSelectElement|null} */ (
            view.query(`[data-route-target="${port}"]`)
          )?.value,
          selectedRoute =
            portRead.routeTargets?.options?.find(
              (entry) => entry.id === selectedRouteId,
            ) || portRead.routeTargets?.options?.[0];
        if (!selectedRoute) return;
        model.setRouteEvidence({
          version: 1,
          partId: part.id,
          portId: portRead.portId,
          status: "pending",
          summary: "Tracing owner-produced path…",
          connectionIds: [],
          identity: null,
        });
        render();
        const result = await actions.traceComponentRoute({
            ...selectedRoute.query,
          }),
          summary =
            result.status === "resolved"
              ? `${result.identity?.phase === "live" ? `Live path · tick ${result.identity.telemetryTick}` : "Authored path"} · ${result.totalHopCount} hop${result.totalHopCount === 1 ? "" : "s"}`
              : `Trace ${result.status}`;
        model.setRouteEvidence({
          version: 1,
          partId: part.id,
          portId: portRead.portId,
          status: result.status,
          summary,
          connectionIds: (result.hops || []).map((hop) => hop.connectionId),
          identity: result.identity || null,
          networkResultDigest: result.networkResultDigest || null,
          hops: result.hops || [],
        });
        if (result.status === "resolved")
          actions.showRelationshipTrace(
            result.hops.map((hop) => hop.connectionId),
          );
        else actions.clearRelationshipTrace();
        render();
      };
    }
    for (const element of view.queryAll("[data-chain-action]")) {
      const button = /** @type {HTMLButtonElement} */ (element);
      button.onclick = async () => {
        const selectedId = /** @type {HTMLSelectElement|null} */ (
            view.query("[data-configured-chain-target]")
          )?.value,
          option = inspection.configuredControlChains?.options?.find(
            (candidate) => candidate.id === selectedId,
          );
        if (!option) return;
        model.setRouteEvidence({
          version: 1,
          kind: "configured-control-chain-explanation-v1",
          partId: part.id,
          optionId: option.id,
          status: "pending",
          summary: "Tracing configured signal segments…",
          input: null,
          output: null,
        });
        render();
        const result = await actions.traceConfiguredControlChain(option),
          projectSegment = (segment) => {
            const witness = segment?.witness;
            return {
              binding: segment?.binding || null,
              availability: segment?.availability || "unsupported",
              status: witness?.status || segment?.availability || "unsupported",
              identity: witness?.identity || null,
              networkResultDigest: witness?.networkResultDigest || null,
              controllerPortSelection: witness?.controllerPortSelection || null,
              hops: witness?.hops || [],
              connectionIds: (witness?.hops || []).map(
                (hop) => hop.connectionId,
              ),
              totalHopCount: witness?.totalHopCount ?? null,
            };
          },
          input = projectSegment(result.input),
          output = projectSegment(result.output),
          summary =
            result.status === "resolved"
              ? "Configured routes resolved · program causality not evaluated"
              : `Configured chain ${result.status} · input ${input.availability} · output ${output.availability}`;
        model.setRouteEvidence({
          version: 1,
          kind: result.kind,
          claim: result.claim,
          partId: part.id,
          optionId: option.id,
          status: result.status,
          summary,
          controllerBoundary: result.controllerBoundary,
          continuousOverlay: false,
          input,
          output,
        });
        actions.showRelationshipTraceSegments({
          input: input.status === "resolved" ? input.connectionIds : [],
          output: output.status === "resolved" ? output.connectionIds : [],
        });
        render();
      };
    }
  }

  return Object.freeze({ bind, chainMarkup, markup });
}
