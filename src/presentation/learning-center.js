export { installTutorialController } from "./tutorial-controller.js";

/**
 * @typedef {{ id: string, category: string, icon: string, title: string, summary: string, why: string, steps: string[], shortcuts: string[], action: string, actionLabel: string }} LearnTopic
 * @typedef {{ title: string, copy: string, topic: string }} DiscoveryStep
 *
 * Installs the searchable learning center and first-run discovery coach.
 * Content is data, presentation owns the DOM, and workshop actions cross one
 * explicit action port instead of reaching into application state.
 *
 * @param {{
 *   root?: Document,
 *   topics: LearnTopic[], discoverySteps: DiscoveryStep[],
 *   ui: { learnTopic: string, learnCategory: string, coachStep: number, coachEnabled: boolean },
 *   persistence: { load: () => {tipsEnabled:boolean, complete:boolean}, setTipsEnabled: (enabled:boolean) => void, setComplete: (complete:boolean) => void },
 *   actions: {
 *     beginTutorial: () => void, enterBuild: () => void,
 *     loadDemo: (kind: string) => void, openRemote: () => void,
 *     openCamera: () => void, openScript: () => void,
 *     openBlueprints: () => void, openChallenges: () => void,
 *     openDemos: () => void, openEnvironment: () => void,
 *     notify: (message: string) => void
 *   }
 * }} options
 */
