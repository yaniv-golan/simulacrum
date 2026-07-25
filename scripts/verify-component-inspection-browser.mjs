import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { prepareUiBaselineFixture } from "./lib/ui-baseline-fixtures.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1280, height: 720 },
});

try {
  const fixture = await prepareUiBaselineFixture(
    page,
    baseUrl,
    "f2-gearbox-build",
  );
  let state = fixture.state;
  const inspection = state.componentInspection,
    dom = await page.evaluate(() => ({
      version:
        document.querySelector(".inspector-content")?.dataset.inspectionVersion,
      subtitle: document.querySelector(".inspect-title small")?.textContent,
      name: document.querySelector("#inspect-name")?.textContent,
      status: document.querySelector(".status")?.textContent,
      warning: document.querySelector(".status")?.classList.contains("warning"),
      impact: document.querySelector("#selection-impact")?.textContent,
      primaryControlHidden: document
        .querySelector(".primary-selection-control")
        ?.classList.contains("hidden"),
      frameShortcut: document
        .querySelector("#frame-selection")
        ?.getAttribute("aria-keyshortcuts"),
      layout: Object.fromEntries(
        [
          ["inspector", ".inspector"],
          ["outliner", ".assembly-outliner"],
          ["title", ".inspect-title"],
          ["frame", "#frame-selection"],
        ].map(([key, selector]) => {
          const rect = document
            .querySelector(selector)
            ?.getBoundingClientRect();
          return [
            key,
            rect
              ? { top: rect.top, bottom: rect.bottom, height: rect.height }
              : null,
          ];
        }),
      ),
    }));

  assert.equal(inspection.version, 1);
  assert.equal(inspection.source.phase, "authored");
  assert.equal(
    inspection.source.assemblyRevision,
    state.architecture.assemblyRevision,
  );
  assert.deepEqual(inspection.selection.selectedPartIds, state.selectedParts);
  assert.equal(inspection.selection.primaryPartId, state.selectedPart);
  assert.equal(dom.version, String(inspection.version));
  assert.equal(dom.subtitle, inspection.header.subtitle);
  assert.equal(dom.name, inspection.header.name);
  assert.equal(dom.status, inspection.status.label);
  assert.equal(dom.warning, inspection.status.warning);
  assert.match(dom.name, new RegExp(`#${state.selectedPart}$`));
  assert.equal(dom.primaryControlHidden, true);
  assert.match(dom.impact, /ACTION SCOPE · 1 COMPONENT/);
  assert.equal(dom.frameShortcut, "F");
  assert.ok(
    dom.layout.outliner.bottom <= dom.layout.title.top,
    "assembly tree overlapped the selected-component Inspector",
  );
  assert.ok(
    dom.layout.title.top >= dom.layout.inspector.top &&
      dom.layout.frame.bottom < dom.layout.inspector.bottom,
    "selected identity and view actions were pushed outside the laptop Inspector",
  );
  assert.equal(inspection.preflight.status, "passed");
  assert.deepEqual(
    inspection.preflight.checks.find(({ id }) => id === "runtime-outcome"),
    {
      id: "runtime-outcome",
      status: "not-checked",
      reason: "Simulation has not established a physical outcome.",
    },
  );
  assert.deepEqual(
    inspection.commands.map(({ id, keyboardActionId, availability }) => ({
      id,
      keyboardActionId,
      availability,
    })),
    [
      {
        id: "selection.duplicate",
        keyboardActionId: "selection.duplicate",
        availability: "available",
      },
      {
        id: "selection.mirror-x",
        keyboardActionId: "selection.mirror",
        availability: "available",
      },
      {
        id: "selection.remove",
        keyboardActionId: "selection.remove",
        availability: "available",
      },
      {
        id: "selection.frame",
        keyboardActionId: "selection.frame",
        availability: "available",
      },
      {
        id: "selection.isolate",
        keyboardActionId: null,
        availability: "available",
      },
      {
        id: "selection.show-all",
        keyboardActionId: null,
        availability: "disabled",
      },
    ],
  );
  const initialImpact = inspection.commands[0].scope.impact;
  assert.ok(
    initialImpact.externalConnectionCount > 0,
    "single-component action scope omitted direct external connections",
  );
  assert.match(
    await page.locator("#delete-part").getAttribute("aria-label"),
    new RegExp(`${initialImpact.externalConnectionCount} external connection`),
  );
  assert.ok(
    inspection.relationships.connections.length > 0,
    "selected motor has no direct authored relationships",
  );
  assert.ok(
    inspection.ports.some(({ status }) => status === "connected"),
    "selected motor ports do not expose their direct counterpart",
  );

  const authoredBeforeIsolation = {
      revision: state.architecture.assemblyRevision,
      partIds: state.parts.map(({ id }) => id),
      connectionIds: state.connections.map(({ id }) => id),
    },
    cameraBeforeIsolation = structuredClone(state.camera);
  await page.locator("#isolate-selection").click();
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).presentation.selectionVisibility
        .active,
  );
  const isolated = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  );
  assert.deepEqual(isolated.selectedParts, state.selectedParts);
  assert.deepEqual(
    isolated.presentation.selectionVisibility.isolatedPartIds,
    state.selectedParts,
  );
  assert.equal(
    isolated.presentation.selectionVisibility.hiddenPartIds.length,
    state.parts.length - state.selectedParts.length,
  );
  assert.equal(
    isolated.architecture.assemblyRevision,
    authoredBeforeIsolation.revision,
  );
  assert.deepEqual(
    isolated.parts.map(({ id }) => id),
    authoredBeforeIsolation.partIds,
  );
  assert.deepEqual(
    isolated.connections.map(({ id }) => id),
    authoredBeforeIsolation.connectionIds,
  );
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "show-all-components",
  );
  await page.keyboard.press("Enter");
  await page.waitForFunction(
    () =>
      !JSON.parse(window.render_game_to_text()).presentation.selectionVisibility
        .active,
  );
  const restored = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  );
  assert.deepEqual(restored.presentation.selectionVisibility.hiddenPartIds, []);
  assert.equal(restored.camera.distance, cameraBeforeIsolation.distance);
  assert.deepEqual(restored.camera.target, cameraBeforeIsolation.target);
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    "isolate-selection",
  );

  await page.locator("canvas").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.waitForFunction(() => {
    const state = JSON.parse(window.render_game_to_text());
    return state.selectedParts.length === state.parts.length;
  });
  const multi = await page.evaluate(() =>
      JSON.parse(window.render_game_to_text()),
    ),
    originalPrimary = multi.selectedPart,
    nextPrimary = multi.selectedParts.find((id) => id !== originalPrimary);
  assert.ok(nextPrimary, "fixture did not provide a second primary candidate");
  assert.equal(
    await page.locator(".primary-selection-control").isVisible(),
    true,
  );
  assert.equal(
    await page.locator("#primary-selection option").count(),
    multi.selectedParts.length,
  );
  await page.locator("#primary-selection").selectOption(String(nextPrimary));
  await page.waitForFunction(
    (partId) =>
      JSON.parse(window.render_game_to_text()).selectedPart === partId,
    nextPrimary,
  );
  const reprioritized = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  );
  assert.deepEqual(
    [...reprioritized.selectedParts].sort((a, b) => a - b),
    [...multi.selectedParts].sort((a, b) => a - b),
  );
  assert.equal(
    await page
      .locator(`[data-outliner-part="${nextPrimary}"]`)
      .getAttribute("aria-current"),
    "true",
  );
  assert.match(
    await page.locator(".selection-label b").innerText(),
    new RegExp(`PRIMARY .* #${nextPrimary}$`),
  );
  await page.locator("canvas").focus();
  await page.keyboard.press("f");
  await page.waitForFunction(
    () =>
      JSON.parse(window.render_game_to_text()).presentation.keyboard
        .lastResolution.actionId === "selection.frame",
  );
  assert.equal(
    (
      await page.evaluate(() => JSON.parse(window.render_game_to_text()))
    ).componentInspection.commands.find(({ id }) => id === "selection.frame")
      .scope.count,
    multi.selectedParts.length,
  );

  await page.locator("#run-btn").click();
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running,
  );
  await page.evaluate(() => window.advanceTime(100));
  const runningInspection = await page.evaluate(
    () => JSON.parse(window.render_game_to_text()).componentInspection,
  );
  assert.equal(runningInspection.source.phase, "live");
  assert.ok(runningInspection.source.runtimeEvidenceRevision > 0);
  assert.ok(
    runningInspection.commands
      .filter(({ editAction }) => editAction)
      .every(
        ({ availability, disabledReason }) =>
          availability === "disabled" && /Stop simulation/.test(disabledReason),
      ),
    "selected-context authoring commands remained available while running",
  );
  assert.ok(
    runningInspection.commands
      .filter(({ presentationAction }) => presentationAction)
      .some(
        ({ id, availability }) =>
          id === "selection.frame" && availability === "available",
      ),
    "presentation-only framing became unavailable while running",
  );
  assert.equal(
    (await page.evaluate(() => JSON.parse(window.render_game_to_text())))
      .presentation.selectionVisibility.active,
    false,
    "simulation start retained the presentation-only isolation filter",
  );
  assert.equal(
    await page.locator(".status").innerText(),
    runningInspection.status.label,
    "visible status and text read model diverged while running",
  );

  assertNoErrors(errors, "component inspection browser");
  console.log("component inspection DOM/text/runtime parity passed");
} finally {
  await closeBrowser(browser);
}
