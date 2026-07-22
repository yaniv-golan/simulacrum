import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1440, height: 900 },
});
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.click("#sandbox-start");
await page.click("#demos-btn");
await page.click('[data-demo="humanoid"]');
await page.locator('.direct-range[data-index="0"]').evaluate((input) => {
  input.value = "0.6";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.locator('.direct-range[data-index="1"]').evaluate((input) => {
  input.value = "0.55";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click('[data-mode="test"]');
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running,
);
const samples = await page.evaluate(() => {
  const observations = [];
  for (let sampleIndex = 1; sampleIndex <= 60; sampleIndex++) {
    window.advanceTime(250);
    observations.push({
      time: sampleIndex / 4,
      ...JSON.parse(window.render_humanoid_debug()),
    });
  }
  return observations;
});
const debug = JSON.parse(
    await page.evaluate(() => window.render_humanoid_debug()),
  ),
  state = JSON.parse(await page.evaluate(() => window.render_game_to_text()));
await page.screenshot({
  path: "artifacts/articulated-extraction/atlas-15s.png",
  fullPage: true,
});
console.log(
  JSON.stringify(
    {
      forwardDistance: debug.forwardDistance,
      fallen: debug.fallen,
      contacts: debug.contacts,
      mission: state.mission,
      oneFootSupport: samples
        .filter(
          ({ contacts }) =>
            Boolean(contacts?.left) !== Boolean(contacts?.right),
        )
        .map(
          ({
            time,
            forwardDistance,
            fallen,
            contacts,
            phase,
            airborneTime,
            balanceError,
            pelvis,
            feet,
          }) => ({
            time,
            forwardDistance,
            fallen,
            contacts,
            phase,
            airborneTime,
            balanceError,
            pelvis,
            feet,
          }),
        ),
      errors,
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  assert.equal(debug.fallen, false, "Atlas fell during the browser regression");
  assert.ok(
    debug.forwardDistance > 0.05 &&
      Math.max(...samples.map((sample) => sample.forwardDistance)) > 0.18,
    `Atlas did not advance in +Z; ended ${debug.forwardDistance} m forward`,
  );
  assert.ok(
    samples.some(
      ({ contacts }) => Boolean(contacts?.left) !== Boolean(contacts?.right),
    ),
    "Atlas never entered measured one-foot support",
  );
  assert.ok(
    state.architecture.session?.systems.articulated?.poses?.length >= 23,
    "immutable session telemetry lost the articulated pose read model",
  );
  assertNoErrors(errors, "articulated browser runtime");
});
