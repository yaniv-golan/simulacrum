import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { assertCanonicalVisualProductState } from "./lib/component-visual-product-assertions.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
    viewport: { width: 1280, height: 800 },
  }),
  click = (selector) => page.locator(selector).dispatchEvent("click"),
  active = () =>
    page.evaluate(() => ({
      id: document.activeElement?.id || null,
      role: document.activeElement?.getAttribute("role") || null,
      key: document.activeElement?.getAttribute("data-outliner-key") || null,
    }));

async function arrowTo(id, maximum = 20) {
  for (let index = 0; index < maximum; index += 1) {
    if ((await active()).id === id) return;
    await page.keyboard.press("ArrowDown");
  }
}

await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.waitForFunction(
  () => !document.querySelector("#sandbox-start")?.disabled,
);
await page.locator("#sandbox-start").focus();
await page.keyboard.press("Space");
await page.locator(".catalog").waitFor();

const editingBindings = await page.evaluate(() => {
  const state = JSON.parse(window.render_game_to_text()),
    bindings = state.presentation.keyboard.bindings;
  return {
    duplicate: bindings.find(({ id }) => id === "selection.duplicate"),
    remove: bindings.find(({ id }) => id === "selection.remove"),
    explode: bindings.find(({ id }) => id === "view.explode"),
    aria: {
      duplicate: document
        .querySelector("#duplicate-part")
        ?.getAttribute("aria-keyshortcuts"),
      remove: document
        .querySelector("#delete-part")
        ?.getAttribute("aria-keyshortcuts"),
      explode: document
        .querySelector("#explode-view")
        ?.getAttribute("aria-keyshortcuts"),
    },
  };
});
assert.deepEqual(editingBindings.duplicate.bindings, ["KeyC", "Primary+KeyD"]);
assert.deepEqual(editingBindings.remove.bindings, [
  "KeyX",
  "Delete",
  "Backspace",
]);
assert.deepEqual(editingBindings.explode.bindings, ["Shift+KeyX"]);
assert.match(editingBindings.aria.duplicate, /^C (Control|Meta)\+D$/);
assert.equal(editingBindings.aria.remove, "X Delete Backspace");
assert.equal(editingBindings.aria.explode, "Shift+X");

const expandLibraryForTextEntry = page.locator(
  '.panel-collapse[aria-label="Expand component library"]',
);
if (await expandLibraryForTextEntry.count())
  await expandLibraryForTextEntry.click();
await page.locator(".search input").focus();
assert.equal(
  await page.evaluate(
    () =>
      JSON.parse(window.render_game_to_text()).presentation.focusOwner.context,
  ),
  "text-entry",
  "part search did not own printable keyboard input",
);
await page.waitForTimeout(100);
const partCountBeforeTextEntry = await page.evaluate(
  () => JSON.parse(window.render_game_to_text()).parts.length,
);
await page.keyboard.press("KeyC");
await page.keyboard.press("KeyX");
await page.waitForTimeout(50);
assert.equal(
  await page.evaluate(
    () => JSON.parse(window.render_game_to_text()).parts.length,
  ),
  partCountBeforeTextEntry,
  "bare C duplicated while text entry owned the key",
);
assert.equal(await page.locator(".search input").inputValue(), "cx");
await page.locator(".search input").fill("");

await page.locator('[data-mode="build"]').focus();
await page.keyboard.press("ArrowRight");
assert.equal(
  await page.evaluate(() => document.activeElement?.dataset.mode),
  "wire",
  "mode toolbar ArrowRight did not move roving focus",
);
await page.keyboard.press("Space");
assert.equal(
  await page.locator('[data-mode="wire"]').getAttribute("aria-pressed"),
  "true",
  "Space did not activate the focused Connect button",
);
const connectProjection = await page.evaluate(
  () => JSON.parse(window.render_game_to_text()).presentation,
);
assert.equal(
  connectProjection.mode,
  "wire",
  "text state did not project Connect mode",
);
await page.locator('[data-mode="build"]').focus();
await page.keyboard.press("Enter");
assert.equal(
  await page.locator('[data-mode="build"]').getAttribute("aria-pressed"),
  "true",
  "Enter did not activate the focused Build button",
);

