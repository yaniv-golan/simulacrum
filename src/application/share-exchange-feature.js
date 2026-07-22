import { createLocalSubassemblyRecord } from "../model/subassemblies.js";
import {
  acquisitionFromShareOrigin,
  BlueprintAcquisition,
} from "../model/blueprint-acquisition.js";
import { parseSharedText, readShareUrl } from "../model/share-codec.js";
import { ShareExchangeService } from "./share-exchange-service.js";
import { BrowserShareRepository } from "./share-exchange-repository.js";
import { installBlueprintExchange } from "../presentation/blueprint-exchange.js";
import {
  captureBlueprintThumbnail,
  copyText,
  createShareUrl,
  downloadSharePackage,
  readShareFile,
} from "../presentation/share-transports.js";

/** Application composition root for sharing domain, browser effects, and UI intents. */
export function installShareExchangeFeature({
  storage,
  keys,
  state,
  serializeBlueprint,
  loadBlueprint,
  sourceCanvas,
  subassemblyLibrary,
  notify,
  root = document,
  locationRef = window.location,
  historyRef = window.history,
}) {
  const repository = new BrowserShareRepository({ storage, keys }),
    service = new ShareExchangeService({ repository });

  const withThumbnail = (metadata) => ({
    ...metadata,
    thumbnail: captureBlueprintThumbnail(sourceCanvas()),
  });
  const currentPackage = (metadata) =>
    service.createPackage({
      kind: "blueprint",
      asset: serializeBlueprint(metadata.title?.trim() || "My machine"),
      metadata: withThumbnail(metadata),
      localChallengeRecords: state.challengeRecords,
    });
  const entry = (fingerprint) =>
      service.get(fingerprint, state.challengeRecords),
    item = async (fingerprint) => (await entry(fingerprint))?.package || null;

  const actions = {
    async saveCurrent(metadata) {
      return service.savePackage(await currentPackage(metadata));
    },
    async downloadCurrent(metadata) {
      downloadSharePackage(await currentPackage(metadata));
      return { ok: true };
    },
    async copyCurrentLink(metadata) {
      await copyText(
        await createShareUrl(await currentPackage(metadata), locationRef),
      );
      return { ok: true };
    },
    async importValue(value, origin, requiredKind = null) {
      return service.importPackage(value, { origin, requiredKind });
    },
    async importFile(file) {
      return service.importPackage(await readShareFile(file), {
        origin: "file",
      });
    },
    async importText(text) {
      return service.importPackage(await parseSharedText(text), {
        origin: text.includes("#share=") ? "link" : "file",
      });
    },
    async importHash() {
      if (!locationRef.hash.includes("share="))
        return { ok: true, status: "unchanged" };
      try {
        const result = await service.importPackage(
          await readShareUrl(locationRef.href),
          { origin: "link" },
        );
        if (result.ok)
          historyRef.replaceState(
            null,
            "",
            `${locationRef.pathname}${locationRef.search}`,
          );
        return result;
      } catch (error) {
        return {
          ok: false,
          status: "rejected",
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
    async load(fingerprint) {
      const selectedEntry = await entry(fingerprint),
        selected = selectedEntry?.package;
      if (!selected || selected.kind !== "blueprint")
        return { ok: false, error: new Error("Complete machine not found") };
      try {
        loadBlueprint(selected.asset, {
          acquisition: acquisitionFromShareOrigin(selectedEntry.origin),
        });
        return { ok: true, item: selected };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
    async remix(fingerprint) {
      const selectedEntry = await entry(fingerprint),
        prepared = await service.prepareRemix(fingerprint);
      if (!prepared.ok) return prepared;
      try {
        loadBlueprint(prepared.asset, {
          acquisition: acquisitionFromShareOrigin(selectedEntry?.origin),
        });
        service.beginRemix(prepared.provenance);
        return prepared;
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
    async install(fingerprint) {
      const selectedEntry = await entry(fingerprint),
        selected = selectedEntry?.package;
      if (!selected || selected.kind === "blueprint")
        return { ok: false, error: new Error("Reusable part not found") };
      state.custom.push(
        createLocalSubassemblyRecord(selected.asset, {
          origin: {
            kind:
              selectedEntry.origin === "local"
                ? BlueprintAcquisition.LOCAL_AUTHORING
                : selectedEntry.origin === "file"
                  ? BlueprintAcquisition.FILE_IMPORT
                  : BlueprintAcquisition.SHARE_IMPORT,
            sourceFingerprint:
              selectedEntry.origin === "local" ? null : selected.fingerprint,
          },
        }),
      );
      storage.writeJson(keys.subassemblies, state.custom);
      subassemblyLibrary.render("saved");
      return { ok: true, item: selected };
    },
    favorite: (fingerprint) => service.favorite(fingerprint),
    rate: (fingerprint, rating) => service.rate(fingerprint, rating),
    remove: (fingerprint) => service.remove(fingerprint),
    publishReusable(creator) {
      return service.publishReusable(
        state.custom.map((record) => record.asset),
        { creator },
      );
    },
    async download(fingerprint) {
      const selected = await item(fingerprint);
      if (!selected) return { ok: false, error: new Error("Design not found") };
      downloadSharePackage(selected);
      return { ok: true };
    },
    async copyLink(fingerprint) {
      const selected = await item(fingerprint);
      if (!selected) return { ok: false, error: new Error("Design not found") };
      await copyText(await createShareUrl(selected, locationRef));
      return { ok: true };
    },
  };

  const presenter = installBlueprintExchange({
    root,
    getView: ({ query = "", filter = "all" } = {}) => ({
      entries: service.list({ query, filter }, state.challengeRecords),
      remix: service.remix(),
    }),
    actions,
    notify,
  });
  service.ready.then(() => presenter.render());

  return {
    ...presenter,
    async importLocationHash() {
      const result = await actions.importHash();
      if (result.ok && result.status !== "unchanged") presenter.open();
      else if (!result.ok)
        notify(`SHARE LINK REJECTED — ${result.error.message}`);
      return result;
    },
    assemblyReplaced: () => service.clearRemix(),
    service,
  };
}
