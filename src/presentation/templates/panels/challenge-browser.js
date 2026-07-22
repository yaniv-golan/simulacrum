export function createChallengeBrowserTemplate() {
  return `<section class="challenge-browser glass hidden" aria-labelledby="challenge-browser-title">
    <div class="demo-head">
      <div><small>ENGINEERING CHALLENGE LAB</small><h2 id="challenge-browser-title">Invent. Test. Improve.</h2></div>
      <button id="close-challenges" aria-label="Close challenges">×</button>
    </div>
    <p>Open contracts judge physical outcomes, not a prescribed machine. Start empty or bring your current build; wheels, legs, rotors, rockets, and hybrids can all qualify.</p>
    <div class="challenge-browser-legend">
      <span>CALIBRATION</span><span>OPEN CONSTRUCTION</span><span>ENERGY · MASS · DAMAGE · RELIABILITY</span>
    </div>
    <div class="challenge-grid"></div>
  </section>`;
}
