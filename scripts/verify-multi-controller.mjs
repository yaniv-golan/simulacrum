import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { resolveWireComponentConfig } from "../src/model/component-resolver.js";
import { completeConnectionContract } from "../src/model/connection-contracts.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { createSharePackage } from "../src/model/share-packages.js";
import { executableDigest } from "../src/model/executable-program.js";
import { descriptorForController } from "../src/application/executable-trust-service.js";

const source = `interface ControlAPI { read(binding: string): number; write(binding: string, value: number): void; }
function tick(api: ControlAPI, dt: number): void { void dt; api.write('drive', 0.6); }`,
  visualProgram = {
    version: 1,
    name: "Independent drive",
    nodes: [
      { id: "command", type: "constant", value: 0.6, x: 20, y: 20 },
      {
        id: "drive-output",
        type: "output",
        bindingId: "drive",
        x: 260,
        y: 20,
      },
    ],
    links: [{ from: "command", to: "drive-output", input: 0 }],
  },
  makePart = (id, type, pos) => ({
    id,
    type,
    pos,
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    config: resolveWireComponentConfig({ type, config: {} }),
    ...(type === "battery" ? { storedEnergyWh: 100 } : {}),
    ...(type === "computer"
      ? {
          scriptLanguage: "visual",
          scriptSources: {
            visual: structuredClone(visualProgram),
            typescript: source,
            wat: "",
          },
        }
      : {}),
  }),
  parts = [
    makePart(1, "battery", [0, 0.8, -1.5]),
    makePart(2, "computer", [-1, 0.6, -1]),
    makePart(3, "computer", [1, 0.6, -1]),
    makePart(4, "motor", [-1.5, 1, 0]),
    makePart(5, "gear12", [-1.5, 1, 0.82]),
    makePart(6, "motor", [1.5, 1, 0]),
    makePart(7, "gear12", [1.5, 1, 0.82]),
  ],
  controllerTargets = new Map([
    [2, 4],
    [3, 6],
  ]),
  byId = new Map(parts.map((part) => [part.id, part])),
  links = [
    ["p-c1", 1, 2, "power", "POWER", "POWER"],
    ["p-c2", 1, 3, "power", "POWER", "POWER"],
    ["p-m1", 1, 4, "power", "POWER", "POWER"],
    ["p-m2", 1, 6, "power", "POWER", "POWER"],
    ["c1-m1", 2, 4, "signal", "OUT", "CONTROL"],
    ["c2-m2", 3, 6, "signal", "OUT", "CONTROL"],
    ["m1-g1", 4, 5, "mechanical", "SHAFT", "AXLE"],
    ["m2-g2", 6, 7, "mechanical", "SHAFT", "AXLE"],
  ],
  connections = links.map(([id, a, b, kind, portA, portB]) =>
    completeConnectionContract(
      { id, a, b, kind, portA, portB },
      byId.get(a),
      byId.get(b),
      {
        capacity:
          kind === "mechanical"
            ? { ultimateForceN: 10_000, ultimateTorqueNm: 2_000 }
            : undefined,
      },
    ),
  );

for (const [controllerId, motorId] of controllerTargets)
  byId.get(controllerId).controllerBindings = [
    {
      id: "drive",
      direction: "output",
      endpointPartId: motorId,
      endpointPortId: "CONTROL",
      channel: "throttle",
    },
  ];

const blueprint = decodeBlueprintOrThrow({
    format: "simulacrum-blueprint",
    version: 1,
    name: "Independent controller rig",
    created: new Date(0).toISOString(),
    parts,
    connections,
    remoteProfiles: {},
    defaultRemoteProfile: null,
  }).wire,
  sharedPackage = await createSharePackage({
    kind: "blueprint",
    asset: blueprint,
    metadata: { title: blueprint.name },
  }),
  secondaryControllerDigest = await executableDigest(
    descriptorForController(byId.get(3)),
  );

const { browser, page, errors, baseUrl } = await createBrowserTest();
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.evaluate(
  async ({ repositoryUrl, digest }) => {
    const { ExecutableTrustRepository } = await import(repositoryUrl),
      result = new ExecutableTrustRepository().grant(digest);
    if (!result.ok || !result.trusted)
      throw new Error("secondary controller trust setup failed");
  },
  {
    repositoryUrl: "/src/application/executable-trust-repository.js",
    digest: secondaryControllerDigest,
  },
);
await page.click("#sandbox-start");
await page.click("#tools-btn");
await page.click("#blueprint-btn");
await page.locator("#share-paste").fill(JSON.stringify(sharedPackage));
await page.click("#import-shared-text");
const importedCard = page.locator(
  `.exchange-item[data-fingerprint="${sharedPackage.fingerprint}"]`,
);
await importedCard.waitFor();
await importedCard.locator("[data-load-share]").click();
await page.click("#close-blueprints");

await page.click("#tools-btn");
await page.click("#wasm-btn");
await page.waitForFunction(
  () =>
    JSON.parse(window.render_game_to_text()).script.trust?.requiresReview ===
    true,
);
await page.click("#trust-program");
await page.waitForFunction(
  () => JSON.parse(window.render_game_to_text()).script.trust?.allowed === true,
);
await page.click("#close-wasm");
await page.click("#run-btn");
await page.waitForFunction(() => {
  const runtimes = JSON.parse(window.render_game_to_text()).script.runtimes;
  return runtimes.length === 2 && runtimes.every((runtime) => runtime.ready);
});
const before = JSON.parse(
  await page.evaluate(() => window.render_game_to_text()),
);
await page.evaluate(() => window.advanceTime(1000));
const state = JSON.parse(
    await page.evaluate(() => window.render_game_to_text()),
  ),
  motors = state.parts
    .filter((part) => part.type === "motor")
    .sort((left, right) => left.id - right.id),
  beforeMotors = before.parts
    .filter((part) => part.type === "motor")
    .sort((left, right) => left.id - right.id);

console.log(
  JSON.stringify({ runtimes: state.script.runtimes, motors, errors }, null, 2),
);

await conclude(browser, () => {
  assert.equal(state.script.runtimes.length, 2, "controllers were collapsed");
  assert.ok(
    state.script.runtimes.every((runtime) => runtime.ready),
    "a controller runtime failed to become ready",
  );
  for (let index = 0; index < motors.length; index++)
    assert.ok(
      Math.abs(
        (motors[index]?.phase || 0) - (beforeMotors[index]?.phase || 0),
      ) > 0.1,
      `independently routed motor ${index + 1} did not advance`,
    );
  assert.equal(
    state.script.conflicts.length,
    0,
    "independent targets produced a false control conflict",
  );
  assertNoErrors(errors, "multi-controller rig");
});
