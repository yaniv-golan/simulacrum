const CONTROL_TYPES = new Set(["range", "toggle", "hold", "pulse"]);
const ENTRY_KEYS = new Set(["profileId", "controlId", "value", "active"]);

function fail(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function finiteNumber(value, path) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail(path, "must be a finite number");
  return number;
}

function validateControlValue(control, value, path) {
  if (!CONTROL_TYPES.has(control.type))
    fail(path, `control has unsupported type ${String(control.type)}`);
  if (control.type === "range") {
    const minimum = finiteNumber(control.min, `${path}.min`),
      maximum = finiteNumber(control.max, `${path}.max`);
    if (value < minimum || value > maximum)
      fail(path, `must be within [${minimum}, ${maximum}]`);
  } else if (value !== 0 && value !== 1) {
    fail(path, `${control.type} controls accept only 0 or 1`);
  }
}

/**
 * Resolve authored challenge setup against strict remote-profile definitions.
 * This is intentionally static: live power and signal state are evaluated only
 * after simulation has produced completed telemetry.
 */
export function resolveReferenceInitialControls(challenge, remoteProfiles) {
  const entries = challenge?.referenceInitialControls ?? [];
  if (!Array.isArray(entries))
    fail("referenceInitialControls", "must be an array");
  const seen = new Set(),
    seenEndpoints = new Set();
  return Object.freeze(
    entries.map((entry, index) => {
      const path = `referenceInitialControls[${index}]`;
      if (!entry || typeof entry !== "object" || Array.isArray(entry))
        fail(path, "must be an object");
      const unknown = Object.keys(entry).filter((key) => !ENTRY_KEYS.has(key));
      if (unknown.length) fail(path, `unknown field ${unknown[0]}`);
      if (typeof entry.profileId !== "string" || !entry.profileId)
        fail(`${path}.profileId`, "must be a non-empty string");
      if (typeof entry.controlId !== "string" || !entry.controlId)
        fail(`${path}.controlId`, "must be a non-empty string");
      if (typeof entry.active !== "boolean")
        fail(`${path}.active`, "must be a boolean");
      const profile = remoteProfiles?.[entry.profileId];
      if (!profile) fail(`${path}.profileId`, "does not name a loaded profile");
      const control = profile.controls?.find(
        (candidate) => candidate.id === entry.controlId,
      );
      if (!control)
        fail(`${path}.controlId`, "does not name a control in the profile");
      const identity = `${entry.profileId}:${entry.controlId}`;
      if (seen.has(identity)) fail(path, "duplicates an earlier control");
      seen.add(identity);
      const endpoint =
        control.targetId == null || typeof control.channel !== "string"
          ? null
          : `${control.targetId}:${control.channel}`;
      if (endpoint && seenEndpoints.has(endpoint))
        fail(path, "duplicates target/channel authority");
      if (endpoint) seenEndpoints.add(endpoint);
      const value = finiteNumber(entry.value, `${path}.value`);
      validateControlValue(control, value, `${path}.value`);
      return Object.freeze({
        profileId: entry.profileId,
        controlId: entry.controlId,
        value,
        active: entry.active,
      });
    }),
  );
}
