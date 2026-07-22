import { STORAGE_KEYS } from "./browser-storage.js";

const TRUST_VERSION = 1;
export const EXECUTABLE_TRUST_KEY = STORAGE_KEYS.executableTrust;

function normalizedStore(value) {
  if (
    !value ||
    value.version !== TRUST_VERSION ||
    !Array.isArray(value.digests)
  )
    return { version: TRUST_VERSION, digests: [] };
  return {
    version: TRUST_VERSION,
    digests: [
      ...new Set(value.digests.filter((item) => /^[0-9a-f]{64}$/.test(item))),
    ],
  };
}

/** Failure-safe local trust store. A grant is effective only after read-back. */
export class ExecutableTrustRepository {
  /**
   * @param {{storage?: BrowserStorage | Pick<Storage, "getItem" | "setItem">, logger?: Pick<Console, "warn">, key?: string}} [options]
   */
  constructor({ storage, logger = console, key = EXECUTABLE_TRUST_KEY } = {}) {
    this.logger = logger;
    this.key = key;
    this.storage =
      storage instanceof BrowserStorage
        ? storage
        : new BrowserStorage(storage, { logger });
  }

  #read() {
    const result = this.storage.readEntry(this.key);
    if (!result.ok) throw result.error;
    if (!result.found) return normalizedStore(null);
    return normalizedStore(JSON.parse(result.value));
  }

  has(digest) {
    try {
      return {
        ok: true,
        trusted: this.#read().digests.includes(digest),
      };
    } catch (error) {
      this.logger.warn("Executable trust could not be read", error);
      return { ok: false, trusted: false, error };
    }
  }

  grant(digest) {
    if (!/^[0-9a-f]{64}$/.test(digest || ""))
      return { ok: false, trusted: false, error: new Error("invalid digest") };
    try {
      const value = this.#read();
      value.digests = [...new Set([...value.digests, digest])].sort();
      const write = this.storage.writeJson(this.key, value);
      if (!write.ok) throw write.error;
      const persisted = this.#read();
      if (!persisted.digests.includes(digest))
        throw new Error("trust write could not be verified");
      return { ok: true, trusted: true };
    } catch (error) {
      this.logger.warn("Executable trust could not be saved", error);
      return { ok: false, trusted: false, error };
    }
  }
}
import { BrowserStorage } from "./browser-storage.js";
