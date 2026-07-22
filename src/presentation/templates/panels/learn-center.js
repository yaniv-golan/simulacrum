export function createLearnCenterTemplate() {
  return `<section class="learn-center glass hidden" aria-labelledby="learn-center-title">
    <div class="learn-head">
      <div>
        <small>IN-GAME KNOWLEDGE BASE</small><h2 id="learn-center-title">Learn Simulacrum</h2>
        <p>Search any capability, then launch it directly in the workshop.</p>
      </div>
      <button id="close-learn" aria-label="Close learning center">×</button>
    </div>
    <label class="learn-search">⌕ <input id="learn-search" aria-label="Search learning topics" placeholder="Search building, physics, scripting, controls…"></label>
    <div class="learn-layout">
      <nav aria-label="Learning topics"><div class="learn-categories"></div><div class="learn-topics"></div></nav>
      <article class="learn-detail"></article>
    </div>
  </section>`;
}
