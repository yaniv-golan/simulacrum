import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createArticulatedSuspensionBench,
  createManualActiveSuspensionBench,
  createActiveSuspensionBench,
  createPinEndedStrut,
} from '../src/model/fixtures/articulated-suspension.mjs';
import { compileAssembly } from '../src/model/assembly.mjs';
import { createPhysicsWorld } from '../src/simulation/physics/world.mjs';
import { createSession } from '../src/simulation/session.mjs';
import { createWorkshop } from '../src/core/workshop.mjs';
import { createEmptyBlueprint, createPart, loadSave } from '../src/model/blueprint.mjs';
import { captureAssembly, insertAssembly } from '../src/model/reusable-assemblies.mjs';
import { CATALOG } from '../src/model/catalog.mjs';
import { rotateVector, solidsOverlap, placementEnvelopes } from '../src/model/surfaces.mjs';
import {
  configuration,
  sample,
  supportFor,
  supported,
  tracking,
  automatic,
  worldPoint,
  checkPinFrames,
  swivelled,
  pinRotation,
  bothPinsMove,
  loadRejection,
  recovered,
  clearanceChecker,
} from './contracts/suspension.mjs';

test('finite active and manual bench travel retains moving hardware and decorative coil clearance', async () => {
  for (const mode of ['automatic', 'manual']) {
    const bp = createActiveSuspensionBench(),
      config = configuration(bp),
      s = await createSession(config),
      check = clearanceChecker(bp, config),
      node = bp.parts.findIndex((p) => p.id === 'rocker-receiver');
    try {
      assert.ok(s.act({ type: 'receiver-mode', node, mode }).ok);
      for (const target of [0.26, 0.33, 0.3]) {
        if (mode === 'automatic') assert.ok(s.act({ type: 'regulator-target', node, target }).ok);
        else assert.ok(s.act({ type: 'receiver', node, duty: target === 0.33 ? -0.2 : 0.2 }).ok);
        let reached = false;
        for (let tick = 0; tick < 600; tick++) {
          s.step();
          const frame = s.observe().frames[0];
          assert.equal(frame.status, 'ready');
          check(frame);
          if (
            mode === 'manual' &&
            ((target === 0.33 && frame.springs[0].length >= target) ||
              (target !== 0.33 && frame.springs[0].length <= target))
          ) {
            check(frame);
            reached = true;
            break;
          }
        }
        if (mode === 'manual')
          assert.ok(reached, 'manual sweep must reach both declared travel bounds');
      }
      const wrong = structuredClone(s.observe().frames[0]);
      const cross = bp.parts.findIndex((p) => p.id === 'cross'),
        pedestal = bp.parts.findIndex((p) => p.id === 'pedestal');
      wrong.physics[cross].position = [...wrong.physics[pedestal].position];
      assert.throws(() => check(wrong), /hardware clearance|coil clearance/);
      const stale = structuredClone(s.observe().frames[0]);
      stale.physics[pedestal].position = stale.springs[0].pointA.map(
        (v, i) => (v + stale.springs[0].pointB[i]) / 2,
      );
      assert.throws(() => check(stale), /tilt|clearance/);
    } finally {
      s.dispose();
    }
  }
});
