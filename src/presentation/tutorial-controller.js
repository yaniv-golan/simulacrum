const TUTORIAL_STEPS = Object.freeze([
  Object.freeze({
    title: "Place the motor",
    description:
      "Choose the highlighted Powered Motor, then click the workbench to place it.",
    event: "placed",
  }),
  Object.freeze({
    title: "Add a pinion gear",
    description:
      "Choose the highlighted 12T Pinion Gear and place it near the motor.",
    event: "placed",
  }),
  Object.freeze({
    title: "Mount it on the shaft",
    description:
      "Select the motor and click SHAFT, then click the pinion. Its hub will physically snap onto the motor shaft and align its axis.",
    event: "connected",
  }),
  Object.freeze({
    title: "Supply real power",
    description:
      "A motor cannot run by itself. Place the highlighted Power Cell and connect its POWER port to the motor.",
    event: "connected",
  }),
  Object.freeze({
    title: "Mesh the output gear",
    description:
      "Place a 24T Spur Gear nearby and connect its MESH port to the 12T pinion (either selection order works). It will snap to the correct pitch-center distance and receive torque from the motor-driven gear.",
    event: "connected",
  }),
  Object.freeze({
    title: "Test the mechanism",
    description:
      "Press START SIMULATION. Torque transfers only through powered, physically aligned connections.",
    event: "simulate",
  }),
]);

/**
 * @typedef {{ step:()=>number, setStep:(step:number)=>void }} TutorialModelPort
 * @typedef {{
 *   clearMachine:()=>void, renderLibrary:()=>void, loadDemo:(kind:string)=>void,
 *   hasMachine:()=>boolean,
 *   openLearning:(topic?:string)=>void, showDiscovery:()=>void,
 *   notify:(message:string)=>void,
 * }} TutorialActionPort
 * @typedef {{ query:(selector:string)=>Element|null, queryAll:(selector:string)=>Element[] }} TutorialViewPort
 */

/**
 * Owns the complete guided-start interaction and emits only domain-level
 * tutorial actions. The surrounding application never mutates tutorial DOM.
 *
 * @param {{ model:TutorialModelPort, actions:TutorialActionPort, view:TutorialViewPort }} ports
 */
export function installTutorialController({ model, actions, view }) {
  /** @param {string} selector */
  const required = (selector) => {
    const element = view.query(selector);
    if (!element) throw new Error(`Missing tutorial element ${selector}`);
    return /** @type {HTMLElement} */ (element);
  };

  function render() {
    const step = model.step(),
      content = TUTORIAL_STEPS[step];
    if (!content) return;
    required(".t-index").textContent =
      `${String(step + 1).padStart(2, "0")} / ${String(TUTORIAL_STEPS.length).padStart(2, "0")}`;
    required(".tutorial h2").textContent = content.title;
    required(".tutorial p").textContent = content.description;
    view
      .queryAll(".t-progress i")
      .forEach((element, index) =>
        element.classList.toggle("done", index <= step),
      );
  }

  function begin() {
    model.setStep(0);
    actions.clearMachine();
    required(".tutorial").classList.remove("hidden");
    render();
    actions.renderLibrary();
  }

  /** @param {string} event */
  function accept(event) {
    const step = model.step();
    if (step < 0 || TUTORIAL_STEPS[step]?.event !== event) return false;
    const next = step + 1;
    if (next >= TUTORIAL_STEPS.length) {
      required(".tutorial").classList.add("hidden");
      model.setStep(-1);
      actions.notify("Tutorial complete — the workshop is yours");
    } else {
      model.setStep(next);
      render();
    }
    actions.renderLibrary();
    return true;
  }

  required("#guided-start").onclick = () => {
    required(".welcome").remove();
    begin();
  };
  required("#sandbox-start").onclick = () => {
    required(".welcome").remove();
    if (!actions.hasMachine()) actions.loadDemo("gearbox");
    actions.showDiscovery();
  };
  required("#learn-start").onclick = () => {
    required(".welcome").remove();
    actions.loadDemo("gearbox");
    actions.openLearning("first-machine");
  };
  for (const id of ["#guided-start", "#sandbox-start", "#learn-start"]) {
    const button = /** @type {HTMLButtonElement} */ (required(id));
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
  required("#tutorial-next").onclick = () => {
    const step = model.step();
    if (step >= 0) accept(TUTORIAL_STEPS[step]?.event || "");
  };
  required("#tutorial-skip").onclick = () => {
    required(".tutorial").classList.add("hidden");
    model.setStep(-1);
    actions.loadDemo("gearbox");
  };

  return Object.freeze({ begin, accept, render });
}
