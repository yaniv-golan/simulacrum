import { createBlueprintExchangeTemplate } from "./blueprint-exchange.js";
import { createCreatorModalTemplate } from "./panels/creator-modal.js";
import { createTutorialTemplate } from "./panels/tutorial.js";
import { createWelcomeTemplate } from "./panels/welcome.js";

export function createWorkshopOverlays() {
  return [
    createWelcomeTemplate(),
    createTutorialTemplate(),
    createCreatorModalTemplate(),
    createBlueprintExchangeTemplate(),
  ].join("\n");
}
