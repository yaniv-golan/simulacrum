export function createRemoteConsoleTemplate() {
  return `<section class="remote-console glass hidden" aria-labelledby="remote-title">
    <div class="remote-head">
      <div><small>COMMAND UPLINK</small><h2 id="remote-title">Field Remote</h2></div>
      <div class="uplink"><i></i><span>CHECKING LINK</span></div>
      <button id="close-remote" aria-label="Close Field Remote">×</button>
    </div>
    <div class="remote-profile">
      <label>CONTROL TEMPLATE
        <select id="remote-profile">
          <option value="gearbox">Powered Gearbox</option><option value="cart">Powered Cart</option>
          <option value="drone">Flight Drone</option><option value="humanoid">Humanoid Robot</option>
          <option value="mission">Space Mission</option>
        </select>
      </label>
      <button id="edit-remote">CUSTOMIZE</button>
    </div>
    <div class="remote-help">
      Commands require a powered Logic Controller and a blue signal connection to the target component.
      <button data-open-learn="power-control">WHY IS A CHANNEL OFFLINE?</button>
    </div>
    <div class="remote-controls"></div>
    <div class="remote-foot">
      <span id="command-count">0 CHANNELS ACTIVE</span>
      <button id="toggle-direct-panel">PIN DIRECT PANEL</button>
      <button id="add-command">＋ ADD CONTROL</button>
    </div>
  </section>`;
}