await page.locator("canvas").focus();
await page.keyboard.press("Digit2");
assert.equal(
  await page.locator('[data-mode="wire"]').getAttribute("aria-pressed"),
  "true",
  "Digit2 did not enter Connect from the canvas context",
);
assert.equal(
  await page.evaluate(
    () =>
      JSON.parse(window.render_game_to_text()).presentation.focusOwner.context,
  ),
  "canvas",
  "text state did not project the canvas keyboard context",
);

const selectedForFastEdit = await page.evaluate(() => {
  const state = JSON.parse(window.render_game_to_text());
  return state.selectedPart || state.parts[0].id;
});
const expandInspectorForFastEdit = page.locator(
  '.panel-collapse[aria-label="Expand inspector"]',
);
if (await expandInspectorForFastEdit.count())
  await expandInspectorForFastEdit.click();
await page.locator(`[data-outliner-part="${selectedForFastEdit}"]`).click();
await page.locator("canvas").focus();
await page.keyboard.press("Digit1");
const fastEditStartCount = await page.evaluate(
  () => JSON.parse(window.render_game_to_text()).parts.length,
);
await page.keyboard.press("KeyC");
await page.waitForFunction(
  (count) =>
    JSON.parse(window.render_game_to_text()).parts.length === count + 1,
  fastEditStartCount,
);
await page.evaluate(() =>
  window.dispatchEvent(
    new KeyboardEvent("keydown", {
      code: "KeyC",
      key: "c",
      bubbles: true,
      repeat: true,
    }),
  ),
);
assert.equal(
  await page.evaluate(
    () => JSON.parse(window.render_game_to_text()).parts.length,
  ),
  fastEditStartCount + 1,
  "a repeated KeyC event created another duplicate",
);
await page.keyboard.press("KeyX");
await page.waitForFunction(
  (count) => JSON.parse(window.render_game_to_text()).parts.length === count,
  fastEditStartCount,
);
await page.keyboard.press("Shift+KeyX");
assert.equal(
  await page.evaluate(
    () => JSON.parse(window.render_game_to_text()).explodedView.active,
  ),
  true,
  "Shift+X did not activate Exploded View",
);
await assertCanonicalVisualProductState(page, "exploded view");
await page.keyboard.press("Shift+KeyX");
assert.equal(
  await page.evaluate(
    () => JSON.parse(window.render_game_to_text()).explodedView.active,
  ),
  false,
  "Shift+X did not collapse Exploded View",
);
await assertCanonicalVisualProductState(page, "collapsed exploded view");

await page.locator("#tools-btn").focus();
await page.keyboard.press("ArrowDown");
assert.equal(
  await page.evaluate(
    () => JSON.parse(window.render_game_to_text()).presentation.surfaces.tools,
  ),
  true,
  "Tools DOM disclosure and text-state projection disagree",
);
assert.deepEqual(
  await active(),
  { id: "environment-btn", role: "menuitem", key: null },
  "ArrowDown did not open Tools and focus its first item",
);
await page.keyboard.press("End");
assert.equal(
  (await active()).id,
  "tutorial-btn",
  "End did not focus the last menu item",
);
await page.keyboard.press("Escape");
assert.equal(
  (await active()).id,
  "tools-btn",
  "Escape did not restore the Tools opener",
);
assert.equal(
  await page.locator(".tools-menu").isVisible(),
  false,
  "Escape did not close Tools",
);

await page.locator("#tools-btn").focus();
await page.keyboard.press("ArrowDown");
await arrowTo("keyboard-commands-btn");
assert.equal(
  (await active()).id,
  "keyboard-commands-btn",
  "Tools menu did not expose keyboard commands in its arrow-key order",
);
await page.keyboard.press("Enter");
await page.waitForFunction(
  () => document.activeElement?.id === "close-keyboard-commands",
);
assert.equal(
  await page.evaluate(
    () => JSON.parse(window.render_game_to_text()).presentation.activeModal,
  ),
  "keyboard-command-surface",
  "command surface was not projected as the active modal",
);
const commandSearch = page.locator("#keyboard-command-search");
await commandSearch.fill("Duplicate selection");
await page
  .locator(
    '[data-keyboard-action="selection.duplicate"][data-keyboard-slot="0"]',
  )
  .click();
