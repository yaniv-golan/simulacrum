import { renderGraphicController } from "../presentation/graphic-controller.js";
import { updateControllerWindowChrome } from "../presentation/controller-window.js";
import { escapeHtml, formatKeyCode } from "../presentation/html.js";
import {
  resolveRemoteAction,
  resolveRemoteActionState,
} from "../model/remote-actions.js";

/**
 * @typedef {{
 *   label: string, channel: string, type: string, value: number,
 *   min?: number, max?: number, step?: number, hotkey?: string | null,
 * }} DirectControl
 * @typedef {{ id: number, type: string, pos: number[], mesh: import("three").Object3D }} DirectPart
 * @typedef {{
 *   parts: DirectPart[], remoteProfile: string,
 *   remoteControls: Record<string, DirectControl[]>, remoteProfiles:Record<string,object>,
 *   directSurfaces: Record<string, boolean>,
 *   controllerLayouts: Record<string, object>,
 *   running: boolean, exploded: boolean, speedMps: number,
 * }} DirectWorkspace
 * @typedef {{
 *   query: (selector: string) => Element | null,
 *   queryAll: (selector: string) => Element[],
 *   controlOnline: (control: DirectControl) => boolean,
 *   sendCommand: (control: DirectControl, value: number) => void,
 *   renderRemote: () => void,
 * }} DirectViewPort
 * @typedef {{
 *   persistSurfaces: (surfaces: Record<string, boolean>) => void,
 *   persistControls: () => void,
 * }} DirectPersistencePort
 */

/**
 * Owns the model-specific direct controller, semantic input state, and physical
 * headlight presentation. The generic Field Remote remains an independent
 * fallback and supplies only command/presentation operations through a port.
 *
 * @param {{
 *   workspace: DirectWorkspace,
 *   view: DirectViewPort,
 *   persistence: DirectPersistencePort,
 *   controlTemplates: Record<string, DirectControl[]>,
 * }} ports
 */
