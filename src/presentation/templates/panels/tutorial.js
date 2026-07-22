export function createTutorialTemplate() {
  return `<div class="tutorial hidden" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
    <div class="tutorial-step">
      <div class="t-index">01 / 06</div>
      <h2 id="tutorial-title">Welcome to the workbench</h2>
      <p>Let’s build a real powered gear transmission.</p>
      <div class="t-progress" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      <button id="tutorial-next">GOT IT</button><button id="tutorial-skip">Skip tutorial</button>
    </div>
    <div class="tutorial-arrow" aria-hidden="true">↙</div>
  </div>`;
}
