import fs from "node:fs/promises";
import path from "node:path";
import { assert } from "./lib/assert.mjs";
import {
  assertNoBrowserErrors,
  closeTrackedBrowsers,
  createBrowserTest,
  createInstrumentedPage,
  seedCurrentTestStorage,
} from "./lib/browser-test.mjs";
import { startTestServer } from "./lib/test-server.mjs";

const root = path.resolve(import.meta.dirname, "..");
const originalLocalStorage = globalThis.localStorage,
  seededValues = new Map();
globalThis.localStorage = {
  getItem: (key) => seededValues.get(key) ?? null,
  setItem: (key, value) => seededValues.set(key, String(value)),
};
seedCurrentTestStorage();
assert.equal(seededValues.size, 3);
assert.equal(
  JSON.parse(seededValues.get("simulacrum.v1.storage.commit")).protocolVersion,
  1,
);
seedCurrentTestStorage();
assert.equal(seededValues.size, 3, "current test storage was seeded twice");
if (originalLocalStorage === undefined) delete globalThis.localStorage;
else globalThis.localStorage = originalLocalStorage;

let ownedServer = null;
if (!process.env.TEST_BASE_URL || !process.env.TEST_BUILD_MARKER) {
  ownedServer = await startTestServer({ root });
  process.env.TEST_BASE_URL = ownedServer.baseUrl;
  process.env.TEST_BUILD_MARKER = ownedServer.marker;
  process.env.TEST_SUITE_NAME = "verify-browser-errors";
}

assertNoBrowserErrors([]);
assert.throws(
  () => assertNoBrowserErrors(["injected"]),
  /browser verification failed/,
);
await createBrowserTest({ page: false });
await closeTrackedBrowsers();
const { browser: defaultsBrowser } = await createBrowserTest({ page: false });
const defaultPage = await createInstrumentedPage(defaultsBrowser);
assert.deepEqual(defaultPage.errors, []);
await defaultPage.page.close();
await defaultsBrowser.close();

const {
    browser: watcherBrowser,
    page: watcherPage,
    baseUrl,
  } = await createBrowserTest(),
  artifactProbe = path.join(
    root,
    "artifacts",
    "test-harness",
    "vite-watch-ignore-probe.txt",
  );
try {
  await watcherPage.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await watcherPage.evaluate(() => {
    window.__viteWatchSentinel = crypto.randomUUID();
  });
  const sentinel = await watcherPage.evaluate(() => window.__viteWatchSentinel);
  await fs.mkdir(path.dirname(artifactProbe), { recursive: true });
  await fs.writeFile(artifactProbe, String(Date.now()));
  await watcherPage.waitForTimeout(500);
  assert.equal(
    await watcherPage.evaluate(() => window.__viteWatchSentinel),
    sentinel,
    "writing a test artifact reloaded the application page",
  );
} finally {
  await fs.rm(artifactProbe, { force: true });
  await watcherBrowser.close();
}

const cases = [
  {
    label: "console",
    expected: /console: injected console failure/,
    inject: (page) =>
      page.evaluate(() => console.error("injected console failure")),
  },
  {
    label: "pageerror",
    expected: /pageerror: Error: injected page failure/,
    inject: async (page) => {
      const pageError = page.waitForEvent("pageerror");
      await page.evaluate(() =>
        setTimeout(() => {
          throw new Error("injected page failure");
        }),
      );
      await pageError;
    },
  },
  {
    label: "requestfailed",
    expected: /requestfailed: GET .*injected-request/,
    inject: async (page) => {
      await page.route("**/injected-request", (route) => route.abort("failed"));
      await page.evaluate(() => fetch("/injected-request").catch(() => {}));
    },
  },
  {
    label: "dialog",
    expected: /dialog: alert injected dialog/,
    inject: (page) => page.evaluate(() => alert("injected dialog")),
  },
];

const configuredSuiteName = process.env.TEST_SUITE_NAME;
delete process.env.TEST_SUITE_NAME;
for (const [index, testCase] of cases.entries()) {
  const { browser, page, baseUrl } = await createBrowserTest();
  if (index === 0 && configuredSuiteName)
    process.env.TEST_SUITE_NAME = configuredSuiteName;
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await testCase.inject(page);
  await assert.rejects(
    browser.close(),
    testCase.expected,
    `${testCase.label} did not fail fixture cleanup`,
  );
  await browser.close();
}

console.log(
  "browser fixture rejected console, page, request, and dialog errors without artifact reloads",
);
if (ownedServer) await ownedServer.stop();
