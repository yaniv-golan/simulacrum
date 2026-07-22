export function createWorkshopHeaderTemplate() {
  return `<header>
    <div class="mark">
      <span class="mark-icon">S</span>
      <div><b>SIMULACRUM</b><small>MECHANICAL FOUNDRY</small></div>
    </div>
    <div class="mode-switch" aria-label="Workshop mode">
      <button data-mode="build" class="active" aria-pressed="true"><i>1</i> BUILD</button>
      <button data-mode="wire" aria-pressed="false"><i>2</i> CONNECT</button>
      <button data-mode="test" aria-pressed="false"><i>3</i> SIMULATE</button>
    </div>
    <div class="header-actions">
      <button id="demos-btn" title="Load a demonstration" aria-label="Demos"><i>▦</i><span>DEMOS</span></button>
      <button id="challenges-btn" title="Open engineering challenges" aria-label="Challenges"><i>⚑</i><span>CHALLENGES</span></button>
      <button id="remote-btn" title="Open the Field Remote" aria-label="Remote"><i>⌁</i><span>REMOTE</span></button>
      <div class="tools-menu-wrap">
        <button id="tools-btn" title="Open workshop tools" aria-label="Tools" aria-haspopup="menu" aria-expanded="false"><i>•••</i><span>TOOLS</span></button>
        <div class="tools-menu hidden" role="menu" aria-label="Workshop tools">
          <small>WORKSHOP TOOLS</small>
          <button id="environment-btn" role="menuitem">☀ <span>ENVIRONMENT<em>Time, wind & world</em></span></button>
          <button id="wasm-btn" role="menuitem">{ } <span>SCRIPT<em>Program controllers</em></span></button>
          <button id="blueprint-btn" role="menuitem">▱ <span>BLUEPRINTS<em>Save & reuse machines</em></span></button>
          <button id="settings-btn" role="menuitem">⚙ <span>LOCAL DATA<em>Storage & recovery</em></span></button>
          <button id="workspace-focus" role="menuitem">▣ <span>CANVAS FOCUS<em>Hide side panels · H</em></span></button>
          <button id="tutorial-btn" role="menuitem" title="Open searchable in-game help (?)">? <span>LEARN<em>Guides & shortcuts</em></span></button>
        </div>
      </div>
    </div>
  </header>`;
}
