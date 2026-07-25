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
      }, value),
  key = (type, code, value) =>
    page.evaluate(
      ({ eventType, eventCode, eventKey }) =>
        window.dispatchEvent(
          new KeyboardEvent(eventType, { code: eventCode, key: eventKey }),
        ),
      { eventType: type, eventCode: code, eventKey: value },
    );

await page.goto(baseUrl, { waitUntil: "networkidle" });
await page.waitForFunction(() => typeof window.advanceTime === "function");
await page.click("#sandbox-start");
await page.locator(".welcome").waitFor({ state: "detached" });
await page.evaluate(() => {
  const wind = document.querySelector("#wind-enabled");
  if (wind?.checked) wind.click();
});
await page.click("#demos-btn");
await page.click('[data-demo="cart"]');
await page.locator('.command-range[data-index="0"]').waitFor();
await page.click("#run-btn");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running,
);
await page.locator("canvas").focus();
await setRange(0, -0.25);

const samples = [];
let edgeDeparture = null;
for (let step = 0; step < 140; step++) {
  await page.evaluate(() => window.advanceTime(250));
  const state = await readState(),
    sample = {
      timeS: state.simulationTime,
      position: state.demo.position,
      speed: state.demo.mobility?.signedSpeed,
      physics: state.demo.mobility?.physics,
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
  if (!edgeDeparture && sample.position.z >= 24) {
    edgeDeparture = sample;
    await setRange(0, 0);
    await key("keydown", "Space", " ");
  }
  if (edgeDeparture && sample.timeS >= edgeDeparture.timeS + 4) break;
  if (sample.failedIds.length || sample.detachedPartIds.length) break;
}
await setRange(0, 0);
await key("keyup", "Space", " ");
const settled = await readState(),
  afterDeparture = edgeDeparture
    ? samples.filter(({ timeS }) => timeS >= edgeDeparture.timeS)
    : [];

await page.screenshot({ path: "artifacts/rover-raw-edge-landing.png" });
console.log(
  JSON.stringify(
    {
      edgeDeparture,
      minimumChassisY: Math.min(
        ...afterDeparture.map(({ position }) => position.y),
      ),
      settledPosition: settled.demo.position,
      settledSpeed: settled.demo.mobility?.signedSpeed,
      settledPhysics: settled.demo.mobility?.physics,
      maximumStress: Math.max(
        0,
        ...samples.map((sample) => sample.maximumStress),
      ),
      maximumFatigue: Math.max(
        0,
        ...samples.map((sample) => sample.maximumFatigue),
      ),
      failures: samples.flatMap(({ failedIds }) => failedIds),
      detachedParts: samples.flatMap(({ detachedPartIds }) => detachedPartIds),
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  assert.ok(edgeDeparture, "rover never departed over the north workshop edge");
  assert.ok(
    Math.abs(edgeDeparture.position.x) < 10,
    "rover used the south apron ramp instead of a raw workshop edge",
  );
  assert.ok(
    Math.min(...afterDeparture.map(({ position }) => position.y)) < 1.1,
    "rover did not complete the vertical drop from the raw workshop edge",
  );
  assert.ok(
    samples.every(
      ({ failedIds, detachedPartIds }) =>
        failedIds.length === 0 && detachedPartIds.length === 0,
    ),
    "ordinary rover broke or detached parts during the raw-edge landing",
  );
  assert.ok(
    Math.max(0, ...samples.map(({ maximumStress }) => maximumStress)) <= 0.8,
    "controlled raw-edge landing exceeded the ordinary structural envelope",
  );
  assert.ok(
    Math.max(0, ...samples.map(({ maximumFatigue }) => maximumFatigue)) <= 1e-4,
    "controlled raw-edge landing accumulated structural fatigue",
  );
  assert.ok(
    settled.demo.position.z > 24,
    "rover rolled back onto the workshop after the raw-edge landing",
  );
  assert.equal(
    settled.demo.mobility?.physics?.wheelContacts,
    4,
    "rover did not settle on all four wheels after the raw-edge landing",
  );
  assert.ok(
    Math.abs(settled.demo.mobility?.signedSpeed || 0) < 0.2,
    "rover did not settle after braking beyond the raw workshop edge",
  );
  assertNoErrors(errors, "rover raw-edge landing");
});
