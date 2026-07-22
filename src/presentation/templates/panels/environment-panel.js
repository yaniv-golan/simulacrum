export function createEnvironmentPanelTemplate() {
  return `<section class="environment-panel glass hidden" aria-labelledby="environment-title">
    <div class="environment-head">
      <div><small>WORLD ATMOSPHERE</small><h2 id="environment-title">Time, sky & wind</h2></div>
      <output id="time-label">14:00</output>
      <button id="close-environment" aria-label="Close environment panel">×</button>
    </div>
    <label class="time-control">
      <span>LOCAL SOLAR TIME <b id="sun-status">DAYLIGHT</b></span>
      <input id="time-of-day" aria-label="Local solar time" type="range" min="0" max="24" step="0.25" value="14">
    </label>
    <div class="time-presets">
      <button data-time="6">DAWN</button><button data-time="12">NOON</button>
      <button data-time="18">SUNSET</button><button data-time="0">MIDNIGHT</button>
    </div>
    <label class="wind-toggle">
      <input id="wind-enabled" type="checkbox" checked>
      <span><b>PHYSICAL WINDS</b><small>Boundary layer · veering · jet stream</small></span><i></i>
    </label>
    <div class="wind-readout">
      <span><b id="surface-wind">—</b><small>10 M WIND</small></span>
      <span><b id="jet-wind">—</b><small>10 KM WIND</small></span>
    </div>
    <div class="celestial-readout">
      <span>☀ <b id="sun-elevation">47°</b><small>SUN ELEVATION</small></span>
      <span>◐ <b>384,400 km</b><small>MOON DISTANCE</small></span>
    </div>
    <div class="earth-readout">
      <span><b id="earth-coordinate">—</b><small>GLOBAL POSITION</small></span>
      <span><b id="earth-chunks">0</b><small>STREAMED TILES</small></span>
    </div>
    <button class="context-learn" data-open-learn="world-space">HOW TERRAIN, WATER & SPACE WORK →</button>
  </section>`;
}
