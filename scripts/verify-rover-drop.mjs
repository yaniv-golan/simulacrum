import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest();
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
await page.click("#run-btn");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running,
);
await page.waitForTimeout(200);
await page.locator("canvas").focus();
await page.evaluate(() =>
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "w", code: "KeyW" }),
  ),
);

const samples = [];
let landedAtS = null,
  failureIds = [];
// Exercise the player-visible contract: hold full forward input beyond the
// finite platform edge, then brake only after every wheel is supported by field
// terrain. Sampling continues through the complete landing instead of accepting
// the first on-field wheel as proof that the rover survived.
for (let step = 0; step < 60; step++) {
  const advanceMs = 250;
  await page.evaluate(
    (milliseconds) => window.advanceTime(milliseconds),
    advanceMs,
  );
  const state = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  );
  const physics = state.demo.mobility?.physics;
  samples.push({
    timeS: state.simulationTime,
    mission: state.mission,
    position: state.demo.position,
    speed: state.demo.mobility?.signedSpeed,
    physics,
    tireDeflectionM: state.parts
      .filter((part) => part.type === "wheel")
      .map((part) => part.tireDeflectionM),
    failed: state.connections.filter((connection) => connection.failed),
    maximumConnection: state.connections
      .map((connection) => ({
        id: connection.id,
        a: connection.a,
        b: connection.b,
        stress: connection.stress || 0,
        forceUtilization: connection.forceUtilization || 0,
        torqueUtilization: connection.torqueUtilization || 0,
        peakLoadN: connection.peakLoadN || 0,
        peakTorqueNm: connection.peakTorqueNm || 0,
        fatigue: connection.fatigue || 0,
      }))
      .sort((left, right) => right.stress - left.stress)[0],
    maximumFatigue: Math.max(
      0,
      ...state.connections.map((connection) => connection.fatigue || 0),
    ),
    detached: state.parts
      .filter((part) => part.aerothermal?.detached)
      .map((part) => ({ id: part.id, type: part.type })),
  });
  failureIds = state.connections
    .filter((connection) => connection.failed)
    .map((connection) => connection.id);
  if (
    landedAtS == null &&
    physics?.onField &&
    !physics.onPlatform &&
    physics.wheelContacts === 4
  ) {
    landedAtS = state.simulationTime;
    await page.evaluate(() =>
      [
        new KeyboardEvent("keyup", { key: "w", code: "KeyW" }),
        new KeyboardEvent("keydown", { key: " ", code: "Space" }),
      ].forEach((event) => window.dispatchEvent(event)),
    );
  }
  if (
    failureIds.length > 0 ||
    (landedAtS != null && state.simulationTime - landedAtS >= 3)
  )
    break;
}
await page.evaluate(() =>
  [
    new KeyboardEvent("keyup", { key: "w", code: "KeyW" }),
    new KeyboardEvent("keyup", { key: " ", code: "Space" }),
  ].forEach((event) => window.dispatchEvent(event)),
);
for (const selector of ["#close-remote", "#close-inspect"]) {
  const element = page.locator(selector);
  if (!(await element.count())) continue;
  const isInViewport = await element.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.right > 0 &&
      rect.bottom > 0 &&
      rect.left < window.innerWidth &&
      rect.top < window.innerHeight
    );
  });
  if (isInViewport) await element.click();
}
await page.waitForTimeout(200);
await page.screenshot({ path: "artifacts/rover-drop-fixed.png" });
console.log(
  JSON.stringify(
    {
      sampleCount: samples.length,
      landedAtS,
      finalPosition: samples.at(-1)?.position,
      maximumStress: Math.max(
        0,
        ...samples.map((sample) => sample.maximumConnection?.stress || 0),
      ),
      maximumFatigue: Math.max(
        0,
        ...samples.map((sample) => sample.maximumFatigue),
      ),
      maximumTireDeflectionM: Math.max(
        0,
        ...samples.flatMap((sample) => sample.tireDeflectionM),
      ),
      failureIds,
      errors,
    },
    null,
    2,
  ),
);
await conclude(browser, () => {
  assert.ok(samples.length >= 4, "rover drop produced insufficient telemetry");
  assert.ok(
    samples.some((sample) => sample.physics?.onField),
    "rover never reached field terrain",
  );
  assert.ok(
    samples.some(
      (sample) =>
        sample.physics?.onField &&
        !sample.physics.onPlatform &&
        sample.physics.wheelContacts === 4,
    ),
    "rover never completed four-wheel field contact beyond the egress",
  );
  assert.ok(
    samples.some((sample) => sample.speed > 1),
    "forward keyboard input never produced positive forward speed",
  );
  assert.ok(
    failureIds.length === 0 &&
      samples.every((sample) => sample.failed.length === 0),
    `ordinary platform drop broke attachments: ${failureIds.join(", ")}`,
  );
  assert.ok(
    samples.every((sample) => sample.detached.length === 0),
    "ordinary platform drop detached parts",
  );
  assert.equal(
    Math.max(0, ...samples.map((sample) => sample.maximumFatigue)),
    0,
    "ordinary platform drop accumulated structural fatigue",
  );
  assert.ok(
    Math.max(0, ...samples.flatMap((sample) => sample.tireDeflectionM)) <=
      0.145 + 1e-9,
    "ordinary platform drop exceeded the authored Wheel carcass stroke",
  );
  assertNoErrors(errors, "rover drop");
});
