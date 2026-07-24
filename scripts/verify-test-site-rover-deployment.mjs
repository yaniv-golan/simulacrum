import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest(),
  click = (selector) => page.locator(selector).dispatchEvent("click"),
  state = () => page.evaluate(() => JSON.parse(window.render_game_to_text()));

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => !document.querySelector("#sandbox-start")?.disabled,
);
await click("#sandbox-start");
await click("#demos-btn");
await click('[data-demo="cart"]');
await click("#test-reserve-btn");
await click('[data-test-pad="surface-lanes"]');
await click("#close-test-reserve");
await click("#run-btn");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running === true,
);
await page.evaluate(() => window.advanceTime(500));
const settled = await state(),
  mobility = settled.architecture.session.systems.mobility.assemblies[0];

console.log(
  JSON.stringify(
    {
      failure: settled.failureAnalysis.report,
      structures: settled.architecture.session.systems.structures,
      wheels: mobility.wheelStates.map((wheel) => ({
        partId: wheel.partId,
        touching: wheel.touching,
        manifoldPointCount: wheel.manifoldPointCount,
        normalLoadN: wheel.normalLoadN,
        supportMaterialKeys: wheel.supportMaterialKeys,
      })),
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  assertNoErrors(errors, "test-site rover deployment");
  assert.equal(settled.failureAnalysis.report.eventCount, 0);
  assert.ok(mobility.wheelStates.every(({ touching }) => touching));
  assert.ok(
    mobility.wheelStates.every(
      ({ supportMaterialKeys }) =>
        supportMaterialKeys.length === 1 &&
        supportMaterialKeys[0] === "dry-asphalt",
    ),
  );
});
