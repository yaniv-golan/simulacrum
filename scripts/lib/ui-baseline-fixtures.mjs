import { resetBrowserStorageForTest } from "./browser-storage-fixture.mjs";

export const UI_BASELINE_FIXTURES = Object.freeze({
  "f1-clean": {
    label: "F1 Clean",
    selectedEntity: null,
    mode: "build",
    openSurfaces: [],
  },
  "f2-gearbox-build": {
    label: "F2 Gearbox Build",
    selectedEntity: "Powered Motor",
    mode: "build",
    openSurfaces: [],
  },
  "f3-gearbox-connect": {
    label: "F3 Gearbox Connect",
    selectedEntity: "Powered Motor SHAFT port",
    mode: "wire",
    openSurfaces: [],
    routeSteps: {
      source: "Powered Motor SHAFT",
      invalidTarget: "Power Cell POWER",
      validTarget:
        "12T Pinion Gear AXLE after removing the existing shaft seat",
    },
  },
  "f4-rover-operate": {
    label: "F4 Rover Operate",
    selectedEntity: "current rover selection",
    mode: "test",
    openSurfaces: ["directControl"],
  },
  "f5-challenge": {
    label: "F5 Challenge",
    selectedEntity: "Mission Payload",
    mode: "build",
    openSurfaces: ["challenge"],
  },
  "f6-dense-specialist": {
    label: "F6 Dense Specialist",
    selectedEntity: "first authored mechanism",
    mode: "build",
    openSurfaces: ["mechanismLab"],
  },
});

async function cleanStart(page, baseUrl) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await resetBrowserStorageForTest(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => !document.querySelector("#sandbox-start")?.disabled,
  );
}

async function enterEmptySandbox(page) {
  await page.locator("#sandbox-start").focus();
  await page.keyboard.press("Enter");
  await page.locator(".catalog").waitFor();
  // OPEN SANDBOX currently seeds the teaching gearbox when no machine exists.
  // F1 is intentionally the clean post-launch editing state, so clear through
  // the same registered workshop action at every responsive breakpoint.
  await page.locator("canvas").focus();
  await page.keyboard.press("Shift+Delete");
  await page.waitForFunction(
    () => {
      const snapshot = JSON.parse(window.render_game_to_text());
      return snapshot.parts.length === 0 && snapshot.connections.length === 0;
    },
    undefined,
    { timeout: 5_000 },
  );
}

async function loadDemo(page, kind) {
  await page.locator("#demos-btn").click();
  await page.locator(`[data-demo="${kind}"]`).click();
  await page.waitForFunction(
    (expected) =>
      JSON.parse(window.render_game_to_text()).demo.kind === expected,
    kind,
  );
}

async function state(page) {
  return JSON.parse(await page.evaluate(() => window.render_game_to_text()));
}

async function closeRemote(page) {
  if (await page.locator(".remote-console").isVisible())
    await page.locator("#close-remote").click();
}

export async function prepareUiBaselineFixture(page, baseUrl, id) {
  if (!UI_BASELINE_FIXTURES[id]) throw new Error(`Unknown UI fixture ${id}`);
  await cleanStart(page, baseUrl);
  const welcome = {
    visible: await page.locator(".welcome").isVisible(),
    focus: await page.evaluate(() => document.activeElement?.id || null),
  };
  await enterEmptySandbox(page);
  if (id.startsWith("f2-") || id.startsWith("f3-")) {
    await loadDemo(page, "gearbox");
    await closeRemote(page);
    const snapshot = await state(page),
      motor = snapshot.parts.find((part) => part.type === "motor");
    if (!motor) throw new Error("Powered Gearbox fixture has no motor");
    if (id === "f2-gearbox-build")
      await page.locator(`[data-outliner-part="${motor.id}"]`).click();
    else
      await page
        .locator(
          `[data-outliner-port-part="${motor.id}"][data-outliner-port="SHAFT"]`,
        )
        .click();
  } else if (id === "f4-rover-operate") {
    await loadDemo(page, "cart");
    await closeRemote(page);
    await page.locator("canvas").focus();
    await page.keyboard.press("Digit3");
    await page.waitForFunction(
      () => JSON.parse(window.render_game_to_text()).running,
    );
  } else if (id === "f5-challenge") {
    await loadDemo(page, "cart");
    await closeRemote(page);
    await page.locator("#challenges-btn").click();
    await page
      .locator('[data-challenge="cargo-relay"][data-start-mode="current"]')
      .click();
  } else if (id === "f6-dense-specialist") {
    await loadDemo(page, "cart");
    await closeRemote(page);
    const snapshot = await state(page),
      mechanism = snapshot.parts.find((part) => part.settings.mechanism);
    if (!mechanism) throw new Error("Rover fixture has no authored mechanism");
    await page.locator(`[data-outliner-part="${mechanism.id}"]`).click();
    await page.locator("#tools-btn").click();
    await page.locator("#mechanism-lab-tool").click();
    await page.locator(".mechanism-lab").waitFor();
  }
  await page.waitForTimeout(100);
  if (await page.locator(".toast.show").count())
    await page.waitForFunction(
      () => !document.querySelector(".toast")?.classList.contains("show"),
      undefined,
      { timeout: 3_000 },
    );
  return {
    definition: UI_BASELINE_FIXTURES[id],
    welcome,
    state: await state(page),
  };
}

export async function captureUiInventory(page) {
  return page.evaluate(() => {
    const controls = [
        ...document.querySelectorAll(
          "button, a[href], input, select, textarea, summary, [role='tab'], [role='treeitem']",
        ),
      ],
      entries = controls.map((element) => ({
        id: element.id || null,
        role: element.getAttribute("role") || element.tagName.toLowerCase(),
        label:
          element.getAttribute("aria-label") ||
          element.textContent?.trim().replace(/\s+/g, " ").slice(0, 100) ||
          null,
        ...window.__simulacrumTestVisibility(element, {
          sampleOcclusion: true,
        }),
      })),
      panelSelectors = [
        "header",
        ".catalog",
        ".inspector",
        ".mission",
        ".bottom-bar",
        ".camera-tools",
        ".remote-console",
        ".drive-hud",
        ".challenge-hud",
        ".learn-center",
        ".mechanism-lab",
      ],
      panels = Object.fromEntries(
        panelSelectors.map((selector) => {
          const element = document.querySelector(selector),
            result = window.__simulacrumTestVisibility(element),
            bounds = element?.getBoundingClientRect();
          return [
            selector,
            {
              rendered: result.rendered,
              bounds: bounds
                ? {
                    left: bounds.left,
                    top: bounds.top,
                    right: bounds.right,
                    bottom: bounds.bottom,
                    width: bounds.width,
                    height: bounds.height,
                  }
                : null,
            },
          ];
        }),
      );
    return {
      viewport: {
        width: innerWidth,
        height: innerHeight,
        devicePixelRatio,
        zoom: 1,
      },
      counts: {
        total: entries.length,
        rendered: entries.filter((entry) => entry.rendered).length,
        pointerInteractive: entries.filter((entry) => entry.pointerInteractive)
          .length,
        keyboardFocusable: entries.filter((entry) => entry.keyboardFocusable)
          .length,
      },
      entries,
      panels,
    };
  });
}
