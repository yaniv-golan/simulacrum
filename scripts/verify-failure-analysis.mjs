import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import fs from "node:fs";
import { decodeFailureEvidenceOrThrow } from "../src/model/failure-evidence-artifacts.js";

const { browser, page, errors, baseUrl } = await createBrowserTest();
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.click("#sandbox-start");
await page.click("#demos-btn");
await page.click('[data-demo="mission"]');
await page.waitForTimeout(600);
await page.locator('.command-range[data-index="2"]').evaluate((input) => {
  input.value = "1";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click('.command-toggle[data-index="0"]');
await page.click("#run-btn");
await page.waitForTimeout(120);
await page.click("#sim-pause");
const beforeStep = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.click("#sim-step");
const afterStep = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.click("#sim-pause");
await page
  .locator('.command-hold[data-index="1"]')
  .dispatchEvent("pointerdown");
await page.locator('.command-hold[data-index="1"]').dispatchEvent("pointerup");
await page.evaluate(() => window.advanceTime(2500));
await page
  .locator('.command-hold[data-index="7"]')
  .dispatchEvent("pointerdown");
await page.locator('.command-hold[data-index="7"]').dispatchEvent("pointerup");
let postAbortElapsedMs = 0;
for (; postAbortElapsedMs < 60_000; postAbortElapsedMs += 2_000) {
  await page.evaluate(() => window.advanceTime(2_000));
  const sample = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  );
  if (sample.failureAnalysis.report.eventCount > 0) break;
}

const failed = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ),
  reportText = await page.locator(".failure-report-body").innerText(),
  evidenceText = await page.locator(".failure-evidence-body").innerText(),
  panelVisible = await page.locator(".failure-lab").isVisible();
