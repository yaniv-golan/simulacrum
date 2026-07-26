export function createComponentInspectorTemplate() {
  return `<aside class="inspector glass" aria-label="Component inspector">
    <section class="assembly-outliner" aria-labelledby="assembly-outliner-title">
      <h3 id="assembly-outliner-title">ASSEMBLY ENTITIES</h3>
      <p>Exact keyboard selection for parts, ports, and connections.</p>
      <div id="assembly-outliner-list"></div>
    </section>
    <div class="inspector-empty">
      <div class="orbit-icon">◎</div>
      <h3>Select a component</h3>
      <p>Click to select; hold and drag to move. Ctrl/Cmd/Shift-click edits the selection.</p>
      <button class="context-learn" data-open-learn="build-edit">LEARN SELECTION & EDITING →</button>
    </div>
    <div class="inspector-content hidden">
      <div class="inspect-title">
        <span class="part-badge">◉</span>
        <div><small>SELECTED COMPONENT</small><h2 id="inspect-name">Motor</h2></div>
        <button id="close-inspect" aria-label="Close component inspector">×</button>
      </div>
      <div class="selection-context" aria-label="Selection context">
        <label class="primary-selection-control" for="primary-selection">
          <span>PRIMARY COMPONENT</span>
          <select id="primary-selection" aria-describedby="selection-impact"></select>
        </label>
        <p id="selection-impact"></p>
        <div class="selection-view-actions" aria-label="Selection view actions">
          <button id="frame-selection" data-shortcut-action="selection.frame"><span class="action-label">FRAME COMPONENT</span> <kbd data-shortcut-hint>F</kbd></button>
          <button id="isolate-selection"><span class="action-label">ISOLATE COMPONENT</span></button>
          <button id="show-all-components" class="hidden"><span class="action-label">SHOW ALL</span></button>
        </div>
      </div>
      <div class="status-row"><span>STATUS</span><b class="status">● READY</b></div>
      <div id="property-list"></div>
      <div id="load-monitor"></div>
      <div class="ports"><h4>CONNECTION PORTS</h4><div id="port-list"></div><div id="configured-chain-list"></div></div>
      <div class="inspector-actions">
        <button id="duplicate-part" data-shortcut-action="selection.duplicate"><span class="action-label">DUPLICATE COMPONENT</span> <kbd data-shortcut-hint>C</kbd></button>
        <button id="mirror-selection"><span class="action-label">MIRROR COMPONENT</span></button>
        <button class="danger" id="delete-part" data-shortcut-action="selection.remove"><span class="action-label">DELETE COMPONENT</span> <kbd data-shortcut-hint>X</kbd></button>
      </div>
    </div>
  </aside>`;
}
