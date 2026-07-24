import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import {
  createBrowserTest,
  createInstrumentedPage,
} from "./lib/browser-test.mjs";
import { installRenderedVisibilityContract } from "./lib/rendered-visibility.mjs";
import {
  prepareUiBaselineFixture,
  UI_BASELINE_FIXTURES,
} from "./lib/ui-baseline-fixtures.mjs";

const { browser, baseUrl } = await createBrowserTest({ page: false });
try {
  const requested = process.env.UI_FIXTURE_FILTER?.split(",").filter(Boolean),
    fixtures = Object.entries(UI_BASELINE_FIXTURES).filter(
      ([id]) => !requested?.length || requested.includes(id),
    );
  for (const [id, definition] of fixtures) {
    const { page, errors } = await createInstrumentedPage(browser, {
      viewport: { width: 1280, height: 720 },
    });
    await installRenderedVisibilityContract(page);
    const fixture = await prepareUiBaselineFixture(page, baseUrl, id),
      presentation = fixture.state.presentation,
      visibleSpecialists = [
        "remote",
        "learn",
        "environment",
        "script",
        "testReserve",
        "mechanismLab",
        "failureAnalysis",
      ].filter((name) => presentation.surfaces[name]);
    assert.equal(
      fixture.welcome.visible,
      true,
      `${id} skipped current first launch`,
    );
    assert.equal(
      fixture.welcome.focus,
      "guided-start",
      `${id} changed first-launch focus`,
    );
    assert.equal(
      presentation.mode,
      definition.mode,
      `${id} has the wrong mode`,
    );
    if (id === "f1-clean") {
      assert.equal(fixture.state.parts.length, 0, "F1 is not an empty Sandbox");
      assert.equal(
        fixture.state.connections.length,
        0,
        "F1 retained connections",
      );
    }
    if (id === "f2-gearbox-build") {
      assert.equal(fixture.state.demo.kind, "gearbox");
      assert.equal(fixture.state.selectedEntity.kind, "part");
      assert.equal(presentation.surfaces.remote, false);
    }
    if (id === "f3-gearbox-connect") {
      assert.deepEqual(fixture.state.selectedEntity, {
        kind: "port",
        partId: fixture.state.parts.find((part) => part.type === "motor").id,
        port: "SHAFT",
      });
    }
    if (id === "f4-rover-operate") {
      assert.equal(fixture.state.demo.kind, "cart");
      assert.equal(fixture.state.running, true);
      assert.equal(presentation.surfaces.directControl, true);
      assert.equal(presentation.surfaces.remote, false);
    }
    if (id === "f5-challenge") {
      assert.equal(fixture.state.challenge.id, "cargo-relay");
      assert.equal(fixture.state.challenge.startMode, "current");
      assert.equal(presentation.surfaces.challenge, true);
    }
    if (id === "f6-dense-specialist") {
      assert.equal(fixture.state.selectedEntity.kind, "part");
      assert.equal(presentation.surfaces.mechanismLab, true);
      assert.equal(
        presentation.surfaces.outliner,
        true,
        "F6 specialist workspace removed exact keyboard entity navigation",
      );
      assert.deepEqual(visibleSpecialists, ["mechanismLab"]);
    }
    assertNoErrors(errors, id);
    await page.close();
  }
  console.log(
    `${fixtures.length} current-schema UI baseline fixture${fixtures.length === 1 ? "" : "s"} passed`,
  );
} finally {
  await closeBrowser(browser);
}
