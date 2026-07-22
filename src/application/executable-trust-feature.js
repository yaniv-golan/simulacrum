import { BlueprintAcquisition } from "../model/blueprint-acquisition.js";
import { ExecutableTrustRepository } from "./executable-trust-repository.js";
import {
  assessControllerTrust,
  grantControllerTrust,
} from "./executable-trust-service.js";

/** Coordinates executable trust policy with the controller editor presentation. */
export function installExecutableTrustFeature({
  getController,
  saveProgram,
  stopRuntime,
  notify,
  query = (selector) => document.querySelector(selector),
  repository = new ExecutableTrustRepository(),
}) {
  function render(controller = getController()) {
    const trust = controller?.programTrust,
      implicitlyLocal =
        controller?.programAcquisition === BlueprintAcquisition.LOCAL_AUTHORING,
      allowed = trust?.allowed ?? implicitlyLocal,
      requiresReview = Boolean(
        (trust?.requiresReview ?? !implicitlyLocal) && !allowed,
      ),
      status =
        trust?.status ||
        (implicitlyLocal
          ? "LOCAL PROGRAM"
          : "PROGRAM DISABLED — REVIEW SOURCE"),
      statusElement = query("#script-trust-status"),
      trustButton = query("#trust-program");
    if (statusElement) {
      statusElement.textContent = status;
      statusElement.classList.toggle("blocked", !allowed);
    }
    if (trustButton) {
      trustButton.classList.toggle("hidden", !requiresReview);
      trustButton.disabled = !controller || !requiresReview;
    }
  }

  async function refresh(controller = getController()) {
    if (!controller || controller.type !== "computer") return null;
    controller.programTrust = await assessControllerTrust({
      controller,
      repository,
    });
    if (controller === getController()) render(controller);
    return controller.programTrust;
  }

  async function enable() {
    const controller = getController();
    if (!controller) return notify("Select a Logic Controller first");
    saveProgram();
    controller.programTrust = await grantControllerTrust({
      controller,
      repository,
    });
    render(controller);
    if (!controller.programTrust.allowed) {
      stopRuntime(controller.programTrust.status, controller.id);
      return notify("Trust was not saved; the program remains disabled");
    }
    notify("Reviewed program enabled on this machine");
  }

  function invalidate(
    controller = getController(),
    message = "PROGRAM CHANGED — REVIEW REQUIRED",
  ) {
    if (!controller) return;
    controller.programTrust = null;
    stopRuntime(message, controller.id);
    render(controller);
  }

  return { enable, invalidate, refresh, render };
}