export function createDirectControlFeature({
  workspace,
  view,
  persistence,
  controlTemplates,
}) {
  const driveKeys = {
      forward: false,
      reverse: false,
      left: false,
      right: false,
      brake: false,
    },
    surfaceReleases = new Set(),
    surfaceTimers = new Set();
  const required = (selector) => {
    const element = view.query(selector);
    if (!element) throw new Error(`Missing direct-control element ${selector}`);
    return element;
  };

  function ensureControls(profile) {
    if (Array.isArray(workspace.remoteControls[profile])) return;
    workspace.remoteControls[profile] = structuredClone(
      controlTemplates[profile] || [],
    );
    persistence.persistControls();
  }

  /** @returns {Array<{part:DirectPart,bulb:any,light:any}>} */
  function lampPresentations() {
    return workspace.parts.flatMap((part) => {
      let bulb = /** @type {any} */ (null),
        light = /** @type {any} */ (null);
      part.mesh.traverse((object) => {
        if (object.userData.headlightBulb) bulb = object;
        if (object.userData.headlightLight) light = object;
      });
      return light ? [{ part, bulb, light }] : [];
    });
  }

  function setLights(activePartIds) {
    const active = new Set(activePartIds || []);
    for (const { part, bulb, light } of lampPresentations()) {
      const enabled = active.has(part.id);
      light.power = enabled ? Number(light.userData.lumens || 0) : 0;
      if (!enabled && light.shadow?.map) {
        light.shadow.map.dispose();
        light.shadow.map = null;
        if (light.shadow.mapPass) {
          light.shadow.mapPass.dispose();
          light.shadow.mapPass = null;
        }
      }
      light.castShadow = enabled;
      if (bulb?.material) bulb.material.emissiveIntensity = enabled ? 4 : 0.08;
    }
  }

  function action(action, pressed = true) {
    return resolveRemoteAction(
      workspace.remoteProfiles[workspace.remoteProfile],
      workspace.remoteControls[workspace.remoteProfile] || [],
      action,
      pressed,
    );
  }

  function applyDriveInput() {
    const commands = resolveRemoteActionState(
      workspace.remoteProfiles[workspace.remoteProfile],
      workspace.remoteControls[workspace.remoteProfile] || [],
      driveKeys,
    );
    for (const { control, value } of commands)
      if (Number(control.value) !== value) view.sendCommand(control, value);
    for (const element of view.queryAll("[data-drive]")) {
      const button = /** @type {HTMLElement} */ (element);
      const action = button.dataset.drive;
      button.classList.toggle("active", Boolean(action && driveKeys[action]));
    }
  }

  function setDriveInput(action, pressed) {
    if (
      !Object.prototype.hasOwnProperty.call(driveKeys, action) ||
      action === "lights" ||
      resolveRemoteAction(
        workspace.remoteProfiles[workspace.remoteProfile],
        workspace.remoteControls[workspace.remoteProfile] || [],
        action,
        pressed,
      ).status === "unsupported"
    )
      return false;
    driveKeys[action] = pressed;
    applyDriveInput();
    return true;
  }

  function toggleLights() {
    const resolved = action("lights", true);
    if (resolved.status !== "ready") return;
    view.sendCommand(resolved.control, resolved.value);
    view.renderRemote();
  }

  function resetDriveInput() {
    releaseSurfaceInputs();
    for (const key of Object.keys(driveKeys)) driveKeys[key] = false;
    applyDriveInput();
  }

  function releaseSurfaceInputs() {
    for (const release of [...surfaceReleases]) release();
    surfaceReleases.clear();
    for (const timer of surfaceTimers) clearTimeout(timer);
    surfaceTimers.clear();
  }

  function persistSurfaces() {
    persistence.persistSurfaces(workspace.directSurfaces);
  }

  function renderSurface() {
    releaseSurfaceInputs();
    const controls = workspace.remoteControls[workspace.remoteProfile] || [];
    const host = required(".direct-surface-controls");
    const layout = workspace.controllerLayouts[workspace.remoteProfile];
    const graphic = renderGraphicController({
      layout,
      actionFor: (name) => action(name),
      onlineFor: view.controlOnline,
    });
    updateControllerWindowChrome({
      $: view.query,
      layout,
      graphic: Boolean(graphic),
      running: workspace.running,
    });
    host.innerHTML =
      graphic ||
      (controls.length
        ? controls
            .map((control, index) => {
              const online = view.controlOnline(control);
              const hotkey = formatKeyCode(control.hotkey);
              const value = Number(control.value || 0);
              let widget;
              if (control.type === "range")
                widget = `<input class="direct-range" data-index="${index}" type="range" min="${control.min}" max="${control.max}" step="${control.step}" value="${value}"><output>${value.toFixed(Number(control.step) < 0.1 ? 2 : 0)}</output>`;
              else if (control.type === "toggle")
                widget = `<button class="direct-toggle ${value ? "active" : ""}" data-index="${index}">${value ? "ON" : "OFF"}</button>`;
              else
                widget = `<button class="direct-hold" data-index="${index}">${control.type === "pulse" ? "SEND" : "HOLD"}</button>`;
              return `<div class="direct-control ${online ? "online" : "offline"}"><div><b>${escapeHtml(control.label)}</b><small>${escapeHtml(control.channel.toUpperCase())} · ${online ? "LINKED" : "OFFLINE"}</small></div><div class="direct-widget">${widget}</div><kbd>${hotkey}</kbd></div>`;
            })
            .join("")
        : '<div class="direct-empty">Add controls in the Field Remote.</div>');
    bindSurfaceControls(controls);
    updateHud();
  }

  function bindSurfaceControls(controls) {
    for (const element of view.queryAll("[data-pilot-action]")) {
      const button = /** @type {HTMLElement} */ (element);
      const release = () => {
        if (button.dataset.pilotAction)
          setDriveInput(button.dataset.pilotAction, false);
        button.classList.remove("pressed");
        surfaceReleases.delete(release);
      };
      const press = (event) => {
        event.preventDefault();
        if (!button.dataset.pilotAction) return;
        setDriveInput(button.dataset.pilotAction, true);
        button.classList.add("pressed");
        surfaceReleases.add(release);
      };
      button.onpointerdown = press;
      button.onkeydown = (event) => {
        if (!["Enter", " "].includes(event.key) || event.repeat) return;
        press(event);
      };
      button.onkeyup = (event) => {
        if (["Enter", " "].includes(event.key)) release();
      };
      button.onpointerup =
        button.onpointerleave =
        button.onpointercancel =
          release;
    }
    for (const element of view.queryAll("[data-pilot-toggle]"))
      element.addEventListener("click", () => {
        toggleLights();
        renderSurface();
      });
    for (const element of view.queryAll(".direct-range")) {
      const input = /** @type {HTMLInputElement} */ (element);
      input.oninput = () => {
        const control = controls[+input.dataset.index];
        view.sendCommand(control, +input.value);
        const output = input.nextElementSibling;
        if (output)
          output.textContent = Number(input.value).toFixed(
            Number(control.step) < 0.1 ? 2 : 0,
          );
      };
    }
    for (const element of view.queryAll(".direct-toggle")) {
      const button = /** @type {HTMLElement} */ (element);
      button.onclick = () => {
        const control = controls[+button.dataset.index];
        view.sendCommand(control, control.value ? 0 : 1);
        renderSurface();
      };
    }
    for (const element of view.queryAll(".direct-hold")) {
      const button = /** @type {HTMLElement} */ (element);
      const control = controls[+button.dataset.index];
      const press = (event) => {
        event.preventDefault();
        view.sendCommand(control, 1);
        button.classList.add("active");
        surfaceReleases.add(release);
      };
      const release = () => {
        if (control.type === "hold") view.sendCommand(control, 0);
        else {
          const timer = setTimeout(() => {
            surfaceTimers.delete(timer);
            view.sendCommand(control, 0);
          }, 180);
          surfaceTimers.add(timer);
        }
        button.classList.remove("active");
        surfaceReleases.delete(release);
      };
      button.onpointerdown = press;
      button.onkeydown = (event) => {
        if (!["Enter", " "].includes(event.key) || event.repeat) return;
        press(event);
      };
      button.onkeyup = (event) => {
        if (["Enter", " "].includes(event.key)) release();
      };
      button.onpointerup =
        button.onpointerleave =
        button.onpointercancel =
          release;
    }
  }

  function updateHud() {
    const controls = workspace.remoteControls[workspace.remoteProfile] || [];
    const visible =
      Boolean(workspace.directSurfaces[workspace.remoteProfile]) &&
      workspace.parts.length > 0 &&
      !workspace.exploded;
    const hud = required(".drive-hud");
    hud.classList.toggle("hidden", !visible);
    required("#controller-launcher").classList.toggle(
      "hidden",
      visible || !workspace.parts.length || workspace.exploded,
    );
    hud.classList.toggle("running", visible && workspace.running);
    updateControllerWindowChrome({
      $: view.query,
      layout: workspace.controllerLayouts[workspace.remoteProfile],
      graphic: hud.classList.contains("graphic-controller"),
      running: workspace.running,
    });
    const labels = {
      gearbox: "POWERED GEARBOX",
      cart: "GROUND VEHICLE",
      drone: "FLIGHT VEHICLE",
      humanoid: "ARTICULATED ROBOT",
      mission: "SPACE VEHICLE",
    };
    required("#direct-profile").textContent =
      labels[workspace.remoteProfile] || "CUSTOM MACHINE";
    const forward = action("forward").control,
      reverse = action("reverse").control;
    if (forward || reverse) {
      const throttle = forward?.value || reverse?.value || 0;
      const direction =
        Math.abs(workspace.speedMps) > 0.08
          ? workspace.speedMps < 0
            ? "R"
            : "D"
          : throttle < -0.02
            ? "R"
            : throttle > 0.02
              ? "D"
              : "N";
      required("#direct-status").textContent =
        `${direction} · ${Math.abs(workspace.speedMps).toFixed(1)} m/s`;
      hud.classList.toggle("reverse", direction === "R");
    } else {
      const online = controls.filter(view.controlOnline).length;
      required("#direct-status").textContent =
        `${online}/${controls.length} ONLINE`;
      hud.classList.remove("reverse");
    }
  }

  function snapshot(platformReceivesShadows = false) {
    const lamps = lampPresentations(),
      activeLamps = lamps.filter(({ light }) => light.power > 0);
    return {
      driveKeys: { ...driveKeys },
      lights: activeLamps.length > 0,
      lighting: lamps.length
        ? {
            castShadows: lamps.every(({ light }) => light.castShadow),
            shadowMapsReady:
              activeLamps.length > 0 &&
              activeLamps.every(({ light }) => Boolean(light.shadow.map)),
            platformReceivesShadows,
            illuminated: activeLamps.length > 0,
            lumens: lamps.reduce(
              (sum, { light }) => sum + Number(light.power || 0),
              0,
            ),
            powerWatts: activeLamps.reduce(
              (sum, { light }) => sum + Number(light.userData.powerWatts || 0),
              0,
            ),
            range: lamps[0]?.light.distance || 0,
          }
        : null,
    };
  }

  return Object.freeze({
    ensureControls,
    persistSurfaces,
    renderSurface,
    releaseHeldInputs: releaseSurfaceInputs,
    resetDriveInput,
    setDriveInput,
    supportsAction(name) {
      return action(name).status !== "unsupported";
    },
    setLights,
    snapshot,
    toggleLights,
    updateHud,
  });
}