let exportedEvidence = null;
if (failed.failureAnalysis.evidence?.trigger) {
  const downloadPromise = page.waitForEvent("download", { timeout: 30_000 });
  await page.click("#export-failure-evidence");
  const download = await downloadPromise.catch(async (error) => {
      const toast = await page
        .locator(".toast")
        .innerText()
        .catch(() => "");
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; export status: ${toast || "unavailable"}`,
      );
    }),
    downloadPath = await download.path();
  exportedEvidence = decodeFailureEvidenceOrThrow(
    JSON.parse(fs.readFileSync(downloadPath, "utf8")),
  ).wire;
}
await page.screenshot({ path: "artifacts/failure-postmortem.png" });
assert.equal(
  panelVisible,
  true,
  `failure did not open its post-mortem: ${JSON.stringify(failed.failureAnalysis)}`,
);
await page.click("#replay-failure");
const replayStarted = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.waitForTimeout(180);
const replayAdvanced = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.click("#replay-play");
const failureFrame = replayAdvanced.failureAnalysis.replay.failureCursor;
assert.ok(
  Number.isInteger(failureFrame) && failureFrame >= 0,
  "replay did not expose its exact recorded failure frame",
);
await page.locator("#replay-scrubber").evaluate((input, value) => {
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, failureFrame);
await page.waitForTimeout(60);
const replayEffect = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.screenshot({ path: "artifacts/failure-effects-replay.png" });
await page.locator("#replay-scrubber").evaluate((input) => {
  input.value = "0";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
const replayScrubbed = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.screenshot({ path: "artifacts/failure-replay.png" });
await page.click("#return-live");
const returnedLive = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.click("#close-failure-lab");
const remoteRestoredAfterClose = await page
  .locator(".remote-console")
  .isVisible();
await page.click("#failure-report");
await page.setViewportSize({ width: 1024, height: 720 });
await page.waitForTimeout(180);
const responsivePanel = await page.locator(".failure-lab").evaluate((panel) => {
  const rect = panel.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    width: rect.width,
    height: rect.height,
  };
});
await page.screenshot({ path: "artifacts/failure-postmortem-compact.png" });
await page.click("#run-btn");
const stoppedCleanly = {
  reportHidden: await page.locator(".failure-lab").isHidden(),
  remoteRestored: await page.locator(".remote-console").isVisible(),
};

console.log(
  JSON.stringify(
    {
      singleStep: {
        before: beforeStep.simulationTime,
        after: afterStep.simulationTime,
        delta: afterStep.simulationTime - beforeStep.simulationTime,
        paused: afterStep.simulationPaused,
      },
      postAbortElapsedMs,
      report: failed.failureAnalysis.report,
      evidence: failed.failureAnalysis.evidence,
      replay: failed.failureAnalysis.replay,
      effects: failed.failureAnalysis.effects,
      replayCursor: {
        started: replayStarted.failureAnalysis.replay.cursor,
        advanced: replayAdvanced.failureAnalysis.replay.cursor,
        scrubbed: replayScrubbed.failureAnalysis.replay.cursor,
      },
      replayEffect: replayEffect.failureAnalysis.effects,
      returnedLive: !returnedLive.failureAnalysis.replay.active,
      remoteRestoredAfterClose,
      stoppedCleanly,
      responsivePanel,
      errors,
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  assert.equal(
    afterStep.simulationPaused,
    true,
    "single-step did not stay paused",
  );
  assert.ok(
    Math.abs(afterStep.simulationTime - beforeStep.simulationTime - 1 / 120) <
      0.001,
    "single-step did not advance exactly one fixed tick",
  );
  assert.equal(panelVisible, true, "failure did not open its post-mortem");
  assert.ok(
    failed.failureAnalysis.report.eventCount > 0,
    "physical failure produced no report event",
  );
  assert.ok(
    Number.isFinite(failed.failureAnalysis.report.primary.load.peakN) &&
      failed.failureAnalysis.report.primary.load.ratedN > 0,
    "post-mortem lost peak load or rating",
  );
  assert.ok(
    failed.failureAnalysis.report.primary.mode !== "thermal" ||
      failed.failureAnalysis.report.primary.environment.temperatureC > 0,
    "thermal post-mortem lost the initiating temperature",
  );
  assert.match(reportText, /PEAK LOAD/);
  assert.match(reportText, /RATED LOAD/);
  assert.match(reportText, /CAUSAL CHAIN/);
  assert.ok(
    failed.failureAnalysis.evidence?.trigger,
    "physical failure produced no exact fixed-step evidence trigger",
  );
  assert.match(evidenceText, /FIXED-STEP EVIDENCE/);
  assert.equal(
    exportedEvidence?.trigger.tick,
    failed.failureAnalysis.evidence?.trigger.tick,
    "downloaded evidence did not match the shared telemetry trigger",
  );
  assert.ok(
    failed.failureAnalysis.effects.triggeredEvents > 0,
    "failure emitted no physical presentation effect",
  );
  assert.ok(
    failed.failureAnalysis.replay.frameCount > 10,
    "instant replay did not retain a useful pre-failure window",
  );
  assert.equal(
    replayStarted.failureAnalysis.replay.active,
    true,
    "replay did not enter read-only playback",
  );
  assert.ok(
    replayAdvanced.failureAnalysis.replay.cursor >
      replayStarted.failureAnalysis.replay.cursor,
    "replay playback did not advance",
  );
  assert.ok(
    replayEffect.failureAnalysis.effects.activeEffects > 0,
    "replay did not reproduce the recorded failure effect",
  );
  assert.equal(
    replayScrubbed.failureAnalysis.replay.cursor,
    0,
    "replay scrubber did not select the requested frame",
  );
  assert.equal(
    returnedLive.failureAnalysis.replay.active,
    false,
    "return-to-live left replay active",
  );
  assert.equal(
    remoteRestoredAfterClose,
    true,
    "closing the report did not restore the previously visible remote",
  );
  assert.deepEqual(
    stoppedCleanly,
    { reportHidden: true, remoteRestored: true },
    "stopping from the report left analysis UI or the remote in the wrong state",
  );
  assert.ok(
    responsivePanel.left >= 0 &&
      responsivePanel.top >= 0 &&
      responsivePanel.right <= 1024 &&
      responsivePanel.bottom <= 720,
    "post-mortem panel escaped the compact viewport",
  );
  assertNoErrors(errors, "failure analysis and replay");
});
