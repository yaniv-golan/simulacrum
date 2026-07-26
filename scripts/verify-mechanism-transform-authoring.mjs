import { assert, assertNoErrors, closeBrowser } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { resetBrowserStorageForTest } from "./lib/browser-storage-fixture.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest();
const textState = async () =>
  JSON.parse(await page.evaluate(() => window.render_game_to_text()));

try {
  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await resetBrowserStorageForTest(page);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(
    () => typeof window.render_game_to_text === "function",
  );
  await page.click("#sandbox-start");
  await page.locator(".welcome").waitFor({ state: "hidden" });
  await page.keyboard.press("Shift+Delete");
  await page.click('.part-card[data-type="builtin-subassembly-1"]');
  await page.fill("#placement-x", "3");
  await page.fill("#placement-y", "1");
  await page.fill("#placement-z", "0.5");
  await page.click("#place-pending");

  const original = await textState(),
    originalParts = original.parts.length,
    originalConnections = original.connections.length;
  assert.equal(original.selectedParts.length, originalParts);

  const duplicate = page.getByRole("button", { name: "DUPLICATE" });
  await duplicate.focus();
  await page.keyboard.press("Enter");
  let state = await textState(),
    operation = state.lastTransformOperation;
  assert.equal(state.parts.length, originalParts * 2);
  assert.equal(state.connections.length, originalConnections * 2);
  assert.equal(operation.kind, "duplicate");
  assert.equal(operation.handedness, "right-handed-frame-preserved");
  assert.equal(Object.keys(operation.partIdMap).length, originalParts);
  assert.equal(operation.connectionMap.length, originalConnections);
  assert.deepEqual(operation.conflicts, []);
  assert.ok(
    ["toward-camera", "camera-right-fallback", "positive-x-fallback"].includes(
      operation.placement.strategy,
    ),
    `button duplicate used unexpected placement intent ${operation.placement.strategy}`,
  );
  assert.equal(operation.placement.snapM, 0.25);
  assert.equal(operation.placement.offsetWorldM[1], 0);
  assert.deepEqual(operation.rejectedCandidates, []);
  assert.deepEqual(
    [...state.selectedParts].sort((left, right) => left - right),
    Object.values(operation.partIdMap).sort((left, right) => left - right),
    "duplicate did not select exactly the remapped ordinary parts",
  );

  const duplicatedPartById = new Map(
    state.parts.map((part) => [part.id, part]),
  );
  for (const [sourceId, targetId] of Object.entries(operation.partIdMap)) {
    const source = duplicatedPartById.get(Number(sourceId)),
      target = duplicatedPartById.get(targetId);
    for (let axis = 0; axis < 3; axis++)
      assert.equal(
        target.position[axis],
        source.position[axis] + operation.placement.offsetWorldM[axis],
      );
  }

  const mirror = page.locator("#mirror-selection");
  assert.match(
    await mirror.getAttribute("aria-label"),
    new RegExp(
      `Mirror ${state.selectedParts.length} components\\. Selection scope has`,
    ),
    "mirror action did not expose its exact multi-selection scope",
  );
  await mirror.focus();
  await page.keyboard.press("Enter");
  state = await textState();
  operation = state.lastTransformOperation;
  assert.equal(operation.kind, "mirror");
  assert.equal(operation.plane, "YZ");
  assert.equal(
    operation.handedness,
    "reflection-restored-to-right-handed-frame",
  );
  assert.deepEqual(operation.conflicts, []);
  assert.equal(Object.keys(operation.partIdMap).length, originalParts);
  assert.equal(operation.connectionMap.length, originalConnections);
  assert.equal(state.parts.length, originalParts * 3);
  assert.equal(state.connections.length, originalConnections * 3);

  const mirroredPartById = new Map(state.parts.map((part) => [part.id, part]));
  for (const [sourceId, targetId] of Object.entries(operation.partIdMap)) {
    const source = mirroredPartById.get(Number(sourceId)),
      target = mirroredPartById.get(targetId);
    assert.equal(target.position[0], -source.position[0]);
    assert.equal(target.position[1], source.position[1]);
    assert.equal(target.position[2], source.position[2]);
  }
  for (const connection of operation.connectionMap)
    for (const endpoint of [connection.portA, connection.portB]) {
      assert.ok(endpoint.source);
      assert.ok(endpoint.target);
      assert.ok([-1, 1].includes(endpoint.coordinateSign));
    }
  assert.ok(
    Object.values(operation.portFrameMappings).every((mappings) =>
      mappings.every(
        ({ sourcePort, targetPort, coordinateSign }) =>
          sourcePort && targetPort && [-1, 1].includes(coordinateSign),
      ),
    ),
    "mirror did not expose its frame/axis mapping",
  );
  assert.match(
    await page.locator(".toast").textContent(),
    /Mirrored selection/i,
  );

  assertNoErrors(errors, "mechanism transform authoring");
  console.log(
    "mechanism transform authoring passed (keyboard duplicate/mirror, atomic ID and connection maps, reflected port frames and handedness)",
  );
} finally {
  await closeBrowser(browser);
}
