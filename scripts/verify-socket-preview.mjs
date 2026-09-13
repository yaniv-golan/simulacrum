import { uploadWorkshopFile } from './browser-evidence.mjs';
import { browserArtifactPath } from './browser-artifacts.mjs';
import { createBrowserEvidence } from './browser-evidence.mjs';

import * as THREE from 'three';

import { mkdirSync, writeFileSync } from 'node:fs';
import { createEmptyBlueprint, createPart } from '../src/model/blueprint.mjs';
import { snapConnection } from '../src/model/assembly.mjs';
const browserEvidence = createBrowserEvidence();

const out = browserArtifactPath('artifacts/socket-preview');
mkdirSync(out, { recursive: true });
const bp = {
  ...createEmptyBlueprint('preview', 'Preview'),
  parts: [
    createPart('poweredMotor', 'motor', [0, 0.4, 0]),
    createPart('gripWheel', 'wheel', [0.6, 0.4, 0]),
  ],
};
writeFileSync(`${out}/machine.json`, JSON.stringify(bp));
const b = await browserEvidence.launch({ profile: 'ui', ...{} }),
  p = await b.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = browserEvidence.errors;

try {
  await browserEvidence.goto(p, process.argv[2] ?? 'http://127.0.0.1:4173/');
  await uploadWorkshopFile(p, `${out}/machine.json`);
  await p.locator('[data-port-id=axle]').click();
  const button = p.locator('[data-target-part-id=motor]');
  await button.hover();
  const ui = await p.evaluate(() => window.workshopProbe.readInteractionState()),
    camera = new THREE.PerspectiveCamera(ui.camera.fov, ui.camera.aspect, 0.01, 100);
  camera.position.fromArray(ui.camera.position);
  camera.lookAt(new THREE.Vector3(...ui.camera.target));
  camera.updateMatrixWorld();
  const next = snapConnection(
      bp,
      { part: 'wheel', port: 'axle' },
      { part: 'motor', port: 'shaft' },
    ),
    pos = new THREE.Vector3(...next.parts[0].position).project(camera),
    rect = await p.locator('canvas[aria-label="Machine view"]').boundingBox();
  await p.mouse.click(
    rect.x + ((pos.x + 1) * rect.width) / 2,
    rect.y + ((1 - pos.y) * rect.height) / 2,
  );
  browserEvidence.assert('equal', [
    await p.evaluate(
      () => window.workshopProbe.observe().frames[0].metadata.blueprint.connections.length,
    ),
    1,
  ]);
  await p.screenshot({ path: `${out}/connected.png` });
  browserEvidence.assert('deepEqual', [errors, []]);
  console.log('PASS ghost click attaches without losing selection');
} catch (error) {
  await browserEvidence.captureFailure(error);
  throw error;
} finally {
  try {
    browserEvidence.assertUnchanged();
  } finally {
    await b.close();
  }
}
