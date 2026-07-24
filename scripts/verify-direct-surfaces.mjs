import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
    viewport: { width: Number(process.env.WIDTH || 1280), height: 800 },
  }),
  click = (selector) => page.locator(selector).dispatchEvent("click");
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => !document.querySelector("#sandbox-start")?.disabled,
);
await click("#sandbox-start");
await click("#demos-btn");
await click('[data-demo="cart"]');
await page.waitForTimeout(300);
await page.evaluate(() => {
  const close = document.querySelector("#close-remote");
  if (close && close.getClientRects().length) close.click();
});
if (!(await page.locator("#collapse-controller").isVisible()))
  await click("#controller-launcher");

const initial = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
await click("#collapse-controller");
const collapsed = await page
  .locator(".drive-hud")
  .evaluate((element) => element.classList.contains("collapsed"));
await click("#collapse-controller");
await click("#controller-mode");
const genericMode = await page.locator(".direct-range").count();
await click("#controller-mode");
if (await page.locator("#close-controller").isVisible())
  await click("#close-controller");
const launcherVisible = await page.locator("#controller-launcher").isVisible();
await click("#controller-launcher");
await click("#design-direct-surface");
await page.locator("#controller-title").fill("Trail Rover");
await page.locator("#controller-title").dispatchEvent("input");
await page.locator("#controller-accent").evaluate((input) => {
  input.value = "#ffb84d";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await click("#edit-direct-surface");
const firstTarget = page.locator('.command-target[data-index="0"]'),
  originalTarget = await firstTarget.inputValue();
await firstTarget.selectOption("");
const firstControlCard = page.locator(
    '.remote-control[data-control-index="0"]',
  ),
  unboundStatus = await firstControlCard.getAttribute("data-binding-status"),
  unboundBinding = await firstControlCard.innerText(),
  unboundTextStatus = await page.evaluate(
    () =>
      JSON.parse(window.render_game_to_text()).directSurface.actions.forward
        .status,
  );
await firstTarget.selectOption(originalTarget);
await page.locator('.command-label[data-index="0"]').fill("Torque request");
await page.locator('.command-label[data-index="0"]').dispatchEvent("change");
const addedCommandIndex = await page.locator(".command-label").count();
await click("#add-command");
await page
  .locator(`.command-label[data-index="${addedCommandIndex}"]`)
  .fill("Horn");
await page
  .locator(`.command-label[data-index="${addedCommandIndex}"]`)
  .dispatchEvent("change");
const afterAdd = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
await click(`.delete-command[data-index="${addedCommandIndex}"]`);
await click("#toggle-direct-panel");
const afterUnpin = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
await click("#toggle-direct-panel");
await click("#close-remote");

const forwardControl = page.locator('[data-pilot-action="forward"]');
const nativeGestureGuard = await page.evaluate(() => {
  const control = document.querySelector('[data-pilot-action="forward"]'),
    label = control.querySelector("small"),
    remoteHeading = document.querySelector(".remote-head h2"),
    selection = new Event("selectstart", {
      bubbles: true,
      cancelable: true,
    }),
    context = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
    }),
    remoteSelection = new Event("selectstart", {
      bubbles: true,
      cancelable: true,
    });
  label.dispatchEvent(selection);
  control.dispatchEvent(context);
  remoteHeading.dispatchEvent(remoteSelection);
  return {
    userSelect: getComputedStyle(label).userSelect,
    selectionPrevented: selection.defaultPrevented,
    contextPrevented: context.defaultPrevented,
    remoteSelectionPrevented: remoteSelection.defaultPrevented,
  };
});
await forwardControl.dispatchEvent("pointerdown");
await page.waitForTimeout(800);
const sustainedPress = await page.evaluate(() => ({
  pressed: document
    .querySelector('[data-pilot-action="forward"]')
    .classList.contains("pressed"),
  selectedText: window.getSelection()?.toString() || "",
}));
if (!process.env.NO_LIGHTS) await click('[data-pilot-toggle="lights"]');
await click("#run-btn");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running,
);
await page.evaluate(
  (duration) => window.advanceTime(duration),
  process.env.NO_LIGHTS ? 250 : 2000,
);
await page.waitForTimeout(200);
const driven = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
await forwardControl.dispatchEvent("pointerup");
if (!process.env.NO_LIGHTS) await click('[data-pilot-toggle="lights"]');
const overlap = await page.evaluate(() => {
  const panel = document.querySelector(".drive-hud").getBoundingClientRect();
  const camera = document
    .querySelector(".camera-tools")
    .getBoundingClientRect();
  return !(
    panel.right <= camera.left ||
    panel.left >= camera.right ||
    panel.bottom <= camera.top ||
    panel.top >= camera.bottom
  );
});
if (!process.env.NOSCREEN)
  await page.screenshot({ path: "artifacts/direct-surface-rover.png" });

