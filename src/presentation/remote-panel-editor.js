import * as THREE from "three";
import {
  defaultActionBinding,
  REMOTE_ACTIONS,
} from "../model/remote-actions.js";

/** Renders customization-only fields; this module is lazy-loaded on demand. */
export function renderRemoteControlEditor({
  control,
  index,
  controls,
  actionBindings,
  keyName,
  escape,
}) {
  const actionEditor = REMOTE_ACTIONS.map((action) => {
    const binding = actionBindings[action],
      checked = binding?.controlId === control.id,
      compatible =
        action === "lights"
          ? control.type === "toggle"
          : action === "brake"
            ? ["range", "hold"].includes(control.type)
            : control.type === "range",
      minimum = control.type === "range" ? control.min : 0,
      maximum = control.type === "range" ? control.max : 1,
      step = control.type === "range" ? control.step : 1,
      valueEditor =
        checked && action !== "lights"
          ? `<span class="command-action-values"><label>ON<input class="command-action-number" data-action="${action}" data-prop="pressedValue" data-index="${index}" type="number" min="${minimum}" max="${maximum}" step="${step}" value="${binding.pressedValue}"></label><label>OFF<input class="command-action-number" data-action="${action}" data-prop="releasedValue" data-index="${index}" type="number" min="${minimum}" max="${maximum}" step="${step}" value="${binding.releasedValue}"></label></span>`
          : "";
    return `<div class="command-action"><label><input type="checkbox" data-action="${action}" data-index="${index}" ${checked ? "checked" : ""} ${compatible ? "" : "disabled"}>${action.toUpperCase()}</label>${valueEditor}</div>`;
  }).join("");
  return `<div class="control-editor"><label>CHANNEL<input class="command-channel" data-index="${index}" value="${escape(control.channel)}"></label><label>TYPE<select class="command-type" data-index="${index}"><option value="range" ${control.type === "range" ? "selected" : ""}>RANGE</option><option value="toggle" ${control.type === "toggle" ? "selected" : ""}>TOGGLE</option><option value="hold" ${control.type === "hold" ? "selected" : ""}>HOLD</option><option value="pulse" ${control.type === "pulse" ? "selected" : ""}>PULSE</option></select></label>${control.type === "range" ? `<label>MIN<input class="command-number" data-prop="min" data-index="${index}" type="number" value="${control.min}"></label><label>MAX<input class="command-number" data-prop="max" data-index="${index}" type="number" value="${control.max}"></label><label>STEP<input class="command-number" data-prop="step" data-index="${index}" type="number" min="0.001" value="${control.step}"></label>` : ""}<label>SHORTCUT<button class="hotkey-capture" data-index="${index}">${keyName(control.hotkey)}</button></label><fieldset class="command-actions"><legend>DIRECT ACTIONS</legend>${actionEditor}</fieldset><div class="edit-actions"><button class="move-command" data-dir="-1" data-index="${index}" ${index === 0 ? "disabled" : ""}>↑</button><button class="move-command" data-dir="1" data-index="${index}" ${index === controls.length - 1 ? "disabled" : ""}>↓</button><button class="duplicate-command" data-index="${index}">DUPLICATE</button><button class="delete-command" data-index="${index}">DELETE</button></div></div>`;
}

