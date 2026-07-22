import fs from "node:fs";
import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import {
  createBrowserTest,
  createInstrumentedPage,
} from "./lib/browser-test.mjs";

const { browser, baseUrl } = await createBrowserTest({ page: false });
fs.mkdirSync("artifacts", { recursive: true });

const activate = (page, selector) =>
  page.locator(selector).dispatchEvent("click");

async function openCart(viewport) {
  const { page, errors } = await createInstrumentedPage(browser, { viewport });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await activate(page, "#sandbox-start");
  await activate(page, "#demos-btn");
  await activate(page, '[data-demo="cart"]');
  await page.waitForTimeout(300);
  if (await page.locator("#close-remote").isVisible())
    await activate(page, "#close-remote");
  await page.waitForTimeout(250);
  return { page, errors };
}

async function layoutSnapshot(page) {
  return page.evaluate(() => {
    const rect = (selector) => {
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        };
      },
      bottom = rect(".bottom-bar"),
      visibleBottomChildren = [
        ...document.querySelector(".bottom-bar").children,
      ]
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => ({
          id: element.id,
          className: element.className,
          ...rect(element.id ? `#${element.id}` : `.${element.classList[0]}`),
        }));
    return {
      viewport: { width: innerWidth, height: innerHeight },
      compact: document
        .querySelector(".shell")
        .classList.contains("compact-workspace"),
      catalog: {
        ...rect(".catalog"),
        collapsed: document
          .querySelector(".catalog")
          .classList.contains("panel-collapsed"),
      },
      inspector: {
        ...rect(".inspector"),
        collapsed: document
          .querySelector(".inspector")
          .classList.contains("panel-collapsed"),
      },
      mission: rect(".mission"),
      bottom,
      bottomChildren: visibleBottomChildren,
      camera: rect(".camera-tools"),
      controller: {
        ...rect(".drive-hud"),
        collapsed: document
          .querySelector(".drive-hud")
          .classList.contains("collapsed"),
        bodyVisible:
          getComputedStyle(document.querySelector(".controller-body"))
            .display !== "none",
      },
      headerActionsVisible: [
        "#demos-btn",
        "#challenges-btn",
        "#remote-btn",
        "#tools-btn",
      ].every((selector) => {
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return bounds.width > 0 && bounds.right <= innerWidth;
      }),
    };
  });
}

