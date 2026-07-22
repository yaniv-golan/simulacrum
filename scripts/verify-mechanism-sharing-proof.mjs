import { decodeExperimentOrThrow } from "../src/model/mechanism-artifacts.js";
import { CHECKPOINT_STATE_OWNER_IDS } from "../src/model/mechanism-artifacts.js";
import { stableStringify } from "../src/model/primitives.js";
import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import {
  readBrowserStorageRoot,
  resetBrowserStorageForTest,
} from "./lib/browser-storage-fixture.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1440, height: 900 },
});
await page.addInitScript(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (value) => {
        window.__copiedMechanismExperiment = value;
      },
    },
  });
});

const textState = async () =>
  JSON.parse(await page.evaluate(() => window.render_game_to_text()));

async function activate(selector) {
  await page.locator(selector).evaluate((element) => element.click());
}

async function placeCurrentPending(position = [0, 1, 0]) {
  for (const [axis, value] of ["x", "y", "z"].map((axis, index) => [
    axis,
    position[index],
  ]))
    await page.fill(`#placement-${axis}`, String(value));
  await page.click("#place-pending");
}

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await resetBrowserStorageForTest(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.click("#sandbox-start");
  await page.click("#clear-build");

  await page.click('.part-card[data-type="builtin-subassembly-0"]');
  await placeCurrentPending([0.75, 1.2, -0.25]);
  const authoredBeforeSave = await textState();
  assert.equal(authoredBeforeSave.selectedParts.length, 9);
  await page.click("#library-add");
  await page.fill("#custom-name", "Suspension proof module");
  const exposedRows = page.locator("#creator-exposed-port-list > li");
  const availableExposedCount = await exposedRows.count();
  assert.ok(availableExposedCount > 2);
  await exposedRows.nth(1).locator('[data-creator-port-move="-1"]').click();
  await page
    .locator('[data-creator-port-label="0"]')
    .fill("Primary chassis attachment");
  await page.locator('[data-creator-port-role="0"]').selectOption("mount");
  await page
    .locator(`[data-creator-port-enabled="${availableExposedCount - 1}"]`)
    .uncheck();
  await page.click("#create-component");

  const library = await readBrowserStorageRoot(page, "subassemblyLibrary", []);
  assert.equal(
    library.length,
    1,
    "saved mechanism was not committed atomically",
  );
  const record = library[0];
  assert.equal(record.format, "simulacrum-local-subassembly-record");
  assert.equal(record.asset.format, "simulacrum-subassembly");
  assert.equal(record.asset.version, 1);
  assert.equal(record.asset.parts.length, 9);
  assert.equal(record.asset.connections.length, 10);
  assert.equal(record.asset.exposedPorts.length, availableExposedCount - 1);
  assert.equal(
    record.asset.exposedPorts[0].label,
    "Primary chassis attachment",
  );
  assert.equal(record.asset.exposedPorts[0].role, "mount");
  assert.ok(
    record.asset.parts.some((part) => part.type === "spring" && part.mechanism),
    "strict mechanism configuration was lost while saving a reusable assembly",
  );
  for (const obsolete of [
    "preset",
    "runtimePresetId",
    "springRate",
    "wheelHitbox",
    "alternate",
  ])
    assert.equal(
      obsolete in record.asset,
      false,
      `saved asset retained obsolete field ${obsolete}`,
    );

  await page.click("#clear-build");
  await page.click('.part-card[data-type="subassembly-0"]');
  await placeCurrentPending([-1.5, 1.1, 0.5]);
  const restoredAssembly = await textState();
  assert.equal(restoredAssembly.parts.length, record.asset.parts.length);
  assert.equal(
    restoredAssembly.connections.length,
    record.asset.connections.length,
  );
  assert.deepEqual(
    restoredAssembly.lastPlacement.exposedPorts.map(
      ({ partId, port, role }) => ({ partId, port, role }),
    ),
    record.asset.exposedPorts.map(({ partId, port, role }) => ({
      partId: restoredAssembly.lastPlacement.idMap[partId],
      port,
      role,
    })),
    "instantiation did not expose authored endpoints through the stable ID map",
  );
  const expectedMechanisms = record.asset.parts
      .filter((part) => part.mechanism)
      .map((part) => [part.type, part.mechanism])
      .sort(([left], [right]) => left.localeCompare(right)),
    actualMechanisms = restoredAssembly.parts
      .filter((part) => part.settings.mechanism)
      .map((part) => [part.type, part.settings.mechanism.config])
      .sort(([left], [right]) => left.localeCompare(right));
  assert.equal(
    actualMechanisms.length,
    expectedMechanisms.length,
    "reusable assembly did not restore every strict mechanism component",
  );
  assert.deepEqual(
    actualMechanisms.map(([type, mechanism]) => [
      type,
      mechanism.config || mechanism,
    ]),
    expectedMechanisms.map(([type, mechanism]) => [type, mechanism.config]),
    "reusable assembly changed authoritative physical-law data",
  );

  await page.click("#tools-btn");
  await page.click("#mechanism-lab-tool");
  await activate('[data-lab-command="run"]');
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running,
  );
  await activate('[data-lab-command="pause"]');
  for (let index = 0; index < 4; index++)
    await activate('[data-lab-command="step"]');

  await activate("#mechanism-pin-run");
  await activate('[data-lab-command="step"]');
  await activate("#mechanism-compare-run");
  const comparison = await page.locator("#mechanism-comparison").textContent();
  assert.match(comparison, /RUN A.*RUN B/s);
  assert.match(
    comparison,
    /PARAMETER BYTE DELTA\s*0/s,
    "an unchanged design produced a false parameter delta",
  );

  await activate("#mechanism-capture-proof");
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).mechanismLab?.experiment
        ?.manifestDigest,
  );
  let proofState = await textState();
  const captured = proofState.mechanismLab.experiment;
  assert.equal(captured.format, "simulacrum-experiment");
  assert.equal(captured.version, 1);
  assert.equal(captured.startTick, 0);
  assert.ok(captured.endTick >= 5);
  assert.match(captured.manifestDigest, /^[0-9a-f]{64}$/);
  assert.match(captured.checkpointStateDigest, /^[0-9a-f]{64}$/);

  for (let index = 0; index < 3; index++)
    await activate('[data-lab-command="step"]');
  const advancedDigest = (await textState()).mechanismLab.session
    .deterministicDigest;
  await activate("#mechanism-restore-proof");
  proofState = await textState();
  assert.equal(
    proofState.mechanismLab.experiment.restoreResult,
    "exact state digest match",
    "production restore did not reproduce the captured committed state",
  );
  assert.notEqual(
    advancedDigest,
    proofState.mechanismLab.session.deterministicDigest,
    "test did not advance away from the checkpoint before restoring",
  );
  assert.match(
    await page.locator("#mechanism-proof").textContent(),
    /RESTORE PROOF\s*exact state digest match/s,
  );

  await activate("#mechanism-copy-proof");
  await page.waitForFunction(() => window.__copiedMechanismExperiment);
  const copied = JSON.parse(
      await page.evaluate(() => window.__copiedMechanismExperiment),
    ),
    decoded = decodeExperimentOrThrow(copied).wire;
  assert.equal(stableStringify(decoded), stableStringify(copied));
  assert.equal(decoded.runConfiguration.fixedStepS, 1 / 120);
  assert.equal(
    decoded.runConfiguration.determinismTier,
    "same-build-bit-exact",
  );
  assert.deepEqual(
    decoded.checkpoint.stateOwners.map(({ ownerId }) => ownerId),
    CHECKPOINT_STATE_OWNER_IDS,
    "portable proof omitted or reordered a production checkpoint owner",
  );
  assert.equal(decoded.inputTrace.inputs.length, 0);
  assert.equal(decoded.manifestDigest, captured.manifestDigest);

  await activate('[data-lab-command="run"]');
  await activate("#close-mechanism-lab");
  await page.click("#demos-btn");
  await page.click('[data-demo="cart"]');
  await page
    .locator('[data-mode="test"]')
    .evaluate((element) => element.click());
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running,
  );
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "w", code: "KeyW" }),
    ),
  );
  await page.evaluate(() => window.advanceTime(250));
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent("keyup", { key: "w", code: "KeyW" }),
    ),
  );
  await page.evaluate(() => window.advanceTime(100));
  await page.click("#tools-btn");
  await activate("#mechanism-lab-tool");
  await activate('[data-lab-command="pause"]');
  await page.evaluate(() => {
    window.__copiedMechanismExperiment = null;
  });
  await activate("#mechanism-capture-proof");
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).mechanismLab?.experiment
        ?.inputCount > 0,
  );
  await activate("#mechanism-copy-proof");
  await page.waitForFunction(() => window.__copiedMechanismExperiment);
  const drivenExperiment = decodeExperimentOrThrow(
      JSON.parse(await page.evaluate(() => window.__copiedMechanismExperiment)),
    ).wire,
    drivePress = drivenExperiment.inputTrace.inputs.find(
      (input) => input.value === 1,
    );
  assert.ok(
    drivePress,
    "production experiment omitted the operator drive transition",
  );
  assert.ok(
    drivenExperiment.inputTrace.inputs.some(
      (input) =>
        input.targetId === drivePress.targetId &&
        input.channelId === drivePress.channelId &&
        input.value === 0 &&
        input.tick > drivePress.tick,
    ),
    "production experiment omitted the matching operator drive release",
  );
  assert.ok(
    drivenExperiment.inputTrace.inputs.every(
      (input, index, inputs) =>
        index === 0 ||
        input.tick > inputs[index - 1].tick ||
        (input.tick === inputs[index - 1].tick &&
          input.sequence > inputs[index - 1].sequence),
    ),
    "production input trace is not canonically ordered",
  );

  assertNoErrors(errors, "mechanism sharing and proof");
  console.log(
    "mechanism sharing/proof passed (strict reusable round trip, A/B identity, portable experiment validation, external input trace, exact checkpoint restore)",
  );
} finally {
  await closeBrowser(browser);
}
