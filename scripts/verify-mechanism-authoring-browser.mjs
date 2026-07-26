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

  const unitSelect = page.locator("#mechanism-display-units");
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
