import fs from "node:fs/promises";
import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

await fs.mkdir("artifacts", { recursive: true });
const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 860, height: 720 },
});
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });

function contrastRatio(foreground, background) {
  const channel = (value) => {
      value /= 255;
      return value <= 0.04045
        ? value / 12.92
        : ((value + 0.055) / 1.055) ** 2.4;
    },
    luminance = (color) =>
      0.2126 * channel(color[0]) +
      0.7152 * channel(color[1]) +
      0.0722 * channel(color[2]),
    light = Math.max(luminance(foreground), luminance(background)),
    dark = Math.min(luminance(foreground), luminance(background));
  return (light + 0.05) / (dark + 0.05);
}

async function colors(selector) {
  return page.locator(selector).evaluate((element) => {
    const parse = (value) =>
        value.match(/[\d.]+/g)?.map(Number) || [0, 0, 0, 0],
      composite = (front, back) => {
        const alpha = front[3] ?? 1,
          backAlpha = back[3] ?? 1,
          outAlpha = alpha + backAlpha * (1 - alpha);
        return [
          ...front
            .slice(0, 3)
            .map(
              (channel, index) =>
                (channel * alpha + back[index] * backAlpha * (1 - alpha)) /
                Math.max(outAlpha, Number.EPSILON),
            ),
          outAlpha,
        ];
      };
    let background = [0, 0, 0, 0],
      node = element;
    while (node) {
      background = composite(
        background,
        parse(getComputedStyle(node).backgroundColor),
      );
      if ((background[3] ?? 0) >= 0.995) break;
      node = node.parentElement;
    }
    if ((background[3] ?? 0) < 0.995)
      background = composite(background, [8, 18, 18, 1]);
    return {
      foreground: parse(getComputedStyle(element).color),
      background,
    };
  });
}

async function assertContrast(selector, minimum = 4.5) {
  const { foreground, background } = await colors(selector),
    ratio = contrastRatio(foreground, background);
  assert.ok(
    ratio >= minimum,
    `${selector} contrast ${ratio.toFixed(2)} is below ${minimum}`,
  );
  return Number(ratio.toFixed(2));
}

await page.waitForFunction(() => document.activeElement?.id === "guided-start");
const welcomeTabOrder = [await page.evaluate(() => document.activeElement?.id)];
for (let index = 0; index < 2; index += 1) {
  await page.keyboard.press("Tab");
  welcomeTabOrder.push(await page.evaluate(() => document.activeElement?.id));
}
assert.deepEqual(
  welcomeTabOrder,
  ["guided-start", "sandbox-start", "learn-start"],
  "welcome actions are not keyboard reachable in visual order",
);
const welcomeContrast = {
  title: await assertContrast(".welcome h1", 3),
  copy: await assertContrast(".welcome-card > p"),
  primary: await assertContrast("#guided-start"),
};

await page.click("#sandbox-start");
await page.locator(".catalog").waitFor();

const unnamedControls = await page.evaluate(() => {
  const visible = (element) => {
      const style = getComputedStyle(element),
        bounds = element.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        bounds.width > 0 &&
        bounds.height > 0
      );
    },
    label = (element) =>
      element.getAttribute("aria-label")?.trim() ||
      element.getAttribute("aria-labelledby")?.trim() ||
      [...(element.labels || [])]
        .map((item) => item.textContent?.trim())
        .filter(Boolean)
        .join(" ") ||
      (element.tagName === "BUTTON" ? element.textContent?.trim() : "");
  return [...document.querySelectorAll("button, input, select, textarea")]
    .filter(visible)
    .filter((element) => !label(element))
    .map((element) => element.id || element.outerHTML.slice(0, 100));
});
assert.deepEqual(
  unnamedControls,
  [],
  `visible controls without accessible names: ${unnamedControls.join(", ")}`,
);

const expandLibrary = page.locator(
  '.catalog .panel-collapse[aria-label="Expand component library"]',
);
if (await expandLibrary.isVisible()) await expandLibrary.click();
await page.click('[data-cat="motion"]');
assert.equal(
  await page.locator('[data-cat="motion"]').getAttribute("aria-selected"),
  "true",
  "component tab does not expose selected state",
);
assert.equal(
  await page.locator('[data-cat="all"]').getAttribute("aria-selected"),
  "false",
  "previous component tab remains selected to assistive technology",
);

await page.click('[data-mode="wire"]');
assert.equal(
  await page.locator('[data-mode="wire"]').getAttribute("aria-pressed"),
  "true",
  "workshop mode does not expose pressed state",
);
assert.equal(
  await page.locator('[data-mode="build"]').getAttribute("aria-pressed"),
  "false",
  "previous workshop mode remains pressed",
);

await page.click("#tools-btn");
assert.equal(
  await page.locator("#tools-btn").getAttribute("aria-expanded"),
  "true",
  "tools menu does not expose expanded state",
);
await page.locator("#blueprint-btn").focus();
await page.click("#blueprint-btn");
await page.waitForFunction(() =>
  document.querySelector("#blueprint-modal").contains(document.activeElement),
);
assert.equal(
  await page.locator("#blueprint-modal").getAttribute("role"),
  "dialog",
  "Blueprint Exchange is not exposed as a dialog",
);
assert.equal(
  await page.locator("#blueprint-modal").getAttribute("aria-modal"),
  "true",
  "Blueprint Exchange is not exposed as modal",
);
const dialogFocus = await page.evaluate(() => ({
  inside: document
    .querySelector("#blueprint-modal")
    .contains(document.activeElement),
  id: document.activeElement?.id,
}));
assert.equal(dialogFocus.inside, true, "focus did not enter the opened dialog");

