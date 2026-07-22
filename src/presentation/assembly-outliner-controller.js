import { TYPES } from "../model/component-catalog.js";
import { escapeHtml as escapeMarkup } from "./html.js";

/** Exact, keyboard-native selection for authored parts, ports and connections. */
export function createAssemblyOutlinerController({ model, view, actions }) {
  let lastRenderSignature = null;

  function renderSignature() {
    return JSON.stringify({
      parts: model.parts().map(({ id, type }) => [id, type]),
      connections: model
        .connections()
        .map(({ id, a, b, portA, portB, kind }) => [
          id,
          a,
          b,
          portA,
          portB,
          kind,
        ]),
      selected: model.selectedEntity(),
    });
  }

  function render() {
    const signature = renderSignature();
    if (signature === lastRenderSignature) return;
    lastRenderSignature = signature;
    const selectedEntity = model.selectedEntity(),
      partRows = model
        .parts()
        .map((part) => {
          const type = TYPES[part.type],
            selected =
              (selectedEntity?.kind === "part" &&
                selectedEntity.partId === part.id) ||
              (selectedEntity?.kind === "parts" &&
                selectedEntity.partIds?.includes(part.id));
          return `<li><button type="button" data-outliner-part="${part.id}" ${selected ? 'aria-current="true"' : ""}><b>${escapeMarkup(type?.name || part.type)}</b><span>part #${part.id} · ${type.ports.length} ports</span></button><ul>${type.ports.map((port) => `<li><button type="button" data-outliner-port-part="${part.id}" data-outliner-port="${escapeMarkup(port.id)}" ${selectedEntity?.kind === "port" && selectedEntity.partId === part.id && selectedEntity.port === port.id ? 'aria-current="true"' : ""}><b>${escapeMarkup(port.id)}</b><span>${escapeMarkup(port.kind)} port</span></button></li>`).join("")}</ul></li>`;
        })
        .join(""),
      connectionRows = model
        .connections()
        .map((connection, index) => {
          const id = connection.id || `connection-${index}`,
            selected =
              selectedEntity?.kind === "connection" &&
              selectedEntity.connectionId === id;
          return `<li><button type="button" data-outliner-connection="${escapeMarkup(id)}" data-outliner-connection-part="${connection.a}" ${selected ? 'aria-current="true"' : ""}><b>${escapeMarkup(id)}</b><span>${escapeMarkup(connection.kind)} · #${connection.a}:${escapeMarkup(connection.portA || "?")} ↔ #${connection.b}:${escapeMarkup(connection.portB || "?")}</span></button></li>`;
        })
        .join("");
    view.list().innerHTML = `<details open><summary>PARTS AND PORTS · ${model.parts().length}</summary><ul>${partRows || "<li>No parts</li>"}</ul></details><details open><summary>CONNECTIONS · ${model.connections().length}</summary><ul>${connectionRows || "<li>No connections</li>"}</ul></details>`;
    for (const element of view.queryAll("[data-outliner-part]"))
      element.onclick = () =>
        actions.selectPart(Number(element.dataset.outlinerPart));
    for (const element of view.queryAll("[data-outliner-port]"))
      element.onclick = () => {
        const partId = Number(element.dataset.outlinerPortPart),
          port = element.dataset.outlinerPort;
        if (port) actions.selectPort(partId, port);
      };
    for (const element of view.queryAll("[data-outliner-connection]"))
      element.onclick = () => {
        for (const candidate of view.queryAll("[aria-current]"))
          candidate.removeAttribute("aria-current");
        element.setAttribute("aria-current", "true");
        actions.selectConnection(
          element.dataset.outlinerConnection || "",
          Number(element.dataset.outlinerConnectionPart),
        );
      };
  }
  return Object.freeze({ render });
}
