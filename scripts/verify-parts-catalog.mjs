import { createBrowserEvidence } from './browser-evidence.mjs';
import * as THREE from 'three';
import { CATALOG } from '../src/model/catalog.mjs';
import { browseAllParts } from './catalog-browser-actions.mjs';
const evidence = createBrowserEvidence();
const browser = await evidence.launch({ profile: 'ui' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
const equal = (a, b) => evidence.assert('deepEqual', [a, b]);
const read = () => page.evaluate(() => JSON.parse(window.render_game_to_text()).metadata);
try {
  await evidence.goto(page, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await page.waitForFunction(() => window.render_game_to_text);
  page.setDefaultTimeout(5000);
  const original = await read();
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
  }
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
  await page.getByRole('button', { name: 'Cancel placement', exact: true }).click();
  equal(await read(), original);
  await page.getByRole('button', { name: 'Power Cell', exact: true }).click();
  await page.getByRole('button', { name: 'Place part', exact: true }).click();
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
  await page.getByRole('button', { name: 'Save to favorites', exact: true }).click();
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
  await page.getByRole('button', { name: 'Expand parts', exact: true }).click();
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
    { timeout: 2000 },
  );
  await page.mouse.move(10, 40, { steps: 4 });
  await page.mouse.up();
  equal(await page.locator('.catalog-expanded').isVisible(), true);
  equal(await read(), placed);
  equal(await search.inputValue(), 'wheel');
  await page.getByRole('button', { name: 'Close parts', exact: true }).click();
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
  // The drawer is bounded and choosing then cancelling returns to the same browser.
  await page.setViewportSize({ width: 600, height: 800 });
  await page.getByRole('button', { name: 'Expand parts', exact: true }).click();
  await search.fill('battery');
  await page.getByRole('button', { name: 'Power Cell', exact: true }).click();
  await page.keyboard.press('Escape');
  equal(await page.locator('.catalog-expanded').isVisible(), true);
  equal((await read()).blueprint, placed.blueprint);
  const canvas = page.locator('.stage canvas');
  await page.getByRole('button', { name: 'Close parts', exact: true }).click();
  const bounds = await canvas.boundingBox();
  equal(bounds.width >= 570, true);
  await page.getByRole('button', { name: 'Expand parts', exact: true }).click();
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
  await page.getByRole('button', { name: 'Expand parts', exact: true }).click();
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
