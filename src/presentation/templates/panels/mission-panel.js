export function createMissionPanelTemplate() {
  return `<div class="mission" aria-live="polite">
    <small>TEST CHAMBER 01</small>
    <b id="mission-name">FIRST MOTION</b>
    <span id="mission-desc">Build a powered transmission and make the output gear turn.</span>
    <div class="mission-progress"><i></i></div>
    <div class="engineering-health">
      <em>STRUCTURE</em><i><u></u></i><strong id="health-readout">100%</strong>
    </div>
  </div>`;
}
