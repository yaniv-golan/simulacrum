/**
 * Loads the optional Blueprint Exchange only when a player opens it or arrives
 * through a share URL. Keeping package validation outside the eager workshop
 * graph avoids charging every editor session for an infrequently used tool.
 */
export function createLazyShareExchangeFeature({
  root = document,
  locationRef = window.location,
  notify,
  installOptions,
}) {
  const modal = /** @type {HTMLElement|null} */ (
      root.querySelector("#blueprint-modal")
    ),
    close = /** @type {HTMLButtonElement|null} */ (
      root.querySelector("#close-blueprints")
    ),
    list = /** @type {HTMLElement|null} */ (
      root.querySelector(".blueprint-list")
    );
  let instance = null,
    loading = null;

  const setLoading = (active) => {
    modal?.setAttribute("aria-busy", String(active));
    for (const element of Array.from(
      modal?.querySelectorAll("input, textarea, button") || [],
    )) {
      const control =
        /** @type {HTMLInputElement|HTMLTextAreaElement|HTMLButtonElement} */ (
          element
        );
      if (control !== close) control.disabled = active;
    }
    if (active && list)
      list.innerHTML =
        '<div class="empty-blueprints"><b>OPENING BLUEPRINT EXCHANGE</b><span>Loading the sharing tools and validating your local catalog…</span></div>';
  };

  const load = () => {
    if (instance) return Promise.resolve(instance);
    if (!loading) {
      setLoading(true);
      loading = import("./share-exchange-feature.js")
        .then(async ({ installShareExchangeFeature }) => {
          instance = installShareExchangeFeature({
            ...installOptions,
            root,
            locationRef,
            notify,
          });
          await instance.service.ready;
          setLoading(false);
          return instance;
        })
        .catch((error) => {
          instance = null;
          loading = null;
          setLoading(false);
          notify(
            `BLUEPRINT EXCHANGE UNAVAILABLE — ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          throw error;
        });
    }
    return loading;
  };

  if (close) close.onclick = () => modal?.classList.add("hidden");

  return Object.freeze({
    open() {
      modal?.classList.remove("hidden");
      void load()
        .then((exchange) => exchange.open())
        .catch(() => {});
    },
    render() {
      return load().then((exchange) => exchange.render());
    },
    async importLocationHash() {
      if (!locationRef.hash.includes("share="))
        return { ok: true, status: "unchanged" };
      try {
        return (await load()).importLocationHash();
      } catch (error) {
        return {
          ok: false,
          status: "rejected",
          error: error instanceof Error ? error : new Error(String(error)),
        };
      }
    },
    assemblyReplaced() {
      instance?.assemblyReplaced();
    },
    snapshot() {
      return (
        instance?.snapshot() || {
          open: Boolean(modal && !modal.classList.contains("hidden")),
          status: loading ? "loading" : "idle",
          filter: "all",
          query: "",
          entries: [],
          remix: null,
        }
      );
    },
  });
}
