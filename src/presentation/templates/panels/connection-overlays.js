export function createConnectionOverlaysTemplate() {
  return `<div class="toast" role="status" aria-live="polite"></div>
  <div class="selection-label hidden"><small>SELECTED</small><b></b></div>
  <div class="connection-banner hidden" role="status">
    <span class="connection-pulse">◆</span>
    <div>
      <small>CONNECTING FROM</small><b></b>
      <em>Hover a compatible component, then click to connect</em>
    </div>
    <button id="cancel-connect">CANCEL · ESC</button>
  </div>
  <div class="placement-help hidden" role="group" aria-labelledby="placement-title">
    <span id="placement-title">PLACE PENDING ASSET</span>
    <label>X <input id="placement-x" type="number" step="0.25" value="0" aria-label="Placement X in meters"></label>
    <label>Y <input id="placement-y" type="number" step="0.25" value="0" aria-label="Placement Y in meters"></label>
    <label>Z <input id="placement-z" type="number" step="0.25" value="0" aria-label="Placement Z in meters"></label>
    <button id="place-pending">PLACE</button>
    <button id="cancel-placement">CANCEL · ESC</button>
  </div>`;
}
