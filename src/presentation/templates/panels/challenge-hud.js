export function createChallengeHudTemplate() {
  return `<section class="challenge-hud glass hidden" aria-live="polite">
    <small>ACTIVE CONTRACT</small>
    <b id="challenge-title">CARGO RELAY</b>
    <span id="challenge-objective"></span>
    <div class="challenge-approach" id="challenge-approach">AWAITING PHYSICAL SYSTEM</div>
    <div class="challenge-meter"><i></i></div>
    <div class="challenge-criteria"></div>
    <div class="challenge-readout"><em id="challenge-status">READY</em><strong id="challenge-score">0</strong></div>
    <div class="challenge-score-factors">
      <span id="challenge-mass">— KG</span><span id="challenge-energy">— ENERGY</span>
      <span id="challenge-damage">0 DAMAGE</span><span id="challenge-reliability">NEW DESIGN</span>
    </div>
    <button id="challenge-retry">↺ RETRY EXACT START</button>
  </section>`;
}
