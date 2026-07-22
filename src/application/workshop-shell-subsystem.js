import { HistoryStore } from "../model/history-store.js";
import { installAccessibleDialogs } from "../presentation/accessibility-controller.js";
import { installCameraControlGuide } from "../presentation/camera-control-guide.js";
import { createWorkshopTemplate } from "../presentation/ui-template.js";
import { installWorkspaceChrome } from "../presentation/workspace-chrome.js";
import { applyUIAction } from "../model/application-state.js";
import { createWorkshopState } from "./workshop-state.js";

/** Owns the browser shell, persistent application state, notices, and history. */
export function createWorkshopShellSubsystem({
  root,
  definitions,
  onLayoutChange,
}) {
  const query = (selector) => document.querySelector(selector),
    queryAll = (selector) => Array.from(document.querySelectorAll(selector));

  root.innerHTML = createWorkshopTemplate(definitions.defaultWatSource);
  installAccessibleDialogs();
  installCameraControlGuide();

  const inspectorHelp = query(".inspector-empty p"),
    libraryAdd = query("#library-add");
  if (inspectorHelp)
    inspectorHelp.textContent =
      "Click a part, or drag a box on empty space. Left-to-right encloses; right-to-left selects anything touched.";
  if (libraryAdd)
    libraryAdd.title = "Save selected component(s) as a reusable assembly";

  const { storage, state, newControllerSources } = createWorkshopState({
      controlTemplates: definitions.controlTemplates,
      defaultWatSource: definitions.defaultWatSource,
      defaultTsSource: definitions.defaultTsSource,
      defaultVisualProgram: definitions.defaultVisualProgram,
    }),
    chrome = installWorkspaceChrome({
      onFocusChange: (focused) => {
        applyUIAction(state.ui, { type: "set-workspace-focus", focused });
      },
      onLayoutChange,
    }),
    history = new HistoryStore({ limit: 60 }),
    notify = createToastPresenter({
      query,
      activeChallenge: () => state.activeChallenge,
    });

  return Object.freeze({
    query,
    queryAll,
    storage,
    state,
    newControllerSources,
    chrome,
    history,
    notify,
  });
}

function createToastPresenter({ query, activeChallenge }) {
  let timer = null;
  const notify = (message) => {
    const notice = query(".toast");
    if (!notice) return;
    notice.textContent = message;
    notice.classList.toggle("challenge-context", Boolean(activeChallenge()));
    notice.classList.add("show");
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => notice.classList.remove("show"), 2200);
  };
  notify.dismiss = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    query(".toast")?.classList.remove("show");
  };
  return notify;
}
