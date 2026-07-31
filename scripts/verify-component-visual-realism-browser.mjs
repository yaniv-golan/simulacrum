import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assert } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";
import { assertCanonicalVisualProductState } from "./lib/component-visual-product-assertions.mjs";
import {
  captureComponentVisualEvidenceIdentity,
  writeComponentVisualEvidenceManifest,
} from "./lib/component-visual-evidence.mjs";

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

const artifacts = new Set(),
  click = (selector) => page.locator(selector).dispatchEvent("click"),
  advance = (milliseconds) =>
    page.evaluate((duration) => window.advanceTime(duration), milliseconds),
  canvas = () => page.locator("#stage canvas"),
  capture = async (name) => {
    const { pngDataUrl, hasVisiblePixel, snapshot, visualGeometry } =
      await canvas().evaluate((element) => {
        // WebGL's drawing buffer is not preserved. Render and read back in the
        // same browser task so a later compositor clear cannot yield a blank
        // but otherwise valid PNG.
        window.advanceTime(0);
        const context =
            element.getContext("webgl2") || element.getContext("webgl"),
          pixels = new Uint8Array(element.width * element.height * 4);
        context.readPixels(
          0,
          0,
          element.width,
          element.height,
          context.RGBA,
          context.UNSIGNED_BYTE,
          pixels,
        );
        return {
          pngDataUrl: element.toDataURL("image/png"),
          hasVisiblePixel: pixels.some((channel, index) =>
            index % 4 === 3 ? channel !== 0 : false,
          ),
          snapshot: JSON.parse(window.render_game_to_text()),
          visualGeometry: window.simulacrum_performance().visualGeometry,
        };
      });
    assert.ok(hasVisiblePixel, `${name} captured a fully transparent canvas`);
    await writeFile(
      path.join(outputDirectory, `${name}.png`),
      Buffer.from(pngDataUrl.split(",", 2)[1], "base64"),
    );
    artifacts.add(`${name}.png`);
    await writeFile(
      path.join(outputDirectory, `${name}.json`),
      `${JSON.stringify(snapshot, null, 2)}\n`,
    );
    artifacts.add(`${name}.json`);
    return { snapshot, visualGeometry };
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
const evidence = await captureComponentVisualEvidenceIdentity({
  browser,
  page,
  evidenceClass: "browser-product-demo-visual-oracle",
  captureMatrix: {
    layouts,
    demos: demos.map(({ id }) => id),
    lighting: ["day", "night"],
    views: ["overview", "mechanism-detail", "running"],
    detailQuality: "auto",
  },
});
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
    const { snapshot: overview, visualGeometry } = await capture(
      `${demo.id}-${layout.id}-day-overview`,
    );
    await assertCanonicalVisualProductState(
      page,
      `${demo.id} ${layout.id} daylight overview`,
    );
    captureCount++;
    assert.ok(overview.parts.some(({ type }) => type === demo.targetType));
    const textPart = overview.parts.find(
        ({ type }) => type === demo.targetType,
      ),
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
    await page.waitForFunction(
      () => {
        const camera = JSON.parse(window.render_game_to_text()).camera;
        return (
          Math.abs(camera.renderedDistance - camera.distance) <= 0.05 &&
          camera.trackingError <= 0.05
        );
      },
      null,
      { timeout: 10_000 },
    );
    const { snapshot: detail, visualGeometry: detailedGeometry } =
      await capture(
        demo.id === "cart" && layout.id === "laptop"
          ? "spring-laptop-day-detail"
          : `${demo.id}-${layout.id}-day-${demo.targetType}-detail`,
      );
    await assertCanonicalVisualProductState(
      page,
      `${demo.id} ${layout.id} isolated detail`,
    );
    captureCount++;
    assert.deepEqual(detail.presentation.selectionVisibility.isolatedPartIds, [
      targetId,
    ]);
    assert.ok(
      Math.abs(detail.camera.renderedDistance - detail.camera.distance) <= 0.05,
      `${demo.id} ${layout.id} detail camera did not settle to its framed distance`,
    );
    assert.ok(
      detail.camera.trackingError <= 0.05,
      `${demo.id} ${layout.id} detail camera did not settle on the selected part`,
    );
    const detailedVisual = detailedGeometry.find(({ id }) => id === targetId);
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
    const { snapshot: running } = await capture(
      `${demo.id}-${layout.id}-night-running`,
    );
    await assertCanonicalVisualProductState(
      page,
      `${demo.id} ${layout.id} night run`,
    );
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
artifacts.add("browser-errors.json");
await writeComponentVisualEvidenceManifest({
  outputDirectory,
  evidence,
  artifacts,
});
await browser.close();
assert.deepEqual(errors, [], `browser errors: ${errors.join("\n")}`);

console.log(
  `component visual browser passed (${captureCount} paired captures, ${cartPartCount} cart parts, captures in ${outputDirectory})`,
);
