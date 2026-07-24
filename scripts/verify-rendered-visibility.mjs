import { assert, assertNoErrors, conclude } from "./lib/assert.mjs";
import { createBrowserTest } from "./lib/browser-test.mjs";
import { installRenderedVisibilityContract } from "./lib/rendered-visibility.mjs";

const { browser, page, errors, baseUrl } = await createBrowserTest({
  viewport: { width: 320, height: 240 },
});
await installRenderedVisibilityContract(page);
await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
await page.evaluate(() => {
  const fixture = document.createElement("div");
  fixture.id = "visibility-contract-fixture";
  fixture.innerHTML = `<style>
    body { margin: 0; }
    #visibility-contract-fixture { position: fixed; inset: 0; z-index: 100000; background: white; }
    .box { position: fixed; width: 80px; height: 40px; left: 10px; top: 10px; }
    #clip { position: fixed; overflow: hidden; left: 100px; top: 10px; width: 20px; height: 20px; }
    #clipped { width: 80px; height: 80px; }
    #offscreen { left: 400px; }
    #transparent-parent { opacity: 0; }
    #pointer-parent { pointer-events: none; }
    #scaled { transform: scale(0); }
    #cover { position: fixed; inset: 10px auto auto 10px; width: 80px; height: 40px; z-index: 2; }
  </style>
  <button id="plain" class="box">Plain</button>
  <div id="hidden-parent" style="display:none"><button id="hidden">Hidden</button></div>
  <div id="transparent-parent"><button id="transparent">Transparent</button></div>
  <div id="pointer-parent"><button id="pointer">Pointer suppressed</button></div>
  <div inert><button id="inert">Inert</button></div>
  <button id="disabled" disabled>Disabled</button>
  <details><button id="closed-details">Closed</button></details>
  <div id="clip"><button id="clipped">Clipped</button></div>
  <button id="offscreen" class="box">Offscreen</button>
  <button id="scaled" class="box">Scaled</button>`;
  document.body.append(fixture);
});

const snapshot = await page.evaluate(() =>
  Object.fromEntries(
    [
      "plain",
      "hidden",
      "transparent",
      "pointer",
      "inert",
      "disabled",
      "closed-details",
      "clipped",
      "offscreen",
      "scaled",
    ].map((id) => [
      id,
      window.__simulacrumTestVisibility(document.getElementById(id)),
    ]),
  ),
);

await page.evaluate(() => {
  const cover = document.createElement("div");
  cover.id = "cover";
  document.querySelector("#visibility-contract-fixture").append(cover);
});
const occluded = await page
  .locator("#plain")
  .evaluate((element) =>
    window.__simulacrumTestVisibility(element, { sampleOcclusion: true }),
  );

console.log(JSON.stringify({ snapshot, occluded }, null, 2));
await conclude(browser, () => {
  assert.equal(snapshot.plain.rendered, true);
  assert.equal(snapshot.plain.pointerInteractive, true);
  assert.equal(snapshot.plain.keyboardFocusable, true);
  for (const id of [
    "hidden",
    "transparent",
    "inert",
    "closed-details",
    "offscreen",
    "scaled",
  ])
    assert.equal(snapshot[id].rendered, false, `${id} was false-visible`);
  assert.equal(snapshot.pointer.rendered, true);
  assert.equal(snapshot.pointer.pointerInteractive, false);
  assert.equal(snapshot.disabled.keyboardFocusable, false);
  assert.equal(snapshot.disabled.pointerInteractive, false);
  assert.equal(snapshot.clipped.rendered, true);
  assert.equal(snapshot.clipped.area.visiblePx, 400);
  assert.ok(snapshot.clipped.area.ratio < 0.1);
  assert.equal(occluded.occlusion.exposedSamples, 0);
  assert.equal(occluded.pointerInteractive, false);
  assertNoErrors(errors);
});
