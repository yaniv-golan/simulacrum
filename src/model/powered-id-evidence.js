function poweredIdKey(value) {
  return JSON.stringify([typeof value, value]);
}

/**
 * Decodes one complete measured set of powered part IDs. Absence, malformed
 * IDs, and duplicates all return null so authority consumers fail closed.
 */
export function poweredIdEvidenceSet(value) {
  if (!Array.isArray(value)) return null;
  const ids = new Set(),
    keys = new Set();
  for (const id of value) {
    if (!(
      (typeof id === "string" && id.length > 0) ||
      Number.isSafeInteger(id)
    ))
      return null;
    const key = poweredIdKey(id);
    if (keys.has(key)) return null;
    keys.add(key);
    ids.add(id);
  }
  return ids;
}
