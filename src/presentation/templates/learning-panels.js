import { createChallengeBrowserTemplate } from "./panels/challenge-browser.js";
import { createChallengeHudTemplate } from "./panels/challenge-hud.js";
import { createDemoBrowserTemplate } from "./panels/demo-browser.js";
import { createDiscoveryCoachTemplate } from "./panels/discovery-coach.js";
import { createLearnCenterTemplate } from "./panels/learn-center.js";
import { createLogicWorkbenchTemplate } from "./panels/logic-workbench.js";
import { createTestReserveBrowserTemplate } from "./panels/test-reserve-browser.js";

export function createLearningPanels(defaultWatSource) {
  return [
    createDemoBrowserTemplate(),
    createChallengeBrowserTemplate(),
    createChallengeHudTemplate(),
    createTestReserveBrowserTemplate(),
    createLearnCenterTemplate(),
    createDiscoveryCoachTemplate(),
    createLogicWorkbenchTemplate(defaultWatSource),
  ].join("\n");
}
