function composePanel() {
  return `<div class="exchange-compose">
    <div class="exchange-fields">
      <label>TITLE<input id="blueprint-name" value="My machine" maxlength="64"></label>
      <label>CREATOR<input id="blueprint-creator" placeholder="Your name" maxlength="48"></label>
      <label class="exchange-wide">DESCRIPTION<textarea id="blueprint-description" maxlength="500" placeholder="What does it do, and what should a remixer know?"></textarea></label>
      <label class="exchange-wide">TAGS<input id="blueprint-tags" placeholder="rover, cargo, autonomous" maxlength="180"></label>
    </div>
    <div class="exchange-compose-actions">
      <button id="save-machine" class="primary">SAVE CURRENT TO EXCHANGE</button>
      <button id="download-current">↓ DOWNLOAD CURRENT</button>
      <button id="share-current">⌁ COPY CURRENT LINK</button>
      <button id="share-my-parts">▦ ADD MY PARTS</button>
      <small id="exchange-remix-note">NEW ORIGINAL DESIGN</small>
    </div>
  </div>`;
}

function browserPanel() {
  return `<div class="exchange-browser">
    <div class="exchange-toolbar">
      <div class="exchange-filters">
        <button class="active" data-exchange-filter="all">ALL</button>
        <button data-exchange-filter="blueprint">MACHINES</button>
        <button data-exchange-filter="subassembly">ASSEMBLIES</button>
        <button data-exchange-filter="component">COMPONENTS</button>
        <button data-exchange-filter="verified">PROVEN</button>
        <button data-exchange-filter="favorites">★ FAVORITES</button>
      </div>
      <label class="exchange-search">⌕ <input id="exchange-search" placeholder="Search title, creator, description, or tag"></label>
    </div>
    <div class="blueprint-list exchange-grid"></div>
  </div>`;
}

function importPanel() {
  return `<div class="exchange-import" id="exchange-drop-zone">
    <div><b>IMPORT A SHARED DESIGN</b><span>Drop a current .simshare package here</span></div>
    <button id="pick-share-file">CHOOSE FILE</button>
    <input id="share-file-input" type="file" accept=".simshare,application/vnd.simulacrum.share+json" hidden>
    <i>OR</i>
    <input id="share-paste" placeholder="Paste a Simulacrum share link or package JSON">
    <button id="import-shared-text">IMPORT</button>
  </div>`;
}

export function createBlueprintExchangeTemplate() {
  return `<div class="modal hidden" id="blueprint-modal" role="dialog" aria-modal="true" aria-labelledby="blueprint-exchange-title">
    <div class="modal-card blueprint-card exchange-card">
      <div class="modal-head">
        <div>
          <small>LOCAL-FIRST SHARING ECOSYSTEM</small>
          <h2 id="blueprint-exchange-title">Blueprint Exchange</h2>
          <p>Package complete machines and reusable mechanisms, prove them in challenges, then share by file or link.</p>
        </div>
        <div class="exchange-head-actions"><span id="exchange-count">0 DESIGNS</span><button id="close-blueprints" aria-label="Close Blueprint Exchange">×</button></div>
      </div>
      ${composePanel()}
      ${browserPanel()}
      ${importPanel()}
    </div>
  </div>`;
}
