export function createWorkshopToolbarTemplate() {
  return `<div class="bottom-bar glass" aria-label="Workshop tools">
    <div class="tool-group" role="toolbar" aria-label="Editor tools">
      <button id="select-tool" class="active">↖ <span>SELECT<kbd>V</kbd></span></button>
      <button id="move-tool">✥ <span>MOVE<kbd>G</kbd></span></button>
      <button id="rotate-tool">↻ <span>ROTATE<kbd>R</kbd></span></button>
      <button id="undo-tool" title="Undo (Ctrl/Cmd+Z)">↶ <span>UNDO<kbd>⌘Z</kbd></span></button>
      <button id="redo-tool" title="Redo (Ctrl/Cmd+Shift+Z)">↷ <span>REDO<kbd>⇧⌘Z</kbd></span></button>
    </div>
    <div class="build-readout" aria-live="polite">
      <span><i class="dot green"></i><b id="part-count">0</b> PARTS</span>
      <span><i class="dot blue"></i><b id="connection-count">0</b> CONNECTIONS</span>
      <span><b id="total-mass">0</b> KG</span>
    </div>
    <div class="sim-controls hidden" role="toolbar" aria-label="Simulation controls">
      <button id="sim-pause" title="Pause/resume (K)">Ⅱ</button>
      <button id="sim-speed" title="Simulation speed ([ and ])">1×</button>
      <button id="sim-reset" title="Reset this test (Shift+R)">↺</button>
    </div>
    <button id="run-btn" class="run">▶ START SIMULATION</button>
  </div>
  <div class="camera-tools glass" role="toolbar" aria-label="Camera controls">
    <button id="orbit-view" title="Orbit camera">⟳<span>ORBIT</span></button>
    <button id="pan-view" title="Pan camera">✋<span>PAN</span></button>
    <button id="zoom-in" title="Zoom toward the view center">＋</button>
    <button id="zoom-out" title="Zoom away from the view center">−</button>
    <button id="focus-view" title="Frame selected component or complete machine (F)">◎<span>FOCUS</span></button>
    <button id="view-front" title="Front view (Numpad 1)">N1</button>
    <button id="view-side" title="Side view (Numpad 3)">N3</button>
    <button id="view-top" title="Top view (Numpad 7)">N7</button>
    <button id="view-home" title="Reset workshop view (Home)">⌂</button>
    <button id="explode-view" title="Temporarily separate parts and reveal connections (X)">⤢<span>EXPLODE</span></button>
    <button id="camera-help" title="Camera controls" aria-expanded="false">?</button>
    <div class="camera-help-card hidden"></div>
  </div>`;
}
