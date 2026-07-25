import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { prepareUiBaselineFixture } from "./lib/ui-baseline-fixtures.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1280, height: 720 },
});

try {
  await prepareUiBaselineFixture(page, baseUrl, "f4-rover-operate");
  await page.locator("#run-btn").click();
  await page.waitForFunction(
    () => !JSON.parse(window.render_game_to_text()).running,
  );
  const rover = await page.evaluate(() =>
      JSON.parse(window.render_game_to_text()),
    ),
    boundEndpointId = rover.parts
      .filter(({ type }) => type === "computer")
      .flatMap(({ authored }) => authored.controllerBindings || [])
      .find(({ endpointPartId }) =>
        rover.parts.some(({ id }) => id === endpointPartId),
      )?.endpointPartId;
  assert.ok(boundEndpointId, "rover fixture has no bound component endpoint");
  const boundEndpoint = page.locator(
    `[data-outliner-part="${boundEndpointId}"]`,
  );
  await boundEndpoint.focus();
  await page.keyboard.press("Enter");
  await page.waitForFunction((partId) => {
    const current = JSON.parse(window.render_game_to_text());
    return (
      current.selectedPart === partId &&
      current.componentInspection.commands[0].scope.impact
        .externalControllerBindingCount > 0
    );
  }, boundEndpointId);
  const boundSelection = await page.evaluate(() =>
      JSON.parse(window.render_game_to_text()),
    ),
    bindingsBeforeDelete = boundSelection.parts
      .filter(({ type }) => type === "computer")
      .flatMap(({ id, authored }) =>
        (authored.controllerBindings || []).map((binding) => ({
          controllerId: id,
          ...binding,
        })),
      ),
    reportedBindingImpact =
      boundSelection.componentInspection.commands[0].scope.impact
        .externalControllerBindingCount;
  assert.equal(
    bindingsBeforeDelete.filter(
      ({ endpointPartId }) => endpointPartId === boundEndpointId,
    ).length,
    reportedBindingImpact,
    "reported controller-binding impact was not exact",
  );
  await page.locator("#delete-part").click();
  await page.waitForFunction(
    (removedId) =>
      !JSON.parse(window.render_game_to_text()).parts.some(
        ({ id }) => id === removedId,
      ),
    boundEndpointId,
  );
  const afterDelete = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  );
  assert.ok(
    afterDelete.parts
      .filter(({ type }) => type === "computer")
      .flatMap(({ authored }) => authored.controllerBindings || [])
      .every(({ endpointPartId }) => endpointPartId !== boundEndpointId),
    "delete left a controller binding aimed at the removed component",
  );
  await page.locator("#undo-tool").click();
  await page.waitForFunction(
    (restoredId) =>
      JSON.parse(window.render_game_to_text()).parts.some(
        ({ id }) => id === restoredId,
      ),
    boundEndpointId,
  );
  const afterUndo = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  );
  assert.deepEqual(
    afterUndo.parts
      .filter(({ type }) => type === "computer")
      .flatMap(({ id, authored }) =>
        (authored.controllerBindings || []).map((binding) => ({
          controllerId: id,
          ...binding,
        })),
      ),
    bindingsBeforeDelete,
    "undo did not restore the controller bindings removed by delete",
  );
  assertNoErrors(errors, "component selection delete browser");
  console.log(
    "component selection delete passed (exact binding impact, cleanup, undo)",
  );
} finally {
  await closeBrowser(browser);
}
