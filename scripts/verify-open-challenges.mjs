import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { CHALLENGES } from "../src/application/content.js";

const { browser, page, errors, baseUrl } = await createBrowserTest();
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.click("#sandbox-start");
await page.click("#challenges-btn");
const browserState = {
  cards: await page.locator(".challenge-grid article").count(),
  openContracts: await page.locator(".challenge-grid .open-contract").count(),
  emptyActions: await page.locator('[data-start-mode="empty"]').count(),
  currentActions: await page.locator('[data-start-mode="current"]').count(),
  challengeIds: await page
    .locator("[data-challenge][data-start-mode]")
    .evaluateAll((elements) => [
      ...new Set(elements.map((element) => element.dataset.challenge)),
    ]),
  copy: await page.locator(".challenge-browser").innerText(),
};
await page.screenshot({ path: "artifacts/open-challenge-lab.png" });

await page.click('[data-challenge="cargo-relay"][data-start-mode="empty"]');
const emptyStart = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ),
  emptyHud = await page.locator(".challenge-hud").innerText();
await page.screenshot({ path: "artifacts/open-challenge-empty.png" });

await page.click("#demos-btn");
await page.click('[data-demo="cart"]');
const cartBuild = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.click("#challenges-btn");
await page.click('[data-challenge="cargo-relay"][data-start-mode="current"]');
assert.deepEqual(errors, [], "starting the current-build challenge failed");
const currentStart = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.click("#run-btn");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).running,
);
await page.evaluate(() => window.advanceTime(1200));
const running = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ),
  runningHud = await page.locator(".challenge-hud").innerText();
await page.screenshot({ path: "artifacts/open-challenge-running.png" });
await page.click("#run-btn");
await page.click("#challenge-retry");
const retried = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.setViewportSize({ width: 1024, height: 720 });
await page.waitForTimeout(150);
const compactHud = await page.locator(".challenge-hud").evaluate((element) => {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
  };
});
await page.screenshot({ path: "artifacts/open-challenge-compact.png" });
await page.click("#challenges-btn");
await page.click(
  '[data-challenge="power-transfer"][data-start-mode="reference"]',
);
const referenceStart = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
assert.notEqual(
  referenceStart.challenge,
  null,
  `reference challenge did not activate: ${errors.join(" | ")}`,
);
await page.click("#run-btn");
await page.waitForFunction(() => {
  const state = JSON.parse(window.render_game_to_text());
  return state.running && state.challenge !== null;
});
for (let segment = 0; segment < 8; segment++) {
  await page.evaluate(() => window.advanceTime(1200));
  if (
    await page.evaluate(
      () =>
        JSON.parse(window.render_game_to_text()).challenge.status ===
        "complete",
    )
  )
    break;
}
const calibration = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);

console.log(
  JSON.stringify(
    {
      browserState,
      emptyStart: {
        challenge: emptyStart.challenge,
        parts: emptyStart.parts.map((part) => part.type),
        demo: emptyStart.demo.kind,
        hud: emptyHud,
      },
      currentStart: {
        challenge: currentStart.challenge,
        parts: currentStart.parts.length,
        connections: currentStart.connections.length,
        cargo: currentStart.parts.filter((part) => part.type === "cargo")
          .length,
        demo: currentStart.demo.kind,
      },
      running: {
        challenge: running.challenge,
        hud: runningHud,
      },
      retried: {
        challenge: retried.challenge,
        parts: retried.parts.length,
        connections: retried.connections.length,
      },
      compactHud,
      calibration: calibration.challenge,
      errors,
    },
    null,
    2,
  ),
);

await conclude(browser, () => {
  assert.equal(
    browserState.cards,
    CHALLENGES.length,
    "challenge lab did not render all contracts",
  );
  assert.deepEqual(
    [...browserState.challengeIds].sort(),
    CHALLENGES.map((challenge) => challenge.id).sort(),
    "challenge lab rendered missing, duplicate, or unknown contract identities",
  );
  assert.equal(
    browserState.openContracts,
    CHALLENGES.filter((challenge) => challenge.category === "OPEN CONSTRUCTION")
      .length,
    "open contracts are missing",
  );
  assert.equal(
    browserState.emptyActions,
    CHALLENGES.filter((challenge) => challenge.startModes.includes("empty"))
      .length,
    "empty-start actions are missing",
  );
  assert.equal(
    browserState.currentActions,
    CHALLENGES.filter((challenge) => challenge.startModes.includes("current"))
      .length,
    "BYOB actions are missing",
  );
  assert.match(browserState.copy, /WHEELS.*LEGS.*ROTOR.*HYBRID/s);
  assert.deepEqual(
    emptyStart.parts.map((part) => part.type),
    ["cargo"],
  );
  assert.equal(
    emptyStart.demo.kind,
    null,
    "empty contract retained demo identity",
  );
  assert.equal(emptyStart.challenge.startMode, "empty");
  assert.equal(
    emptyStart.challenge.contract.criteria[0].met,
    false,
    "loose payload was shown as secured",
  );
  assert.match(emptyHud, /MISSION PAYLOAD SECURED/);
  assert.equal(
    currentStart.parts.length,
    cartBuild.parts.length + 1,
    "BYOB did not preserve the rover plus its challenge payload",
  );
  assert.equal(
    currentStart.connections.length,
    cartBuild.connections.length,
    "BYOB changed rover wiring",
  );
  assert.equal(currentStart.challenge.startMode, "current");
  assert.equal(
    currentStart.demo.kind,
    null,
    "open challenge kept stock demo dispatch",
  );
  assert.equal(
    running.challenge.status,
    "running",
    "unsecured cargo incorrectly completed the live contract",
  );
  assert.equal(
    running.challenge.contract.criteria.find((entry) => entry.id === "payload")
      ?.met,
    false,
    "live evaluator accepted unsecured cargo",
  );
  assert.doesNotMatch(
    runningHud,
    /SOLUTION CLASS/,
    "unsecured cargo was assigned a mission solution component",
  );
  assert.match(runningHud, /AWAITING MOTION/);
  assert.deepEqual(
    [retried.parts.length, retried.connections.length],
    [cartBuild.parts.length + 1, cartBuild.connections.length],
    "exact retry did not restore the pre-test BYOB build",
  );
  assert.deepEqual(
    [
      retried.challenge.reliability.attempts,
      retried.challenge.reliability.successes,
    ],
    [1, 0],
    "aborted attempts were not included in reliability history",
  );
  assert.ok(
    compactHud.left >= 48 &&
      compactHud.top >= 0 &&
      compactHud.right <= 1024 &&
      compactHud.bottom <= 720,
    "challenge HUD escaped the compact viewport",
  );
  assert.equal(
    calibration.challenge.status,
    "complete",
    "existing gearbox calibration did not survive generic evaluation",
  );
  assert.equal(
    calibration.challenge.contract.solution,
    "MECHANICAL TRANSMISSION",
    "calibration was not classified from physical capability",
  );
  assertNoErrors(errors, "open construction challenges");
});
