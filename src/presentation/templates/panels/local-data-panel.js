export function createLocalDataPanelTemplate() {
  return `<section class="local-data-panel glass hidden" aria-labelledby="local-data-title">
    <div class="local-data-head">
      <div><small>WORKSHOP SETTINGS</small><h2 id="local-data-title">Local data</h2></div>
      <button id="close-local-data" aria-label="Close local data settings">×</button>
    </div>
    <p>Your machines, reusable parts, challenge history, preferences, and script trust stay only in this browser.</p>
    <div class="local-data-recovery">
      <b>START FRESH ON THIS DEVICE</b>
      <p>Use this only to recover from damaged local data or erase this browser's Simulacrum workshop.</p>
      <button id="request-local-reset" class="danger-action">RESET LOCAL DATA…</button>
      <div id="confirm-local-reset" class="local-reset-confirm hidden" role="alert">
        <strong>Erase all Simulacrum data on this device?</strong>
        <p>This removes saved machines, My Parts, Exchange items, challenge results, preferences, and executable trust. Download anything you need first.</p>
        <div><button id="cancel-local-reset">CANCEL</button><button id="confirm-local-reset-button" class="danger-action">ERASE AND RELOAD</button></div>
      </div>
      <p id="local-reset-status" role="status" aria-live="polite"></p>
    </div>
  </section>`;
}
