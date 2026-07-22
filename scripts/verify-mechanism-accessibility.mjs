import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1440, height: 900 },
});

const textState = async () =>
  JSON.parse(await page.evaluate(() => window.render_game_to_text()));

const changeValue = async (locator, value) => {
  await locator.fill(value);
  await locator.evaluate((input) =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
};

try {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await resetBrowserStorageForTest(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.click("#sandbox-start");
  await page.click("#clear-build");

  const preset = page.locator('.part-card[data-type="builtin-subassembly-0"]');
  await preset.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("group", { name: "PLACE PENDING ASSET" }).waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "placement-x",
    "keyboard placement did not move focus to the exact-coordinate form",
  );
  await page
    .getByRole("spinbutton", { name: "Placement X in meters" })
    .fill("0.5");
  await page
    .getByRole("spinbutton", { name: "Placement Y in meters" })
    .fill("1.25");
  await page
    .getByRole("spinbutton", { name: "Placement Z in meters" })
    .fill("-0.5");
  const place = page.getByRole("button", { name: "PLACE", exact: true });
  await place.focus();
  await page.keyboard.press("Enter");

  const addReusable = page.locator("#library-add");
  await addReusable.focus();
  await page.keyboard.press("Enter");
  const creator = page.getByRole("dialog", { name: "Save reusable assembly" });
  await creator.waitFor();
  assert.equal(
    await creator.evaluate((dialog) => dialog.contains(document.activeElement)),
    true,
    "subassembly creator does not move keyboard focus into the dialog",
  );
  const exposedCheckbox = creator
    .getByRole("checkbox", {
      name: /EXPOSE .* ON PART #/i,
    })
    .first();
  assert.ok(
    await exposedCheckbox.count(),
    "subassembly creator has no screen-reader named exposed-port choices",
  );
  assert.ok(
    await creator.getByRole("textbox", { name: "LABEL" }).count(),
    "exposed-port labels are not screen-reader addressable",
  );
  assert.ok(
    await creator.getByRole("combobox", { name: "ROLE" }).count(),
    "exposed-port semantic roles are not screen-reader addressable",
  );
  const moveLater = creator
    .getByRole("button", { name: /Move .* later/i })
    .first();
  await moveLater.focus();
  await page.keyboard.press("Enter");
  assert.equal(
    await creator.evaluate((dialog) => dialog.contains(document.activeElement)),
    true,
    "reordering an exposed port loses keyboard focus",
  );
  await page.keyboard.press("Escape");
  await creator.waitFor({ state: "hidden" });
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "library-add",
    "closing the subassembly creator does not restore opener focus",
  );

  let state = await textState();
  const spring = state.parts.find((part) => part.type === "spring");
  assert.ok(spring, "ordinary suspension preset has no spring entity");
  const springButton = page.locator(`[data-outliner-part="${spring.id}"]`);
  await springButton.focus();
  await page.keyboard.press("Enter");
  state = await textState();
  assert.deepEqual(state.selectedEntity, { kind: "part", partId: spring.id });
  assert.match(
    await springButton.textContent(),
    new RegExp(`part #${spring.id}.*ports`, "i"),
    "outliner part name omits stable identity or port count",
  );

  const stiffness = page.getByRole("spinbutton", {
    name: "STIFFNESS",
  });
  assert.match(
    await stiffness.getAttribute("aria-describedby"),
    /mechanism-unit-.*mechanism-error/,
    "mechanism input is not tied to its unit and validation status",
  );
  await changeValue(stiffness, "-1");
  assert.equal(
    await stiffness.getAttribute("aria-invalid"),
    "true",
    "invalid exact input is not announced as invalid",
  );
  assert.match(
    await page
      .getByRole("status")
      .filter({ hasText: /INVALID|minimum|must/i })
      .textContent(),
    /INVALID|minimum|must/i,
  );
  await changeValue(stiffness, "28000");
  assert.equal(
    await stiffness.getAttribute("aria-invalid"),
    "false",
    "corrected exact input remains announced as invalid",
  );

  const port = page.locator(`[data-outliner-port-part="${spring.id}"]`).first();
  const portName = (await port.textContent()).trim();
  assert.match(portName, /port/i, "outliner port lacks a stable kind label");
  await port.focus();
  await page.keyboard.press("Enter");
  state = await textState();
  assert.equal(state.selectedEntity.kind, "port");
  assert.equal(state.selectedEntity.partId, spring.id);

  await page.locator("#tools-btn").focus();
  await page.keyboard.press("Enter");
  const labTool = page.getByRole("button", { name: /MECHANISM LAB/i });
  await labTool.focus();
  await page.keyboard.press("Enter");
  const lab = page.locator(".mechanism-lab");
  await lab.getByRole("heading", { name: "Mechanism Lab" }).waitFor();
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "close-mechanism-lab",
    "Mechanism Lab does not put keyboard focus inside on open",
  );
  assert.equal(
    await lab.getByRole("status").getAttribute("aria-live"),
    "polite",
    "transport state is not exposed as a polite live region",
  );
  assert.equal(
    await lab
      .getByRole("searchbox", { name: "SEARCH CHANNELS" })
      .getAttribute("aria-describedby"),
    "mechanism-channel-help",
  );

  const run = lab.getByRole("button", { name: "RUN / STOP" });
  await run.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.running && state.mechanismLab?.session?.tick >= 0;
  });
  const pause = lab.getByRole("button", { name: "PAUSE / RESUME" });
  await pause.focus();
  await page.keyboard.press("Enter");
  const step = lab.getByRole("button", { name: "STEP 1/120 S" });
  await step.focus();
  await page.keyboard.press("Enter");
  state = await textState();
  assert.equal(state.mechanismLab.open, true);
  assert.equal(state.mechanismLab.session.mode, "paused");
  assert.ok(state.mechanismLab.session.tick >= 1);

  const table = lab.getByRole("table", {
    name: /canonical completed-tick samples/i,
  });
  await table.waitFor();
  assert.deepEqual(
    await table.getByRole("columnheader").allTextContents(),
    ["CHANNEL / OWNER", "FRAME", "TICK", "VALUE", "FLAGS", ""],
    "canonical channel columns are not screen-reader addressable",
  );

  const unnamedControls = await lab.evaluate((root) => {
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
      name = (element) =>
        element.getAttribute("aria-label")?.trim() ||
        element.getAttribute("aria-labelledby")?.trim() ||
        [...(element.labels || [])]
          .map((label) => label.textContent?.trim())
          .filter(Boolean)
          .join(" ") ||
        (element.tagName === "BUTTON" ? element.textContent?.trim() : "");
    return [...root.querySelectorAll("button, input, select, textarea")]
      .filter(visible)
      .filter((element) => !name(element))
      .map((element) => element.id || element.outerHTML.slice(0, 100));
  });
  assert.deepEqual(unnamedControls, [], "Mechanism Lab has unnamed controls");

  // Browser zoom halves the CSS-pixel viewport at 200%; model that effective
  // viewport directly instead of using the non-standard CSS zoom property.
  await page.setViewportSize({ width: 720, height: 450 });
  const zoomedBounds = await lab.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left,
      right: bounds.right,
      top: bounds.top,
      bottom: bounds.bottom,
      viewportWidth: innerWidth,
      viewportHeight: innerHeight,
      scrollable: element.scrollHeight > element.clientHeight,
    };
  });
  assert.ok(
    zoomedBounds.left >= 0 && zoomedBounds.right <= zoomedBounds.viewportWidth,
    `Mechanism Lab escapes the viewport at 200% zoom: ${JSON.stringify(zoomedBounds)}`,
  );
  assert.ok(
    zoomedBounds.top >= 0 && zoomedBounds.bottom <= zoomedBounds.viewportHeight,
    `Mechanism Lab is vertically unreachable at 200% zoom: ${JSON.stringify(zoomedBounds)}`,
  );
  assert.equal(
    await page.evaluate(
      () => matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    true,
    "reduced-motion preference was not preserved",
  );

  assertNoErrors(errors, "mechanism accessibility");
  console.log(
    "mechanism accessibility passed (keyboard, screen-reader semantics, text-state parity, reduced motion, 200% zoom)",
  );
} finally {
  await closeBrowser(browser);
}
