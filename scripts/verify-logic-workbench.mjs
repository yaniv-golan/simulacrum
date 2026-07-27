import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1440, height: 950 },
});
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.click("#sandbox-start");
await page.click("#demos-btn");
await page.click('[data-demo="mission"]');
await page.click("#tools-btn");
await page.click("#wasm-btn");
await page.waitForFunction(() =>
  document
    .querySelector("#script-trust-status")
    ?.textContent.includes("AUDITED BUILT-IN"),
);
await page.click('[data-script-language="visual"]');

const initial = {
  nodes: await page.locator(".logic-node").count(),
  bindings: await page.locator(".controller-binding-row").count(),
  validBindings: await page.locator(".controller-binding-row.online").count(),
  sensorCards: await page.locator(".logic-sensor-list button").count(),
  heading: await page.locator("#script-title").innerText(),
  inputs: await page.locator("#script-sensors").innerText(),
  outputs: await page.locator("#script-channels").innerText(),
};

const aliasInput = page
  .locator(".controller-binding-row")
  .filter({ hasText: "Navigation Sensor" })
  .first()
  .locator("[data-binding-alias]");
await aliasInput.fill("navigation.x");
await aliasInput.press("Tab");
await page.locator("#trust-program").waitFor({ state: "visible" });
assert.match(await page.locator("#script-trust-status").innerText(), /REVIEW/);
assert.equal(
  await aliasInput.inputValue(),
  "navigation.x",
  "binding alias rename did not persist",
);

await page.click('[data-add-logic-node="sensor"]');
await page.click('[data-add-logic-node="constant"]');
await page.click('[data-add-logic-node="output"]');
await page
  .locator('.logic-node.output select[data-link-input="0"]')
  .selectOption("constant-2");
const editedNodes = await page.locator(".logic-node").count();
await page.click("#trust-program");
await page.click("#compile-wasm");
await page.waitForFunction(() =>
  document.querySelector("#wasm-status")?.textContent.includes("ONLINE"),
);

const boundSensor = await page
  .locator('[data-watch^="sensor."]')
  .first()
  .getAttribute("data-watch");
assert.ok(boundSensor, "named physical input was not exposed to the debugger");
await page.click(`[data-watch="${boundSensor}"]`);
await page.selectOption("#logic-breakpoint-name", boundSensor);
await page.selectOption("#logic-breakpoint-op", "gte");
await page.fill("#logic-breakpoint-value", "-1000000");
await page.click("#logic-arm-breakpoint");
await page.click("#logic-test-machine");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running === true,
);
for (let index = 0; index < 10; index++) {
  await page.evaluate(() => window.advanceTime(280));
  await page.waitForTimeout(35);
}
const paused = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ),
  watchedValue = await page
    .locator(`[data-watch="${boundSensor}"] em`)
    .innerText(),
  beforeStep = paused.simulationTime;
await page.click("#logic-step");
const stepped = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.screenshot({ path: "artifacts/visual-logic-debugger.png" });

await page.setViewportSize({ width: 1024, height: 720 });
await page.waitForTimeout(180);
const compact = await page.locator(".logic-workbench").evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
});
await page.screenshot({ path: "artifacts/visual-logic-compact.png" });

await page.setViewportSize({ width: 1440, height: 950 });
await page.click('[data-script-language="typescript"]');
const codeMode = {
  textareaVisible: await page.locator("#wasm-source").isVisible(),
  help: await page.locator("#script-help").innerText(),
};

console.log(
  JSON.stringify(
    {
      initial,
      editedNodes,
      paused: {
        simulationPaused: paused.simulationPaused,
        debug: paused.script.debug,
        commands: paused.script.commands,
        watchedValue,
      },
      stepDelta: stepped.simulationTime - beforeStep,
      compact,
      codeMode,
      errors,
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  assert.equal(initial.nodes, 0, "new visual program was not empty");
  assert.equal(initial.bindings, 27, "mission binding manifest was incomplete");
  assert.equal(
    initial.validBindings,
    initial.bindings,
    "a built-in binding did not have a valid authored route",
  );
  assert.equal(
    initial.sensorCards,
    20,
    "bound physical inputs were incomplete",
  );
  assert.match(initial.heading, /Logic Controller #\d+/);
  assert.match(initial.inputs, /20 NAMED BINDINGS/);
  assert.match(initial.outputs, /engine\.gimbal/);
  assert.match(initial.outputs, /coupler\.release/);
  assert.equal(editedNodes, 3, "visual nodes did not persist");
  assert.equal(
    Number.isFinite(paused.script.debug.latest["sensor.target.range"]),
    true,
    "range sensor binding was absent from the controller trace",
  );
  assert.equal(
    paused.script.debug.latestProvenance.find(
      (entry) => entry.bindingId === "target.range",
    )?.hitBodyId,
    "environment:near-space-body:001",
    "range trace lost its registered environment-body provenance",
  );
  assert.equal(
    paused.simulationPaused,
    true,
    "bound-input breakpoint did not pause physics",
  );
  assert.equal(paused.script.language, "visual");
  assert.ok(paused.script.debug.sampleCount > 0, "controller trace is empty");
  assert.equal(paused.script.debug.triggered.name, boundSensor);
  assert.notEqual(watchedValue, "—", "bound physical input did not update");
  assert.ok(
    Object.hasOwn(paused.script.commands, "engine.throttle"),
    "visual output did not address its exact actuator binding",
  );
  assert.ok(
    Math.abs(stepped.simulationTime - beforeStep - 1 / 120) < 0.001,
    "debug step did not advance exactly one physics tick",
  );
  assert.ok(
    compact.left >= 0 &&
      compact.top >= 0 &&
      compact.right <= 1024 &&
      compact.bottom <= 720,
    "logic workbench escaped compact viewport",
  );
  assert.equal(
    codeMode.textareaVisible,
    true,
    "TypeScript editor did not restore",
  );
  assert.match(codeMode.help, /deterministic fuel/);
  assertNoErrors(errors, "visual logic workbench");
});
