export function createDirectControllerTemplate() {
  return `<button class="controller-launcher hidden" id="controller-launcher" title="Open model controller">◆ CONTROLLER</button>
  <section class="drive-hud glass hidden" aria-label="Direct controller">
    <div class="drive-head">
      <div><small id="direct-profile">CONTROL SURFACE</small><b>DIRECT CONTROL</b></div>
      <span id="direct-status">IDLE</span>
      <div class="controller-window-actions">
        <button id="controller-mode" title="Switch custom or generic controller">CUSTOM</button>
        <button id="collapse-controller" title="Collapse controller" aria-expanded="true">−</button>
        <button id="close-controller" title="Close controller" aria-label="Close direct controller">×</button>
      </div>
    </div>
    <div class="controller-body">
      <div class="direct-surface-controls"></div>
      <div class="controller-design hidden">
        <label>STYLE<select id="controller-style"><option value="drive-pad">DRIVE PAD</option><option value="compact-grid">INSTRUMENT GRID</option></select></label>
        <label>ACCENT<input id="controller-accent" type="color" value="#70e0c4"></label>
        <label>NAME<input id="controller-title" maxlength="28" value="Direct Control"></label>
      </div>
      <div class="direct-actions">
        <button id="design-direct-surface" aria-expanded="false">DESIGN</button>
        <button id="edit-direct-surface">ADVANCED REMOTE →</button>
      </div>
    </div>
  </section>`;
}
