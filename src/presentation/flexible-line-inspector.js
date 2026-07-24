import { TYPES } from "../model/component-catalog.js";

export function flexibleLineMaterialMarkup(part) {
  return TYPES[part.type]?.flexibleLine
    ? `<br><strong>MATERIAL · ${String(part.config.materialKey).toUpperCase()}</strong>`
    : "";
}

export function flexibleLineReadout(part) {
  const line = part.flexibleLineTelemetry;
  if (!line) return "";
  return `<section class="mechanism-editor"><h4>ROPE · COMPLETED PHYSICS TICK</h4><p class="component-contract-note">${line.state.toUpperCase()} · ${line.totalLengthM.toFixed(3)} m current arc / ${line.unstretchedLengthM.toFixed(3)} m unstretched · ${line.endToEndDistanceM.toFixed(3)} m span · ${line.slackM.toFixed(3)} m slack · ${line.extensionM.toFixed(4)} m extension</p><p class="component-contract-note">${(line.maximumTensionN / 1000).toFixed(2)} kN maximum tension · ${line.elasticEnergyJ.toFixed(2)} J elastic energy · ${(line.dampingDissipationJ + line.contactDissipationJ).toFixed(2)} J dissipated · ${line.contactCount} contacts</p><p class="component-contract-note">END_A ${(line.endpointTensionsN.END_A / 1000).toFixed(2)} kN · END_B ${(line.endpointTensionsN.END_B / 1000).toFixed(2)} kN · ${(100 * line.failureMargin).toFixed(1)}% governing failure margin (${line.governingElementId || "none"}) · ${line.validity}${line.unsupportedEffects.length ? `: ${line.unsupportedEffects.join(", ")}` : ""}</p></section>`;
}

export function twoEndedRopeWorkflow(selection) {
  if (selection.length !== 2) return "";
  const spanM = selection[0].mesh.position.distanceTo(
      selection[1].mesh.position,
    ),
    extraSlackM = 0.25,
    lengthM = spanM + extraSlackM,
    rope = TYPES.rope,
    massKg = lengthM * Number(rope.linearDensityKgPerM),
    ratingKn = Number(rope.ultimateTensionN) / 1000;
  return `<section class="mechanism-editor" aria-labelledby="connect-with-rope-title"><h4 id="connect-with-rope-title">CONNECT WITH ROPE</h4><p class="component-contract-note">Create one ordinary Rope and two ordinary attachments as one undoable action. Current direct span ${spanM.toFixed(2)} m · estimated mass ${massKg.toFixed(2)} kg · nominal break load ${ratingKn.toFixed(1)} kN.</p><label>EXTRA CUT LENGTH / SLACK (m)<input id="two-ended-extra-slack" type="number" min="0" max="20" step="0.05" value="${extraSlackM}" aria-describedby="connect-with-rope-title"></label><button id="connect-with-rope" type="button">CONNECT SELECTED COMPONENTS WITH ROPE</button></section>`;
}

export function bindTwoEndedRopeWorkflow({
  query,
  selectedParts,
  connect,
  notify,
}) {
  const button = query("#connect-with-rope");
  if (!button) return;
  button.onclick = () => {
    const input = query("#two-ended-extra-slack"),
      extraSlackM = Number(input?.value);
    if (!Number.isFinite(extraSlackM) || extraSlackM < 0) {
      input?.setAttribute("aria-invalid", "true");
      notify("Extra Rope length must be a finite non-negative value");
      return;
    }
    connect(
      selectedParts().map((selected) => selected.id),
      extraSlackM,
    );
  };
}
