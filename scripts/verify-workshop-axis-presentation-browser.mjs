import fs from "node:fs";
import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
    viewport: { width: 1440, height: 900 },
  }),
  textState = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text()));
fs.mkdirSync("artifacts/workshop-axis-presentation", { recursive: true });

async function assertAxisClearOfCatalog(label) {
  const catalog = await page.locator(".catalog").boundingBox(),
    indicator = await page.locator(".workshop-axis-indicator").boundingBox();
  assert.ok(catalog && indicator, `${label} axis/catalog bounds unavailable`);
  assert.ok(
    indicator.x >= catalog.x + catalog.width + 8,
    `${label} Workshop indicator overlaps the expanded catalog`,
  );
}

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await resetBrowserStorageForTest(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.click("#sandbox-start");
  await page.locator(".welcome").waitFor({ state: "hidden" });

  let state = await textState();
  assert.equal(
    state.coordinateSystem,
    "meters, Y up, 0.25m move snap, 15deg rotation snap",
  );
  assert.deepEqual(state.coordinateFrames.workshopAuthored, {
    axes: "x-east-y-up-z-north",
    origin: "workshop-board-center",
    rebased: false,
    units: "m",
    fields: [
      "parts[].position",
      "transformGizmo.startPivot",
      "transformGizmo.pivot",
    ],
  });
  await page
    .getByRole("button", { name: /Front view, primarily the XY/ })
    .waitFor();
  await page
    .getByRole("button", { name: /Side view, primarily the ZY/ })
    .waitFor();
  await page
    .getByRole("button", { name: /Top view, primarily the XZ/ })
    .waitFor();
  await page.getByRole("img", { name: /Workshop axes: X east/ }).waitFor();
  assert.equal(
    await page.getByLabel("Workshop X position, east positive, metres").count(),
    1,
  );
  assert.match(
    await page.locator(".coordinate-context").textContent(),
    /WORKSHOP POSITION · PIVOT · m/,
  );

  const catalog = page.locator(".catalog");
  if (
    await catalog.evaluate((element) =>
      element.classList.contains("panel-collapsed"),
    )
  )
    await page.click(
      '.catalog .panel-collapse[aria-label="Expand component library"]',
    );
  await assertAxisClearOfCatalog("laptop");
  await page.screenshot({
    path: "artifacts/workshop-axis-presentation/laptop.png",
    fullPage: true,
  });
  await page.click("#move-tool");
  await page.waitForTimeout(100);
  await page.screenshot({
    path: "artifacts/workshop-axis-presentation/gizmo.png",
    fullPage: true,
  });
  await page.click("#select-tool");

  await page.click("#view-front");
  await page.waitForTimeout(100);
  assert.equal((await textState()).camera.axisViewId, "front");
  await page.click("#zoom-in");
  assert.equal((await textState()).camera.axisViewId, "front");
  await page.click("#focus-view");
  assert.equal((await textState()).camera.axisViewId, "front");
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("ArrowLeft");
  assert.equal((await textState()).camera.axisViewId, null);
  await page.click("#view-top");
  assert.equal((await textState()).camera.axisViewId, "top");

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(100);
  await assertAxisClearOfCatalog("wide-monitor");
  await page.screenshot({
    path: "artifacts/workshop-axis-presentation/wide.png",
    fullPage: true,
  });
  state = await textState();
  assert.equal(state.camera.axisViewId, "top");
  assertNoErrors(errors, "Workshop axis presentation");
  console.log("Workshop axis browser presentation verification passed");
} finally {
  await closeBrowser(browser);
}
