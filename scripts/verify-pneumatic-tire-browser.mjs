import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { prepareUiBaselineFixture } from "./lib/ui-baseline-fixtures.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1440, height: 900 },
});

try {
  const fixture = await prepareUiBaselineFixture(
      page,
      baseUrl,
      "f4-rover-operate",
    ),
    wheel = fixture.state.parts.find((part) => part.type === "wheel");
  assert.ok(wheel, "rover fixture has no ordinary Grip Wheel");
  await page
    .locator(`[data-outliner-part="${wheel.id}"]`)
    .evaluate((element) => element.click());
  await page.waitForFunction(
    () => document.querySelector("#tire-live-pressure")?.textContent,
  );
  const readout = await page.locator("#tire-live-pressure").innerText(),
    fields = page.locator("[data-mechanism-path]"),
    state = JSON.parse(await page.evaluate(() => window.render_game_to_text())),
    chamber = state.pneumatics.chambers.find(
      (candidate) => candidate.partId === wheel.id,
    );
  assert.match(readout, /TIRE PRESSURE · [0-9.]+ kPa GAUGE · [0-9.]+ K/);
  assert.match(readout, /GAS [0-9.]+ kg · DEFLECTION [0-9.]+ mm · RIM MARGIN/);
  assert.match(readout, /FLOW IN [0-9.]+ kg · OUT [0-9.]+ kg · TRANSACTION/);
  assert.ok(
    (await fields.count()) > 0,
    "wheel pneumatic law is not inspectable",
  );
  for (let index = 0; index < (await fields.count()); index++)
    assert.equal(
      await fields.nth(index).isDisabled(),
      true,
      "running mechanism field remained editable",
    );
  assert.ok(chamber.absolutePressurePa > chamber.ambientPressurePa);
  assert.ok(chamber.gasMassKg > 0);
  assert.ok(chamber.internalEnergyJ > 0);
  assert.equal(chamber.failureMode, null);
  assert.equal(
    Number(readout.match(/TIRE PRESSURE · ([0-9.]+) kPa/)?.[1]),
    Number((chamber.gaugePressurePa / 1000).toFixed(1)),
    "visible and text-state pressure diverged",
  );

  await page.locator("canvas").focus();
  await page.keyboard.press("Digit1");
  await page.waitForFunction(
    () => !JSON.parse(window.render_game_to_text()).running,
  );
  await page.locator(`[data-outliner-part="${wheel.id}"]`).click();
  const pressureField = page.locator(
    '[data-mechanism-path="tireConstitutiveLaw/pneumaticChamber/initialColdGaugePressurePa"]',
  );
  assert.equal(await pressureField.count(), 1);
  assert.equal(await pressureField.isDisabled(), false);
  assert.match(
    await page.locator(".pneumatic-authoring-summary").innerText(),
    /COLD ABSOLUTE PRESSURE[\s\S]*COLD GAS MASS[\s\S]*WORKING GAUGE RANGE/i,
  );
  assert.equal(
    await page.locator(".mechanism-editor details").getAttribute("open"),
    null,
    "advanced pneumatic law did not remain progressively disclosed",
  );
  await page.locator("#mechanism-display-units").selectOption("engineering");
  assert.equal(await pressureField.getAttribute("data-si-factor"), "0.001");
  await pressureField.fill("180");
  await pressureField.evaluate((input) =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
  const stoppedState = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  );
  assert.equal(
    stoppedState.parts.find((part) => part.id === wheel.id).settings.mechanism
      .config.tireConstitutiveLaw.pneumaticChamber.initialColdGaugePressurePa,
    180_000,
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.equal(
    await page.locator(".pneumatic-authoring-summary").isVisible(),
    true,
  );
  assert.equal(
    await page.locator("#tire-live-pressure").getAttribute("role"),
    "status",
  );
  assertNoErrors(errors, "pneumatic tire browser");
  console.log(
    `pneumatic tire browser passed (${Math.round(chamber.gaugePressurePa / 1000)} kPa gauge)`,
  );
} finally {
  await closeBrowser(browser, errors);
}
