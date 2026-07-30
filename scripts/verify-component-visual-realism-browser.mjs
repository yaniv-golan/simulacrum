import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assert } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";

const outputDirectory = path.resolve(
    process.env.COMPONENT_VISUAL_CAPTURE_DIR ||
      "artifacts/component-visual-realism",
  ),
  { browser, page, errors, baseUrl } = await createBrowserTest({
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=swiftshader"],
    },
  });

const click = (selector) => page.locator(selector).dispatchEvent("click"),
  state = () => page.evaluate(() => JSON.parse(window.render_game_to_text())),
  advance = (milliseconds) =>
    page.evaluate((duration) => window.advanceTime(duration), milliseconds),
  canvas = () => page.locator("#stage canvas"),
  capture = async (name) => {
    await page.waitForTimeout(120);
    await page.locator(".shell").evaluate((shell) => {
      shell.style.visibility = "hidden";
    });
    const pngDataUrl = await canvas().evaluate((element) =>
      element.toDataURL("image/png"),
    );
    await writeFile(
      path.join(outputDirectory, `${name}.png`),
      Buffer.from(pngDataUrl.split(",", 2)[1], "base64"),
    );
    await page.locator(".shell").evaluate((shell) => {
      shell.style.visibility = "";
    });
    const snapshot = await state();
    await writeFile(
      path.join(outputDirectory, `${name}.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
    return snapshot;
  };

await mkdir(outputDirectory, { recursive: true });
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await resetBrowserStorageForTest(page);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => !document.querySelector("#sandbox-start")?.disabled,
  null,
  { timeout: 60_000 },
);
await click("#sandbox-start");
await page.waitForFunction(
  () => typeof window.render_game_to_text === "function",
);

const layouts = [
    { id: "laptop", width: 1440, height: 900 },
    { id: "wide", width: 1920, height: 1080 },
  ],
  demos = [
    { id: "gearbox", targetType: "gear24", requiredKind: "spur-gear-v1" },
    { id: "cart", targetType: "spring", requiredKind: "helical-spring-v1" },
    { id: "drone", targetType: "rotor", requiredKind: "extruded-profile-v1" },
    { id: "humanoid", targetType: "hinge", requiredKind: "cylinder-v1" },
    { id: "mission", targetType: "rocket", requiredKind: "cone-v1" },
  ],
  setTimeOfDay = (hour) =>
    page.locator("#time-of-day").evaluate((control, value) => {
      control.value = String(value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    }, hour);
let captureCount = 0,
  cartPartCount = 0;

for (const layout of layouts) {
  await page.setViewportSize({ width: layout.width, height: layout.height });
  for (const demo of demos) {
    await setTimeOfDay(10);
    await click("#demos-btn");
    await click(`[data-demo="${demo.id}"]`);
    await page.waitForFunction(
      (type) =>
        JSON.parse(window.render_game_to_text()).parts.some(
          (part) => part.type === type,
        ),
      demo.targetType,
    );
    if (
      !(await page
        .locator(".inspector-content")
        .evaluate((element) => element.classList.contains("hidden")))
    )
      await page.locator("#close-inspect").dispatchEvent("click");
    await click("#view-front");
    await click("#focus-view");
    await advance(250);
    const overview = await capture(`${demo.id}-${layout.id}-day-overview`);
    captureCount++;
    assert.ok(overview.parts.some(({ type }) => type === demo.targetType));
    const visualGeometry = await page.evaluate(
        () => window.simulacrum_performance().visualGeometry,
      ),
      textPart = overview.parts.find(({ type }) => type === demo.targetType),
      renderedPart = visualGeometry.find(({ id }) => id === textPart.id);
    assert.equal(renderedPart?.type, textPart.type);
    assert.ok(
      renderedPart?.bodyPrimitiveKinds.includes(demo.requiredKind),
      `${demo.id} rendered ${demo.targetType} without ${demo.requiredKind}`,
    );
    assert.ok(
      renderedPart.bodyPrimitiveIds.every(
        (id) => id !== "collision" && !id.startsWith("collision:"),
      ),
      `${demo.id} rendered a collision fallback as canonical body geometry`,
    );
    if (demo.id === "cart") {
      cartPartCount = overview.parts.length;
      assert.ok(
        overview.parts.filter(({ type }) => type === "spring").length >= 4,
        "cart text state omitted its four physical springs",
      );
    }

    const targetId = textPart.id;
    await page
      .locator(`[data-outliner-part="${targetId}"]`)
      .dispatchEvent("click");
    await page.locator("#isolate-selection").dispatchEvent("click");
    await page.locator("#frame-selection").dispatchEvent("click");
    await page.waitForTimeout(150);
    const detail = await capture(
      demo.id === "cart" && layout.id === "laptop"
        ? "spring-laptop-day-detail"
        : `${demo.id}-${layout.id}-day-${demo.targetType}-detail`,
    );
    captureCount++;
    assert.deepEqual(detail.presentation.selectionVisibility.isolatedPartIds, [
      targetId,
    ]);
    const detailedVisual = (
      await page.evaluate(() => window.simulacrum_performance().visualGeometry)
    ).find(({ id }) => id === targetId);
    const selectedDetail = detail.presentation.componentDetail.selected.find(
      ({ id }) => id === targetId,
    );
    assert.equal(detailedVisual.detailTier, selectedDetail?.tier);
    assert.ok(detailedVisual.bodyPrimitiveKinds.includes(demo.requiredKind));
    await page.locator("#show-all-components").dispatchEvent("click");
    await page.locator("#close-inspect").dispatchEvent("click");
    await click("#view-front");
    await click("#focus-view");

    await setTimeOfDay(20);
    await click("#run-btn");
    await page.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).running === true,
    );
    await advance(250);
    const running = await capture(`${demo.id}-${layout.id}-night-running`);
    captureCount++;
    assert.equal(running.running, true);
    await click("#run-btn");
    await page.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).running === false,
    );
  }
}

await writeFile(
  path.join(outputDirectory, "browser-errors.json"),
  `${JSON.stringify(errors, null, 2)}\n`,
);
await browser.close();
assert.deepEqual(errors, [], `browser errors: ${errors.join("\n")}`);

console.log(
  `component visual browser passed (${captureCount} paired captures, ${cartPartCount} cart parts, captures in ${outputDirectory})`,
);
