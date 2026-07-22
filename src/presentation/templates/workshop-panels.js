import { createComponentInspectorTemplate } from "./panels/component-inspector.js";
import { createComponentLibraryTemplate } from "./panels/component-library.js";
import { createConnectionOverlaysTemplate } from "./panels/connection-overlays.js";
import { createDirectControllerTemplate } from "./panels/direct-controller.js";
import { createEnvironmentPanelTemplate } from "./panels/environment-panel.js";
import { createMissionPanelTemplate } from "./panels/mission-panel.js";
import { createLocalDataPanelTemplate } from "./panels/local-data-panel.js";
import { createRemoteConsoleTemplate } from "./panels/remote-console.js";
import { createWorkshopHeaderTemplate } from "./panels/workshop-header.js";
import { createWorkshopToolbarTemplate } from "./panels/workshop-toolbar.js";

export function createWorkshopPanels() {
  return [
    createWorkshopHeaderTemplate(),
    createComponentLibraryTemplate(),
    createComponentInspectorTemplate(),
    createWorkshopToolbarTemplate(),
    createMissionPanelTemplate(),
    createEnvironmentPanelTemplate(),
    createLocalDataPanelTemplate(),
    createDirectControllerTemplate(),
    createConnectionOverlaysTemplate(),
    createRemoteConsoleTemplate(),
  ].join("\n");
}
