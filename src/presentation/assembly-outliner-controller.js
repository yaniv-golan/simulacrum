import { TYPES } from "../model/component-catalog.js";
import { escapeHtml as escapeMarkup } from "./html.js";

/** Exact, keyboard-native selection for authored parts, ports and connections. */
export function createAssemblyOutlinerController({ model, view, actions }) {
  let lastRenderSignature = null,
    activeKey = null,
    typeahead = "",
    typeaheadTimer = null;
  const collapsedParts = new Set();

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

  function selectedKey(selectedEntity) {
    if (selectedEntity?.kind === "part") return `part:${selectedEntity.partId}`;
    if (selectedEntity?.kind === "port")
      return `port:${selectedEntity.partId}:${selectedEntity.port}`;
    if (selectedEntity?.kind === "connection")
      return `connection:${selectedEntity.connectionId}`;
    return null;
  }

  function items() {
    return view
      .queryAll('[role="treeitem"]')
      .filter((item) => !item.closest('[role="group"][hidden]'));
  }

  function focusItem(item) {
    if (!item) return;
    for (const candidate of view.queryAll('[role="treeitem"]'))
      candidate.tabIndex = candidate === item ? 0 : -1;
    activeKey = item.dataset.outlinerKey || null;
    item.focus();
  }

  function parentItem(item) {
    const group = item.closest('[role="group"]');
    return group?.parentElement?.querySelector(':scope > [role="treeitem"]');
  }

  function childItems(item) {
    return [
      ...(item.parentElement
        ?.querySelector(':scope > [role="group"]')
        ?.querySelectorAll(':scope > li > [role="treeitem"]') || []),
    ];
  }

  function setExpanded(item, expanded) {
    const group = item.parentElement?.querySelector(':scope > [role="group"]');
    if (!group) return false;
    item.setAttribute("aria-expanded", String(expanded));
    group.hidden = !expanded;
    const partId = Number(item.dataset.outlinerPart);
    if (expanded) collapsedParts.delete(partId);
    else collapsedParts.add(partId);
    return true;
  }

  function activate(item) {
    activeKey = item.dataset.outlinerKey || null;
    if (item.dataset.outlinerPart)
      actions.selectPart(Number(item.dataset.outlinerPart));
    else if (item.dataset.outlinerPort) {
      const partId = Number(item.dataset.outlinerPortPart),
        port = item.dataset.outlinerPort;
      if (port) actions.selectPort(partId, port);
    } else if (item.dataset.outlinerConnection) {
      actions.selectConnection(
        item.dataset.outlinerConnection,
        Number(item.dataset.outlinerConnectionPart),
      );
    }
    queueMicrotask(() => {
      const next = view
        .queryAll('[role="treeitem"]')
        .find((candidate) => candidate.dataset.outlinerKey === activeKey);
      focusItem(next);
    });
  }

  function onKeydown(event) {
    const item =
      event.target instanceof Element &&
      event.target.closest('[role="treeitem"]');
    if (!item) return;
    const visible = items(),
      index = visible.indexOf(item);
    let next = null;
    if (event.key === "ArrowDown") next = visible[index + 1] || visible[0];
    else if (event.key === "ArrowUp")
      next = visible[index - 1] || visible.at(-1);
    else if (event.key === "Home") next = visible[0];
    else if (event.key === "End") next = visible.at(-1);
    else if (event.key === "ArrowRight") {
      if (item.getAttribute("aria-expanded") === "false")
        setExpanded(item, true);
      else next = childItems(item)[0];
    } else if (event.key === "ArrowLeft") {
      if (item.getAttribute("aria-expanded") === "true")
        setExpanded(item, false);
      else next = parentItem(item);
    } else if (["Enter", " "].includes(event.key)) activate(item);
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      clearTimeout(typeaheadTimer);
      typeahead += event.key.toLowerCase();
      typeaheadTimer = setTimeout(() => (typeahead = ""), 650);
      const ordered = [
        ...visible.slice(index + 1),
        ...visible.slice(0, index + 1),
      ];
      next = ordered.find((candidate) =>
        candidate.textContent?.trim().toLowerCase().startsWith(typeahead),
      );
    } else return;
    event.preventDefault();
    event.stopPropagation();
    if (next) focusItem(next);
  }

  function render() {
    const signature = renderSignature();
    if (signature === lastRenderSignature) return;
    lastRenderSignature = signature;
    const list = view.list(),
      restoreFocus = list.contains(list.ownerDocument.activeElement),
      selectedEntity = model.selectedEntity(),
      chosenKey = selectedKey(selectedEntity) || activeKey,
      partRows = model
        .parts()
        .map((part) => {
          const type = TYPES[part.type],
            selected =
              (selectedEntity?.kind === "part" &&
                selectedEntity.partId === part.id) ||
              (selectedEntity?.kind === "parts" &&
                selectedEntity.partIds?.includes(part.id)),
            expanded = !collapsedParts.has(part.id),
            partKey = `part:${part.id}`;
          return `<li role="none"><button type="button" role="treeitem" aria-level="1" aria-expanded="${expanded}" data-outliner-key="${partKey}" data-outliner-part="${part.id}" ${selected ? 'aria-current="true"' : ""}><b>${escapeMarkup(type?.name || part.type)}</b><span>part #${part.id} · ${type.ports.length} ports</span></button><ul role="group" ${expanded ? "" : "hidden"}>${type.ports.map((port) => `<li role="none"><button type="button" role="treeitem" aria-level="2" data-outliner-key="port:${part.id}:${escapeMarkup(port.id)}" data-outliner-port-part="${part.id}" data-outliner-port="${escapeMarkup(port.id)}" ${selectedEntity?.kind === "port" && selectedEntity.partId === part.id && selectedEntity.port === port.id ? 'aria-current="true"' : ""}><b>${escapeMarkup(port.id)}</b><span>${escapeMarkup(port.kind)} port</span></button></li>`).join("")}</ul></li>`;
        })
        .join(""),
      connectionRows = model
        .connections()
        .map((connection, index) => {
          const id = connection.id || `connection-${index}`,
            selected =
              selectedEntity?.kind === "connection" &&
              selectedEntity.connectionId === id;
          return `<li role="none"><button type="button" role="treeitem" aria-level="1" data-outliner-key="connection:${escapeMarkup(id)}" data-outliner-connection="${escapeMarkup(id)}" data-outliner-connection-part="${connection.a}" ${selected ? 'aria-current="true"' : ""}><b>${escapeMarkup(id)}</b><span>${escapeMarkup(connection.kind)} · #${connection.a}:${escapeMarkup(connection.portA || "?")} ↔ #${connection.b}:${escapeMarkup(connection.portB || "?")}</span></button></li>`;
        })
        .join("");
    list.innerHTML = `<div class="outliner-summary">PARTS AND PORTS · ${model.parts().length} · CONNECTIONS · ${model.connections().length}</div><ul role="tree" aria-label="Assembly entities">${partRows}${connectionRows || ""}${partRows || connectionRows ? "" : '<li role="none">No assembly entities</li>'}</ul>`;
    const all = view.queryAll('[role="treeitem"]'),
      active =
        all.find((item) => item.dataset.outlinerKey === chosenKey) || all[0];
    for (const item of all) {
      item.tabIndex = item === active ? 0 : -1;
      item.onclick = () => activate(item);
      item.onkeydown = onKeydown;
    }
    activeKey = active?.dataset.outlinerKey || null;
    if (restoreFocus) focusItem(active);
  }

  return Object.freeze({ render });
}
