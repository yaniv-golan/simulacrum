import { TYPES } from "../model/component-catalog.js";
import { escapeHtml, formatKeyCode } from "./html.js";

const STATUS_LABELS = {
  online: "LINKED",
  unbound: "UNBOUND — CHOOSE A TARGET",
  "missing-target": "TARGET MISSING — REBIND",
  "incompatible-target": "INCOMPATIBLE TARGET — REBIND",
  unpowered: "TARGET UNPOWERED",
  "no-signal-route": "NO CONTROLLER SIGNAL ROUTE",
};

export function createRemotePanel({
  state,
  $,
  $$,
  readControlBinding,
  renderDirectSurface,
  persistRemoteDefinitions,
  persistRemoteState,
  nextControlId,
}) {
  let editorModule = null,
    editorLoad = null;
  function ensureEditorModule() {
    editorLoad ||= import("./remote-panel-editor.js").then((module) => {
      editorModule = module;
      if (state.remoteEdit) renderRemote();
      return module;
    });
    return editorLoad;
  }
  const persistRemotes = persistRemoteDefinitions;
  function controlOnline(control) {
    return readControlBinding(control).online;
  }
  function syncControlWidgets(control) {
    const controls = state.remoteControls[state.remoteProfile] || [],
      index = controls.indexOf(control);
    if (index < 0) return;
    const value = Number(control.value || 0),
      precision = control.step < 0.1 ? 2 : 0;
    for (const selector of [
      `.command-range[data-index="${index}"]`,
      `.direct-range[data-index="${index}"]`,
    ]) {
      const input = $(selector);
      if (!input) continue;
      input.value = String(value);
      if (input.nextElementSibling)
        input.nextElementSibling.textContent = value.toFixed(precision);
    }
    for (const selector of [
      `.command-toggle[data-index="${index}"]`,
      `.direct-toggle[data-index="${index}"]`,
    ]) {
      const button = $(selector);
      if (!button) continue;
      button.classList.toggle(
        selector.startsWith(".command") ? "on" : "active",
        Boolean(value),
      );
      button.textContent = value ? "ON" : "OFF";
    }
  }
  function sendCommand(control, value) {
    control.value = value;
    control.active = true;
    if (["range", "toggle"].includes(control.type)) persistRemoteState();
    renderRemoteStatus();
    syncControlWidgets(control);
  }
  function renderRemoteStatus() {
    const controls = state.remoteControls[state.remoteProfile],
      online = controls.filter(controlOnline).length,
      active = controls.filter((c) => Number(c.value) !== 0).length;
    $(".uplink").classList.toggle("online", online > 0);
    $(".uplink span").textContent = online
      ? `${online}/${controls.length} CHANNELS ONLINE`
      : "NO POWERED CONTROLLER";
    $("#command-count").textContent =
      `${active} CHANNEL${active === 1 ? "" : "S"} ACTIVE`;
  }
  function renderRemote() {
    if (state.remoteEdit && !editorModule) void ensureEditorModule();
    const controls = state.remoteControls[state.remoteProfile] || [],
      profile = state.remoteProfiles[state.remoteProfile],
      actionBindings = profile?.actionBindings || {};
    $("#remote-profile").value = state.remoteProfile;
    $("#edit-remote").classList.toggle("active", state.remoteEdit);
    $("#edit-remote").textContent = state.remoteEdit ? "DONE" : "CUSTOMIZE";
    $(".remote-controls").innerHTML = controls
      .map((c, i) => {
        const binding = readControlBinding(c),
          options = state.parts
            .filter((p) => binding.compatiblePartIds.includes(p.id))
            .map(
              (p) =>
                `<option value="${p.id}" ${p.id === c.targetId ? "selected" : ""}>${escapeHtml(TYPES[p.type].name)} #${p.id}</option>`,
            )
            .join(""),
          online = binding.online,
          statusLabel = STATUS_LABELS[binding.status] || binding.status,
          label = state.remoteEdit
            ? `<input class="command-label" data-index="${i}" value="${escapeHtml(c.label)}">`
            : `<b>${escapeHtml(c.label)}</b>`,
          invalidOption =
            c.targetId != null &&
            !state.parts.some((part) => part.id === c.targetId)
              ? `<option value="${c.targetId}" selected>MISSING #${c.targetId}</option>`
              : "",
          targetSelect = `<label class="command-binding">TARGET<select class="command-target" data-index="${i}"><option value="">UNBOUND</option>${invalidOption}${options}</select><small>${escapeHtml(statusLabel)}</small></label>`;
        let widget;
        if (c.type === "range")
          widget = `<input class="command-range" data-index="${i}" type="range" min="${c.min}" max="${c.max}" step="${c.step}" value="${c.value}"><output>${Number(c.value).toFixed(c.step < 0.1 ? 2 : 0)}</output>`;
        else if (c.type === "toggle")
          widget = `<button class="command-toggle ${c.value ? "on" : ""}" data-index="${i}">${c.value ? "ON" : "OFF"}</button>`;
        else
          widget = `<button class="command-hold" data-index="${i}">${c.type === "pulse" ? "SEND" : "HOLD"}</button>`;
        const editor = state.remoteEdit
          ? editorModule
            ? editorModule.renderRemoteControlEditor({
                control: c,
                index: i,
                controls,
                actionBindings,
                escape: escapeHtml,
                keyName: (code) =>
                  state.capturingHotkey === i
                    ? "PRESS KEY…"
                    : formatKeyCode(code),
              })
            : `<div class="control-editor">LOADING CUSTOMIZATION…</div>`
          : `<div class="shortcut-hint"><kbd>${formatKeyCode(c.hotkey)}</kbd><span>${c.type === "range" ? "KEY + / SHIFT −" : c.type === "hold" ? "HOLD KEY" : c.type === "toggle" ? "KEY TOGGLE · SHIFT OFF" : "KEY TO SEND"}</span></div>`;
        return `<div class="remote-control ${online ? "online" : "offline"}" data-control-index="${i}" data-binding-status="${binding.status}"><div class="control-meta"><span class="channel-led"></span><div>${label}<small>CH ${escapeHtml(c.channel.toUpperCase())} · ${escapeHtml(statusLabel)}</small></div></div><div class="control-widget">${widget}</div>${targetSelect}${editor}</div>`;
      })
      .join("");
    $$(".command-range").forEach(
      (el) =>
        (el.oninput = () => {
          const c = controls[+el.dataset.index];
          sendCommand(c, +el.value);
          el.nextElementSibling.textContent = Number(el.value).toFixed(
            c.step < 0.1 ? 2 : 0,
          );
        }),
    );
    $$(".command-toggle").forEach(
      (el) =>
        (el.onclick = () => {
          const c = controls[+el.dataset.index];
          sendCommand(c, c.value ? 0 : 1);
          renderRemote();
        }),
    );
    $$(".command-hold").forEach((el) => {
      const c = controls[+el.dataset.index];
      el.onpointerdown = () => {
        sendCommand(c, 1);
        el.classList.add("on");
      };
      el.onpointerup = el.onpointerleave = () => {
        if (c.type === "hold") {
          sendCommand(c, 0);
          el.classList.remove("on");
        } else
          setTimeout(() => {
            sendCommand(c, 0);
            el.classList.remove("on");
          }, 180);
      };
    });
    $$(".command-target").forEach(
      (el) =>
        (el.onchange = () => {
          controls[+el.dataset.index].targetId = +el.value || null;
          persistRemotes();
          renderRemote();
        }),
    );
    if (state.remoteEdit && editorModule)
      editorModule.bindRemoteControlEditor({
        state,
        $$,
        controls,
        profile,
        actionBindings,
        persistRemotes,
        renderRemote,
        nextControlId,
      });
    $("#toggle-direct-panel").textContent = state.directSurfaces[
      state.remoteProfile
    ]
      ? "UNPIN DIRECT PANEL"
      : "PIN DIRECT PANEL";
    $("#toggle-direct-panel").classList.toggle(
      "active",
      !!state.directSurfaces[state.remoteProfile],
    );
    renderRemoteStatus();
    renderDirectSurface();
  }
  return {
    controlOnline,
    esc: escapeHtml,
    persistRemotes,
    renderRemote,
    sendCommand,
  };
}
