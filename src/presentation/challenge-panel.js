import { challengeReliability } from "../model/challenge-lab.js";

/** Renders Challenge Lab discovery and the compact live contract read model. */
export function createChallengePanel({
  root = document,
  challenges,
  getView,
  onStart,
  onRetry,
}) {
  const $ = (selector) => root.querySelector(selector),
    $$ = (selector) => Array.from(root.querySelectorAll(selector));

  function renderBrowser() {
    const view = getView(),
      ordered = [...challenges].sort(
        (left, right) =>
          Number(right.category === "OPEN CONSTRUCTION") -
          Number(left.category === "OPEN CONSTRUCTION"),
      );
    $(".challenge-grid").innerHTML = ordered
      .map((challenge) => {
        const reliability = challengeReliability(view.records, challenge.id),
          best = Math.max(reliability.best, view.best[challenge.id] || 0),
          approaches = challenge.approaches?.length
            ? `<div class="challenge-approaches">${challenge.approaches.map((approach) => `<span>${approach}</span>`).join("")}</div>`
            : '<div class="challenge-approaches"><span>REFERENCE MACHINE</span></div>',
          actions = challenge.startModes
            .map((mode) => {
              const label =
                mode === "empty"
                  ? "START EMPTY"
                  : mode === "current"
                    ? "USE CURRENT BUILD"
                    : "LOAD CALIBRATION";
              return `<button data-challenge="${challenge.id}" data-start-mode="${mode}">${label}</button>`;
            })
            .join("");
        return `<article class="${challenge.category === "OPEN CONSTRUCTION" ? "open-contract" : "calibration"}"><div class="challenge-card-main"><i>${challenge.icon}</i><span><small>${challenge.category}</small><b>${challenge.stage} · ${challenge.name}</b><p>${challenge.brief}</p><em>${challenge.target}</em>${approaches}</span><strong>${best ? `BEST ${best}` : "UNPROVEN"}<small>${reliability.attempts ? `${Math.round(reliability.reliability * 100)}% · ${reliability.attempts} RUNS` : "NO RUNS"}</small></strong></div><div class="challenge-card-actions">${actions}</div></article>`;
      })
      .join("");
    $$("[data-challenge][data-start-mode]").forEach(
      (button) =>
        (button.onclick = () =>
          onStart(button.dataset.challenge, button.dataset.startMode)),
    );
  }

  function renderHud() {
    const view = getView(),
      challenge = challenges.find((entry) => entry.id === view.activeChallenge),
      result = view.result,
      reliability = challenge
        ? challengeReliability(view.records, challenge.id)
        : null;
    $(".mission").classList.toggle("challenge-active", Boolean(challenge));
    $(".challenge-hud").classList.toggle("hidden", !challenge);
    if (!challenge) return;
    $("#challenge-title").textContent = challenge.name.toUpperCase();
    $("#challenge-objective").textContent = challenge.target;
    $(".challenge-meter i").style.width =
      `${Math.max(0, Math.min(1, view.progress)) * 100}%`;
    $("#challenge-approach").textContent =
      result?.solution && result.solution !== "UNRESOLVED"
        ? `SOLUTION CLASS · ${result.solution}`
        : `${view.startMode === "current" ? "YOUR BUILD" : view.startMode === "empty" ? "EMPTY START" : "REFERENCE CALIBRATION"} · AWAITING TEST`;
    $(".challenge-criteria").innerHTML = (result?.criteria || [])
      .slice(0, 5)
      .map(
        (entry) =>
          `<div class="${entry.met ? "met" : ""}"><i>${entry.met ? "✓" : "○"}</i><span><b>${entry.label}</b><em>${entry.current} / ${entry.target}</em></span></div>`,
      )
      .join("");
    $("#challenge-status").textContent =
      view.status === "complete"
        ? "PROVEN"
        : view.status === "failed"
          ? "FAILED"
          : view.running
            ? view.paused
              ? "PAUSED"
              : "MEASURING"
            : "READY TO TEST";
    $("#challenge-score").textContent = view.score
      ? `${view.score} PTS`
      : view.best[challenge.id]
        ? `BEST ${view.best[challenge.id]}`
        : "NO SCORE";
    $("#challenge-mass").textContent = result
      ? `${Math.round(result.metrics.massKg)} KG`
      : "— KG";
    $("#challenge-energy").textContent = result
      ? `${result.metrics.energyUsed.toFixed(1)} ENERGY`
      : "— ENERGY";
    $("#challenge-damage").textContent = result
      ? `${result.metrics.damage} DAMAGE`
      : "0 DAMAGE";
    $("#challenge-reliability").textContent = reliability?.attempts
      ? `${Math.round(reliability.reliability * 100)}% RELIABLE · ${reliability.attempts} RUNS`
      : "NEW DESIGN";
    $(".challenge-hud").classList.toggle(
      "complete",
      view.status === "complete",
    );
    $(".challenge-hud").classList.toggle("failed", view.status === "failed");
  }

  $("#challenge-retry").onclick = onRetry;
  return { renderBrowser, renderHud };
}