/** Binds customization-only events after the panel's HTML transaction. */
export function bindRemoteControlEditor({
  state,
  $$,
  controls,
  profile,
  actionBindings,
  persistRemotes,
  renderRemote,
  nextControlId,
}) {
  $$(".command-action > label > input").forEach(
    (element) =>
      (element.onchange = () => {
        const control = controls[+element.dataset.index],
          action = element.dataset.action;
        profile.actionBindings ||= {};
        if (element.checked)
          profile.actionBindings[action] = defaultActionBinding(
            action,
            control,
          );
        else if (profile.actionBindings[action]?.controlId === control.id)
          delete profile.actionBindings[action];
        persistRemotes();
        renderRemote();
      }),
  );
  $$(".command-action-number").forEach(
    (element) =>
      (element.onchange = () => {
        const control = controls[+element.dataset.index],
          binding = profile.actionBindings?.[element.dataset.action];
        if (!binding || binding.controlId !== control.id) return;
        const minimum = control.type === "range" ? control.min : 0,
          maximum = control.type === "range" ? control.max : 1;
        profile.actionBindings[element.dataset.action] = {
          ...binding,
          [element.dataset.prop]: THREE.MathUtils.clamp(
            Number(element.value),
            minimum,
            maximum,
          ),
        };
        persistRemotes();
        renderRemote();
      }),
  );
  $$(".command-label").forEach(
    (element) =>
      (element.onchange = () => {
        controls[+element.dataset.index].label =
          element.value.trim() || "Untitled control";
        persistRemotes();
        renderRemote();
      }),
  );
  $$(".command-channel").forEach(
    (element) =>
      (element.onchange = () => {
        controls[+element.dataset.index].channel =
          element.value
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, "_") || "aux";
        persistRemotes();
        renderRemote();
      }),
  );
  $$(".command-type").forEach(
    (element) =>
      (element.onchange = () => {
        const control = controls[+element.dataset.index];
        control.type = element.value;
        control.value = 0;
        control.defaultValue = 0;
        if (control.type === "range") {
          control.min ??= -1;
          control.max ??= 1;
          control.step ??= 0.05;
        }
        for (const [action, binding] of Object.entries(actionBindings))
          if (
            binding.controlId === control.id &&
            !(
              (action === "lights" && control.type === "toggle") ||
              (action === "brake" &&
                ["range", "hold"].includes(control.type)) ||
              (!["lights", "brake"].includes(action) &&
                control.type === "range")
            )
          )
            delete actionBindings[action];
        persistRemotes();
        renderRemote();
      }),
  );
  $$(".command-number").forEach(
    (element) =>
      (element.onchange = () => {
        const control = controls[+element.dataset.index];
        control[element.dataset.prop] = +element.value;
        if (control.max <= control.min) control.max = control.min + 1;
        if (control.step <= 0) control.step = 0.01;
        control.value = THREE.MathUtils.clamp(
          control.value,
          control.min,
          control.max,
        );
        for (const binding of Object.values(actionBindings))
          if (binding.controlId === control.id)
            for (const property of ["pressedValue", "releasedValue"])
              if (binding[property] != null)
                binding[property] = THREE.MathUtils.clamp(
                  binding[property],
                  control.min,
                  control.max,
                );
        persistRemotes();
        renderRemote();
      }),
  );
  $$(".hotkey-capture").forEach(
    (element) =>
      (element.onclick = () => {
        state.capturingHotkey = +element.dataset.index;
        $$(".hotkey-capture").forEach((item) =>
          item.classList.remove("capturing"),
        );
        element.classList.add("capturing");
        element.textContent = "PRESS KEY…";
      }),
  );
  $$(".delete-command").forEach(
    (element) =>
      (element.onclick = () => {
        const removed = controls.splice(+element.dataset.index, 1)[0];
        for (const [action, binding] of Object.entries(actionBindings))
          if (binding.controlId === removed.id) delete actionBindings[action];
        persistRemotes();
        renderRemote();
      }),
  );
  $$(".duplicate-command").forEach(
    (element) =>
      (element.onclick = () => {
        const control = structuredClone(controls[+element.dataset.index]);
        control.label += " Copy";
        control.id = nextControlId(state.remoteProfile, controls);
        control.hotkey = null;
        controls.splice(+element.dataset.index + 1, 0, control);
        persistRemotes();
        renderRemote();
      }),
  );
  $$(".move-command").forEach(
    (element) =>
      (element.onclick = () => {
        const index = +element.dataset.index,
          targetIndex = index + +element.dataset.dir;
        if (targetIndex < 0 || targetIndex >= controls.length) return;
        [controls[index], controls[targetIndex]] = [
          controls[targetIndex],
          controls[index],
        ];
        persistRemotes();
        renderRemote();
      }),
  );
}
