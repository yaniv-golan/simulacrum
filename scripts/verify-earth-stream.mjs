import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1024, height: 720 },
});
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForSelector("#sandbox-start");
await page.click("#sandbox-start");
await page.waitForTimeout(1000);
for (const selector of [
  "#close-remote",
  "#close-environment",
  "#close-coach",
]) {
  const element = page.locator(selector);
  if ((await element.count()) && (await element.isVisible()))
    await element.click();
}
await page.waitForTimeout(400);
const readState = () =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const walkCamera = (key, code, count) =>
  page.evaluate(
    ({ key, code, count }) => {
      for (let index = 0; index < count; index++)
        window.dispatchEvent(
          new KeyboardEvent("keydown", { key, code, shiftKey: true }),
        );
    },
    { key, code, count },
  );
const tileSignature = (state, key = "0,0") =>
  state.environment.earth.activeTileSignatures.find((tile) => tile.key === key)
    ?.signature || null;

await page.waitForFunction(
  () =>
    JSON.parse(window.render_game_to_text()).environment.earth.activeChunks ===
    49,
);
const initial = await readState();
console.error("initial");
await walkCamera("w", "KeyW", 300);
await page.waitForTimeout(1200);
const nearby = await readState();
console.error("nearby");
await walkCamera("w", "KeyW", 1300);
await page.waitForTimeout(1500);
const far = await readState();
console.error("far");
await page.screenshot({ path: "artifacts/earth-generated-terrain.png" });
await walkCamera("s", "KeyS", 1600);
await page.waitForFunction(
  () =>
    JSON.parse(window.render_game_to_text()).environment.earth.activeChunks ===
    49,
  undefined,
  { timeout: 10_000 },
);
const returned = await readState();
console.error("returned");

console.log(
  JSON.stringify(
    {
      initial: {
        coordinate: initial.environment.earth.currentCoordinate,
        offset: initial.environment.earth.globalOffsetM,
        signature: tileSignature(initial),
        active: initial.environment.earth.activeChunks,
      },
      nearby: {
        coordinate: nearby.environment.earth.currentCoordinate,
        offset: nearby.environment.earth.globalOffsetM,
        biome: nearby.environment.earth.currentBiome,
        elevation: nearby.environment.earth.currentElevationM,
      },
      far: {
        coordinate: far.environment.earth.currentCoordinate,
        offset: far.environment.earth.globalOffsetM,
        elevation: far.environment.earth.currentElevationM,
        biome: far.environment.earth.currentBiome,
        originLoaded: Boolean(tileSignature(far)),
        active: far.environment.earth.activeChunks,
      },
      returned: {
        coordinate: returned.environment.earth.currentCoordinate,
        offset: returned.environment.earth.globalOffsetM,
        signature: tileSignature(returned),
        active: returned.environment.earth.activeChunks,
      },
      signatureMatch: tileSignature(initial) === tileSignature(returned),
    },
    null,
    2,
  ),
);
await conclude(browser, () => {
  assertNoErrors(errors, "earth stream");
  assert.equal(
    tileSignature(initial),
    tileSignature(returned),
    "origin tile changed after revisit",
  );
  assert.equal(
    initial.environment.earth.activeChunks,
    49,
    "unexpected initial chunk count",
  );
  assert.equal(
    returned.environment.earth.activeChunks,
    49,
    "stream did not return to bounded size",
  );
});
