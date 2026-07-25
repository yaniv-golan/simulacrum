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
    ),
    state = fixture.state,
    inspection = state.componentInspection,
    dom = await page.evaluate(() => ({
      version:
        document.querySelector(".inspector-content")?.dataset.inspectionVersion,
      subtitle: document.querySelector(".inspect-title small")?.textContent,
      name: document.querySelector("#inspect-name")?.textContent,
      status: document.querySelector(".status")?.textContent,
      warning: document.querySelector(".status")?.classList.contains("warning"),
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
    ],
  );
  assert.ok(
    inspection.relationships.connections.length > 0,
    "selected motor has no direct authored relationships",
  );
  assert.ok(
    inspection.ports.some(({ status }) => status === "connected"),
    "selected motor ports do not expose their direct counterpart",
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
    runningInspection.commands.every(
      ({ availability, disabledReason }) =>
        availability === "disabled" && /Stop simulation/.test(disabledReason),
    ),
    "selected-context authoring commands remained available while running",
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
