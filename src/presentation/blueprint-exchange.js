import { renderBlueprintExchangeCard } from "./blueprint-exchange-card.js";
import { errorMessage } from "../model/primitives.js";

/** Renders Exchange view models and emits user intents through typed actions. */
export function installBlueprintExchange({
  root = document,
  getView,
  actions,
  notify,
}) {
  const $ = (selector) => root.querySelector(selector),
    modal = $("#blueprint-modal"),
    list = modal.querySelector(".blueprint-list"),
    search = $("#exchange-search"),
    filterButtons = [...modal.querySelectorAll("[data-exchange-filter]")];
  let filter = "all";

  const metadata = () => ({
    title: $("#blueprint-name").value,
    creator: $("#blueprint-creator").value,
    description: $("#blueprint-description").value,
    tags: $("#blueprint-tags").value,
  });
  const failure = (result, prefix = "ACTION REJECTED") => {
    if (result?.ok) return false;
    notify(`${prefix} — ${result?.error?.message || "Unknown error"}`);
    return true;
  };

  function view() {
    return getView({ query: search.value, filter });
  }

  function render() {
    const current = view();
    $("#exchange-count").textContent =
      `${current.entries.length} DESIGN${current.entries.length === 1 ? "" : "S"}`;
    list.innerHTML = current.entries.length
      ? current.entries.map(renderBlueprintExchangeCard).join("")
      : '<div class="empty-blueprints"><b>NO MATCHING DESIGNS</b><span>Save this machine, import a package, or change the filters.</span></div>';
    $("#exchange-remix-note").textContent = current.remix
      ? `REMIX OF ${current.remix.parentFingerprint.slice(-6).toUpperCase()} · ATTRIBUTION WILL BE PRESERVED`
      : "NEW ORIGINAL DESIGN";
  }

  async function imported(operation) {
    try {
      const result = await operation();
      if (failure(result, "IMPORT REJECTED")) return null;
      render();
      notify(
        `${result.item.metadata.title} added to Exchange · ${result.item.dependencies.partCount} parts`,
      );
      if (result.warnings?.length)
        notify(
          `${result.warnings.length} proof attachment${result.warnings.length === 1 ? " was" : "s were"} ignored · shared design remains usable`,
        );
      return result;
    } catch (error) {
      notify(`IMPORT REJECTED — ${errorMessage(error)}`);
      return null;
    }
  }

  list.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    const fingerprint =
      button.dataset.loadShare ||
      button.dataset.remixShare ||
      button.dataset.installShare ||
      button.dataset.favorite ||
      button.dataset.rate ||
      button.dataset.downloadShare ||
      button.dataset.linkShare ||
      button.dataset.deleteShare;
    if (button.dataset.loadShare) {
      const result = await actions.load(fingerprint);
      if (!failure(result)) modal.classList.add("hidden");
    } else if (button.dataset.remixShare) {
      const result = await actions.remix(fingerprint);
      if (!failure(result)) {
        $("#blueprint-name").value = result.title;
        modal.classList.add("hidden");
        notify("Remix loaded · attribution will be preserved when shared");
      }
    } else if (button.dataset.installShare) {
      const result = await actions.install(fingerprint);
      if (!failure(result))
        notify(`${result.item.metadata.title} installed in My Parts`);
    } else if (button.dataset.favorite) {
      if (!failure(await actions.favorite(fingerprint))) render();
    } else if (button.dataset.rate) {
      if (!failure(await actions.rate(fingerprint, button.dataset.rating)))
        render();
    } else if (button.dataset.downloadShare)
      failure(await actions.download(fingerprint));
    else if (button.dataset.linkShare)
      try {
        const result = await actions.copyLink(fingerprint);
        if (!failure(result, "LINK UNAVAILABLE"))
          notify(
            "Share link copied · thumbnail omitted to keep the URL portable",
          );
      } catch (error) {
        notify(`LINK UNAVAILABLE — ${errorMessage(error)}`);
      }
    else if (button.dataset.deleteShare) {
      if (!failure(await actions.remove(fingerprint))) render();
    }
  });

  filterButtons.forEach((button) => {
    button.onclick = () => {
      filter = button.dataset.exchangeFilter;
      filterButtons.forEach((candidate) =>
        candidate.classList.toggle("active", candidate === button),
      );
      render();
    };
  });
  search.oninput = render;
  $("#save-machine").onclick = async () => {
    const result = await actions.saveCurrent(metadata());
    if (failure(result, "SAVE FAILED")) return;
    render();
    notify(
      `${result.item.metadata.title} saved · ${result.item.verification.length ? `${result.item.verification.length} challenge proof attached` : "ready to share"}`,
    );
  };
  $("#download-current").onclick = async () =>
    failure(await actions.downloadCurrent(metadata()));
  $("#share-current").onclick = async () => {
    try {
      const result = await actions.copyCurrentLink(metadata());
      if (!failure(result, "LINK UNAVAILABLE"))
        notify(
          "Share link copied · thumbnail omitted to keep the URL portable",
        );
    } catch (error) {
      notify(`LINK UNAVAILABLE — ${errorMessage(error)}`);
    }
  };
  $("#share-my-parts").onclick = async () => {
    const result = await actions.publishReusable($("#blueprint-creator").value);
    if (failure(result)) return;
    render();
    notify(
      result.items.length
        ? `${result.items.length} My Parts design${result.items.length === 1 ? "" : "s"} added to Exchange`
        : "Save a reusable assembly in My Parts first",
    );
  };
  $("#pick-share-file").onclick = () => $("#share-file-input").click();
  $("#share-file-input").onchange = (event) => {
    imported(() => actions.importFile(event.target.files?.[0]));
    event.target.value = "";
  };
  $("#import-shared-text").onclick = async () => {
    const result = await imported(() =>
      actions.importText($("#share-paste").value),
    );
    if (result) $("#share-paste").value = "";
  };

  const dropZone = $("#exchange-drop-zone");
  for (const type of ["dragenter", "dragover"])
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.add("dragging");
    });
  for (const type of ["dragleave", "drop"])
    dropZone.addEventListener(type, (event) => {
      event.preventDefault();
      dropZone.classList.remove("dragging");
    });
  dropZone.addEventListener("drop", (event) =>
    imported(() => actions.importFile(event.dataTransfer?.files?.[0])),
  );

  $("#close-blueprints").onclick = () => modal.classList.add("hidden");

  function open() {
    modal.classList.remove("hidden");
    render();
  }

  render();
  return {
    open,
    render,
    snapshot: () => ({
      open: !modal.classList.contains("hidden"),
      filter,
      query: search.value,
      entries: view().entries.map((entry) => ({
        fingerprint: entry.package.fingerprint,
        kind: entry.package.kind,
        title: entry.package.metadata.title,
        favorite: entry.social.favorite,
        rating: entry.social.rating,
        origin: entry.origin,
        origins: entry.origins,
        proofs: entry.package.verification.length,
        proofTrust: entry.proofTrust,
        remixOf: entry.package.provenance.parentFingerprint,
      })),
      remix: view().remix,
    }),
  };
}
