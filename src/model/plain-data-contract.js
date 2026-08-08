// Narrow model-layer boundary for persisted executable-state inputs. Scripting
// may depend on this contract without gaining access to the broader primitives
// implementation surface.
import {
  deepFreeze,
  detachPlainData,
  DomainValidationError,
} from "./primitives.js";

export { detachPlainData };

// There is no portable ECMAScript predicate that can distinguish an ordinary
// object from a Proxy without invoking at least one Proxy structural trap.
// Consequently, exposed executable-state boundaries must never inspect an
// arbitrary object to decide whether it is inert. They accept either serialized
// JSON, whose parser creates an inert native graph, or a root issued here from
// package-owned data. WeakSet membership itself does not invoke Proxy traps.
const inertPlainDataRoots = new WeakSet();

function rememberInertPlainData(value) {
  const pending = [value],
    seen = new WeakSet();
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    inertPlainDataRoots.add(current);
    pending.push(...Object.values(current));
  }
  deepFreeze(value);
  return value;
}

/**
 * Package-internal publisher for data constructed by trusted code. The input
 * is detached before the immutable issued root becomes externally visible.
 * @template T
 * @param {T} value
 * @param {object} [options]
 * @returns {T}
 */
export function issueInertPlainData(value, options = {}) {
  return rememberInertPlainData(detachPlainData(value, options));
}

/**
 * Reads an inert trust-boundary value without inspecting an arbitrary object.
 * Callers may pass serialized JSON or a root returned by issueInertPlainData.
 * @template T
 * @param {string | T} input
 * @param {object} [options]
 * @returns {T}
 */
export function requireInertPlainData(
  input,
  {
    code = "INERT_PLAIN_DATA_REQUIRED",
    message = "Expected serialized JSON or a trusted immutable data root",
    path = [],
  } = {},
) {
  if (typeof input === "string") {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch (cause) {
      throw new DomainValidationError(code, message, { path, cause });
    }
    return /** @type {T} */ (rememberInertPlainData(parsed));
  }
  if (
    input !== null &&
    typeof input === "object" &&
    inertPlainDataRoots.has(input)
  )
    return /** @type {T} */ (input);
  throw new DomainValidationError(code, message, { path });
}

export function isIssuedInertPlainData(value) {
  return Boolean(
    value !== null &&
    typeof value === "object" &&
    inertPlainDataRoots.has(value),
  );
}
