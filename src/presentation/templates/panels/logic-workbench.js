export function createLogicWorkbenchTemplate(defaultWatSource) {
  return `<section class="wasm-console logic-workbench glass hidden" aria-labelledby="script-title">
    <div class="demo-head">
      <div><small>PROGRAMMABLE CONTROL LAB</small><h2 id="script-title">Logic Controller Program</h2></div>
      <button id="close-wasm" aria-label="Close controller program">×</button>
    </div>
    <div id="script-controller-status">SELECT A LOGIC CONTROLLER</div>
    <div id="script-trust-status" class="script-trust-status">LOCAL PROGRAM</div>
    <details class="controller-binding-editor" open>
      <summary><span>NAMED PHYSICAL I/O</span><small>Programs can access only these routed endpoints</small></summary>
      <div class="controller-binding-actions"><button data-add-controller-binding="input">＋ SENSOR INPUT</button><button data-add-controller-binding="output">＋ ACTUATOR OUTPUT</button></div>
      <div class="controller-binding-list"></div>
    </details>
    <div class="script-language" role="tablist" aria-label="Program language">
      <button data-script-language="visual" role="tab" aria-selected="false" tabindex="-1">VISUAL LOGIC</button>
      <button data-script-language="typescript" role="tab" aria-selected="false" tabindex="-1">TYPESCRIPT</button>
      <button class="active" data-script-language="wat" role="tab" aria-selected="true" tabindex="0">WEBASSEMBLY · WAT</button>
    </div>
    <p id="script-help">Every mode runs through the same restricted controller and physical signal network. <button data-open-learn="scripting">HOW DOES SAFE SCRIPTING WORK?</button></p>
    <div class="visual-logic-workspace hidden">
      <div class="logic-toolbar">
        <span>ADD NODE</span>
        <button data-add-logic-node="sensor">＋ SENSOR</button><button data-add-logic-node="constant">＋ VALUE</button>
        <button data-add-logic-node="math">＋ MATH</button><button data-add-logic-node="compare">＋ COMPARE</button>
        <button data-add-logic-node="select">＋ SELECT</button><button data-add-logic-node="clamp">＋ CLAMP</button>
        <button data-add-logic-node="output">＋ ACTUATOR</button><button id="logic-reset">RESET EXAMPLE</button>
      </div>
      <div class="logic-canvas"><svg class="logic-wires"></svg><div class="logic-nodes"></div></div>
    </div>
    <textarea id="wasm-source" aria-label="Controller source" spellcheck="false">${defaultWatSource}</textarea>
    <div class="logic-debug">
      <div class="logic-debug-head">
        <div><small>CONTROLLER DEBUGGER</small><b id="logic-debug-status">0 SAMPLES</b></div>
        <div><button id="logic-step">▸│ STEP PHYSICS</button><button id="logic-clear-trace">CLEAR TRACE</button></div>
      </div>
      <div class="logic-debug-grid">
        <section><h4>TYPED SENSOR API · CLICK TO WATCH</h4><div class="logic-sensor-list"></div></section>
        <section>
          <h4>OSCILLOSCOPE · LAST 3 SECONDS</h4><div class="logic-scope"></div>
          <div class="logic-breakpoint">
            <select id="logic-breakpoint-name" aria-label="Breakpoint signal"></select>
            <select id="logic-breakpoint-op" aria-label="Breakpoint comparison"><option value="gt">&gt;</option><option value="gte">≥</option><option value="lt">&lt;</option><option value="lte">≤</option><option value="eq">=</option></select>
            <input id="logic-breakpoint-value" aria-label="Breakpoint value" type="number" step="0.1" value="5">
            <button id="logic-arm-breakpoint">ARM BREAKPOINT</button>
          </div>
          <div class="logic-variables"></div>
        </section>
      </div>
    </div>
    <div class="wasm-api">
      <span id="script-sensors">SENSORS: CONNECT A SENSOR TO DISCOVER ITS TYPED READINGS</span>
      <span id="script-channels">CHANNELS: OUTPUTS REQUIRE A LIVE SIGNAL PATH</span>
    </div>
    <div class="wasm-actions">
      <button id="trust-program" class="trust-program hidden">ENABLE REVIEWED PROGRAM</button>
      <button id="compile-wasm" class="primary">COMPILE & RUN</button>
      <button id="logic-test-machine">▶ TEST MACHINE</button><button id="stop-wasm">STOP PROGRAM</button>
      <b id="wasm-status" role="status">IDLE</b>
    </div>
  </section>`;
}
