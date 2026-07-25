import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest(),
  readState = () =>
    page.evaluate(() => JSON.parse(window.render_game_to_text())),
  setRange = (index, value) =>
    page
      .locator(`.command-range[data-index="${index}"]`)
      .evaluate((input, nextValue) => {
        input.value = String(nextValue);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, value);

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForFunction(() => typeof window.advanceTime === "function");
await page.click("#sandbox-start");
await page.locator(".welcome").waitFor({ state: "detached" });
await page.evaluate(() => {
  const wind = document.querySelector("#wind-enabled");
  if (wind?.checked) wind.click();
});

async function loadRover() {
  const running = (await readState()).running;
  if (running) await page.click("#run-btn");
  await page.click("#demos-btn");
  await page.click('[data-demo="cart"]');
  await page.locator('.command-range[data-index="0"]').waitFor();
  await page.click("#run-btn");
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running,
  );
}

async function runEgress({ id, throttle, maximumDurationS }) {
  await loadRover();
  await setRange(0, throttle);
  const samples = [];
  let completedAtS = null,
    fieldEntry = null;
  for (let step = 0; step < maximumDurationS * 2; step++) {
    await page.evaluate(() => window.advanceTime(500));
    const state = await readState(),
      physics = state.demo.mobility?.physics,
      sample = {
        timeS: state.simulationTime,
        position: state.demo.position,
        speed: state.demo.mobility?.signedSpeed,
        physics,
        failedIds: state.connections
          .filter((connection) => connection.failed)
          .map((connection) => connection.id),
        detachedPartIds: state.parts
          .filter((part) => part.aerothermal?.detached)
          .map((part) => part.id),
        maximumStress: Math.max(
          0,
          ...state.connections.map((connection) => connection.stress || 0),
        ),
        maximumFatigue: Math.max(
          0,
          ...state.connections.map((connection) => connection.fatigue || 0),
        ),
      };
    samples.push(sample);
    if (sample.failedIds.length || sample.detachedPartIds.length) break;
    if (!fieldEntry && sample.position.z <= -48 && physics?.onField)
      fieldEntry = { timeS: state.simulationTime, z: sample.position.z };
    if (fieldEntry && state.simulationTime >= fieldEntry.timeS + 2) {
      completedAtS = state.simulationTime;
      break;
    }
  }

  await setRange(0, 0);
  await page.locator("canvas").focus();
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: " ", code: "Space" }),
    ),
  );
  await page.evaluate(() => window.advanceTime(1500));
  await page.evaluate(() =>
    window.dispatchEvent(
      new KeyboardEvent("keyup", { key: " ", code: "Space" }),
    ),
  );
  const settled = await readState(),
    transitionSamples = samples.filter(
      ({ position }) => position.z <= -18 && position.z >= -48,
    );
  return {
    id,
    throttle,
    completedAtS,
    fieldEntry,
    postFieldDistanceM: fieldEntry
      ? fieldEntry.z - samples.at(-1).position.z
      : 0,
    samples,
    settled,
    minimumTransitionWheelContacts: Math.min(
      4,
      ...transitionSamples.map(({ physics }) => physics?.wheelContacts ?? 0),
    ),
    maximumStress: Math.max(
      0,
      ...samples.map((sample) => sample.maximumStress),
    ),
    maximumFatigue: Math.max(
      0,
      ...samples.map((sample) => sample.maximumFatigue),
    ),
  };
}

const scenarioSpecs = [
    { id: "slow-crawl", throttle: 0.25, maximumDurationS: 45 },
    { id: "fast-drive", throttle: 1, maximumDurationS: 18 },
  ],
  scenarios = [];
for (const scenario of scenarioSpecs) scenarios.push(await runEgress(scenario));

await page.screenshot({ path: "artifacts/rover-apron-egress.png" });
console.log(
  JSON.stringify(
    scenarios.map((scenario) => ({
      id: scenario.id,
      throttle: scenario.throttle,
      completedAtS: scenario.completedAtS,
      fieldEntry: scenario.fieldEntry,
      postFieldDistanceM: scenario.postFieldDistanceM,
      sampleCount: scenario.samples.length,
      finalPosition: scenario.settled.demo.position,
      finalSpeed: scenario.settled.demo.mobility?.signedSpeed,
      finalPhysics: scenario.settled.demo.mobility?.physics,
      minimumTransitionWheelContacts: scenario.minimumTransitionWheelContacts,
      maximumStress: scenario.maximumStress,
      maximumFatigue: scenario.maximumFatigue,
      failedIds: [
        ...new Set(scenario.samples.flatMap((sample) => sample.failedIds)),
      ],
      detachedPartIds: [
        ...new Set(
          scenario.samples.flatMap((sample) => sample.detachedPartIds),
        ),
      ],
    })),
    null,
    2,
  ),
);

await conclude(browser, () => {
  for (const scenario of scenarios) {
    assert.ok(
      scenario.completedAtS != null,
      `${scenario.id} rover never completed the workshop apron transition`,
    );
    assert.ok(
      scenario.minimumTransitionWheelContacts >= 1,
      `${scenario.id} rover was launched fully airborne by the workshop apron`,
    );
    assert.ok(
      scenario.postFieldDistanceM > 1,
      `${scenario.id} rover locked after reaching the Test Reserve heightfield`,
    );
    assert.ok(
      scenario.samples.every(
        ({ failedIds, detachedPartIds }) =>
          failedIds.length === 0 && detachedPartIds.length === 0,
      ),
      `${scenario.id} rover broke or detached parts during workshop egress`,
    );
    assert.ok(
      scenario.maximumFatigue <= 1e-4,
      `${scenario.id} rover accumulated material structural fatigue during workshop egress`,
    );
    assert.ok(
      scenario.settled.demo.position.z < -48,
      `${scenario.id} rover rolled back onto the workshop edge after braking`,
    );
    assert.equal(
      scenario.settled.demo.mobility?.physics?.wheelContacts,
      4,
      `${scenario.id} rover did not settle on all four wheels`,
    );
  }
  assertNoErrors(errors, "rover apron egress");
});
