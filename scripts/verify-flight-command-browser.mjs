import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 1440, height: 900 },
});
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.click("#sandbox-start");
await page.click("#demos-btn");
await page.click('[data-demo="mission"]');

await page.click("#tools-btn");
await page.click("#wasm-btn");
await page.waitForFunction(() =>
  document
    .querySelector("#script-trust-status")
    ?.textContent.includes("AUDITED BUILT-IN"),
);
const visibleSource = await page.locator("#wasm-source").inputValue();
await page.click("#close-wasm");

const remote = page.locator(".remote-console"),
  arm = page.locator('.command-toggle[data-index="0"]'),
  throttle = page.locator('.command-range[data-index="2"]');
if (!(await remote.isVisible())) await page.click("#remote-btn");
await remote.waitFor({ state: "visible" });
await arm.click();
await throttle.evaluate((input) => {
  input.value = "0.8";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click('[data-mode="test"]');
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running,
);

const launch = page.locator('.command-hold[data-index="1"]');
await launch.dispatchEvent("pointerdown");
await page.evaluate(() => window.advanceTime(80));
await launch.dispatchEvent("pointerup");
await page.waitForTimeout(220);
await page.evaluate(() => window.advanceTime(1_200));

const state = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ),
  systems = state.architecture.session.systems,
  controller = systems.controllers.runtimes.find(
    (runtime) => runtime.language === "typescript",
  ),
  propulsion = systems.propulsion.engines,
  mainPropulsion = propulsion.find(
    (record) =>
      state.parts.find((part) => part.id === record.partId)?.type !== "rcs",
  ),
  transversePropulsion = propulsion.filter(
    (record) =>
      state.parts.find((part) => part.id === record.partId)?.type === "rcs",
  ),
  controlByLabel = new Map(
    state.remote.controls.map((control) => [control.label, control]),
  ),
  receiverByPart = new Map(
    systems.commandReceivers.states.map((receiver) => [
      receiver.partId,
      receiver,
    ]),
  ),
  armReceiver = receiverByPart.get(controlByLabel.get("Arm vehicle").targetId),
  throttleReceiver = receiverByPart.get(
    controlByLabel.get("Main throttle").targetId,
  );

await page.screenshot({
  path: "artifacts/flight-runtime/mission-endpoint-control.png",
  fullPage: true,
});
console.log(
  JSON.stringify(
    {
      controller: {
        controllerId: controller?.controllerId,
        language: controller?.language,
        powered: controller?.powered,
        ready: controller?.ready,
        commands: controller?.commands,
      },
      mainPropulsion,
      transversePropulsion: transversePropulsion.map((record) => ({
        partId: record.partId,
        throttle: record.throttle,
        commandSource: record.commandSource,
        deliveredMassFlowKgS: record.deliveredMassFlowKgS,
      })),
      armReceiver,
      throttleReceiver,
      flight: {
        position: systems.flight.pose.position,
        velocity: systems.flight.velocity,
        propulsionActive: systems.flight.propulsionActive,
      },
      script: {
        status: state.script.status,
        sampleCount: state.script.debug.sampleCount,
        latest: state.script.debug.latest,
      },
      visibleSource: visibleSource.slice(0, 180),
      errors,
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  assert.match(visibleSource, /pilot\.arm/);
  assert.match(visibleSource, /rcs\.0\.throttle/);
  assert.ok(controller?.ready, "orbital controller was not ready");
  assert.equal(controller.language, "typescript");
  assert.ok(
    Number(controller.commands["engine.throttle"] || 0) >= 0.79,
    "arm/launch/throttle receivers did not produce main-engine command",
  );
  assert.ok(
    mainPropulsion &&
      mainPropulsion.commandSource === "script" &&
      mainPropulsion.targetThrottle >= 0.79 &&
      mainPropulsion.deliveredMassFlowKgS > 0,
    "main-engine material-backed thrust was not traced to the visible controller",
  );
  assert.equal(
    transversePropulsion.length,
    4,
    "orbital controller did not address all four physical RCS pods",
  );
  assert.ok(
    transversePropulsion.every((record) => record.commandSource === "script"),
    "an RCS request bypassed the visible controller",
  );
  assert.equal(armReceiver?.valid, true);
  assert.equal(armReceiver?.value, 1);
  assert.equal(throttleReceiver?.valid, true);
  assert.ok(Math.abs(throttleReceiver.value - 0.8) < 1e-6);
  assert.ok(
    systems.flight.velocity.y > 0,
    "scripted main-engine command did not produce upward motion",
  );
  assert.ok(
    state.script.debug.sampleCount > 0,
    "orbital controller trace did not record completed sensor/command steps",
  );
  assert.ok(
    state.parts.every((part) => !part.aerothermal?.detached),
    "orbital command transition detached a component",
  );
  assertNoErrors(errors, "orbital endpoint command browser flow");
});
