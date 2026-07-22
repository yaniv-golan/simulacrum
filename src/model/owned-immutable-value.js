const ownedImmutableValues = new WeakSet();

/**
 * Marks a value whose owner has completed its deep-immutability transaction.
 * Consumers can safely retain registered values without re-walking or cloning
 * the graph. Registration stays private to trusted model/simulation builders.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function registerOwnedImmutable(value) {
  if ((typeof value !== "object" && typeof value !== "function") || !value)
    throw new TypeError("Owned immutable values must be objects");
  if (!Object.isFrozen(value))
    throw new TypeError(
      "Owned immutable values must be frozen before register",
    );
  ownedImmutableValues.add(value);
  return value;
}

/** @param {unknown} value */
export function isOwnedImmutable(value) {
  if ((typeof value !== "object" && typeof value !== "function") || !value)
    return false;
  return ownedImmutableValues.has(value);
}
