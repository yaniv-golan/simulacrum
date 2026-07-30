import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assert } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";

const outputDirectory = path.resolve(
    process.env.COMPONENT_CATALOG_CAPTURE_DIR ||
      "artifacts/component-visual-realism/catalog-turntable",
  ),
  { browser, page, errors, baseUrl } = await createBrowserTest({
    viewport: { width: 1440, height: 900 },
    launchOptions: {
      args: ["--use-gl=angle", "--use-angle=swiftshader"],
    },
  }),
  browserExecutable = browser.browserType().executablePath();

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
const browserIdentity = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    devicePixelRatio: devicePixelRatio,
    viewport: { width: innerWidth, height: innerHeight },
    fonts: {
      spaceGrotesk: document.fonts.check('16px "Space Grotesk"'),
      ibmPlexMono: document.fonts.check('16px "IBM Plex Mono"'),
    },
  })),
  identity = {
    evidenceContract: "component-visual-evidence-identity-v1",
    source: {
      gitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      gitStatusShort: execFileSync("git", ["status", "--short"], {
        encoding: "utf8",
      })
        .trim()
        .split("\n")
        .filter(Boolean),
    },
    host: {
      platform: process.platform,
      architecture: process.arch,
      osRelease: os.release(),
      cpu: os.cpus()[0]?.model || "unknown",
    },
    runtime: {
      node: process.version,
      npmUserAgent: process.env.npm_config_user_agent || null,
      playwright: (
        await import("playwright/package.json", { with: { type: "json" } })
      ).default.version,
      chromium: browser.version(),
      chromiumExecutable: browserExecutable,
    },
    browser: browserIdentity,
    captureMatrix: {
      catalogViewport: browserIdentity.viewport,
      demoViewports: [
        { width: 1440, height: 900 },
        { width: 1920, height: 1080 },
      ],
      lighting: ["day", "night"],
      detailQuality: "auto",
      deterministicSeed: null,
    },
    render: renderIdentity,
  };
await writeFile(
  path.join(outputDirectory, "capture-identity.json"),
  `${JSON.stringify(identity, null, 2)}\n`,
);

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
    await writeFile(
      path.join(outputDirectory, `${type}-${lighting}.json`),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    assert.equal(result.catalog.type, type);
    assert.equal(result.catalog.lighting, lighting);
    captureCount++;
    if (lighting === "night") console.log(`captured ${type}`);
  }

await page.evaluate(() => window.__componentCatalogTurntable.dispose());
await writeFile(
  path.join(outputDirectory, "browser-errors.json"),
  `${JSON.stringify(errors, null, 2)}\n`,
);
await browser.close();
assert.deepEqual(errors, [], `browser errors: ${errors.join("\n")}`);
console.log(`component catalog turntable passed (${captureCount} captures)`);
