import { TYPES } from "../model/component-catalog.js";

/**
 * Renders network routes that may be explicitly opened by an authored release
 * coupler. This editor owns no topology policy; strict model validation remains
 * authoritative when the workspace is synchronized.
 *
 * @param {{
 *   connections: Array<{a:number,b:number,kind:string,releaseCouplerPartId?:number}>,
 *   parts: Array<{id:number,type:string,mechanism?:{config?:{releaseLaw?:{kind?:string}}}}>,
 *   selectedPartId: number,
 *   running: boolean,
 * }} input
 */
export function breakawayUmbilicalMarkup({
  connections,
  parts,
  selectedPartId,
  running,
}) {
  const networkConnections = connections.filter(
    (connection) =>
      ["power", "signal", "resource"].includes(connection.kind) &&
      (connection.a === selectedPartId || connection.b === selectedPartId),
  );
  if (!networkConnections.length) return "";
  const releaseCouplers = parts.filter(
    (part) =>
      part.mechanism?.config?.releaseLaw?.kind === "electromechanical-latch-v1",
  );
  return `<div class="attachment-monitor breakaway-monitor"><h4>NETWORK UMBILICALS</h4><p class="component-contract-note">Optionally bind a cable or fluid line to a physical release coupler. Only declared umbilicals open with that latch.</p>${networkConnections
    .map((connection) => {
      const index = connections.findIndex(
          (candidate) => candidate === connection,
        ),
        otherId = connection.a === selectedPartId ? connection.b : connection.a,
        other = parts.find((candidate) => candidate.id === otherId),
        options = releaseCouplers
          .map(
            (candidate) =>
              `<option value="${candidate.id}" ${connection.releaseCouplerPartId === candidate.id ? "selected" : ""}>${TYPES[candidate.type].name} #${candidate.id}</option>`,
          )
          .join("");
      return `<label class="property"><span>${connection.kind.toUpperCase()} · ${other ? TYPES[other.type].name : `#${otherId}`}<b>BREAKAWAY LATCH</b></span><select data-breakaway-connection-index="${index}" ${running ? "disabled" : ""}><option value="">NONE</option>${options}</select></label>`;
    })
    .join("")}</div>`;
}

/** @param {{
 *   elements: Element[],
 *   connections: () => Array<{releaseCouplerPartId?:number}>,
 *   recordHistory: (label:string) => void,
 *   syncAssembly: () => void,
 *   drawConnections: () => void,
 *   render: () => void,
 * }} input */
export function bindBreakawayUmbilicalEditor({
  elements,
  connections,
  recordHistory,
  syncAssembly,
  drawConnections,
  render,
}) {
  for (const element of elements) {
    const select = /** @type {HTMLSelectElement} */ (element);
    select.onchange = () => {
      const connection =
        connections()[+select.dataset.breakawayConnectionIndex];
      if (!connection) return;
      recordHistory("configure breakaway umbilical");
      const couplerId = Number(select.value);
      if (
        select.value !== "" &&
        Number.isSafeInteger(couplerId) &&
        couplerId >= 0
      )
        connection.releaseCouplerPartId = couplerId;
      else delete connection.releaseCouplerPartId;
      syncAssembly();
      drawConnections();
      render();
    };
  }
}
