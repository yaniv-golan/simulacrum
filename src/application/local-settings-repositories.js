import { STORAGE_KEYS } from "./browser-storage.js";

const DISCOVERY_DEFAULTS = Object.freeze({
    tipsEnabled: true,
    complete: false,
  }),
  ENVIRONMENT_DEFAULTS = Object.freeze({
    timeOfDay: 14,
    windEnabled: true,
  });

/** Owns the single current discovery-state storage root. */
export class BrowserDiscoveryRepository {
  constructor({ storage, key = STORAGE_KEYS.discovery }) {
    this.storage = storage;
    this.key = key;
  }

  load() {
    const value = this.storage.readJson(this.key, DISCOVERY_DEFAULTS);
    return {
      tipsEnabled:
        typeof value?.tipsEnabled === "boolean"
          ? value.tipsEnabled
          : DISCOVERY_DEFAULTS.tipsEnabled,
      complete:
        typeof value?.complete === "boolean"
          ? value.complete
          : DISCOVERY_DEFAULTS.complete,
    };
  }

  setTipsEnabled(tipsEnabled) {
    return this.storage.writeJson(this.key, {
      ...this.load(),
      tipsEnabled: Boolean(tipsEnabled),
    });
  }

  setComplete(complete) {
    return this.storage.writeJson(this.key, {
      ...this.load(),
      complete: Boolean(complete),
    });
  }
}

/** Owns time-of-day and wind preferences as one current storage root. */
export class BrowserEnvironmentPreferencesRepository {
  constructor({ storage, key = STORAGE_KEYS.environmentPreferences }) {
    this.storage = storage;
    this.key = key;
  }

  load() {
    const value = this.storage.readJson(this.key, ENVIRONMENT_DEFAULTS),
      timeOfDay = Number(value?.timeOfDay);
    return {
      timeOfDay:
        Number.isFinite(timeOfDay) && timeOfDay >= 0 && timeOfDay <= 24
          ? timeOfDay
          : ENVIRONMENT_DEFAULTS.timeOfDay,
      windEnabled:
        typeof value?.windEnabled === "boolean"
          ? value.windEnabled
          : ENVIRONMENT_DEFAULTS.windEnabled,
    };
  }

  setTimeOfDay(timeOfDay) {
    const value = Number(timeOfDay);
    if (!Number.isFinite(value) || value < 0 || value > 24)
      return { ok: false, error: new TypeError("Invalid time of day") };
    return this.storage.writeJson(this.key, {
      ...this.load(),
      timeOfDay: value,
    });
  }

  setWindEnabled(windEnabled) {
    return this.storage.writeJson(this.key, {
      ...this.load(),
      windEnabled: Boolean(windEnabled),
    });
  }
}
