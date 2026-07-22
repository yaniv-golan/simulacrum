import { createLearningPanels } from "./templates/learning-panels.js";
import { createWorkshopOverlays } from "./templates/overlays.js";
import { createWorkshopPanels } from "./templates/workshop-panels.js";

/** Composes independent panel templates; behavior is wired by presentation controllers. */
export function createWorkshopTemplate(defaultWatSource) {
  return `<div id="stage"></div><div class="ambient"><div class="sun"></div><div class="cloud c1"></div><div class="cloud c2"></div></div>
<div class="shell">
${createWorkshopPanels()}
${createLearningPanels(defaultWatSource)}
</div>
${createWorkshopOverlays()}`;
}