await page.keyboard.press("Delete");
assert.match(
  await page.locator("#keyboard-command-status").innerText(),
  /binding cleared/i,
  "duplicate primary binding could not be cleared",
);
assert.match(
  await page.locator("#duplicate-part").getAttribute("aria-keyshortcuts"),
  /^(Control|Meta)\+D$/,
  "duplicate aria-keyshortcuts did not remove the cleared C binding",
);
await commandSearch.fill("Delete selection");
await page
  .locator('[data-keyboard-action="selection.remove"][data-keyboard-slot="0"]')
  .click();
await page.keyboard.press("Backspace");
assert.equal(
  await page.locator("#delete-part").getAttribute("aria-keyshortcuts"),
  "Delete Backspace",
  "delete aria-keyshortcuts did not remove the cleared X binding",
);
await page.locator("#reset-keyboard-commands").click();
assert.equal(
  await page.locator("#duplicate-part").getAttribute("aria-keyshortcuts"),
  editingBindings.aria.duplicate,
  "reset did not restore duplicate aria-keyshortcuts",
);
assert.equal(
  await page.locator("#delete-part").getAttribute("aria-keyshortcuts"),
  editingBindings.aria.remove,
  "reset did not restore delete aria-keyshortcuts",
);
await commandSearch.fill("Pause or resume");
await page.locator("#keyboard-command-context").selectOption("operation");
assert.equal(
  await page.locator("#keyboard-command-context").inputValue(),
  "operation",
  "native context selector did not reach Simulate by keyboard",
);
await page.locator("#keyboard-command-context").focus();
await page.keyboard.press("Tab");
await page.keyboard.press("Tab");
assert.equal(
  await page.evaluate(
    () => document.activeElement?.dataset.keyboardAction || null,
  ),
  "simulation.pause",
  "search and context filtering did not reach the generated Pause binding",
);
await page.keyboard.press("Enter");
await page.keyboard.press("KeyU");
assert.match(
  await page.locator("#keyboard-command-status").innerText(),
  /assigned for this session/i,
  "valid workshop remap was not accepted",
);
await page.keyboard.press("Enter");
await page.keyboard.press("Digit1");
assert.match(
  await page.locator("#keyboard-command-status").innerText(),
  /already assigned to Build mode/i,
  "cross-context conflict did not name the exact registered action",
);
await page.keyboard.press("Escape");
await page.locator("#reset-keyboard-commands").focus();
await page.keyboard.press("Enter");
assert.match(
  await page.locator("#keyboard-command-status").innerText(),
  /default bindings restored/i,
  "keyboard reset did not report its session-scoped result",
);
assert.deepEqual(
  await page.evaluate(() => {
    const bindings = JSON.parse(window.render_game_to_text()).presentation
      .keyboard.bindings;
    return bindings.find(({ id }) => id === "simulation.pause");
  }),
  { id: "simulation.pause", bindings: ["KeyK"], customized: false },
  "keyboard reset did not restore the registered default",
);
await page.keyboard.press("Escape");
assert.equal(
  (await active()).id,
  "tools-btn",
  "closing keyboard commands did not restore the Tools opener",
);

const expandLibrary = page.locator(
  '.panel-collapse[aria-label="Expand component library"]',
);
if (await expandLibrary.count()) {
  await expandLibrary.focus();
  await page.keyboard.press("Enter");
}
await page.locator('[data-cat="all"]').focus();
await page.keyboard.press("ArrowRight");
assert.deepEqual(
  {
    active: (await active()).id,
    category: await page
      .locator('[data-cat="structure"]')
      .getAttribute("aria-selected"),
  },
  { active: null, category: "true" },
  "Right Arrow did not focus and activate the next component tab",
);
assert.equal(
  await page.locator('.tabs [role="tab"][tabindex="0"]').count(),
  1,
  "the component tablist has more than one Tab entry",
);
const expandInspector = page.locator(
  '.panel-collapse[aria-label="Expand inspector"]',
);
if (await expandInspector.count()) {
  await expandInspector.focus();
  await page.keyboard.press("Enter");
}

