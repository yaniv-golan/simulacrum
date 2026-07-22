import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1440, height: 900 },
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
await page.click("#close-wasm");
const remote = page.locator(".remote-console");
if (!(await remote.isVisible())) await page.click("#remote-btn");
await remote.waitFor({ state: "visible" });
await page.locator('.command-range[data-index="2"]').evaluate((input) => {
  input.value = "1";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click('.command-toggle[data-index="0"]');
await page.click('[data-mode="test"]');
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running,
);
await page
  .locator('.command-hold[data-index="1"]')
  .dispatchEvent("pointerdown");
await page.evaluate(() => window.advanceTime(80));
await page.locator('.command-hold[data-index="1"]').dispatchEvent("pointerup");
await page.waitForTimeout(220);
await page.evaluate(() => window.advanceTime(1200));
await page.waitForFunction(() => {
  const state = JSON.parse(window.render_game_to_text()),
    runtime = state.architecture.session.systems.controllers.runtimes.find(
      (candidate) => candidate.language === "typescript",
    );
  return runtime?.commands?.["engine.throttle"] > 0.5;
});
await page.evaluate(() => window.advanceTime(1300));
await page
  .locator('.command-hold[data-index="7"]')
  .dispatchEvent("pointerdown");
await page.evaluate(() => window.advanceTime(80));
await page.locator('.command-hold[data-index="7"]').dispatchEvent("pointerup");
await page.evaluate(() => window.advanceTime(160));
await page.waitForFunction(() => {
  const state = JSON.parse(window.render_game_to_text()),
    runtime = state.architecture.session.systems.controllers.runtimes.find(
      (candidate) => candidate.language === "typescript",
    );
  return runtime?.commands?.["engine.throttle"] === 0;
});
const preImpactState = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  ),
  preImpact = {
    failed: preImpactState.connections.filter((connection) => connection.failed)
      .length,
    detached: preImpactState.parts.filter((part) => part.aerothermal?.detached)
      .length,
  };
// The component runtime coasts ballistically after abort. Sample the complete
// return so the regression proves an actual external contact, rather than
// accepting an unrelated thermal failure as evidence of impact sensitivity.
const samples = [];
let elapsed = 0;
const sampleStepS = 2;
while (elapsed < 40) {
  await page.evaluate(
    (milliseconds) => window.advanceTime(milliseconds),
    sampleStepS * 1000,
  );
  elapsed = Number((elapsed + sampleStepS).toFixed(3));
  const sample = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  );
  samples.push({
    elapsed,
    altitude: sample.demo.missile?.altitude,
    verticalSpeed: sample.demo.missile?.verticalSpeed,
    impact: sample.demo.missile?.lastImpact,
    failed: sample.connections.filter((connection) => connection.failed).length,
    detached: sample.parts.filter((part) => part.aerothermal?.detached).length,
  });
  // Aerothermal or aerodynamic breakup may correctly occur before ground
  // contact. The failure lab auto-pauses for inspection; resume the same
  // physical trajectory so this regression still reaches and measures the
  // distinct external-impact event it exists to validate.
  if (sample.failureAnalysis?.open) await page.click("#close-failure-lab");
  if (sample.simulationPaused) await page.click("#sim-pause");
  const firstImpactIndex = samples.findIndex(
    (entry) =>
      entry.impact?.peakSpeedMps > 5 && entry.impact?.peakImpulseNs > 100,
  );
  if (firstImpactIndex >= 0) {
    const beforeImpact =
        firstImpactIndex === 0 ? preImpact : samples[firstImpactIndex - 1],
      current = samples.at(-1);
    if (
      current.failed > beforeImpact.failed &&
      current.detached > beforeImpact.detached
    )
      break;
  }
}
const state = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
console.log(
  JSON.stringify(
    {
      mission: state.mission,
      impact: state.demo.missile?.lastImpact,
      failed: state.connections.filter((connection) => connection.failed)
        .length,
      detached: state.parts.filter((part) => part.aerothermal?.detached).length,
      samples,
      errors,
    },
    null,
    2,
  ),
);
const failed = state.connections.filter(
  (connection) => connection.failed,
).length;
const detached = state.parts.filter(
  (part) => part.aerothermal?.detached,
).length;
await conclude(browser, () => {
  const impactIndex = samples.findIndex(
      (sample) =>
        sample.impact?.peakSpeedMps > 5 && sample.impact?.peakImpulseNs > 100,
    ),
    beforeImpact = impactIndex <= 0 ? preImpact : samples[impactIndex - 1],
    afterImpact = samples.slice(Math.max(0, impactIndex));
  assert.ok(
    impactIndex >= 0,
    "return trajectory never produced a measured hard external contact",
  );
  assert.ok(
    afterImpact.some((sample) => sample.failed > beforeImpact.failed),
    "measured impact did not fail any attachment",
  );
  assert.ok(
    afterImpact.some((sample) => sample.detached > beforeImpact.detached),
    "measured impact did not detach any component",
  );
  assert.ok(failed > 0 && detached > 0, "impact damage was not retained");
  assertNoErrors(errors, "hard impact");
});
