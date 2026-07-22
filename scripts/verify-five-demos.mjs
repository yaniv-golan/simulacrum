import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import {
  DEFAULT_WAT_SOURCE,
  DRONE_TS_SOURCE,
  MISSION_TS_SOURCE,
} from "../src/application/content.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { createWorkspace } from "../src/model/workspaces.js";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest();
const demoKinds = ["gearbox", "cart", "drone", "humanoid", "mission"],
  demoSources = {
    wat: DEFAULT_WAT_SOURCE,
    typescript: MISSION_TS_SOURCE,
    droneTypescript: DRONE_TS_SOURCE,
  },
  expectedControls = Object.fromEntries(
    demoKinds.map((kind) => {
      const blueprint = builtInDemo(kind, demoSources).blueprint,
        byId = new Map(blueprint.parts.map((part) => [part.id, part]));
      return [
        kind,
        blueprint.remoteProfiles[kind].controls.map((control) => ({
          label: control.label,
          channel: control.channel,
          targetType: byId.get(control.targetId)?.type || null,
        })),
      ];
    }),
  ),
  results = {};
await page.goto(baseUrl, { waitUntil: "networkidle" });
const staleBlueprint = structuredClone(
    builtInDemo("gearbox", demoSources).blueprint,
  ),
  staleComputerIds = staleBlueprint.parts
    .filter((part) => part.type === "computer")
    .map((part) => part.id);
for (const control of staleBlueprint.remoteProfiles.gearbox.controls)
  control.label = `STALE ${control.label}`;
await resetBrowserStorageForTest(page, {
  workspace: createWorkspace({
    blueprint: staleBlueprint,
    idSeed: Math.max(...staleBlueprint.parts.map((part) => part.id)) + 1,
    activeRemoteProfile: "gearbox",
    programAcquisitionByController: Object.fromEntries(
      staleComputerIds.map((id) => [id, "BUILT_IN"]),
    ),
    controllerWindowState: {
      visible: true,
      collapsed: false,
      pinned: false,
      x: 24,
      y: 24,
      width: 360,
      height: 520,
    },
  }),
});
await page.reload({ waitUntil: "networkidle" });
await page
  .waitForFunction(() => !document.querySelector("#sandbox-start")?.disabled)
  .catch(async () => {
    const textState = await page.evaluate(
      () => window.render_game_to_text?.() || null,
    );
    throw new Error(
      `sandbox startup remained blocked: ${JSON.stringify({ errors, textState })}`,
    );
  });
await page.click("#sandbox-start");
await page.locator(".welcome").waitFor({ state: "detached" });

for (const demo of demoKinds) {
  await page.click("#demos-btn");
  await page.click(`[data-demo="${demo}"]`);
  await page
    .locator('[data-mode="test"]')
    .evaluate((element) => element.click());
  await page.waitForFunction(
    () => JSON.parse(window.render_game_to_text()).running,
  );
  if (demo === "gearbox")
    await page.locator('.direct-range[data-index="0"]').evaluate((input) => {
      input.value = "0.55";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await page.evaluate(() => window.advanceTime(300));
  const state = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  );
  results[demo] = {
    parts: state.parts.length,
    mechanisms: state.architecture.session?.systems.mechanisms?.activeMotors,
    mobility:
      (state.architecture.session?.systems.mobility?.assemblies?.length || 0) >
      0,
    flight: state.architecture.session?.systems.flight?.active || false,
    propulsion: (
      state.architecture.session?.systems.propulsion?.engines || []
    ).map((record) => ({
      kind: record.kind,
      commandSource: record.commandSource,
      targetThrottle: record.targetThrottle,
      deliveredMassKg: record.deliveredMassKg,
      allocationId: record.allocationId,
    })),
    articulated:
      state.architecture.session?.systems.articulated?.active || false,
    failedConnections: state.connections
      .filter((connection) => connection.failed)
      .map((connection) => connection.id),
    detachedParts: state.parts
      .filter((part) => part.aerothermal?.detached)
      .map((part) => ({ id: part.id, type: part.type })),
    controls: state.remote.controls.map((control) => ({
      label: control.label,
      channel: control.channel,
      targetType:
        state.parts.find((part) => part.id === control.targetId)?.type || null,
      online: control.online,
    })),
  };
  await page.locator("#run-btn").evaluate((element) => element.click());
}
console.log(JSON.stringify({ results, errors }, null, 2));

await conclude(browser, () => {
  for (const kind of demoKinds) {
    assert.deepEqual(
      results[kind].controls.map((control) => ({
        label: control.label,
        channel: control.channel,
        targetType: control.targetType,
      })),
      expectedControls[kind],
      `${kind} authored controls were rewritten by preexisting user state`,
    );
    assert.ok(
      results[kind].controls.every((control) => control.online),
      `${kind} has an offline authored control despite satisfied power and signal topology`,
    );
    assert.deepEqual(
      results[kind].failedConnections,
      [],
      `${kind} failed a connection during its initial settle`,
    );
    assert.deepEqual(
      results[kind].detachedParts,
      [],
      `${kind} detached a part during its initial settle`,
    );
  }
  assert.ok(
    results.gearbox.mechanisms > 0,
    "explicit gearbox throttle did not run the mechanism",
  );
  assert.equal(
    results.cart.mobility,
    true,
    "cart rolling-contact runtime did not run",
  );
  assert.equal(results.drone.flight, true, "drone flight runtime did not run");
  assert.equal(
    results.humanoid.articulated,
    true,
    "humanoid articulated runtime did not run",
  );
  assert.equal(
    results.mission.flight,
    true,
    "mission flight runtime did not run",
  );
  for (const kind of ["gearbox", "cart", "humanoid"])
    assert.deepEqual(
      results[kind].propulsion,
      [],
      `${kind} published flight-command parity without flight engines`,
    );
  assert.equal(
    results.drone.propulsion.length,
    4,
    "drone did not publish one local command record per engine",
  );
  assert.ok(
    results.drone.propulsion.every(
      (record) =>
        record.kind === "pressure-nozzle-state-v1" &&
        record.commandSource === "script" &&
        typeof record.allocationId === "string",
    ),
    "drone nozzle allocation did not originate from its visible controller",
  );
  assert.deepEqual(
    results.mission.propulsion.map((record) => record.kind),
    Array(5).fill("pressure-nozzle-state-v1"),
    "mission propulsion did not cover its main engine and four physical RCS pods",
  );
  assert.ok(
    results.mission.propulsion.every(
      (record) =>
        record.commandSource === "script" &&
        record.targetThrottle === 0 &&
        record.deliveredMassKg === 0 &&
        typeof record.allocationId === "string",
    ),
    "disarmed mission controller produced thrust or bypassed ordinary zero-flow allocation",
  );
  assertNoErrors(errors, "five built-in demos");
});
