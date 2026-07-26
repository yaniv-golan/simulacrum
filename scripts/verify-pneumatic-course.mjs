import assert from "node:assert/strict";
import { WORKSHOP_TEST_SITE } from "../src/application/testing-playground-content.js";
import { TestCourseRun } from "../src/model/test-course-evaluator.js";
import {
  createPneumaticState,
  pneumaticRollingLoss,
  solvePneumaticStaticLoad,
  TYPES,
} from "../src/core/index.js";

const route = WORKSHOP_TEST_SITE.routes.find(
    ({ id }) => id === "tire-pressure-comparison",
  ),
  wheelLaw = TYPES.wheel.mechanism.config.tireConstitutiveLaw,
  chamber = wheelLaw.pneumaticChamber,
  ambientPressurePa = 101_325;
assert.ok(route, "Test Reserve tire-pressure comparison course is missing");

function runPressureCase(gaugePressurePa) {
  const gasState = createPneumaticState({
      absolutePressurePa: ambientPressurePa + gaugePressurePa,
      temperatureK: chamber.initialGasTemperatureK,
      volumeM3: chamber.referenceInternalVolumeM3,
    }),
    staticState = solvePneumaticStaticLoad({
      chamber,
      normalModel: wheelLaw.normalModel,
      state: gasState,
      ambientPressurePa,
      loadN: 5_000,
    }),
    rolling = pneumaticRollingLoss({
      rollingResistance: wheelLaw.rollingResistance,
      normalLoadN: 5_000,
      deflectionM: staticState.deflectionM,
      radiusM: TYPES.wheel.mechanism.config.radiusM,
    }),
    course = new TestCourseRun({
      testSite: WORKSHOP_TEST_SITE,
      routeId: route.id,
      targetPartId: 1,
    });
  let tick = 0,
    snapshot;
  const stepAt = (position, speedMps) => {
    tick++;
    snapshot = course.step({
      tick,
      systems: {
        testSite: {
          siteId: WORKSHOP_TEST_SITE.id,
          components: [
            {
              componentId: "pressure-fixture",
              partIds: [1],
              position,
              grounded: true,
              speedMps,
              materialKey: "weathered-concrete",
              districtId: "durability",
              fluidId: null,
            },
          ],
        },
        structures: { failedCount: 0, detachedPartIds: [] },
        pneumatics: {
          transactionId: tick,
          chambers: [
            {
              partId: 1,
              controlVolumeKind: "tire-chamber-v1",
              gaugePressurePa,
              temperatureK: chamber.initialGasTemperatureK,
              gasMassKg: gasState.massKg,
              failureMode: null,
            },
          ],
        },
        mobility: {
          assemblies: [
            {
              wheelStates: [
                {
                  partId: 1,
                  carcassDeflectionM: staticState.deflectionM,
                  rimLoadN: 0,
                  effectiveRollingResistanceCoefficient:
                    rolling.effectiveCoefficient,
                },
              ],
            },
          ],
        },
      },
    });
  };
  for (const gateId of route.gateIds) {
    const gate = WORKSHOP_TEST_SITE.zones.find(({ id }) => id === gateId);
    stepAt({ x: gate.shape.centerM[0], z: gate.shape.centerM[1] }, 0.8);
  }
  const finish = WORKSHOP_TEST_SITE.zones.find(
    ({ id }) => id === route.gateIds.at(-1),
  );
  for (let hold = 0; hold < 92; hold++)
    stepAt({ x: finish.shape.centerM[0], z: finish.shape.centerM[1] }, 0);
  assert.equal(snapshot.status, "complete");
  assert.equal(snapshot.pneumaticEvidence.length, 1);
  return snapshot.pneumaticEvidence[0];
}

const evidence = [80_000, 220_000, 400_000].map(runPressureCase);
assert.ok(
  evidence[0].maximumDeflectionM > evidence[1].maximumDeflectionM &&
    evidence[1].maximumDeflectionM > evidence[2].maximumDeflectionM,
);
assert.ok(
  evidence[0].maximumRollingLossCoefficient >
    evidence[1].maximumRollingLossCoefficient &&
    evidence[1].maximumRollingLossCoefficient >
      evidence[2].maximumRollingLossCoefficient,
);
assert.deepEqual(
  evidence.map(({ minimumGaugePressurePa }) => minimumGaugePressurePa),
  [80_000, 220_000, 400_000],
);

console.log("pneumatic course passed (low/nominal/high evidence is ordered)");
