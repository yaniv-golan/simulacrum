import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { startTestServer } from "./lib/test-server.mjs";

const captures = [
    ["reference-overview", "reference-overview", { usePresetSolarTime: true }],
    ["surface-ground", "surface-ground", { usePresetSolarTime: true }],
    ["terrain-ground", "terrain-ground", { usePresetSolarTime: true }],
    ["water-ground", "water-ground", { usePresetSolarTime: true }],
    ["airfield-chase", "airfield-chase", { usePresetSolarTime: true }],
    ["reference-overview-noon", "reference-overview", { solarTime: 12 }],
    ["reference-overview-low-sun", "reference-overview", { solarTime: 6.5 }],
    ["reference-overview-night", "reference-overview", { solarTime: 0 }],
    ["surface-ground-noon", "surface-ground", { solarTime: 12 }],
  ],
  outputDirectory = "artifacts/environment-art",
  root = path.resolve(import.meta.dirname, ".."),
  server = await startTestServer({ root });
await mkdir(outputDirectory, { recursive: true });
process.env.TEST_BASE_URL = server.baseUrl;
process.env.TEST_BUILD_MARKER = server.marker;
process.env.TEST_SUITE_NAME = "capture-testing-playground-art";

try {
  const { browser, page, errors, baseUrl } = await createBrowserTest({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !document.querySelector("#sandbox-start")?.disabled,
  );
  await page.locator("#sandbox-start").dispatchEvent("click");
  await page.waitForFunction(
    () =>
      typeof window.render_game_to_text === "function" &&
      typeof window.simulacrum_environment_capture === "function",
  );
  const canvas = page.locator("#stage canvas");

  for (const [fileId, presetId, options] of captures) {
    const rendered = await canvas.evaluate(
        (element, id) => {
          const capture = window.simulacrum_environment_capture(id),
            png = element
              .toDataURL("image/png")
              .replace(/^data:image\/png;base64,/u, "");
          return { capture, png };
        },
        { id: presetId, ...options },
      ),
      state = await page.evaluate(() =>
        JSON.parse(window.render_game_to_text()),
      ),
      performance = await page.evaluate(() => window.simulacrum_performance());
    await writeFile(
      `${outputDirectory}/${fileId}.png`,
      Buffer.from(rendered.png, "base64"),
    );
    await writeFile(
      `${outputDirectory}/${fileId}.json`,
      `${JSON.stringify(
        {
          viewport: { width: 1440, height: 900 },
          capture: rendered.capture,
          camera: state.camera,
          renderer: performance.renderer,
        },
        null,
        2,
      )}\n`,
    );
  }

  await conclude(browser, () =>
    assertNoErrors(errors, "testing playground art capture"),
  );
  console.log(`captured ${captures.length} exact environment-art views`);
} finally {
  await server.stop();
}
