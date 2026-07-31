import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assert } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";
import {
  captureComponentVisualEvidenceIdentity,
  writeComponentVisualEvidenceManifest,
} from "./lib/component-visual-evidence.mjs";

const outputDirectory = path.resolve(
    process.env.COMPONENT_CATALOG_CAPTURE_DIR ||
      "artifacts/component-visual-realism/catalog-turntable",
  ),
  { browser, page, errors, baseUrl } = await createBrowserTest({
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=swiftshader"],
    },
  });

await mkdir(outputDirectory, { recursive: true });
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await resetBrowserStorageForTest(page);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => !document.querySelector("#sandbox-start")?.disabled,
  null,
  { timeout: 60_000 },
);
await page.locator("#sandbox-start").dispatchEvent("click");
await page.waitForFunction(
  () => typeof window.render_game_to_text === "function",
);
const { types, identity: renderIdentity } = await page.evaluate(async () => {
  const module =
    await import("/scripts/fixtures/component-catalog-turntable.js");
  window.__componentCatalogTurntable =
    module.installComponentCatalogTurntable();
  return {
    types: module.catalogTypes,
    identity: window.__componentCatalogTurntable.identity(),
  };
});
assert.equal(types.length, 42, "catalog turntable omitted component types");
await page.evaluate(() => document.fonts.ready);
const evidence = await captureComponentVisualEvidenceIdentity({
    browser,
    page,
    evidenceClass: "browser-product-catalog-turntable",
    captureMatrix: {
      viewport: { width: 512, height: 512 },
      lighting: ["day", "night"],
      detailTier: "standard",
      cameraDistanceM: 6,
    },
    renderIdentity,
  }),
  artifacts = new Set();

let captureCount = 0;
for (const type of types)
  for (const lighting of ["day", "night"]) {
    const { pngDataUrl, result } = await page.evaluate(
      ({ componentType, preset }) => {
        const catalog = window.__componentCatalogTurntable.render(
          componentType,
          preset,
        );
        return {
          pngDataUrl: document
            .querySelector("#component-catalog-turntable")
            .toDataURL("image/png"),
          result: {
            catalog,
            workshopTextState: JSON.parse(window.render_game_to_text()),
          },
        };
      },
      { componentType: type, preset: lighting },
    );
    await writeFile(
      path.join(outputDirectory, `${type}-${lighting}.png`),
      Buffer.from(pngDataUrl.split(",", 2)[1], "base64"),
    );
    artifacts.add(`${type}-${lighting}.png`);
    await writeFile(
      path.join(outputDirectory, `${type}-${lighting}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    artifacts.add(`${type}-${lighting}.json`);
    assert.equal(result.catalog.type, type);
    assert.equal(result.catalog.lighting, lighting);
    assert.equal(result.catalog.detailTier, "standard");
    assert.equal(result.catalog.cameraDistanceM, 6);
    captureCount++;
    if (lighting === "night") console.log(`captured ${type}`);
  }

for (const lighting of ["day", "night"]) {
  const { pngDataUrl, result } = await page.evaluate((preset) => {
    const result =
      window.__componentCatalogTurntable.renderGearEngagement(preset);
    return {
      pngDataUrl: document
        .querySelector("#component-catalog-turntable")
        .toDataURL("image/png"),
      result,
    };
  }, lighting);
  const stem = `gear-pair-engagement-${lighting}`;
  await writeFile(
    path.join(outputDirectory, `${stem}.png`),
    Buffer.from(pngDataUrl.split(",", 2)[1], "base64"),
  );
  await writeFile(
    path.join(outputDirectory, `${stem}.json`),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  artifacts.add(`${stem}.png`);
  artifacts.add(`${stem}.json`);
  assert.equal(result.pinion.toothCount, 12);
  assert.equal(result.wheel.toothCount, 24);
  assert.equal(result.pinion.moduleM, result.wheel.moduleM);
  assert.equal(
    result.centerDistanceM,
    result.pinion.pitchRadiusM + result.wheel.pitchRadiusM,
  );
  assert.equal(result.pinion.toothPhaseRad, 0);
  assert.equal(result.wheel.toothPhaseRad, Math.PI / 24);
  captureCount++;
}

await page.evaluate(() => window.__componentCatalogTurntable.dispose());
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
  `component catalog turntable passed (${captureCount} captures including canonical gear engagement)`,
);
