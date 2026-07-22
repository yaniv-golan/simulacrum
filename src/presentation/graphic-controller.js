import { escapeHtml } from "./html.js";

const button = (direction, icon, label, key, online) =>
  `<button class="pilot-button pilot-${direction} ${online ? "online" : "offline"}" data-pilot-action="${direction}" title="${label} (${key})"><span>${icon}</span><small>${label}</small><kbd>${key}</kbd></button>`;

export function renderGraphicController({ layout, actionFor, onlineFor }) {
  if (layout?.style !== "drive-pad") return null;
  const action = (name) => actionFor(name),
    online = (resolved) =>
      resolved?.status === "ready" && onlineFor(resolved.control),
    lights = action("lights");
  return `<div class="pilot-shell" style="--controller-accent:${layout.accent}">
    <div class="pilot-grip left-grip"></div><div class="pilot-grip right-grip"></div>
    <div class="pilot-title"><span>MODEL CONTROL</span><b>${escapeHtml(layout.title)}</b></div>
    <div class="pilot-pad">
      ${button("forward", "▲", "FORWARD", "W", online(action("forward")))}
      ${button("left", "◀", "LEFT", "A", online(action("left")))}
      <div class="pilot-center"><i></i><span>DRIVE</span></div>
      ${button("right", "▶", "RIGHT", "D", online(action("right")))}
      ${button("reverse", "▼", "REVERSE", "S", online(action("reverse")))}
    </div>
    <div class="pilot-aux">
      ${button("brake", "■", "BRAKE", "SPACE", online(action("brake")))}
      <button class="pilot-toggle ${lights?.control?.value ? "active" : ""} ${online(lights) ? "online" : "offline"}" data-pilot-toggle="lights"><span>◉</span><small>LIGHTS</small><kbd>L</kbd></button>
    </div>
  </div>`;
}
