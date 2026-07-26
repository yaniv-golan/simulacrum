import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest();
const state = () =>
  page.evaluate(() => JSON.parse(window.render_game_to_text()));
const waitForDrive = (forward) =>
  page.waitForFunction(
    (expected) =>
      JSON.parse(window.render_game_to_text()).demo.mobility.driveKeys
        .forward === expected,
    forward,
  );

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => !document.querySelector("#sandbox-start")?.disabled,
);
await page.click("#sandbox-start");
await page.click("#demos-btn");
await page.click('[data-demo="cart"]');
await page.waitForTimeout(250);
await page.click("#close-remote");

await page.click("#run-btn");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running,
);
assert.equal(
  await page.evaluate(() => document.activeElement?.id),
  "run-btn",
  "starting with the pointer did not leave the initiating control focused",
);
assert.equal((await state()).presentation.keyboard.inputContext, "operation");
assert.equal((await state()).presentation.focusOwner.context, "widget");

await page.keyboard.down("KeyW");
await waitForDrive(true);
assert.equal(
  await page.evaluate(() => document.activeElement?.id),
  "run-btn",
  "machine input moved DOM focus away from the initiating control",
);
await page.keyboard.up("KeyW");
await waitForDrive(false);
await page.waitForTimeout(50);

await page.click("#remote-btn");
await page.click("#edit-remote");
await page.locator(".command-label").first().focus();
assert.equal((await state()).presentation.keyboard.inputContext, "text-entry");
await page.keyboard.press("KeyW");
await page.waitForTimeout(50);
assert.equal(
  (await state()).demo.mobility.driveKeys.forward,
  false,
  "text entry leaked W into machine operation",
);

await page.click("#tools-btn");
assert.equal(
  (await state()).presentation.keyboard.inputContext,
  "blocking-surface",
);
await page.keyboard.press("KeyW");
await page.waitForTimeout(50);
assert.equal(
  (await state()).demo.mobility.driveKeys.forward,
  false,
  "an open menu leaked W into machine operation",
);
await page.click("#blueprint-btn");
await page.waitForFunction(
  () => document.querySelector("#blueprint-modal")?.ariaBusy === "false",
);
assert.equal(
  (await state()).presentation.keyboard.inputContext,
  "blocking-surface",
);
await page.keyboard.press("KeyW");
await page.waitForTimeout(50);
assert.equal(
  (await state()).demo.mobility.driveKeys.forward,
  false,
  "a modal dialog leaked W into machine operation",
);

console.log(
  "operation input context passed (focused Start, text entry, menu, modal)",
);
await conclude(browser, () => assertNoErrors(errors));