try {
  const narrowSession = await openCart({ width: 860, height: 720 }),
    narrow = await layoutSnapshot(narrowSession.page);

  assert.equal(narrow.compact, true, "constrained layout did not activate");
  assert.equal(
    narrow.catalog.collapsed,
    true,
    "component library did not yield space after selecting a part",
  );
  assert.equal(
    narrow.inspector.collapsed,
    false,
    "selected-part inspector was not kept available",
  );
  assert.ok(
    narrow.inspector.left - narrow.catalog.right >= 480,
    "constrained layout leaves too little visible model space",
  );
  assert.equal(
    narrow.controller.collapsed,
    true,
    "build-mode controller did not minimize automatically",
  );
  assert.equal(
    narrow.controller.bodyVisible,
    false,
    "minimized controller still covers the model",
  );
  assert.equal(
    narrow.headerActionsVisible,
    true,
    "essential header actions are clipped",
  );
  assert.ok(
    narrow.bottomChildren.every(
      (child) =>
        child.left >= narrow.bottom.left - 1 &&
        child.right <= narrow.bottom.right + 1,
    ),
    "bottom actions spill outside their container",
  );
  assert.ok(
    narrow.camera.top >= narrow.catalog.bottom,
    "camera controls overlap the active workspace drawer",
  );

  await activate(
    narrowSession.page,
    '.panel-collapse[aria-label="Expand component library"]',
  );
  const switched = await layoutSnapshot(narrowSession.page);
  assert.equal(switched.catalog.collapsed, false, "library did not expand");
  assert.equal(
    switched.inspector.collapsed,
    true,
    "expanding the library did not yield the inspector drawer",
  );
  await activate(
    narrowSession.page,
    '.panel-collapse[aria-label="Expand inspector"]',
  );

  await activate(narrowSession.page, "#collapse-controller");
  const controller = await layoutSnapshot(narrowSession.page);
  assert.equal(
    controller.controller.bodyVisible,
    true,
    "compact controller cannot be expanded on demand",
  );
  await activate(narrowSession.page, "#collapse-controller");

  await activate(narrowSession.page, "#tools-btn");
  assert.equal(
    await narrowSession.page.locator(".tools-menu").isVisible(),
    true,
    "compact header hides the secondary tools menu",
  );
  await activate(narrowSession.page, "#tools-btn");

  await activate(narrowSession.page, "#remote-btn");
  await narrowSession.page.waitForFunction(
    () =>
      Number(getComputedStyle(document.querySelector(".inspector")).opacity) <
        0.001 &&
      Number(getComputedStyle(document.querySelector(".drive-hud")).opacity) <
        0.001,
  );
  const remoteDrawer = await narrowSession.page.evaluate(() => {
    const remote = document
        .querySelector(".remote-console")
        .getBoundingClientRect(),
      inspector = document.querySelector(".inspector");
    return {
      left: remote.left,
      right: remote.right,
      top: remote.top,
      bottom: remote.bottom,
      inspectorOpacity: Number(getComputedStyle(inspector).opacity),
      controllerOpacity: Number(
        getComputedStyle(document.querySelector(".drive-hud")).opacity,
      ),
    };
  });
  assert.ok(
    remoteDrawer.left >= 0 &&
      remoteDrawer.right <= 860 &&
      remoteDrawer.top >= 0 &&
      remoteDrawer.bottom <= 720,
    "Field Remote escapes the constrained viewport",
  );
  assert.ok(
    remoteDrawer.inspectorOpacity < 0.001,
    "Field Remote competes with the inspector on a constrained screen",
  );
  assert.ok(
    remoteDrawer.controllerOpacity < 0.001,
    "Field Remote leaves a duplicate model controller over the canvas",
  );
  await activate(narrowSession.page, "#close-remote");

  await activate(narrowSession.page, "#run-btn");
  await narrowSession.page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running,
  );
  const running = await narrowSession.page.evaluate(() => {
    const rect = (selector) => {
        const bounds = document.querySelector(selector).getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
        };
      },
      state = JSON.parse(window.render_game_to_text());
    return {
      runtimeRunning: state.running,
      shellClasses: document.querySelector(".shell").className,
      runButtonText: document.querySelector("#run-btn").textContent,
      focused: document
        .querySelector(".shell")
        .classList.contains("focus-workspace"),
      controller: rect(".drive-hud"),
      controllerBodyVisible:
        getComputedStyle(document.querySelector(".controller-body")).display !==
        "none",
      camera: rect(".camera-tools"),
      safeFrame: state.camera.tracking?.safeFrame || null,
    };
  });
  assert.equal(
    running.focused,
    true,
    `simulation did not prioritize the canvas: ${JSON.stringify({ running, errors: narrowSession.errors })}`,
  );
  assert.equal(
    running.controllerBodyVisible,
    true,
    "simulation hid the controls needed to operate the model",
  );
  assert.ok(
    running.camera.top >= running.controller.bottom,
    "model controller overlaps orbit, pan, or zoom controls",
  );
  assert.ok(running.safeFrame, "simulation did not expose a camera safe frame");
  assert.ok(
    running.safeFrame.left >= running.controller.right + 10,
    "camera framing places the model behind its controller",
  );
  await narrowSession.page.screenshot({
    path: "artifacts/adaptive-workspace-narrow.png",
  });
  assertNoErrors(narrowSession.errors, "constrained adaptive workspace");
  await narrowSession.page.close();

  const largeSession = await openCart({ width: 1728, height: 1000 }),
    large = await layoutSnapshot(largeSession.page);
  assert.equal(large.compact, false, "large display used constrained layout");
  assert.equal(large.catalog.collapsed, false, "large display hid the library");
  assert.equal(
    large.inspector.collapsed,
    false,
    "large display hid the inspector",
  );
  assert.ok(
    large.catalog.width >= 320 && large.inspector.width >= 320,
    "large display did not provide more legible working panels",
  );
  assert.ok(
    large.inspector.left - large.catalog.right >= 1000,
    "large display did not preserve a generous model viewport",
  );
  assert.equal(
    large.controller.bodyVisible,
    true,
    "large display unnecessarily minimized the model controller",
  );
  assert.ok(
    large.bottomChildren.every(
      (child) =>
        child.left >= large.bottom.left - 1 &&
        child.right <= large.bottom.right + 1,
    ),
    "large-screen bottom actions spill outside their container",
  );
  await largeSession.page.screenshot({
    path: "artifacts/adaptive-workspace-large.png",
  });
  await largeSession.page.setViewportSize({ width: 860, height: 720 });
  await largeSession.page.waitForTimeout(250);
  const resizedNarrow = await layoutSnapshot(largeSession.page);
  assert.equal(
    resizedNarrow.compact,
    true,
    "resizing a large workspace did not activate compact disclosure",
  );
  assert.equal(
    Number(resizedNarrow.catalog.collapsed) +
      Number(resizedNarrow.inspector.collapsed),
    1,
    "resized compact workspace did not retain one working drawer",
  );
  await largeSession.page.setViewportSize({ width: 1728, height: 1000 });
  await largeSession.page.waitForTimeout(250);
  const resizedLarge = await layoutSnapshot(largeSession.page);
  assert.equal(
    resizedLarge.catalog.collapsed,
    false,
    "returning to a large workspace did not restore the library",
  );
  assert.equal(
    resizedLarge.inspector.collapsed,
    false,
    "returning to a large workspace did not restore the inspector",
  );
  assertNoErrors(largeSession.errors, "large adaptive workspace");

  console.log(
    JSON.stringify(
      {
        narrow: {
          visibleModelWidth: narrow.inspector.left - narrow.catalog.right,
          controllerCollapsed: narrow.controller.collapsed,
          runningSafeFrame: running.safeFrame,
        },
        large: {
          panelWidth: large.catalog.width,
          visibleModelWidth: large.inspector.left - large.catalog.right,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await closeBrowser(browser);
}