await click("#run-btn");
await click("#demos-btn");
await click('[data-demo="drone"]');
await page.waitForTimeout(250);
const droneBefore = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);
await click("#toggle-direct-panel");
await click("#close-remote");
const droneAfter = await page.evaluate(() =>
  JSON.parse(window.render_game_to_text()),
);

console.log(
  JSON.stringify(
    {
      initial: initial.directSurface,
      collapsed,
      genericMode,
      launcherVisible,
      afterAdd: afterAdd.directSurface,
      afterUnpin: afterUnpin.directSurface,
      nativeGestureGuard,
      sustainedPress,
      unboundBinding,
      unboundStatus,
      unboundTextStatus,
      driven: {
        directSurface: driven.directSurface,
        speed: driven.demo.mobility?.signedSpeed,
        lights: driven.demo.mobility?.lights,
        lighting: driven.demo.mobility?.lighting,
        componentActuators:
          driven.architecture?.session?.systems?.componentActuators,
      },
      overlap,
      droneBefore: droneBefore.directSurface,
      droneAfter: droneAfter.directSurface,
      errors,
    },
    null,
    2,
  ),
);
await conclude(browser, () => {
  assert.equal(
    collapsed,
    true,
    "controller did not collapse to its status bar",
  );
  assert.ok(genericMode > 0, "generic controller mode did not render controls");
  assert.equal(
    launcherVisible,
    true,
    "closed controller has no visible reopen launcher",
  );
  assert.equal(
    driven.directSurface.layout?.title,
    "Trail Rover",
    "custom controller title was not preserved",
  );
  assert.equal(
    driven.directSurface.layout?.accent,
    "#ffb84d",
    "custom controller accent was not preserved",
  );
  assert.equal(
    afterAdd.directSurface.controls.at(-1)?.label,
    "Horn",
    "custom control was not added",
  );
  assert.equal(
    afterUnpin.directSurface.visible,
    false,
    "direct panel did not unpin",
  );
  assert.deepEqual(nativeGestureGuard, {
    userSelect: "none",
    selectionPrevented: true,
    contextPrevented: true,
    remoteSelectionPrevented: true,
  });
  assert.equal(sustainedPress.pressed, true, "long press released the command");
  assert.match(
    unboundBinding,
    /UNBOUND — CHOOSE A TARGET/,
    "remote customization did not explain an unbound control",
  );
  assert.equal(
    unboundStatus,
    "unbound",
    "clearing a remote target did not persist an unbound binding",
  );
  assert.equal(
    unboundTextStatus,
    "unbound",
    "visible and text-state binding diagnostics diverged",
  );
  assert.equal(
    sustainedPress.selectedText,
    "",
    "long press selected controller or Field Remote text",
  );
  assert.ok(
    (driven.demo.mobility?.signedSpeed || 0) > 0.1,
    "forward direct throttle moved the rover backward or not at all",
  );
  assert.notEqual(
    driven.mission,
    "DRIVETRAIN INCOMPLETE",
    "wheel-owned motor was reported as an incomplete generic mechanism",
  );
  if (!process.env.NO_LIGHTS) {
    assert.equal(
      driven.demo.mobility?.lighting?.castShadows,
      true,
      "powered headlights are not casting physical shadows",
    );
    assert.equal(
      driven.demo.mobility?.lighting?.platformReceivesShadows,
      true,
      "terrain is not receiving headlight shadows",
    );
    assert.ok(
      driven.demo.mobility?.lighting?.lumens > 0,
      "headlight command produced no emitted light",
    );
  }
  assert.equal(overlap, false, "direct controls overlap camera controls");
  assert.equal(
    droneBefore.directSurface.visible,
    false,
    "drone panel unexpectedly started pinned",
  );
  assert.equal(
    droneAfter.directSurface.visible,
    true,
    "drone panel did not pin",
  );
  assertNoErrors(errors, "direct surfaces");
});