const gearbox = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  ),
  motorId = gearbox.parts.find((part) => part.type === "motor").id,
  gearId = gearbox.parts.find((part) => part.type === "gear12").id,
  batteryId = gearbox.parts.find((part) => part.type === "battery").id,
  shaftConnection = gearbox.connections.find(
    (connection) =>
      connection.a === motorId &&
      connection.portA === "SHAFT" &&
      connection.b === gearId &&
      connection.portB === "AXLE",
  );
assert.ok(shaftConnection, "gearbox fixture lost its named shaft seat");
await page
  .locator(`[data-outliner-connection="${shaftConnection.id}"]`)
  .focus();
await page.keyboard.press("Enter");
await page.keyboard.press("Delete");
await page.waitForFunction(
  (connectionId) =>
    !JSON.parse(window.render_game_to_text()).connections.some(
      (connection) => connection.id === connectionId,
    ),
  shaftConnection.id,
);
await page
  .locator(`[data-outliner-port-part="${motorId}"][data-outliner-port="SHAFT"]`)
  .focus();
await page.keyboard.press("Enter");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).mode === "wire",
);
await page
  .locator(
    `[data-outliner-port-part="${batteryId}"][data-outliner-port="POWER"]`,
  )
  .focus();
await page.keyboard.press("Enter");
assert.equal(
  await page.evaluate(() => JSON.parse(window.render_game_to_text()).mode),
  "wire",
  "invalid exact target silently ended the connection route",
);
assert.match(
  await page.locator(".toast").innerText(),
  /port|power|compatible|connection/i,
  "invalid exact target did not expose a route diagnosis",
);
await page.keyboard.press("Escape");
assert.equal(
  await page.evaluate(() => JSON.parse(window.render_game_to_text()).mode),
  "build",
  "Escape from the outliner did not cancel an armed route",
);
if (await expandInspector.count()) {
  await expandInspector.focus();
  await page.keyboard.press("Enter");
}
await page.locator("canvas").focus();
await page.keyboard.press("Digit2");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).mode === "wire",
);
await page
  .locator(`[data-outliner-port-part="${motorId}"][data-outliner-port="SHAFT"]`)
  .press("Enter");
await page.waitForTimeout(100);
await page
  .locator(`[data-outliner-port-part="${gearId}"][data-outliner-port="AXLE"]`)
  .press("Enter");
await page.waitForTimeout(200);
const completedRoute = await page.evaluate(() => ({
  state: JSON.parse(window.render_game_to_text()),
  notice: document.querySelector(".toast")?.textContent || "",
}));
assert.ok(
  completedRoute.state.connections.some(
    (connection) =>
      connection.a === motorId &&
      connection.portA === "SHAFT" &&
      connection.b === gearId &&
      connection.portB === "AXLE",
  ),
  `valid exact route did not complete: ${JSON.stringify({ mode: completedRoute.state.mode, selected: completedRoute.state.selectedEntity, notice: completedRoute.notice, connections: completedRoute.state.connections })}`,
);
await page.locator(`[data-outliner-part="${motorId}"]`).focus();
await page.keyboard.press("Enter");
await page.locator(".selection-arrange summary").focus();
await page.keyboard.press("Enter");
await page.locator("[data-selection-yaw]").focus();
await page.keyboard.press("ControlOrMeta+A");
await page.keyboard.type("15");
await page.keyboard.press("Tab");
await page.waitForFunction(
  (id) =>
    JSON.parse(window.render_game_to_text()).parts.find(
      (part) => part.id === id,
    ).displayYawDeg === 15,
  motorId,
);

await click("#demos-btn");
await click('[data-demo="cart"]');
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector("#close-remote")?.click());
await page.locator('[role="tree"][aria-label="Assembly entities"]').waitFor();
assert.equal(
  await page
    .locator('#assembly-outliner-list [role="treeitem"][tabindex="0"]')
    .count(),
  1,
  "the assembly tree does not expose exactly one Tab entry",
);
await page
  .locator('#assembly-outliner-list [role="treeitem"][tabindex="0"]')
  .focus();
const treeStart = await active();
await page.keyboard.press("ArrowRight");
const treeChild = await active();
assert.notEqual(
  treeChild.key,
  treeStart.key,
  "Right Arrow did not enter the part's child ports",
);
assert.match(
  treeChild.key || "",
  /^port:/,
  "Right Arrow did not focus a port child",
);
await page.keyboard.press("ArrowLeft");
assert.equal(
  (await active()).key,
  treeStart.key,
  "Left Arrow did not return to the parent part",
);

