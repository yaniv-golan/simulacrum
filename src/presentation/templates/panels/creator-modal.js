export function createCreatorModalTemplate() {
  return `<div class="modal hidden" id="creator-modal" role="dialog" aria-modal="true" aria-labelledby="creator-title">
    <div class="modal-card">
      <div class="modal-head">
        <div><small>SUBASSEMBLY WORKSHOP</small><h2 id="creator-title">Save reusable assembly</h2></div>
        <button class="modal-close" aria-label="Close reusable assembly dialog">×</button>
      </div>
      <p>Save the complete connected selection with relative transforms, tuned behavior, programs, and internal links.</p>
      <div class="creator-summary"><span id="creator-selection-count">1 SELECTED PART</span><span id="creator-connection-count">0 INTERNAL LINKS</span></div>
      <label>ASSEMBLY NAME<input id="custom-name" value="My assembly" maxlength="40" /></label>
      <label>LIBRARY ACCENT<input id="custom-color" type="color" value="#e8a53a" /></label>
      <fieldset class="creator-exposed-ports"><legend>EXPOSED PORTS</legend><p>Choose the ordinary internal ports that remain connectable after placement. Reorder them for keyboard and assistive navigation.</p><ol id="creator-exposed-port-list"></ol></fieldset>
      <button id="create-component" class="primary">SAVE TO MY PARTS</button>
      <small class="creator-note">Tip: Ctrl/Cmd/Shift-click or drag a box on empty space to select multiple connected parts.</small>
    </div>
  </div>`;
}
