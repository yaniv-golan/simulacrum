/** Browser persistence port for the local Exchange, including rollback on write failure. */
export class BrowserShareRepository {
  constructor({ storage, keys, logger = console }) {
    this.storage = storage;
    this.keys = keys;
    this.logger = logger;
  }

  load() {
    return {
      catalog: {
        packages: this.storage.readJson(this.keys.sharePackages, []),
        social: this.storage.readJson(this.keys.shareSocial, {}),
        origins: this.storage.readJson(this.keys.shareOrigins, {}),
      },
    };
  }

  commit({ catalog }) {
    return this.storage.commitOwned("share", [
      {
        key: this.keys.sharePackages,
        encoding: "json",
        value: structuredClone(catalog.packages),
      },
      {
        key: this.keys.shareSocial,
        encoding: "json",
        value: structuredClone(catalog.social),
      },
      {
        key: this.keys.shareOrigins,
        encoding: "json",
        value: structuredClone(catalog.origins),
      },
    ]);
  }
}