await click("#remote-btn");
if (!(await page.locator(".remote-console").isVisible()))
  await click("#remote-btn");
await click("#edit-remote");
const captures = page.locator(".hotkey-capture");
await captures.nth(0).click();
await page.keyboard.press("Tab");
assert.equal(
  await captures.nth(0).innerText(),
  "PRESS KEY…",
  "Tab escaped or replaced the dedicated hotkey capture target",
);
assert.match(
  await page.locator(".toast").innerText(),
  /reserved for focus navigation/i,
  "reserved-key capture did not explain why Tab was rejected",
);
await page.keyboard.press("KeyJ");
await captures.nth(1).click();
await page.keyboard.press("KeyJ");
assert.match(
  await page.locator(".toast").innerText(),
  /already assigned/i,
  "duplicate hotkey capture did not report the exact conflict",
);
assert.equal(
  await captures.nth(1).innerText(),
  "PRESS KEY…",
  "conflicting capture silently replaced the previous binding",
);
await page.keyboard.press("Escape");
await click("#close-remote");

await page.locator("canvas").focus();
await page.keyboard.press("Digit3");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running,
);
await page.keyboard.press("BracketRight");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).timeScale === 2,
);
await page.keyboard.press("KeyK");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).simulationPaused,
);
const timeBeforeStep = await page.evaluate(
  () => JSON.parse(window.render_game_to_text()).simulationTime,
);
await page.keyboard.press("Period");
await page.waitForFunction(
  (before) => JSON.parse(window.render_game_to_text()).simulationTime > before,
  timeBeforeStep,
);
await page.keyboard.press("KeyK");
await page.waitForFunction(
  () => !JSON.parse(window.render_game_to_text()).simulationPaused,
);
await page.keyboard.down("KeyW");
await page.waitForFunction(
  () =>
    JSON.parse(window.render_game_to_text()).demo.mobility.driveKeys.forward,
);
await page.evaluate(() => window.dispatchEvent(new Event("blur")));
await page.waitForFunction(
  () =>
    !JSON.parse(window.render_game_to_text()).demo.mobility.driveKeys.forward,
);
const released = await page.evaluate(
  () => JSON.parse(window.render_game_to_text()).demo.mobility.driveKeys,
);
await page.keyboard.up("KeyW");
await page.locator("canvas").focus();
await page.keyboard.press("Shift+KeyR");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).simulationTime < 0.1,
);
await page.keyboard.press("F1");
await page.waitForFunction(() => document.activeElement?.id === "close-learn");
assert.equal(
  await page.evaluate(
    () => JSON.parse(window.render_game_to_text()).presentation.surfaces.learn,
  ),
  true,
  "F1 did not open Learn during machine operation",
);
await page.keyboard.press("Escape");
assert.equal(
  await page.evaluate(() => document.activeElement?.tagName),
  "CANVAS",
  "closing Learn did not restore the canvas opener",
);
await page.keyboard.press("Digit1");
await page.waitForFunction(
  () => !JSON.parse(window.render_game_to_text()).running,
);
await page.locator("#tools-btn").focus();
await page.keyboard.press("ArrowDown");
await arrowTo("mechanism-lab-tool");
assert.equal(
  (await active()).id,
  "mechanism-lab-tool",
  "Tools arrow navigation skipped the dynamic Mechanism Lab entry",
);
await page.keyboard.press("Enter");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).mechanismLab?.open,
);
assert.equal(
  (await active()).id,
  "close-mechanism-lab",
  "Mechanism Lab did not focus its close action",
);
await page.keyboard.press("Escape");
assert.equal(
  (await active()).id,
  "tools-btn",
  "Mechanism Lab Escape did not restore the visible Tools opener",
);

console.log(
  JSON.stringify({ treeStart, treeChild, released, errors }, null, 2),
);
await conclude(browser, () => {
  assert.deepEqual(
    released,
    { forward: false, reverse: false, left: false, right: false, brake: false },
    "window blur left a machine command active",
  );
  assertNoErrors(errors);
});
