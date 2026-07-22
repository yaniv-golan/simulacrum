const PROFILE_DESIGN = Object.freeze({
  title: "Direct Control",
  style: "compact-grid",
  accent: "#70e0c4",
});

function identifier(value, fallback) {
  const normalized = String(value || "")
    .replace(/[^A-Za-z0-9._:-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

/** Convert non-persistent startup templates into the current portable shape. */
export function remoteProfilesFromTemplates(templates = {}) {
  return Object.fromEntries(
    Object.entries(templates).map(([profileId, controls]) => [
      profileId,
      {
        design: {
          ...PROFILE_DESIGN,
        },
        controls: controls.map((control, index) => ({
          id: identifier(control.id, `${profileId}-${index + 1}`),
          label: String(control.label || "Untitled control").slice(0, 80),
          channel: identifier(control.channel, `aux-${index + 1}`),
          type: control.type,
          targetId: Number.isSafeInteger(control.targetId)
            ? control.targetId
            : null,
          defaultValue: Number(control.defaultValue ?? control.value ?? 0),
          hotkey: control.hotkey ?? null,
          ...(control.type === "range"
            ? { min: control.min, max: control.max, step: control.step }
            : {}),
        })),
        actionBindings: {},
      },
    ]),
  );
}

/** Build the mutable runtime view without contaminating portable definitions. */
export function runtimeControlsFromProfiles(profiles = {}, values = {}) {
  return Object.fromEntries(
    Object.entries(profiles).map(([profileId, profile]) => [
      profileId,
      profile.controls.map((control) => ({
        ...structuredClone(control),
        value:
          values?.[profileId]?.[control.id] ?? Number(control.defaultValue),
        active: false,
      })),
    ]),
  );
}

/** Persist only latching numeric state; momentary controls are session-only. */
export function durableRemoteControlState(profiles = {}, controls = {}) {
  const result = {};
  for (const [profileId, profile] of Object.entries(profiles)) {
    const runtimeById = new Map(
      (controls[profileId] || []).map((control) => [control.id, control]),
    );
    const profileState = {};
    for (const definition of profile.controls) {
      if (!["range", "toggle"].includes(definition.type)) continue;
      const value = Number(
        runtimeById.get(definition.id)?.value ?? definition.defaultValue,
      );
      if (Number.isFinite(value)) profileState[definition.id] = value;
    }
    if (Object.keys(profileState).length) result[profileId] = profileState;
  }
  return result;
}

/** Copy intentional definition edits from the runtime editor into portable DTOs. */
export function syncRemoteProfileDefinitions(state) {
  const next = {};
  for (const [profileId, controls] of Object.entries(
    state.remoteControls || {},
  )) {
    const existing = state.remoteProfiles?.[profileId];
    next[profileId] = {
      design: structuredClone(
        existing?.design ||
          state.controllerLayouts?.[profileId] ||
          PROFILE_DESIGN,
      ),
      controls: controls.map((control, index) => ({
        id: identifier(control.id, `${profileId}-${index + 1}`),
        label: String(control.label || "Untitled control").slice(0, 80),
        channel: identifier(control.channel, `aux-${index + 1}`),
        type: control.type,
        targetId: Number.isSafeInteger(control.targetId)
          ? control.targetId
          : null,
        defaultValue: Number(control.defaultValue ?? 0),
        hotkey: control.hotkey ?? null,
        ...(control.type === "range"
          ? { min: control.min, max: control.max, step: control.step }
          : {}),
        ...(control.extensions
          ? { extensions: structuredClone(control.extensions) }
          : {}),
      })),
      actionBindings: structuredClone(existing?.actionBindings || {}),
      ...(existing?.extensions
        ? { extensions: structuredClone(existing.extensions) }
        : {}),
    };
  }
  state.remoteProfiles = next;
  return next;
}

export function nextRemoteControlId(profileId, controls) {
  const occupied = new Set(controls.map((control) => control.id));
  let sequence = controls.length + 1;
  while (occupied.has(`${profileId}-${sequence}`)) sequence++;
  return `${profileId}-${sequence}`;
}
