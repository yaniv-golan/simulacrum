import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1280, height: 800 },
});

async function tabTo(selector, maximum = 120, key = "Tab") {
  const visited = [];
  for (let index = 0; index < maximum; index += 1) {
    const match = await page.evaluate(
      (candidate) => document.activeElement?.matches(candidate) || false,
      selector,
    );
    if (match) return;
    visited.push(
      await page.evaluate(() => {
        const element = document.activeElement;
        return `${element?.tagName || "none"}#${element?.id || ""}.${typeof element?.className === "string" ? element.className : ""}[${element?.tabIndex ?? ""}]`;
      }),
    );
    await page.keyboard.press(key);
  }
  throw new Error(
    `Tab did not reach ${selector}; cycle=${JSON.stringify(visited.slice(-30))}`,
  );
}

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await resetBrowserStorageForTest(page);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => !document.querySelector("#sandbox-start")?.disabled,
);
assert.equal(
  await page.evaluate(() => document.activeElement?.id),
  "guided-start",
  "fresh first launch did not enter the welcome focus contract",
);
await page.keyboard.press("Tab");
assert.equal(
  await page.evaluate(() => document.activeElement?.id),
  "sandbox-start",
  "Tab did not reach Open Sandbox from the welcome entry",
);
await page.keyboard.press("Enter");
await tabTo("canvas");
await page.keyboard.press("Shift+Delete");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).parts.length === 0,
);
await tabTo(".search input");
await page.keyboard.type("Powered Motor");
await tabTo('.part-card[data-type="motor"]');
await page.keyboard.press("Enter");
assert.equal(
  await page.evaluate(() => document.activeElement?.id),
  "placement-x",
  "catalog activation did not enter exact placement",
);
await page.keyboard.press("ControlOrMeta+A");
await page.keyboard.type("1");
await page.keyboard.press("Tab");
await page.keyboard.press("Tab");
await page.keyboard.press("ControlOrMeta+A");
await page.keyboard.type("2");
await page.keyboard.press("Tab");
await page.keyboard.press("Enter");
await page.waitForFunction(() => {
  const state = JSON.parse(window.render_game_to_text());
  return (
    state.parts.length === 1 &&
    state.parts[0].position[0] === 1 &&
    state.parts[0].position[2] === 2
  );
});
await tabTo('[data-prop="rpm"]');
await page.keyboard.press("ControlOrMeta+A");
await page.keyboard.type("120");
await page.keyboard.press("Tab");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).parts[0].settings.rpm === 120,
);
assert.equal(
  await page.locator('[role="treeitem"][tabindex="0"]').count(),
  1,
  "the selected assembly tree lost its one Tab entry",
);
await tabTo('[role="treeitem"][tabindex="0"]', 40, "Shift+Tab");
await tabTo("canvas", 40, "Shift+Tab");
await page.keyboard.press("KeyC");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).parts.length === 2,
);
const duplicateId = await page.evaluate(
  () => JSON.parse(window.render_game_to_text()).selectedPart,
);
await tabTo(".selection-arrange summary");
await page.keyboard.press("Enter");
await tabTo('[data-pivot-axis="0"]');
await page.keyboard.press("ControlOrMeta+A");
await page.keyboard.type("1.5");
await page.keyboard.press("Tab");
await page.waitForFunction(
  (id) =>
    JSON.parse(window.render_game_to_text()).parts.find(
      (part) => part.id === id,
    ).position[0] === 1.5,
  duplicateId,
);
await tabTo("[data-selection-yaw]");
await page.keyboard.press("ControlOrMeta+A");
await page.keyboard.type("15");
await page.keyboard.press("Tab");
await page.waitForFunction(
  (id) =>
    JSON.parse(window.render_game_to_text()).parts.find(
      (part) => part.id === id,
    ).displayYawDeg === 15,
  duplicateId,
);
await tabTo(`[data-outliner-part="${duplicateId}"]`, 40, "Shift+Tab");
await page.keyboard.press("ControlOrMeta+Z");
await page.waitForTimeout(100);
const undoState = await page.evaluate((id) => {
  const state = JSON.parse(window.render_game_to_text());
  return {
    yaw: state.parts.find((part) => part.id === id)?.displayYawDeg,
    keyboard: state.presentation.keyboard,
    focus: state.presentation.focus,
  };
}, duplicateId);
assert.equal(
  undoState.yaw,
  0,
  `keyboard undo did not restore yaw: ${JSON.stringify(undoState)}`,
);
await tabTo(`[data-outliner-part="${duplicateId}"]`);
await tabTo("canvas", 40, "Shift+Tab");
await page.keyboard.press("KeyX");
await page.waitForFunction(
  (id) =>
    !JSON.parse(window.render_game_to_text()).parts.some(
      (part) => part.id === id,
    ),
  duplicateId,
);
const result = await page.evaluate(() => {
  const state = JSON.parse(window.render_game_to_text());
  return {
    parts: state.parts.length,
    motorRpm: state.parts[0].settings.rpm,
    position: state.parts[0].position,
  };
});
console.log(JSON.stringify({ result, errors }, null, 2));
await conclude(browser, () => {
  assert.equal(result.parts, 1);
  assert.equal(result.motorRpm, 120);
  assert.equal(result.position[0], 1);
  assert.equal(result.position[2], 2);
  assertNoErrors(errors, "keyboard-only authoring journey");
});
