function normalizeRequestedCheck(value) {
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.endsWith(".mjs") ? trimmed : `${trimmed}.mjs`;
}

/**
 * Resolve an exact TEST_FILTER against the registered verification suites.
 * Unknown names are always errors, including when other requested names exist.
 *
 * @param {readonly string[]} checks
 * @param {string | undefined | null} rawFilter
 * @returns {string[]}
 */
export function selectVerificationChecks(checks, rawFilter) {
  const requested = [
    ...new Set(
      String(rawFilter || "")
        .split(",")
        .map(normalizeRequestedCheck)
        .filter(Boolean),
    ),
  ];
  if (!requested.length) return [...checks];

  const registered = new Set(checks);
  const unknown = requested.filter((name) => !registered.has(name));
  if (unknown.length) {
    throw new Error(
      `TEST_FILTER contains unknown verification suite${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}`,
    );
  }

  const requestedSet = new Set(requested);
  return checks.filter((check) => requestedSet.has(check));
}