const focusBoundary = await page
  .locator("#blueprint-modal")
  .evaluate((dialog) => {
    const focusables = [
      ...dialog.querySelectorAll(
        "button:not([disabled]), input:not([disabled]):not([type=hidden]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ),
    ].filter((element) => {
      const closedDetails = element.closest("details:not([open])");
      return (
        !element.hidden &&
        element.getAttribute("aria-hidden") !== "true" &&
        !element.closest(".hidden") &&
        element.getClientRects().length > 0 &&
        (!closedDetails || Boolean(element.closest("summary")))
      );
    });
    focusables.at(-1).focus();
    return {
      first: focusables[0].id,
      last: focusables.at(-1).id,
      activeAfterFocus: document.activeElement?.id,
    };
  });
assert.equal(
  focusBoundary.activeAfterFocus,
  focusBoundary.last,
  "test could not focus the dialog's last visible control",
);
await page.keyboard.press("Tab");
assert.equal(
  await page.evaluate(() => document.activeElement?.id),
  focusBoundary.first,
  "Tab escaped the modal dialog",
);
await page.keyboard.press("Shift+Tab");
assert.equal(
  await page.evaluate(() => document.activeElement?.id),
  focusBoundary.last,
  "Shift+Tab escaped the modal dialog",
);
await page.keyboard.press("Escape");
await page.locator("#blueprint-modal").waitFor({ state: "hidden" });
await page.waitForFunction(() => document.activeElement?.id === "tools-btn");

assert.equal(
  await page.locator("#tools-btn").getAttribute("aria-expanded"),
  "false",
  "tools menu did not close after its action",
);

const compactLayout = await page.evaluate(() => {
  const rect = (selector) => {
      const bounds = document.querySelector(selector).getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
        width: bounds.width,
      };
    },
    catalog = document.querySelector(".catalog"),
    inspector = document.querySelector(".inspector");
  return {
    compact: document
      .querySelector(".shell")
      .classList.contains("compact-workspace"),
    catalog: rect(".catalog"),
    inspector: rect(".inspector"),
    catalogCollapsed: catalog.classList.contains("panel-collapsed"),
    inspectorCollapsed: inspector.classList.contains("panel-collapsed"),
    canvasWidth: Math.max(0, rect(".inspector").left - rect(".catalog").right),
  };
});
assert.equal(
  compactLayout.compact,
  true,
  "two-thirds laptop layout is not compact",
);
assert.ok(
  compactLayout.catalogCollapsed || compactLayout.inspectorCollapsed,
  "compact layout leaves both side panels over the model",
);
assert.ok(
  compactLayout.canvasWidth >= 480,
  `compact layout leaves only ${compactLayout.canvasWidth}px for the model`,
);

await page.emulateMedia({ reducedMotion: "reduce" });
const reducedMotion = await page.evaluate(() => {
  const node = document.querySelector(".catalog"),
    style = getComputedStyle(node),
    milliseconds = (value) =>
      value
        .split(",")
        .map((item) =>
          item.trim().endsWith("ms")
            ? Number.parseFloat(item)
            : Number.parseFloat(item) * 1000,
        );
  return {
    animation: milliseconds(style.animationDuration),
    transition: milliseconds(style.transitionDuration),
  };
});
assert.ok(
  reducedMotion.animation.every((duration) => duration <= 0.011),
  "reduced-motion preference leaves a long animation",
);
assert.ok(
  reducedMotion.transition.every((duration) => duration <= 0.011),
  "reduced-motion preference leaves a long transition",
);

const compactContrast = {
  catalogTitle: await assertContrast(".catalog h2", 3),
  search: await assertContrast(".search input"),
  activeMode: await assertContrast('[data-mode="wire"]'),
};
await page.screenshot({
  path: "artifacts/accessibility-compact.png",
  fullPage: false,
});

await page.setViewportSize({ width: 1728, height: 1000 });
await page.waitForTimeout(250);
const largeLayout = await page.evaluate(() => {
  const bounds = (selector) =>
    document.querySelector(selector).getBoundingClientRect();
  return {
    compact: document
      .querySelector(".shell")
      .classList.contains("compact-workspace"),
    catalogWidth: bounds(".catalog").width,
    inspectorWidth: bounds(".inspector").width,
    modelWidth: bounds(".inspector").left - bounds(".catalog").right,
  };
});
assert.equal(
  largeLayout.compact,
  false,
  "large monitor retained compact layout",
);
assert.ok(
  largeLayout.catalogWidth >= 320 && largeLayout.inspectorWidth >= 320,
  "large monitor does not provide readable side panels",
);
assert.ok(
  largeLayout.modelWidth >= 1000,
  "large monitor does not preserve a generous model viewport",
);
await page.screenshot({
  path: "artifacts/accessibility-large.png",
  fullPage: false,
});

console.log(
  JSON.stringify(
    {
      welcomeTabOrder,
      dialogFocus,
      compactLayout,
      largeLayout,
      reducedMotion,
      contrast: { welcomeContrast, compactContrast },
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  assertNoErrors(errors, "accessibility and responsive design verification");
});
