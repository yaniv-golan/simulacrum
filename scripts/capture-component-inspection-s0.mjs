import fs from "node:fs/promises";
import path from "node:path";
import {
  createBrowserTest,
  createInstrumentedPage,
} from "./lib/browser-test.mjs";
import { prepareUiBaselineFixture } from "./lib/ui-baseline-fixtures.mjs";
import { startTestServer } from "./lib/test-server.mjs";

const root = path.resolve(import.meta.dirname, ".."),
  definition = JSON.parse(
    await fs.readFile(
      path.join(
        root,
        "scripts/baselines/component-inspection-s0-existing-ui.json",
      ),
      "utf8",
    ),
  ),
  outputDirectory = path.join(root, "artifacts/component-inspection-s0"),
  captures = [];

await fs.mkdir(outputDirectory, { recursive: true });
const server = await startTestServer({
  root,
  artifactsDir: outputDirectory,
});
process.env.TEST_BASE_URL = server.baseUrl;
process.env.TEST_BUILD_MARKER = server.marker;
const { browser, baseUrl } = await createBrowserTest({ page: false });
try {
  for (const viewport of definition.viewports) {
    const { page, errors } = await createInstrumentedPage(browser, {
      viewport,
    });
    const fixture = await prepareUiBaselineFixture(
      page,
      baseUrl,
      definition.fixture,
    );
    const screenshot = path.join(outputDirectory, `${viewport.id}.png`);
    await page.screenshot({ path: screenshot, fullPage: true });
    captures.push({
      viewport,
      screenshot: path.relative(root, screenshot),
      errors,
      dom: await page.evaluate(() => ({
        nodeCount: document.querySelectorAll("*").length,
        inspectorNodeCount: document.querySelectorAll(".inspector *").length,
        inspectorFocusableCount: document.querySelectorAll(
          ".inspector button, .inspector input, .inspector select, .inspector [tabindex]",
        ).length,
        title: document.querySelector("#inspect-name")?.textContent || null,
        status: document.querySelector(".status")?.textContent || null,
        activeElement: document.activeElement?.id || null,
      })),
      textState: fixture.state,
    });
    await page.close();
  }
} finally {
  await browser.close();
  await server.stop();
}

const artifact = {
  schemaVersion: 1,
  classification: definition.classification,
  capturedAt: new Date().toISOString(),
  fixture: definition.fixture,
  keyboardRoute: definition.keyboardRoute,
  tasks: definition.tasks,
  captures,
};
await fs.writeFile(
  path.join(outputDirectory, "current.json"),
  `${JSON.stringify(artifact, null, 2)}\n`,
);
console.log(`captured ${captures.length} S0 existing-UI viewports`);
