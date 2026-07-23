export function createTestReserveBrowserTemplate() {
  return `<section id="test-reserve-browser" class="test-reserve-browser glass hidden" aria-labelledby="test-reserve-title" aria-hidden="true">
    <div class="demo-head">
      <div><small>WORKSHOP TEST RESERVE</small><h2 id="test-reserve-title">Choose a proving ground</h2></div>
      <button id="close-test-reserve" aria-label="Close Test Reserve">×</button>
    </div>
    <p>Use the same physical site freely or stage the stopped assembly near a test district. Surface colors represent actual contact materials.</p>
    <div class="test-reserve-layout">
      <div id="test-reserve-map" class="test-reserve-map" aria-label="Map of the Workshop Test Reserve"></div>
      <aside>
        <div id="test-reserve-status" role="status">READY · BOARD START</div>
        <button id="test-reserve-free" class="primary">FREE TEST FROM CURRENT POSITION</button>
        <button id="test-reserve-retry">RETRY EXACT START <small>CTRL / CMD + R</small></button>
        <small>DEPLOY STOPPED ASSEMBLY</small>
        <div id="test-reserve-pads" class="test-reserve-pads"></div>
        <small>GUIDED TRIALS</small>
        <div id="test-reserve-routes" class="test-reserve-routes"></div>
      </aside>
    </div>
    <div id="test-reserve-legend" class="test-reserve-legend"></div>
  </section>`;
}