export function installLearningCenter({
  root = document,
  topics,
  discoverySteps,
  ui,
  persistence,
  actions,
}) {
  const $ = (selector) => root.querySelector(selector),
    $$ = (selector) => Array.from(root.querySelectorAll(selector));

  function closeSecondaryPanels() {
    for (const selector of [
      ".learn-center",
      ".demo-browser",
      ".challenge-browser",
      ".environment-panel",
      ".remote-console",
      ".wasm-console",
    ])
      $(selector).classList.add("hidden");
  }

  function runAction(action) {
    $(".learn-center").classList.add("hidden");
    const handlers = {
      tutorial: actions.beginTutorial,
      build: () => {
        actions.enterBuild();
        actions.notify(
          "Build mode ready · choose a component or select an existing part",
        );
      },
      gearbox: () => actions.loadDemo("gearbox"),
      remote: actions.openRemote,
      camera: actions.openCamera,
      script: actions.openScript,
      blueprints: actions.openBlueprints,
      challenges: actions.openChallenges,
      demos: actions.openDemos,
      environment: actions.openEnvironment,
    };
    handlers[action]?.();
  }

  function render() {
    const query = ($("#learn-search")?.value || "").trim().toLowerCase(),
      queryTerms = query.split(/\s+/).filter(Boolean),
      categories = ["ALL", ...new Set(topics.map((topic) => topic.category))],
      visible = topics.filter((topic) => {
        const searchable = [
          topic.title,
          topic.summary,
          topic.why,
          topic.category,
          ...topic.steps,
          ...topic.shortcuts,
        ]
          .join(" ")
          .toLowerCase();
        return (
          (ui.learnCategory === "ALL" || topic.category === ui.learnCategory) &&
          queryTerms.every((term) => searchable.includes(term))
        );
      });
    if (!visible.some((topic) => topic.id === ui.learnTopic) && visible[0])
      ui.learnTopic = visible[0].id;
    $(".learn-categories").setAttribute("role", "tablist");
    $(".learn-categories").setAttribute("aria-label", "Topic categories");
    $(".learn-categories").innerHTML = categories
      .map(
        (category) =>
          `<button class="${ui.learnCategory === category ? "active" : ""}" data-learn-category="${category}" role="tab" aria-selected="${ui.learnCategory === category}">${category}</button>`,
      )
      .join("");
    $(".learn-topics").setAttribute("role", "tablist");
    $(".learn-topics").setAttribute("aria-label", "Learning topics");
    $(".learn-topics").innerHTML = visible.length
      ? visible
          .map(
            (topic) =>
              `<button class="${ui.learnTopic === topic.id ? "active" : ""}" data-learn-topic="${topic.id}" role="tab" aria-selected="${ui.learnTopic === topic.id}"><i aria-hidden="true">${topic.icon}</i><span><b>${topic.title}</b><small>${topic.summary}</small></span></button>`,
          )
          .join("")
      : '<div class="learn-empty">No capability matches that search.</div>';
    const topic = visible.find((entry) => entry.id === ui.learnTopic);
    $(".learn-detail").innerHTML = topic
      ? `<div class="learn-detail-head"><span aria-hidden="true">${topic.icon}</span><div><small>${topic.category}</small><h3>${topic.title}</h3><p>${topic.summary}</p></div></div><div class="learn-why"><b>WHY IT MATTERS</b><p>${topic.why}</p></div><ol>${topic.steps.map((step) => `<li>${step}</li>`).join("")}</ol><div class="learn-shortcuts">${topic.shortcuts.map((shortcut) => `<kbd>${shortcut}</kbd>`).join("")}</div><div class="learn-detail-actions"><button id="learn-action" data-learn-action="${topic.action}">${topic.actionLabel} →</button><button id="learn-tour">START 5-STEP DISCOVERY TOUR</button></div>`
      : '<div class="learn-empty">Try a broader search.</div>';
    for (const button of $$("[data-learn-category]"))
      button.onclick = () => {
        ui.learnCategory = button.dataset.learnCategory;
        render();
      };
    for (const button of $$("[data-learn-topic]"))
      button.onclick = () => {
        ui.learnTopic = button.dataset.learnTopic;
        render();
      };
    $("#learn-action")?.addEventListener("click", (event) =>
      runAction(event.currentTarget.dataset.learnAction),
    );
    $("#learn-tour")?.addEventListener("click", () => {
      $(".learn-center").classList.add("hidden");
      ui.coachStep = 0;
      ui.coachEnabled = true;
      renderCoach();
    });
  }

  function open(topicId = ui.learnTopic) {
    if (topics.some((topic) => topic.id === topicId)) {
      ui.learnTopic = topicId;
      ui.learnCategory = "ALL";
    }
    closeSecondaryPanels();
    $("#learn-search").value = "";
    $(".discovery-coach").classList.add("hidden");
    $(".learn-center").classList.remove("hidden");
    render();
  }

  function renderCoach() {
    const coach = discoverySteps[ui.coachStep];
    if (!ui.coachEnabled || !coach) {
      $(".discovery-coach").classList.add("hidden");
      return;
    }
    $("#coach-count").textContent =
      `${ui.coachStep + 1} / ${discoverySteps.length}`;
    $("#coach-title").textContent = coach.title;
    $("#coach-copy").textContent = coach.copy;
    $("#coach-next").textContent =
      ui.coachStep === discoverySteps.length - 1 ? "FINISH ✓" : "NEXT →";
    $(".coach-progress").innerHTML = discoverySteps
      .map(
        (_, index) =>
          `<i class="${index <= ui.coachStep ? "active" : ""}"></i>`,
      )
      .join("");
    $(".discovery-coach").classList.remove("hidden");
  }

  function showFirstRun() {
    if (ui.coachEnabled && !persistence.load().complete) {
      ui.coachStep = 0;
      renderCoach();
    }
  }

  $("#close-learn").onclick = () => $(".learn-center").classList.add("hidden");
  $("#learn-search").oninput = render;
  $("#close-coach").onclick = () =>
    $(".discovery-coach").classList.add("hidden");
  $("#coach-disable").onclick = () => {
    ui.coachEnabled = false;
    persistence.setTipsEnabled(false);
    $(".discovery-coach").classList.add("hidden");
    actions.notify(
      "First-run tips disabled · every guide remains available under LEARN",
    );
  };
  $("#coach-show").onclick = () => open(discoverySteps[ui.coachStep].topic);
  $("#coach-next").onclick = () => {
    if (ui.coachStep >= discoverySteps.length - 1) {
      persistence.setComplete(true);
      $(".discovery-coach").classList.add("hidden");
      actions.notify(
        "Discovery tour complete · LEARN is always available in the header",
      );
      return;
    }
    ui.coachStep += 1;
    renderCoach();
  };
  $("#tutorial-btn").onclick = () => open();
  for (const button of $$("[data-open-learn]"))
    button.onclick = () => open(button.dataset.openLearn);

  return { closeSecondaryPanels, open, render, renderCoach, showFirstRun };
}
