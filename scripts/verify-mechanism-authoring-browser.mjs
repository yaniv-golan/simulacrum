import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest();

const textState = async () =>
  JSON.parse(await page.evaluate(() => window.render_game_to_text()));

try {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await resetBrowserStorageForTest(page);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.click("#sandbox-start");
  await page.keyboard.press("Shift+Delete");

  const preset = page.locator('.part-card[data-type="builtin-subassembly-0"]');
  await preset.focus();
  await page.keyboard.press("Enter");
  let state = await textState();
  const { exposedPorts, ...pendingPlacement } = state.pendingPlacement;
  assert.deepEqual(pendingPlacement, {
    kind: "ordinary-subassembly",
    componentType: null,
    assetName: "Rigid axle suspension",
    partCount: 9,
    connectionCount: 10,
    position: [0, 0.03, 0],
  });
  assert.ok(
    exposedPorts.length > 0,
    "ordinary preset did not advertise any connectable exposed ports",
  );
  assert.equal(
    "runtimePresetId" in state.pendingPlacement,
    false,
    "ordinary preset placement leaked a runtime identity",
  );
  await page.fill("#placement-x", "1.25");
  await page.fill("#placement-y", "1.5");
  await page.fill("#placement-z", "-0.75");
  await page.click("#place-pending");
  state = await textState();
  assert.equal(state.parts.length, 9);
  assert.equal(state.connections.length, 10);

  const spring = state.parts.find((part) => part.type === "spring");
  assert.ok(spring, "preset did not expand to an ordinary spring part");
  await page.click(`[data-outliner-part="${spring.id}"]`);
  state = await textState();
  assert.deepEqual(state.selectedEntity, { kind: "part", partId: spring.id });

  const unitSelect = page.locator("#mechanism-display-units"),
    readMechanismTypography = () =>
      page.locator(".mechanism-editor").evaluate((editor) => {
        const style = (selector) =>
          getComputedStyle(editor.querySelector(selector));
        return {
          labelDisplay: style(":scope > label").display,
          labelFontSize: style(":scope > label").fontSize,
          selectFontSize: style("select").fontSize,
          noteFontSize: style(".component-contract-note").fontSize,
          summaryFontSize: style("summary").fontSize,
          editorRight: editor.getBoundingClientRect().right,
          selectRight: editor.querySelector("select").getBoundingClientRect()
            .right,
          inspectorLeft: editor.closest(".inspector").getBoundingClientRect()
            .left,
          collapseButtonRight: editor
            .closest(".inspector")
            .querySelector(".panel-collapse")
            .getBoundingClientRect().right,
        };
      }),
    expectedMechanismTypography = {
      labelDisplay: "grid",
      labelFontSize: "8px",
      selectFontSize: "9px",
      noteFontSize: "9px",
      summaryFontSize: "9px",
    },
    readInspectorLayout = (scrollRatio) =>
      page.locator(".inspector-content").evaluate((content, ratio) => {
        const scrollBody = content.querySelector(".inspector-scroll-body"),
          actions = content.querySelector(".inspector-actions"),
          lastContent = scrollBody.lastElementChild,
          rect = (element) => {
            const bounds = element.getBoundingClientRect();
            return {
              top: bounds.top,
              right: bounds.right,
              bottom: bounds.bottom,
              left: bounds.left,
              width: bounds.width,
              height: bounds.height,
            };
          },
          maximumScrollTop = scrollBody.scrollHeight - scrollBody.clientHeight;
        scrollBody.scrollTop = maximumScrollTop * ratio;
        return new Promise((resolve) =>
          requestAnimationFrame(() =>
            resolve({
              content: rect(content),
              scrollBody: rect(scrollBody),
              actions: rect(actions),
              actionPosition: getComputedStyle(actions).position,
              actionButtonHeights: [...actions.querySelectorAll("button")].map(
                (button) => rect(button).height,
              ),
              maximumScrollTop,
              scrollTop: scrollBody.scrollTop,
              lastContentBottom: rect(lastContent).bottom,
            }),
          ),
        );
      }, scrollRatio),
    initialViewport = page.viewportSize();
  for (const [name, viewport] of [
    ["laptop", { width: 1280, height: 720 }],
    ["wide", { width: 1920, height: 1080 }],
  ]) {
    await page.setViewportSize(viewport);
    const typography = await readMechanismTypography();
    assert.deepEqual(
      {
        labelDisplay: typography.labelDisplay,
        labelFontSize: typography.labelFontSize,
        selectFontSize: typography.selectFontSize,
        noteFontSize: typography.noteFontSize,
        summaryFontSize: typography.summaryFontSize,
      },
      expectedMechanismTypography,
      `mechanism Inspector typography escaped the compact panel scale at ${name}`,
    );
    assert.ok(
      typography.selectRight <= typography.editorRight,
      `mechanism display-unit selector escaped the Inspector at ${name}`,
    );
    assert.ok(
      typography.collapseButtonRight <= typography.inspectorLeft,
      `Inspector collapse control overlapped panel content at ${name}`,
    );
    for (const [position, scrollRatio] of [
      ["top", 0],
      ["middle", 0.5],
      ["bottom", 1],
    ]) {
      const layout = await readInspectorLayout(scrollRatio);
      assert.equal(
        layout.actionPosition,
        "static",
        `Inspector actions escaped the in-flow footer at ${name}/${position}`,
      );
      assert.ok(
        layout.maximumScrollTop > 0,
        `mechanism Inspector fixture did not exercise scrolling at ${name}`,
      );
      assert.ok(
        layout.scrollBody.bottom <= layout.actions.top + 0.5,
        `Inspector properties ran under the action footer at ${name}/${position}`,
      );
      assert.ok(
        layout.actions.bottom <= layout.content.bottom + 0.5,
        `Inspector action footer escaped its panel at ${name}/${position}`,
      );
      assert.ok(
        layout.actionButtonHeights.every((height) => height >= 44),
        `Inspector action target fell below 44px at ${name}/${position}`,
      );
      if (position === "bottom")
        assert.ok(
          layout.lastContentBottom <= layout.scrollBody.bottom + 0.5,
          `Inspector's final content cannot clear the footer at ${name}`,
        );
      await page.screenshot({
        path: `artifacts/mechanism-inspector-footer-${name}-${position}.png`,
      });
    }
  }
  await page.setViewportSize(initialViewport);
  await page.locator(".inspector-scroll-body").evaluate((scrollBody) => {
    const focusable = [
      ...scrollBody.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex='-1'])",
      ),
    ].filter((element) => element.getClientRects().length > 0);
    focusable.at(-1).focus();
  });
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "duplicate-part",
    "Tab order did not advance from Inspector properties into the action footer",
  );
  await unitSelect.selectOption("engineering");
  await page.locator(".mechanism-editor details > summary").click();
  const stiffness = page.locator(
    '[data-mechanism-path="elasticLaw/stiffnessNPerM"]',
  );
  assert.equal(await stiffness.getAttribute("data-si-factor"), "0.001");
  await stiffness.fill("-2");
  await stiffness.evaluate((input) =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
  assert.match(
    await page.locator("#mechanism-error").textContent(),
    /INVALID|must|minimum/i,
  );
  state = await textState();
  assert.equal(
    state.parts.find((part) => part.id === spring.id).settings.mechanism.config
      .elasticLaw.stiffnessNPerM,
    spring.settings.mechanism.config.elasticLaw.stiffnessNPerM,
    "invalid exact edit mutated authoritative SI state",
  );
  assert.equal(
    state.parts.find((part) => part.id === spring.id).settings.mechanism
      .displayUnit,
    "engineering",
  );

  await stiffness.fill("32");
  await stiffness.evaluate((input) =>
    input.dispatchEvent(new Event("change", { bubbles: true })),
  );
  state = await textState();
  assert.equal(
    state.parts.find((part) => part.id === spring.id).settings.mechanism.config
      .elasticLaw.stiffnessNPerM,
    32_000,
    "engineering display value was not converted back to authoritative SI",
  );

  const firstConnection = state.connections[0];
  await page.click(`[data-outliner-connection="${firstConnection.id}"]`);
  state = await textState();
  assert.equal(state.selectedEntity.kind, "connection");
  assert.equal(state.selectedEntity.connectionId, firstConnection.id);

  await page.click('.panel-collapse[aria-label="Expand component library"]');
  await page.click('[data-cat="motion"]');
  await page.locator('.part-card[data-type="spring"]').focus();
  await page.keyboard.press("Enter");
  await page.fill("#placement-x", "4");
  await page.fill("#placement-y", "2");
  await page.fill("#placement-z", "0");
  await page.click("#place-pending");
  const looseSpringId = (await textState()).selectedPart;
  await page.click("#tools-btn");
  await page.click("#mechanism-lab-tool");
  await page
    .locator("#mechanism-diagnostics")
    .getByText("INCOMPLETE_CONNECTOR")
    .waitFor();
  await page.click(`[data-diagnostic-part="${looseSpringId}"]`);
  state = await textState();
  assert.deepEqual(state.selectedEntity, {
    kind: "part",
    partId: looseSpringId,
  });

  assertNoErrors(errors, "mechanism authoring browser");
  console.log(
    "mechanism authoring browser passed (ordinary preset, exact placement, outliner, SI conversion, atomic validation, diagnostic jump)",
  );
} finally {
  await closeBrowser(browser);
}
