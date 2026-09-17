import { createBrowserEvidence } from './browser-evidence.mjs';
import * as THREE from 'three';
import { CATALOG } from '../src/model/catalog.mjs';
import { ESSENTIAL_PARTS } from '../src/presentation/part-search.mjs';
import { PART_HELP } from '../src/presentation/part-help-content.mjs';
import { browseAllParts } from './catalog-browser-actions.mjs';
const evidence = createBrowserEvidence();
const browser = await evidence.launch({ profile: 'ui' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
// The message reaches assert.deepEqual, so two failures of the same shape stay distinguishable.
const equal = (a, b, message) =>
  evidence.assert('deepEqual', message === undefined ? [a, b] : [a, b, message]);
const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()).metadata);
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.render_game_to_text);
  page.setDefaultTimeout(5000);
  const original = await read();
  // Summoning: + Add part and P open the overlay with the search focused; Escape puts it
  // away and hands focus back to whatever summoned it; Run puts it away too.
  const overlay = page.locator('.parts-browser.catalog-expanded');
  const addPart = page.locator('[data-command=add-part]');
  equal(await overlay.count(), 0);
  await addPart.click();
  await overlay.waitFor({ state: 'visible' });
  equal(await overlay.getAttribute('role'), 'dialog');
  equal(await overlay.getAttribute('aria-label'), 'Parts');
  equal(
    await page
      .getByRole('searchbox', { name: 'Search all parts' })
      .evaluate((node) => node === document.activeElement),
    true,
    'summoning focuses the search box',
  );
  await page.keyboard.press('p');
  equal(await overlay.count(), 1, 'P while typing in the search box types, never toggles');
  await page.getByRole('searchbox', { name: 'Search all parts' }).fill('');
  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'detached' });
  equal(
    await addPart.evaluate((node) => node === document.activeElement),
    true,
    'focus returns to the opener',
  );
  await page.locator('.stage canvas').focus();
  await page.keyboard.press('p');
  await overlay.waitFor({ state: 'visible' });
  const close = overlay.locator('.dialog-close');
  equal(await close.getAttribute('aria-label'), 'Close parts');
  equal(await close.textContent(), '×', 'the shared close control');
  await close.click();
  await overlay.waitFor({ state: 'detached' });
  await addPart.click();
  await overlay.waitFor({ state: 'visible' });
  await page.locator('[data-command=run]').click();
  await overlay.waitFor({ state: 'detached' });
  equal(await addPart.isDisabled(), true, 'nothing to add while running');
  await page.locator('[data-command=build]').click();
  await page.waitForFunction(() => !document.querySelector('[data-command=add-part]').disabled);
  // The supported laptop viewport must expose complete tiles without expansion.
  await page.setViewportSize({ width: 1280, height: 720 });
  for (const category of ['Essentials', 'All parts']) {
    await page.getByRole('button', { name: category, exact: true }).click();
    const gridBox = await page.locator('.catalog-grid').boundingBox();
    const tileBox = await page
      .locator('.catalog-entry:not([hidden]) .part-card')
      .first()
      .boundingBox();
    equal(gridBox.height >= tileBox.height, true);
    equal(tileBox.y >= gridBox.y && tileBox.y + tileBox.height <= gridBox.y + gridBox.height, true);
    // Essentials tiles carry their purpose line; other categories show the name only.
    const purpose = page.locator('.catalog-entry:not([hidden]) .part-purpose').first();
    equal(await purpose.isVisible(), category === 'Essentials');
    if (category === 'Essentials') {
      equal(await page.locator('.catalog-entry:not([hidden])').count(), ESSENTIAL_PARTS.length);
      equal(await purpose.textContent(), PART_HELP[ESSENTIAL_PARTS[0]].purpose);
    }
  }
  // Both corner controls must be reachable on the tightest card — the compact sidebar's 88 px
  // tile, not only the roomier summoned overlay.
  const cornersReachable = async (scope, label) => {
    const entry = page.locator(`${scope} .catalog-entry:not([hidden])`).first();
    const star = entry.locator('.catalog-favorite'),
      info = entry.locator('.part-about');
    equal(await star.isVisible(), true, `${label}: the star is on the card`);
    equal(await info.isVisible(), true, `${label}: the (i) button is still on the card`);
    const starBox = await star.boundingBox(),
      infoBox = await info.boundingBox();
    equal(starBox.width >= 28 && starBox.height >= 28, true, `${label}: 28 px target`);
    equal(starBox.x + starBox.width <= infoBox.x, true, `${label}: the corners do not overlap`);
    equal(
      await star.evaluate((node) => {
        const box = node.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return node === hit || node.contains(hit);
      }),
      true,
      `${label}: a press at its centre reaches the star`,
    );
  };
  await cornersReachable('.parts-browser:not(.catalog-expanded)', 'compact sidebar');
  await addPart.click();
  await overlay.waitFor({ state: 'visible' });
  await cornersReachable('.parts-browser.catalog-expanded', 'summoned overlay');
  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'detached' });
  await page.screenshot({ path: '/tmp/catalog-fixed-1280.png' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await browseAllParts(page);
  equal(await page.locator('.catalog-entry:not([hidden])').count(), Object.keys(CATALOG).length);
  const search = page.getByRole('searchbox', { name: 'Search all parts' });
  const scroll = await page.locator('.catalog-grid').evaluate((node) => {
    node.scrollTop = 300;
    return node.scrollTop;
  });
  await search.fill('battery');
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  equal(await page.locator('.catalog-grid').evaluate((node) => node.scrollTop), scroll);
  for (const [query, type] of [
    ['batery', 'powerCell'],
    ['tyre', 'gripWheel'],
    ['keyboard', 'commandReceiver'],
    ['detect rotation', 'rotationSensor'],
    ['detect rotatoin', 'rotationSensor'],
    ['motor spin', 'poweredMotor'],
    ['24T', 'gear24'],
  ]) {
    await search.fill(query);
    equal(
      await page
        .locator('.catalog-entry:not([hidden]) [data-part-type]')
        .first()
        .getAttribute('data-part-type'),
      type,
    );
  }
  await search.fill('25T');
  equal(await page.locator('.catalog-entry:not([hidden])').count(), 0);
  await search.fill('battery');
  await search.press('Space');
  await search.press('Control+z');
  equal(await read(), original);
  await search.fill('battery');
  await page.getByRole('button', { name: 'Power Cell', exact: true }).click();
  equal(await read(), original);
  // The placement strip is one row while the preview is valid: the part, its state word
  // from the shared placement vocabulary, the coordinates chip and the two actions all
  // share one vertical band, and each keeps the name this check clicks it by.
  const strip = page.getByRole('region', { name: 'Place part', exact: true });
  equal(await strip.locator('p[role=status]').textContent(), 'Preview · not placed');
  equal(await strip.locator('summary').textContent(), 'Precise position');
  equal(
    await strip.getByRole('button', { name: 'Cancel placement', exact: true }).textContent(),
    'Cancel',
  );
  const row = await strip.evaluate((panel) => {
    const shown = [...panel.children].filter((child) => !child.hidden),
      middle = (node) => {
        const box = node.getBoundingClientRect();
        return box.top + box.height / 2;
      };
    return {
      controls: shown.length,
      offRow: shown.filter((child) => Math.abs(middle(child) - middle(panel)) > 2).length,
      height: Math.round(panel.getBoundingClientRect().height),
      tallest: Math.round(Math.max(...shown.map((c) => c.getBoundingClientRect().height))),
    };
  });
  equal([row.controls, row.offRow], [5, 0]);
  equal(row.height <= row.tallest + 20, true);
  // Enter belongs to the control that has focus: on Cancel it closes the strip and
  // commits nothing.
  await page.getByRole('button', { name: 'Cancel placement', exact: true }).focus();
  await page.keyboard.press('Enter');
  equal(await strip.isVisible(), false);
  equal(await read(), original);
  await page.getByRole('button', { name: 'Power Cell', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel placement', exact: true }).click();
  equal(await read(), original);
  await page.getByRole('button', { name: 'Power Cell', exact: true }).click();
  const coordinates = page.locator('.placement-coordinates');
  await page.locator('.part-placement summary').click();
  equal(await coordinates.isVisible(), true);
  await page.getByRole('button', { name: 'Place part', exact: true }).click();
  // The coordinates go away with the fields they edit: a placed row is never left with an
  // orphan card floating above it.
  equal(await coordinates.isVisible(), false);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  equal((await read()).blueprint.parts.length, 1);
  await page.getByRole('button', { name: 'Create assembly…', exact: true }).click();
  await search.fill('motor');
  equal(await page.getByRole('button', { name: 'Powered Motor', exact: true }).isEnabled(), false);
  await page.getByRole('button', { name: 'Cancel assembly', exact: true }).click();
  await page.getByRole('button', { name: 'Recent', exact: true }).click();
  equal(
    await page
      .locator('.catalog-entry:not([hidden]) [data-part-type]')
      .getAttribute('data-part-type'),
    'powerCell',
  );
  // The star belongs to the tile it sits on. Focus Power Cell, graze another tile on the way
  // to the control, and the click still saves Power Cell; the retired shared summary button
  // followed whichever tile the pointer or Tab touched last.
  await page.getByRole('button', { name: 'All parts', exact: true }).click();
  const cellStar = page
    .locator('.catalog-entry:has([data-part-type="powerCell"]) .catalog-favorite')
    .first();
  equal(await cellStar.getAttribute('aria-label'), 'Save Power Cell to favorites');
  equal(await cellStar.getAttribute('aria-pressed'), 'false');
  await page.locator('[data-part-type="powerCell"]').focus();
  await page.locator('[data-part-type="gripWheel"]').hover();
  await cellStar.click();
  equal(await cellStar.getAttribute('aria-pressed'), 'true');
  equal(
    await cellStar.getAttribute('aria-label'),
    'Remove Power Cell from favorites',
    'a pressed star offers the removal rather than another save',
  );
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  const placed = await read();
  await page.getByRole('button', { name: 'About Power Cell', exact: true }).click();
  await page.getByRole('tab', { name: 'How to connect', exact: true }).click();
  await page
    .getByRole('button', { name: 'Find Powered Motor in parts', exact: true })
    .first()
    .click();
  equal(await search.inputValue(), 'Powered Motor');
  equal(await read(), placed);
  await page.getByRole('button', { name: 'Powered Motor', exact: true }).click();
  await page.locator('.part-placement summary').click();
  await page.getByRole('spinbutton', { name: 'X position', exact: true }).fill('');
  equal(await page.getByRole('button', { name: 'Place part', exact: true }).isEnabled(), false);
  await page.keyboard.press('Escape');
  equal(await read(), placed);
  await search.fill('spring strut');
  equal(
    await page.getByRole('button', { name: 'Spring strut · Assemblies', exact: true }).isVisible(),
    true,
  );
  await search.fill('battery');
  await page.getByRole('button', { name: 'Power Cell', exact: true }).click();
  await search.fill('wheel');
  await addPart.click();
  const dragCard = await page
    .getByRole('button', { name: 'Grip Wheel', exact: true })
    .boundingBox();
  await page.mouse.move(dragCard.x + dragCard.width / 2, dragCard.y + dragCard.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    dragCard.x + dragCard.width / 2 + 20,
    dragCard.y + dragCard.height / 2 + 20,
    { steps: 4 },
  );
  await page.waitForFunction(
    () => !document.querySelector('.parts-browser').classList.contains('catalog-expanded'),
    undefined,
    { timeout: evidence.waitBudget(2000) },
  );
  await page.mouse.move(10, 40, { steps: 4 });
  await page.mouse.up();
  // A cancelled drag restores the browse snapshot for the next open but never re-summons.
  equal(await page.locator('.catalog-expanded').count(), 0);
  equal(await read(), placed);
  equal(await search.inputValue(), 'wheel');
  await search.fill('battery');
  await page.getByRole('button', { name: 'Power Cell', exact: true }).click();
  await search.fill('wheel');
  await search.press('Escape');
  equal(
    await page.getByRole('button', { name: 'Cancel placement', exact: true }).isVisible(),
    false,
  );
  equal(await search.inputValue(), 'battery');
  // Picking from the catalog reaches the existing surface owner, including
  // keyboard target choice, atomic attachment and a single Undo.
  await search.fill('plate');
  await page.getByRole('button', { name: 'Plate', exact: true }).click();
  await page.getByRole('button', { name: 'Place part', exact: true }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Frame machine · F', exact: true }).click();
  const beforeMount = await read();
  await search.fill('battery');
  await page.getByRole('button', { name: 'Power Cell', exact: true }).click();
  const cameraState = await page.evaluate(() => window.workshopProbe.readInteractionState().camera);
  const camera = new THREE.PerspectiveCamera(cameraState.fov, cameraState.aspect, 0.01, 100);
  camera.position.fromArray(cameraState.position);
  camera.lookAt(new THREE.Vector3(...cameraState.target));
  camera.updateMatrixWorld();
  const sceneBounds = await page.locator('.stage canvas').boundingBox();
  const sourceCell = beforeMount.blueprint.parts.at(-1);
  const topPoint = new THREE.Vector3(...sourceCell.position);
  topPoint.y += CATALOG.plate.primitives[0].halfExtents[1];
  const screen = topPoint.project(camera);
  await page.mouse.move(
    sceneBounds.x + ((screen.x + 1) * sceneBounds.width) / 2,
    sceneBounds.y + ((1 - screen.y) * sceneBounds.height) / 2,
  );
  await page
    .getByLabel('Target surface', { exact: true })
    .selectOption(JSON.stringify([sourceCell.id, 'top']));
  equal((await read()).blueprint, beforeMount.blueprint);
  await page.locator('[data-command="apply-surface"]').click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  equal((await read()).blueprint.connections.length, placed.blueprint.connections.length + 1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  equal((await read()).blueprint, beforeMount.blueprint);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  equal((await read()).blueprint, placed.blueprint);
  // Narrow: the longest state sentence a learner can sit in stays wholly readable and
  // inside the stage, and the row reserves the machine control band it shares the bench's
  // bottom edge with, so a placement never covers Sound or takes its click.
  await page.setViewportSize({ width: 780, height: 720 });
  await addPart.click();
  await search.fill('battery');
  await page.getByRole('button', { name: 'Power Cell', exact: true }).click();
  const occupied = (await read()).blueprint.parts[0].position;
  await page.locator('.part-placement summary').click();
  for (const [index, axis] of ['X', 'Y', 'Z'].entries())
    await page
      .getByRole('spinbutton', { name: `${axis} position`, exact: true })
      .fill(String(occupied[index]));
  await page.locator('.part-placement summary').click();
  const narrow = await strip.evaluate((panel) => {
    const status = panel.querySelector('p[role=status]'),
      box = panel.getBoundingClientRect(),
      toggle = document.querySelector('.sound-controls > button'),
      sound = toggle.getBoundingClientRect(),
      band = document.querySelector('.attempt-controls').getBoundingClientRect();
    return {
      sentence: status.textContent,
      clipped:
        status.scrollWidth > status.clientWidth + 1 ||
        status.scrollHeight > status.clientHeight + 1,
      inside:
        box.left >= 0 &&
        box.top >= 0 &&
        box.right <= window.innerWidth &&
        box.bottom <= window.innerHeight,
      coversBand:
        box.left < band.right &&
        box.right > band.left &&
        box.top < band.bottom &&
        box.bottom > band.top,
      soundReached: toggle.contains(
        document.elementFromPoint(sound.left + sound.width / 2, sound.top + sound.height / 2),
      ),
    };
  });
  equal(narrow.sentence, 'Overlaps another part. Move the preview clear.');
  equal(
    [narrow.clipped, narrow.inside, narrow.coversBand, narrow.soundReached],
    [false, true, false, true],
  );
  equal(await page.getByRole('button', { name: 'Place part', exact: true }).isEnabled(), false);
  await page.screenshot({ path: '/tmp/placement-strip-780-invalid.png' });
  await page.keyboard.press('Escape');
  equal((await read()).blueprint, placed.blueprint);
  // The drawer is bounded and choosing then cancelling returns to the same browser.
  await page.setViewportSize({ width: 600, height: 800 });
  await addPart.click();
  await search.fill('battery');
  await page.getByRole('button', { name: 'Power Cell', exact: true }).click();
  await page.keyboard.press('Escape');
  // Narrow: cancelling a placement leaves the catalogue away until it is summoned again,
  // and summoning brings the snapshot back.
  equal(await page.locator('.catalog-expanded').count(), 0);
  equal((await read()).blueprint, placed.blueprint);
  const canvas = page.locator('.stage canvas');
  const bounds = await canvas.boundingBox();
  equal(bounds.width >= 570, true);
  await addPart.click();
  equal(await search.inputValue(), 'battery', 'the snapshot returns with the overlay');
  await search.fill('beam');
  await page.getByRole('button', { name: 'Beam', exact: true }).click();
  const tapX = bounds.x + bounds.width * 0.7,
    tapY = bounds.y + bounds.height * 0.35;
  // Right-click must never confirm a proposal.
  await page.mouse.click(tapX, tapY, { button: 'right' });
  equal((await read()).blueprint, placed.blueprint);
  // Measure the delivered touch and camera at admission: framing may still be
  // easing, and browsers may quantize the requested touch coordinates.
  await page.evaluate(() => {
    const capture = (event) => {
      if (event.pointerType !== 'touch') return;
      window.removeEventListener('pointerup', capture, true);
      const rect = document.querySelector('.stage canvas').getBoundingClientRect();
      window.catalogTouch = {
        x: event.clientX,
        y: event.clientY,
        bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        camera: window.workshopProbe.readInteractionState().camera,
      };
    };
    window.addEventListener('pointerup', capture, true);
  });
  await page.touchscreen.tap(tapX, tapY);
  const touch = await page.evaluate(() => {
    const value = window.catalogTouch;
    delete window.catalogTouch;
    return value;
  });
  equal(Math.abs(touch.x - tapX) <= 1 && Math.abs(touch.y - tapY) <= 1, true);
  const touchCameraState = touch.camera;
  camera.aspect = touchCameraState.aspect;
  camera.updateProjectionMatrix();
  camera.position.fromArray(touchCameraState.position);
  camera.lookAt(new THREE.Vector3(...touchCameraState.target));
  camera.updateMatrixWorld();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(
    new THREE.Vector2(
      ((touch.x - touch.bounds.x) / touch.bounds.width) * 2 - 1,
      1 - ((touch.y - touch.bounds.y) / touch.bounds.height) * 2,
    ),
    camera,
  );
  const height = CATALOG.beam.primitives[0].halfExtents[1];
  const expectedPosition = ray.ray.intersectPlane(
    new THREE.Plane(new THREE.Vector3(0, 1, 0), -height),
    new THREE.Vector3(),
  );
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const tapped = await read();
  equal(tapped.blueprint.parts.length, placed.blueprint.parts.length + 1);
  equal(tapped.blueprint.parts.at(-1).position, [
    Math.round(expectedPosition.x / 0.025) * 0.025,
    height,
    Math.round(expectedPosition.z / 0.025) * 0.025,
  ]);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  equal((await read()).blueprint, placed.blueprint);
  // Loading saved favorites must not depend on a machine save.
  // Reload repeats application startup before the five-second interaction budget.
  page.setDefaultTimeout(30000);
  await evidence.reload(page);
  await page.waitForFunction(() => window.render_game_to_text);
  page.setDefaultTimeout(5000);
  await page.locator('[data-command=add-part]').click();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  equal(
    await page
      .locator('.catalog-entry:not([hidden]) [data-part-type]')
      .getAttribute('data-part-type'),
    'powerCell',
  );
  evidence.assertUnchanged();
  console.log(
    'Parts catalog: search, preview, cancellation, help, favorites and compact drawer passed',
  );
} catch (error) {
  await evidence.captureFailure(error);
  throw error;
} finally {
  await browser.close();
}
