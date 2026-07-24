import fs from "node:fs/promises";
import path from "node:path";
import {
  createBrowserTest,
  createInstrumentedPage,
} from "./lib/browser-test.mjs";
import { assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { installRenderedVisibilityContract } from "./lib/rendered-visibility.mjs";
import { startTestServer } from "./lib/test-server.mjs";
import {
  captureUiInventory,
  prepareUiBaselineFixture,
  UI_BASELINE_FIXTURES,
} from "./lib/ui-baseline-fixtures.mjs";

const root = path.resolve(import.meta.dirname, ".."),
  server = await startTestServer({
    root,
    artifactsDir: path.join(root, "artifacts", "ui-baseline-0.1.0"),
  });
process.env.TEST_BASE_URL = server.baseUrl;
process.env.TEST_BUILD_MARKER = server.marker;

const allViewports = [
    { width: 860, height: 720 },
    { width: 1728, height: 1000 },
    { width: 1280, height: 720 },
    { width: 1920, height: 1080 },
  ],
  requestedViewports =
    process.env.UI_VIEWPORT_FILTER?.split(",").filter(Boolean),
  viewports = allViewports.filter(
    ({ width, height }) =>
      !requestedViewports?.length ||
      requestedViewports.includes(`${width}x${height}`),
  ),
  output = path.resolve("artifacts/ui-baseline-0.1.0"),
  previousManifest = await fs
    .readFile(path.join(output, "manifest.json"), "utf8")
    .then((value) => JSON.parse(value))
    .catch(() => null),
  { browser, baseUrl } = await createBrowserTest({ page: false }),
  manifest = {
    capturedAt: new Date().toISOString(),
    browserVersion: browser.version(),
    storage: "current browser-storage-v1 roots reset through BrowserStorage",
    fixtures: previousManifest?.fixtures || {},
  };
await fs.mkdir(output, { recursive: true });
try {
  const requested = process.env.UI_FIXTURE_FILTER?.split(",").filter(Boolean),
    fixtureIds = Object.keys(UI_BASELINE_FIXTURES).filter(
      (id) => !requested?.length || requested.includes(id),
    );
  for (const id of fixtureIds) {
    manifest.fixtures[id] ||= {};
    for (const viewport of viewports) {
      const { page, errors } = await createInstrumentedPage(browser, {
        viewport,
      });
      await installRenderedVisibilityContract(page);
      const fixture = await prepareUiBaselineFixture(page, baseUrl, id),
        inventory = await captureUiInventory(page),
        key = `${viewport.width}x${viewport.height}`,
        directory = path.join(output, id);
      await fs.mkdir(directory, { recursive: true });
      await page.screenshot({
        path: path.join(directory, `${key}.png`),
        fullPage: false,
      });
      await fs.writeFile(
        path.join(directory, `${key}.state.json`),
        JSON.stringify(fixture.state, null, 2),
      );
      await fs.writeFile(
        path.join(directory, `${key}.inventory.json`),
        JSON.stringify(inventory, null, 2),
      );
      assertNoErrors(errors, `${id} ${key}`);
      manifest.fixtures[id][key] = {
        definition: fixture.definition,
        welcome: fixture.welcome,
        presentation: fixture.state.presentation,
        inventoryCounts: inventory.counts,
      };
      await page.close();
    }
  }
  await fs.writeFile(
    path.join(output, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  console.log(`captured UI baseline at ${output}`);
} finally {
  await closeBrowser(browser);
  await server.stop();
}
