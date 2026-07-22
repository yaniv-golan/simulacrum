import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1024, height: 720 },
});
await page.addInitScript(() => {
  Object.defineProperty(navigator, "platform", { get: () => "MacIntel" });
});
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.click("#sandbox-start");
await page.click("#demos-btn");
await page.click('[data-demo="cart"]');
await page.click("#close-remote");
await page.click("#move-tool");
const editorState = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ),
  selectionVisible = await page.locator(".selection-label").isVisible();
await page.waitForTimeout(250);
await page.click("#tools-btn");
const toolsVisible = await page.locator(".tools-menu").isVisible();
const cameraGuide = await page.locator(".camera-help-card").innerText();
await page.click("#workspace-focus");
await page.waitForTimeout(220);
const focused = await page.evaluate(() => ({
  active: document
    .querySelector(".shell")
    .classList.contains("focus-workspace"),
  catalogOpacity: Number(
    getComputedStyle(document.querySelector(".catalog")).opacity,
  ),
  inspectorOpacity: Number(
    getComputedStyle(document.querySelector(".inspector")).opacity,
  ),
}));
await page.keyboard.press("h");
await page.waitForTimeout(220);
const catalogDisclosure = page.locator(".catalog .panel-collapse");
if ((await catalogDisclosure.getAttribute("aria-label"))?.startsWith("Expand"))
  await catalogDisclosure.click();
await catalogDisclosure.click();
await page.waitForTimeout(220);
const collapsedPanel = await page.evaluate(() => {
  const catalog = document.querySelector(".catalog"),
    rect = catalog.getBoundingClientRect(),
    reopen = catalog.querySelector(".panel-collapse");
  return {
    collapsed: catalog.classList.contains("panel-collapsed"),
    visibleRailRight: rect.right,
    reopenLabel: reopen.getAttribute("aria-label"),
  };
});
const result = await page.evaluate(() => {
  const panel = document.querySelector(".drive-hud").getBoundingClientRect();
  const camera = document
    .querySelector(".camera-tools")
    .getBoundingClientRect();
  const overlap = !(
    panel.right <= camera.left ||
    panel.left >= camera.right ||
    panel.bottom <= camera.top ||
    panel.top >= camera.bottom
  );
  const mission = document.querySelector(".mission").getBoundingClientRect(),
    selection = document
      .querySelector(".selection-label")
      .getBoundingClientRect();
  return {
    panel: { x: panel.x, y: panel.y, width: panel.width, height: panel.height },
    camera: {
      x: camera.x,
      y: camera.y,
      width: camera.width,
      height: camera.height,
    },
    overlap,
    selectionGap: selection.top - mission.bottom,
  };
});
await page.screenshot({ path: "artifacts/final-architecture-ui.png" });
await page.click("#camera-help");
await page.screenshot({ path: "artifacts/camera-controls-mac.png" });
const helpOpened = await page.locator(".camera-help-card").isVisible(),
  expandedWhenOpen = await page
    .locator("#camera-help")
    .getAttribute("aria-expanded");
await page.click(".camera-help-close");
const closedByButton = await page.locator(".camera-help-card").isHidden();
await page.click("#camera-help");
await page.mouse.click(700, 300);
const closedByOutsideClick = await page.locator(".camera-help-card").isHidden();
await page.click("#camera-help");
await page.keyboard.press("Escape");
const closedByEscape = await page.locator(".camera-help-card").isHidden();
console.log(
  JSON.stringify(
    {
      ...result,
      toolsVisible,
      cameraGuide,
      helpOpened,
      expandedWhenOpen,
      closedByButton,
      closedByOutsideClick,
      closedByEscape,
      focused,
      collapsedPanel,
      editorState: {
        tool: editorState.tool,
        selectedPart: editorState.selectedPart,
        selectionVisible,
      },
      errors,
    },
    null,
    2,
  ),
);
await conclude(browser, () => {
  assert.equal(
    result.overlap,
    false,
    "direct controls overlap camera controls",
  );
  assert.equal(toolsVisible, true, "secondary tools are not discoverable");
  assert.match(cameraGuide, /MAC TRACKPAD & MOUSE/);
  assert.match(cameraGuide, /⌥ \+ Drag\s*Orbit/);
  assert.match(cameraGuide, /Space \+ Drag\s*Pan/);
  assert.doesNotMatch(cameraGuide, /\b(?:RMB|MMB)\b/);
  assert.equal(helpOpened, true, "camera help did not open");
  assert.equal(
    expandedWhenOpen,
    "true",
    "camera help did not expose its expanded state",
  );
  assert.equal(
    closedByButton,
    true,
    "camera help close button did not dismiss it",
  );
  assert.equal(
    closedByOutsideClick,
    true,
    "outside click did not dismiss camera help",
  );
  assert.equal(closedByEscape, true, "Escape did not dismiss camera help");
  assert.equal(focused.active, true, "canvas focus mode did not activate");
  assert.ok(
    focused.catalogOpacity < 0.01,
    "canvas focus left the catalog visible",
  );
  assert.ok(
    focused.inspectorOpacity < 0.01,
    "canvas focus left the inspector visible",
  );
  assert.ok(
    result.selectionGap >= 8,
    "selection label overlaps mission telemetry",
  );
  assert.equal(
    collapsedPanel.collapsed,
    true,
    "library collapse control did not activate",
  );
  assert.ok(
    collapsedPanel.visibleRailRight <= 55,
    "collapsed library still covers the canvas",
  );
  assert.equal(
    collapsedPanel.reopenLabel,
    "Expand component library",
    "collapsed library has no discoverable reopen control",
  );
  assert.equal(editorState.tool, "move", "Move tool did not activate");
  assert.ok(
    editorState.selectedPart,
    "demo load did not preserve a clear selection",
  );
  assert.equal(
    selectionVisible,
    true,
    "selected component has no visible selection label",
  );
  assertNoErrors(errors, "responsive editor layout");
});
