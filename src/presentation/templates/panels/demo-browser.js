export function createDemoBrowserTemplate() {
  return `<section class="demo-browser glass hidden" aria-labelledby="demo-browser-title">
    <div class="demo-head">
      <div><small>FIVE-MACHINE VALIDATION SERIES</small><h2 id="demo-browser-title">Complexity ladder</h2></div>
      <button id="close-demos" aria-label="Close demonstrations">×</button>
    </div>
    <p>Five editable machines progress from basic torque transfer to autonomous aerospace systems. Every stage is powered, wired, physically connected, and paired with its own remote.</p>
    <div class="demo-grid">
      <button data-demo="gearbox"><i>⚙</i><span><b>1 · Powered Gearbox</b><small>Power · shaft · 2:1 reduction</small></span><em>01 / 05</em></button>
      <button data-demo="cart"><i>◉</i><span><b>2 · Suspension Rover</b><small>Traction · steering · lights</small></span><em>02 / 05</em></button>
      <button data-demo="drone"><i>✣</i><span><b>3 · Quad Drone</b><small>4 electric rotors · attitude control</small></span><em>03 / 05</em></button>
      <button data-demo="humanoid"><i>♙</i><span><b>4 · Atlas Humanoid</b><small>Powered joints · physical plant</small></span><em>04 / 05</em></button>
      <button data-demo="mission"><i>▲</i><span><b>5 · Orbital Missile</b><small>Aerodynamics · thermal flight</small></span><em>05 / 05</em></button>
    </div>
  </section>`;
}
