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
      <div class="status-row"><span>STATUS</span><b class="status">● READY</b></div>
      <div id="property-list"></div>
      <div id="load-monitor"></div>
      <div class="ports"><h4>CONNECTION PORTS</h4><div id="port-list"></div></div>
      <div class="inspector-actions">
        <button id="duplicate-part" data-shortcut-action="selection.duplicate">DUPLICATE <kbd data-shortcut-hint>C</kbd></button>
        <button id="mirror-selection" title="Reflect selection across the world X plane (Shift+M)">X-AXIS MIRROR</button>
        <button class="danger" id="delete-part" data-shortcut-action="selection.remove">DELETE <kbd data-shortcut-hint>X</kbd></button>
      </div>
    </div>
  </aside>`;
}
