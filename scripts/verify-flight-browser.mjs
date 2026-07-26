import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
    viewport: { width: 1440, height: 900 },
  }),
  pitchCommand = Number(process.env.SIM_PITCH ?? 0.25),
  sampleCount = Number(process.env.SIM_SAMPLES ?? 20),
  sampleStepMs = Number(process.env.SIM_STEP_MS ?? 250);
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.click("#sandbox-start");
await page.click("#demos-btn");
await page.click('[data-demo="drone"]');
await page.click("#tools-btn");
await page.click("#wasm-btn");
await page.waitForFunction(() =>
  document
    .querySelector("#script-trust-status")
    ?.textContent.includes("AUDITED BUILT-IN"),
);
const visibleSource = await page.locator("#wasm-source").inputValue();
await page.click("#close-wasm");
await page.locator('.direct-range[data-index="0"]').evaluate((input) => {
  input.value = "0.72";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.locator('.direct-range[data-index="2"]').evaluate((input, value) => {
  input.value = String(value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}, pitchCommand);
await page.click('[data-mode="test"]');
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running,
);
const samples = await page.evaluate(
  ({ sampleCount, sampleStepMs }) => {
    const observations = [];
    for (let index = 1; index <= sampleCount; index++) {
      window.advanceTime(sampleStepMs);
      const drone = JSON.parse(window.render_game_to_text()).demo.drone;
      const architecture = JSON.parse(window.render_game_to_text()).architecture
          .session.systems,
        controller = architecture.controllers?.runtimes?.find(
          (runtime) => runtime.language === "typescript",
        );
      observations.push({
        timeS: (index * sampleStepMs) / 1000,
        altitudeM: drone.altitude,
        attitudeDeg: drone.attitudeDeg,
        angularRateRadS: drone.angularRateRadS,
        motorThrustsN: drone.motorThrustsN,
        controllerCommands: controller?.commands || {},
        propulsion: (architecture.propulsion?.engines || []).map((record) => ({
          partId: record.partId,
          motorPartId: record.motorPartId,
          powerSourceIds: record.powerSourceIds,
          commandSource: record.commandSource,
          allocationId: record.allocationId,
          rpm: record.rpm,
          reactionTorqueNm: record.reactionTorqueNm,
          thrustN: record.thrustN,
          tipMach: record.tipMach,
        })),
      });
    }
    return observations;
  },
  { sampleCount, sampleStepMs },
);
const state = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.screenshot({
  path: "artifacts/flight-runtime/drone-controlled-flight.png",
  fullPage: true,
});

await page.locator("#run-btn").evaluate((element) => element.click());
await page.waitForFunction(
  () => !JSON.parse(window.render_game_to_text()).running,
);
await page.click("#demos-btn");
await page.click('[data-demo="drone"]');
await page.locator('.direct-range[data-index="0"]').evaluate((input) => {
  input.value = "1";
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.click('[data-mode="test"]');
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running,
);
const maxCollectiveSamples = await page.evaluate(() => {
  const observations = [];
  for (let index = 1; index <= 14; index++) {
    window.advanceTime(500);
    const state = JSON.parse(window.render_game_to_text()),
      systems = state.architecture.session.systems;
    observations.push({
      timeS: index * 0.5,
      altitudeM: state.demo.drone.altitude,
      verticalSpeedMps: systems.flight.velocity.y,
      attitudeDeg: state.demo.drone.attitudeDeg,
      propulsion: (systems.propulsion?.engines || []).map((record) => ({
        rpm: record.rpm,
        thrustN: record.thrustN,
        valid: record.valid,
        validity: record.validity,
      })),
      failedCount: systems.structures?.failedCount || 0,
      failedConnections: state.connections
        .filter((connection) => connection.failed)
        .map((connection) => connection.id),
    });
  }
  return observations;
});
const maxCollectiveState = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.screenshot({
  path: "artifacts/flight-runtime/drone-max-collective-stable.png",
  fullPage: true,
});
console.log(
  JSON.stringify(
    {
      drone: state.demo.drone,
      samples,
      maxCollective: {
        drone: maxCollectiveState.demo.drone,
        samples: maxCollectiveSamples,
      },
      flightStatus: state.mission,
      visibleSource,
      errors,
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  for (const removedField of [
    "launched",
    "flightStarted",
    "multirotor",
    "status",
    "statusDetail",
  ])
    assert.equal(
      removedField in state.architecture.session.systems.flight,
      false,
      `completed physical telemetry restored presentation field ${removedField}`,
    );
  assert.equal(
    state.architecture.session?.systems.flight?.active,
    true,
    "flight runtime did not publish telemetry",
  );
  assert.equal(
    state.demo.drone?.stabilizerReady,
    true,
    "drone control topology is offline",
  );
  assert.ok(
    state.demo.drone.altitude > 1,
    "drone did not produce physical lift",
  );
  assert.ok(
    samples.some(
      ({ controllerCommands }) =>
        Math.abs(
          Number(controllerCommands["motor.0.throttle"] || 0) -
            Number(controllerCommands["motor.2.throttle"] || 0),
        ) > 0.005,
    ),
    "pitch receiver did not produce distinct endpoint engine commands",
  );
  assert.ok(
    samples.some(({ propulsion }) =>
      propulsion.every(
        (record) =>
          record.commandSource === "script" &&
          typeof record.allocationId === "string" &&
          Number.isFinite(record.motorPartId) &&
          record.powerSourceIds.length === 1 &&
          Number.isFinite(record.rpm) &&
          Number.isFinite(record.reactionTorqueNm),
      ),
    ),
    "drone forces were not traced through controller-owned electrical allocations and physical shafts",
  );
  assert.ok(
    Object.values(state.demo.drone.attitudeDeg).every(Number.isFinite),
    "drone attitude became non-finite",
  );
  assert.ok(
    Math.abs(state.demo.drone.attitudeDeg.roll) < 8,
    `drone lost roll balance: ${state.demo.drone.attitudeDeg.roll}°`,
  );
  assert.ok(
    maxCollectiveSamples.some(({ altitudeM }) => altitudeM > 1),
    "maximum collective did not produce physical lift",
  );
  assert.ok(
    maxCollectiveSamples.every(({ attitudeDeg }) =>
      Object.values(attitudeDeg).every(Number.isFinite),
    ),
    "maximum collective produced a non-finite attitude",
  );
  assert.ok(
    Math.max(
      ...maxCollectiveSamples.map(({ attitudeDeg }) =>
        Math.abs(attitudeDeg.pitch),
      ),
    ) < 15,
    `maximum collective lost pitch control: ${JSON.stringify(maxCollectiveSamples.map(({ timeS, attitudeDeg }) => ({ timeS, pitch: attitudeDeg.pitch })))}`,
  );
  assert.ok(
    Math.max(
      ...maxCollectiveSamples.map(({ attitudeDeg }) =>
        Math.abs(attitudeDeg.roll),
      ),
    ) < 15,
    `maximum collective lost roll control: ${JSON.stringify(maxCollectiveSamples.map(({ timeS, attitudeDeg }) => ({ timeS, roll: attitudeDeg.roll })))}`,
  );
  assert.ok(
    maxCollectiveSamples.every(({ propulsion }) =>
      propulsion.every(
        (record) =>
          record.valid !== false &&
          Number.isFinite(record.rpm) &&
          Number.isFinite(record.thrustN),
      ),
    ),
    "maximum collective invalidated a rotor",
  );
  assert.ok(
    maxCollectiveSamples.every(
      ({ failedCount, failedConnections }) =>
        failedCount === 0 && failedConnections.length === 0,
    ),
    "maximum collective caused structural failure",
  );
  assert.match(
    visibleSource,
    /motor\.0\.throttle/,
    "drone controller source was not visible and editable",
  );
  assertNoErrors(errors, "flight browser runtime");
});
