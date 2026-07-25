export function createConnectionOverlaysTemplate() {
  return `<div class="toast" role="status" aria-live="polite"></div>
  <div class="selection-label hidden"><small>SELECTED</small><b></b></div>
  <div class="workshop-axis-indicator" role="img" aria-label="Workshop axes: X east, Y up, Z north">
    <small>WORKSHOP</small>
    <svg viewBox="0 0 72 72" aria-hidden="true">
      <g data-workshop-axis="x"><line x1="36" y1="36" x2="58" y2="36"></line><circle cx="58" cy="36" r="2"></circle><text x="58" y="32">X · E</text></g>
      <g data-workshop-axis="y"><line x1="36" y1="36" x2="36" y2="14"></line><circle cx="36" cy="14" r="2"></circle><text x="36" y="10">Y · UP</text></g>
      <g data-workshop-axis="z"><line x1="36" y1="36" x2="50" y2="50"></line><circle cx="50" cy="50" r="2"></circle><text x="50" y="46">Z · N</text></g>
      <circle class="axis-origin" cx="36" cy="36" r="2.5"></circle>
    </svg>
  </div>
  <div class="gizmo-drag-readout hidden">
    <div aria-hidden="true"><b></b><span></span></div>
    <span class="assistive-commit visually-hidden" role="status" aria-live="polite"></span>
  </div>
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
