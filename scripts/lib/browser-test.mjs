import { chromium } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import { assertTestServer } from "./test-server.mjs";

const trackedBrowsers = new Set();

export function seedCurrentTestStorage() {
  const pointerKey = "simulacrum.v1.storage.commit";
  if (localStorage.getItem(pointerKey) !== null) return;
  const manifestId = "11111111111111111111111111111111",
    generationId = "22222222222222222222222222222222",
    generationKey = `simulacrum.v1.storage.generation.${generationId}.discovery`,
    manifestKey = `simulacrum.v1.storage.manifest.${manifestId}`;
  localStorage.setItem(generationKey, '{"complete":false,"tipsEnabled":false}');
  localStorage.setItem(
    manifestKey,
    JSON.stringify({
      protocolVersion: 1,
      manifestId,
      generationId,
      previousManifestId: null,
      createdAt: "2026-07-17T00:00:00.000Z",
      roots: {
        workspace: null,
        subassemblyLibrary: null,
        sharePackages: null,
        shareSocial: null,
        shareOrigins: null,
        challengeRecords: null,
        challengeBest: null,
        discovery: {
          key: generationKey,
          bytes: 38,
          sha256:
            "166d27dde65783e1813d80f3fb5a68c834b629fad5ea84749848c6a6d7fafe76",
        },
        environmentPreferences: null,
        executableTrust: null,
      },
    }),
  );
  localStorage.setItem(
    pointerKey,
    JSON.stringify({ protocolVersion: 1, manifestId }),
  );
}

function recordPageFailures(page, errors) {
  page.on("pageerror", (error) =>
    errors.push(`pageerror: ${error.stack || String(error)}`),
  );
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    errors.push(
      `requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText || "unknown"})`,
    );
  });
  page.on("dialog", async (dialog) => {
    errors.push(`dialog: ${dialog.type()} ${dialog.message()}`);
    await dialog.dismiss().catch(() => {});
  });
}

export function assertNoBrowserErrors(errors) {
  if (errors.length)
    throw new Error(`browser verification failed:\n${errors.join("\n")}`);
}

export async function createInstrumentedPage(
  browser,
  { viewport = { width: 1280, height: 800 }, errors = [] } = {},
) {
  const page = await browser.newPage({ viewport });
  recordPageFailures(page, errors);
  return { page, errors };
}

export async function createBrowserTest({
  viewport = { width: 1280, height: 800 },
  defaultTimeoutMs = 30_000,
  page: createPage = true,
  launchOptions = {},
} = {}) {
  const baseUrl = process.env.TEST_BASE_URL;
  const marker = process.env.TEST_BUILD_MARKER;
  await assertTestServer(baseUrl, marker);
  const browser = await chromium.launch({ headless: true, ...launchOptions });
  trackedBrowsers.add(browser);
  browser.once("disconnected", () => trackedBrowsers.delete(browser));
  if (!createPage) return { browser, baseUrl, marker };
  const errors = [];
  const result = await createInstrumentedPage(browser, { viewport, errors });
  await result.page.addInitScript(seedCurrentTestStorage);
  result.page.setDefaultTimeout(defaultTimeoutMs);
  const suiteName = process.env.TEST_SUITE_NAME || "browser-verification";
  const tracePath = path.resolve(
    "artifacts",
    "test-harness",
    `${suiteName}.trace.zip`,
  );
  await result.page.context().tracing.start({
    screenshots: false,
    snapshots: false,
    sources: true,
  });
  const nativeClose = browser.close.bind(browser);
  let closed = false;
  browser.close = async () => {
    if (closed) return;
    closed = true;
    await fs.mkdir(path.dirname(tracePath), { recursive: true });
    await result.page
      .context()
      .tracing.stop({ path: tracePath })
      .catch(() => {});
    await nativeClose();
    assertNoBrowserErrors(errors);
  };
  return { browser, baseUrl, marker, ...result };
}

export async function closeTrackedBrowsers() {
  await Promise.allSettled(
    [...trackedBrowsers].map((browser) => browser.close()),
  );
  trackedBrowsers.clear();
}
