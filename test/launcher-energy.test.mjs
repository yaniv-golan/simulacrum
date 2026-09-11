import test from 'node:test';
import assert from 'node:assert/strict';
import { createSpringLauncher } from '../src/model/fixtures/spring-launcher.mjs';
import {
  launchMechanicalEnergy,
  assertNoCreation,
  rotationDistance,
  launchControls,
  assertReleaseEnergy,
} from './contracts/launcher-energy.mjs';

test('launcher release meets fixed-time energy separation with matched quiet controls', async (t) => {
  const rest = {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    velocity: [2, 0, 0],
    angularVelocity: [1, 0, 0],
  };
  const body = { shape: 'box', mass: 3, halfExtents: [1, 2, 3], fixed: false };
  const numeric = { bodies: [body], joints: [], gravity: [0, -9.81, 0] };
  assert.equal(launchMechanicalEnergy(numeric, [rest], [rest]).kinetic, 12.5);
  const turned = {
    ...rest,
    rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    angularVelocity: [0, 1, 0],
  };
  assert.ok(Math.abs(launchMechanicalEnergy(numeric, [turned], [turned]).kinetic - 12.5) < 1e-12);
  const cylinder = { ...body, shape: 'cylinder', mass: 2, halfExtents: [0.5, 0.1, 0.1] };
  const spin = { ...rest, velocity: [0, 0, 0] };
  assert.ok(
    Math.abs(
      launchMechanicalEnergy({ ...numeric, bodies: [cylinder] }, [spin], [spin]).kinetic - 0.005,
    ) < 1e-15,
  );
  const still = { ...rest, velocity: [0, 0, 0], angularVelocity: [0, 0, 0] };
  const displaced = { ...still, position: [0.2, 1, 0] };
  const elasticConfig = {
    ...numeric,
    bodies: [body, body],
    joints: [
      {
        kind: 'spring',
        a: 0,
        b: 1,
        anchorA: [0, 0, 0],
        anchorB: [0, 0, 0],
        axisA: [1, 0, 0],
        stiffness: 100,
        restLength: 0.3,
      },
    ],
  };
  const energy = launchMechanicalEnergy(elasticConfig, [still, displaced], [still, still]);
  assert.ok(Math.abs(energy.elastic - 0.5) < 1e-14);
  assert.ok(Math.abs(energy.gravity - 29.43) < 1e-12);
  const oriented = { ...still, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2] };
  const offset = { ...still, position: [0, 0.3, 0] };
  const offCenter = {
    ...elasticConfig,
    joints: [{ ...elasticConfig.joints[0], anchorA: [0.1, 0, 0] }],
  };
  assert.ok(
    Math.abs(
      launchMechanicalEnergy(offCenter, [oriented, offset], [oriented, offset]).elastic - 0.5,
    ) < 1e-14,
  );

  assertNoCreation({ uncertainty: 3.6e-6, noncreation: 0 });
  assert.throws(
    () => assertNoCreation({ uncertainty: 3.6e-6, noncreation: 1e-4 }),
    /mechanical energy creation/,
  );
  assert.ok(rotationDistance([0, 0, 0, 1], [0, Math.sin(0.1), 0, Math.cos(0.1)]) > 0.05 * 1.5);
  const [loaded, ...controls] = await launchControls(() =>
    createSpringLauncher({ projectile: 'gripWheel', catcher: false }),
  );
  t.diagnostic(
    JSON.stringify({
      speed: loaded.speed,
      gain: loaded.gain,
      alternative: loaded.alternative,
      positiveWork: loaded.positiveWork,
      positiveConstraintWork: loaded.positiveConstraintWork,
      gravityDrop: loaded.gravityDrop,
      noncreation: loaded.noncreation,
      initial: loaded.mechanicalInitial,
      final: loaded.mechanicalFinal,
    }),
  );
  assertReleaseEnergy(loaded);
  assert.ok(loaded.hold <= 0.01 * (0.4 - 0.08), 'two-second hold within one percent of travel');
  assert.ok(
    loaded.transfer > 0 && loaded.lastContact < 360,
    'spring carriage transfers impulse then separates within one second',
  );
  assert.ok(loaded.initial.energy.springPotentialJ > loaded.final.energy.springPotentialJ);
  assert.ok(loaded.final.power.cells[0].energyJ < loaded.initial.power.cells[0].energyJ);
  for (const control of controls) {
    assert.ok(
      control.gain <= 0.1 * loaded.gain,
      'unloaded control has at most ten percent forward energy',
    );
    assert.ok(
      control.gates.every(
        (angle, i) => rotationDistance(angle, loaded.gates[i]) <= 0.05 * loaded.stroke,
      ),
      'actual gate trajectories match within five percent of stroke',
    );
  }
});
