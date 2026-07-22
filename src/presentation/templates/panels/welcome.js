export function createWelcomeTemplate() {
  return `<div class="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
    <div class="welcome-art" aria-hidden="true">
      <div class="gear-art g1">⚙</div><div class="gear-art g2">⚙</div><div class="gear-art g3">⚙</div>
    </div>
    <div class="welcome-card">
      <div class="edition">EARLY ENGINEERING BUILD · 0.2</div>
      <h1 id="welcome-title">Build machines.<br><em>Understand why they move.</em></h1>
      <p>Every axle, tooth, signal, and force is visible. Start with a guided gearbox, explore every capability in-game, then invent anything from walking robots to orbital vehicles.</p>
      <div class="welcome-actions">
        <button id="guided-start" class="primary" disabled aria-busy="true">START GUIDED BUILD <span>→</span></button>
        <button id="sandbox-start" disabled aria-busy="true">OPEN SANDBOX</button><button id="learn-start" disabled aria-busy="true">EXPLORE FEATURES</button>
      </div>
      <div class="feature-row">
        <span>⚙ REAL GEAR RATIOS</span><span>⌁ LIVE SIGNAL WIRING</span>
        <span>▱ REUSABLE ASSEMBLIES</span><span>⚑ PHYSICS CHALLENGES</span>
      </div>
    </div>
  </div>`;
}
