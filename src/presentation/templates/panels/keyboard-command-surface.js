export function createKeyboardCommandSurfaceTemplate() {
  return `<div id="keyboard-command-surface" class="modal hidden" role="dialog" aria-modal="true" aria-labelledby="keyboard-command-title">
    <section class="modal-card keyboard-command-card">
      <div class="modal-head">
        <div><small>SESSION CONTROLS</small><h2 id="keyboard-command-title">Keyboard & commands</h2></div>
        <button id="close-keyboard-commands" class="modal-close" aria-label="Close keyboard and commands">×</button>
      </div>
      <p>Search every registered workshop command. Bindings use physical keys and reset when this browser session reloads; machine Remote bindings remain part of the authored blueprint.</p>
      <div class="keyboard-command-tools">
        <label>FIND A COMMAND<input id="keyboard-command-search" type="search" autocomplete="off" placeholder="Build, pause, view…"></label>
        <label>CONTEXT<select id="keyboard-command-context"><option value="active">ACTIVE NOW</option><option value="all">ALL</option><option value="workshop">BUILD / CONNECT</option><option value="operation">SIMULATE</option></select></label>
        <button id="reset-keyboard-commands" type="button">RESET DEFAULTS</button>
      </div>
      <p id="keyboard-command-status" role="status" aria-live="polite"></p>
      <div id="keyboard-command-list" class="keyboard-command-list"></div>
    </section>
  </div>`;
}
