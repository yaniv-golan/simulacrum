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

/**
 * Split an already-selected suite list into stable, disjoint CI shards.
 * Local runs use the complete list unless both shard variables are supplied.
 *
 * @param {readonly string[]} checks
 * @param {string | number | undefined | null} rawIndex
 * @param {string | number | undefined | null} rawCount
 * @returns {string[]}
 */
export function shardVerificationChecks(checks, rawIndex, rawCount) {
  if (rawIndex == null && rawCount == null) return [...checks];

  const shardIndex = Number(rawIndex);
  const shardCount = Number(rawCount);
  if (!Number.isSafeInteger(shardCount) || shardCount < 1)
    throw new Error("TEST_SHARD_COUNT must be a positive integer");
  if (
    !Number.isSafeInteger(shardIndex) ||
    shardIndex < 0 ||
    shardIndex >= shardCount
  )
    throw new Error(
      "TEST_SHARD_INDEX must be an integer between 0 and TEST_SHARD_COUNT - 1",
    );

  return checks.filter((_check, index) => index % shardCount === shardIndex);
}
