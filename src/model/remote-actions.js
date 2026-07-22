import { DomainValidationError } from "./primitives.js";

export const REMOTE_ACTIONS = Object.freeze([
  "forward",
  "reverse",
  "left",
  "right",
  "brake",
  "lights",
]);

const MOMENTARY_ACTIONS = new Set([
  "forward",
  "reverse",
  "left",
  "right",
  "brake",
]);

function valueAccepted(control, value) {
  const minimum = control.type === "range" ? Number(control.min) : 0,
    maximum = control.type === "range" ? Number(control.max) : 1;
  return (
    Number.isFinite(value) &&
    Number.isFinite(minimum) &&
    Number.isFinite(maximum) &&
    value >= minimum &&
    value <= maximum
  );
}

/** Validates the semantic direct-control contract at the strict model boundary. */
export function validateRemoteActionBindings(profile, profilePath = []) {
  const controls = new Map(
      (profile.controls || []).map((control) => [control.id, control]),
    ),
    semanticOwnerByControl = new Map();
  for (const [action, binding] of Object.entries(
    profile.actionBindings || {},
  )) {
    const path = [...profilePath, "actionBindings", action];
    if (!REMOTE_ACTIONS.includes(action))
      throw new DomainValidationError(
        "UNKNOWN_REMOTE_ACTION",
        `Unknown remote action ${action}`,
        { path },
      );
    const control = controls.get(binding.controlId);
    if (!control)
      throw new DomainValidationError(
        "UNKNOWN_REMOTE_ACTION_CONTROL",
        `Remote action ${action} references missing control ${binding.controlId}`,
        { path: [...path, "controlId"] },
      );
    if (MOMENTARY_ACTIONS.has(action)) {
      const acceptedTypes = action === "brake" ? ["range", "hold"] : ["range"];
      if (!acceptedTypes.includes(control.type))
        throw new DomainValidationError(
          "REMOTE_ACTION_CONTROL_TYPE_MISMATCH",
          `Remote action ${action} requires ${action === "brake" ? "a range or hold" : "a range"} control`,
          { path },
        );
      for (const field of ["pressedValue", "releasedValue"])
        if (!valueAccepted(control, binding[field]))
          throw new DomainValidationError(
            "REMOTE_ACTION_VALUE_OUT_OF_RANGE",
            `${action}.${field} must fit control ${control.id}`,
            { path: [...path, field] },
          );
    } else {
      if (control.type !== "toggle")
        throw new DomainValidationError(
          "REMOTE_ACTION_CONTROL_TYPE_MISMATCH",
          "The lights action requires a toggle control",
          { path },
        );
      if (binding.pressedValue != null || binding.releasedValue != null)
        throw new DomainValidationError(
          "REMOTE_TOGGLE_ACTION_HAS_MOMENTARY_VALUES",
          "Toggle actions do not accept momentary values",
          { path },
        );
    }
    const semanticGroup = ["forward", "reverse"].includes(action)
      ? "longitudinal"
      : ["left", "right"].includes(action)
        ? "lateral"
        : action;
    const previous = semanticOwnerByControl.get(control.id);
    if (previous && previous !== semanticGroup)
      throw new DomainValidationError(
        "REMOTE_ACTION_CONTROL_CONFLICT",
        `Control ${control.id} owns unrelated actions ${previous} and ${semanticGroup}`,
        { path: [...path, "controlId"] },
      );
    semanticOwnerByControl.set(control.id, semanticGroup);
  }
  return true;
}

/** Resolve one authored semantic action without target, channel, or profile heuristics. */
export function resolveRemoteAction(profile, controls, action, pressed) {
  const binding = profile?.actionBindings?.[action] || null,
    control = binding
      ? (controls || []).find((candidate) => candidate.id === binding.controlId)
      : null;
  if (!binding)
    return Object.freeze({
      action,
      status: "unsupported",
      control: null,
      value: null,
    });
  if (!control)
    return Object.freeze({
      action,
      status: "missing-control",
      control: null,
      value: null,
    });
  if (action === "lights")
    return Object.freeze({
      action,
      status: pressed ? "ready" : "ignored-release",
      control,
      value: pressed ? (Number(control.value) ? 0 : 1) : null,
    });
  return Object.freeze({
    action,
    status: "ready",
    control,
    value: Number(pressed ? binding.pressedValue : binding.releasedValue),
  });
}

/** Resolve a complete momentary input state into one command per authored control. */
export function resolveRemoteActionState(profile, controls, pressedActions) {
  const byControl = new Map();
  for (const action of MOMENTARY_ACTIONS) {
    const resolved = resolveRemoteAction(
      profile,
      controls,
      action,
      Boolean(pressedActions?.[action]),
    );
    if (resolved.status !== "ready") continue;
    const previous = byControl.get(resolved.control.id);
    if (!previous)
      byControl.set(resolved.control.id, {
        control: resolved.control,
        value: resolved.value,
        activeActions: pressedActions?.[action] ? [action] : [],
      });
    else if (pressedActions?.[action]) {
      const minimum = Number(resolved.control.min ?? 0),
        maximum = Number(resolved.control.max ?? 1);
      previous.value = Math.max(
        minimum,
        Math.min(maximum, previous.value + resolved.value),
      );
      previous.activeActions.push(action);
    }
  }
  return Object.freeze(
    [...byControl.values()].map((command) =>
      Object.freeze({
        ...command,
        activeActions: Object.freeze([...command.activeActions]),
      }),
    ),
  );
}

/**
 * Exact persistent endpoint anchors referenced by semantic actions.
 * @param {{actionBindings?:Record<string,{controlId:string}>}|null|undefined} profile
 * @param {ReadonlyArray<{id:string,targetId?:number|null}>} controls
 * @returns {ReadonlyArray<number>}
 */
export function remoteActionTargetPartIds(profile, controls) {
  const controlsById = new Map(
      (controls || []).map((control) => [control.id, control]),
    ),
    targets = /** @type {number[]} */ ([]);
  for (const binding of Object.values(profile?.actionBindings || {})) {
    const targetId = controlsById.get(binding.controlId)?.targetId;
    if (typeof targetId === "number" && Number.isSafeInteger(targetId))
      targets.push(targetId);
  }
  return Object.freeze([...new Set(targets)]);
}

export function defaultActionBinding(action, control) {
  if (action === "lights") return Object.freeze({ controlId: control.id });
  const minimum = Number(control.min ?? 0),
    maximum = Number(control.max ?? 1),
    desired = ["reverse", "left"].includes(action) ? -1 : 1;
  return Object.freeze({
    controlId: control.id,
    pressedValue: Math.max(minimum, Math.min(maximum, desired)),
    releasedValue: Math.max(minimum, Math.min(maximum, 0)),
  });
}
