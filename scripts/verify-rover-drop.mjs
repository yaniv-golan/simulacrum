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
await page.evaluate(() =>
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "w", code: "KeyW" }),
  ),
);

const samples = [];
let previousSurface = "platform";
// Prove the keyboard path, then continue at a controlled cruise speed for the
// plate-to-field landing. The separate hard-impact suite owns destructive
// obstacle-speed impacts.
for (let step = 0; step < 48; step++) {
  if (step > 0)
    await page.evaluate(
      (powered) => {
        window.dispatchEvent(
          new KeyboardEvent(powered ? "keydown" : "keyup", {
            key: "w",
            code: "KeyW",
          }),
        );
      },
      step % 3 === 1,
    );
  await page.evaluate(() => window.advanceTime(250));
  const state = await page.evaluate(() =>
    JSON.parse(window.render_game_to_text()),
  );
  const physics = state.demo.mobility?.physics;
  if (physics?.surface !== previousSurface || step % 4 === 0) {
    samples.push({
      timeS: state.simulationTime,
      mission: state.mission,
      position: state.demo.position,
      speed: state.demo.mobility?.signedSpeed,
      throttle: state.directSurface?.controls?.find(
        (control) => control.channel === "throttle",
      )?.value,
      wheelDrive: state.architecture?.session?.systems?.wheels,
      physics,
      tireDeflectionM: state.parts
        .filter((part) => part.type === "wheel")
        .map((part) => part.tireDeflectionM),
      failed: state.connections.filter((connection) => connection.failed),
      detached: state.parts
        .filter((part) => part.aerothermal?.detached)
        .map((part) => ({ id: part.id, type: part.type })),
    });
  }
  previousSurface = physics?.surface;
  if (physics?.onField) break;
  if (step === 0)
    await page.evaluate(() =>
      window.dispatchEvent(
        new KeyboardEvent("keyup", { key: "w", code: "KeyW" }),
      ),
    );
}
await page.evaluate(() =>
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "w", code: "KeyW" })),
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
console.log(JSON.stringify({ samples, errors }, null, 2));
await conclude(browser, () => {
  assert.ok(samples.length >= 4, "rover drop produced insufficient telemetry");
  assert.ok(
    samples.some((sample) => sample.physics?.onField),
    "rover never reached field terrain",
  );
  assert.ok(
    samples.some((sample) => sample.speed > 1),
    "forward keyboard input never produced positive forward speed",
  );
  assert.ok(
    samples.every((sample) => sample.failed.length === 0),
    "normal plate exit broke attachments",
  );
  assertNoErrors(errors, "rover drop");
});
