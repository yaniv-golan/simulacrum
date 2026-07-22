export function createDiscoveryCoachTemplate() {
  return `<section class="discovery-coach glass hidden" aria-live="polite">
    <div class="coach-kicker">DISCOVERY TOUR · <span id="coach-count">1 / 5</span></div>
    <button id="close-coach" aria-label="Close discovery tour">×</button>
    <b id="coach-title">Look around naturally</b>
    <p id="coach-copy"></p>
    <div class="coach-progress"></div>
    <div class="coach-actions"><button id="coach-show">SHOW ME</button><button id="coach-next">NEXT →</button></div>
    <button id="coach-disable">DON’T SHOW FIRST-RUN TIPS</button>
  </section>`;
}
