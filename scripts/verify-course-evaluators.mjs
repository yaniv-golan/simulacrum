import { assert } from "./lib/assert.mjs";
import { WORKSHOP_TEST_SITE } from "../src/application/testing-playground-content.js";
import {
  sweptTestSiteShapeEntry,
  TestCourseRun,
} from "../src/model/test-course-evaluator.js";

const close = (actual, expected) =>
  assert.ok(
    Math.abs(actual - expected) < 1e-10,
    `${actual} did not equal ${expected}`,
  );

const rectangle = {
    kind: "rectangle",
    centerM: [0, 0],
    sizeM: [4, 2],
    rotationRad: 0,
  },
  ellipse = { ...rectangle, kind: "ellipse" };
close(
  sweptTestSiteShapeEntry(rectangle, { x: -3, z: 0 }, { x: 3, z: 0 }),
  1 / 6,
);
close(
  sweptTestSiteShapeEntry(rectangle, { x: 0, z: -3 }, { x: 0, z: 3 }),
  1 / 3,
);
assert.equal(
  sweptTestSiteShapeEntry(rectangle, { x: 0, z: 0 }, { x: 3, z: 0 }),
  0,
);
assert.equal(
  sweptTestSiteShapeEntry(rectangle, { x: -3, z: 2 }, { x: 3, z: 2 }),
  null,
);
assert.equal(
  sweptTestSiteShapeEntry(rectangle, { x: -4, z: 0 }, { x: -3, z: 0 }),
  null,
);
close(sweptTestSiteShapeEntry(ellipse, { x: -3, z: 0 }, { x: 3, z: 0 }), 1 / 6);
close(sweptTestSiteShapeEntry(ellipse, { x: -3, z: 1 }, { x: 3, z: 1 }), 0.5);
assert.equal(
  sweptTestSiteShapeEntry(ellipse, { x: 0, z: 0 }, { x: 3, z: 0 }),
  0,
);
assert.equal(
  sweptTestSiteShapeEntry(ellipse, { x: -3, z: 2 }, { x: 3, z: 2 }),
  null,
);
assert.equal(
  sweptTestSiteShapeEntry(ellipse, { x: -3, z: 2 }, { x: -3, z: 2 }),
  null,
);
const rotatedRectangle = { ...rectangle, rotationRad: Math.PI / 2 },
  rotatedEllipse = { ...ellipse, rotationRad: Math.PI / 2 };
close(
  sweptTestSiteShapeEntry(rotatedRectangle, { x: 0, z: -3 }, { x: 0, z: 3 }),
  1 / 6,
);
close(
  sweptTestSiteShapeEntry(rotatedEllipse, { x: 0, z: -3 }, { x: 0, z: 3 }),
  1 / 6,
);

const frame = (
  tick,
  x,
  z,
  {
    siteId = WORKSHOP_TEST_SITE.id,
    grounded = true,
    speedMps = 0,
    materialKey = "dry-asphalt",
    fluidId = null,
    damage = 0,
  } = {},
) => ({
  tick,
  systems: {
    structures: { failedCount: damage, detachedPartIds: [] },
    testSite: {
      siteId,
      components: [
        {
          componentId: "machine",
          partIds: [1, 2],
          position: { x, y: 0.5, z },
          districtId: "airfield",
          materialKey,
          fluidId,
          grounded,
          speedMps,
        },
      ],
    },
  },
});

const swept = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "suspension-shakedown",
  targetPartId: 1,
});
swept.step(frame(1, -170, -46));
const highSpeed = swept.step(frame(2, -50, -46));
assert.equal(highSpeed.status, "running");
assert.deepEqual(highSpeed.passedGateIds, [
  "durability-entry",
  "durability-mid",
  "durability-finish",
]);
assert.equal(swept.step(frame(92, -63, -46)).status, "complete");
assert.throws(
  () =>
    new TestCourseRun({
      testSite: WORKSHOP_TEST_SITE,
      routeId: "missing-route",
    }),
  (error) => error.code === "UNKNOWN_TEST_COURSE",
);

const unavailable = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "surface-sampler",
});
assert.deepEqual(
  unavailable.step({
    tick: 1,
    systems: {
      testSite: { siteId: WORKSHOP_TEST_SITE.id, components: [] },
    },
  }),
  {
    siteId: WORKSHOP_TEST_SITE.id,
    routeId: "surface-sampler",
    status: "running",
    tick: 1,
    passedGateIds: [],
    nextGateId: "surface-asphalt",
    progress: 0,
    finishHoldS: 0,
    failureReason: "component-telemetry-unavailable",
    districtId: null,
    materialKey: null,
    fluidId: null,
    grounded: false,
    speedMps: 0,
    binding: null,
    requirements: [
      {
        kind: "visit-materials",
        id: "dry-asphalt+loose-gravel+saturated-mud+short-grass",
        met: false,
      },
      { kind: "remain-intact", id: "remain-intact", met: true },
    ],
  },
);

const reverse = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "suspension-shakedown",
});
reverse.step(frame(1, -50, -46));
const reverseResult = reverse.step(frame(2, -170, -46));
assert.equal(reverseResult.status, "failed");
assert.equal(reverseResult.failureReason, "out-of-order:durability-finish");

const mismatch = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "suspension-shakedown",
});
assert.equal(
  mismatch.step(frame(1, -170, -46, { siteId: "different-site" })).status,
  "failed",
);
assert.throws(
  () => mismatch.step(frame(1, -170, -46)),
  (error) => error.code === "NON_MONOTONIC_TEST_COURSE_TICK",
);

const replay = () => {
  const run = new TestCourseRun({
    testSite: WORKSHOP_TEST_SITE,
    routeId: "suspension-shakedown",
  });
  return [
    run.step(frame(1, -170, -46)),
    run.step(frame(2, -110, -46)),
    run.step(frame(3, -63, -46)),
  ];
};
assert.deepEqual(replay(), replay(), "course replay was not deterministic");

const damaged = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "suspension-shakedown",
});
assert.equal(damaged.step(frame(1, -170, -46, { damage: 1 })).status, "failed");
assert.equal(damaged.snapshot().failureReason, "damage-limit-exceeded");
const detachedDamage = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "suspension-shakedown",
});
const detachedFrame = frame(1, -170, -46);
detachedFrame.systems.structures = {
  failedCount: 0,
  detachedPartIds: [88],
};
assert.equal(detachedDamage.step(detachedFrame).status, "failed");

const braking = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "brake-lab",
});
braking.step(frame(1, -40, 24, { speedMps: 5 }));
assert.equal(
  braking.step(frame(2, -54, 24, { speedMps: 5 })).status,
  "running",
);
braking.step(frame(3, -82, 24));
assert.equal(braking.step(frame(123, -82, 24)).status, "complete");
const slowEntry = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "brake-lab",
});
slowEntry.step(frame(1, -40, 24, { speedMps: 2 }));
assert.equal(
  slowEntry.step(frame(2, -54, 24, { speedMps: 2 })).failureReason,
  "gate-condition:handling-entry",
);

const surface = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "surface-sampler",
});
surface.step(frame(1, 80, -85, { materialKey: "dry-asphalt" }));
surface.step(frame(2, 96, -85, { materialKey: "dry-asphalt" }));
surface.step(frame(3, 96, -33, { materialKey: "short-grass" }));
surface.step(frame(4, 96, -20, { materialKey: "loose-gravel" }));
surface.step(frame(5, 96, 6, { materialKey: "saturated-mud" }));
surface.step(frame(6, 145, 6, { materialKey: "saturated-mud" }));
assert.equal(
  surface.step(frame(96, 145, 6, { materialKey: "saturated-mud" })).status,
  "complete",
);

const ford = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "ford-crossing",
});
ford.step(frame(1, -90, -108));
ford.step(frame(2, -82, -108));
ford.step(frame(3, -67, -108, { fluidId: "shallow-ford" }));
ford.step(frame(4, -48, -108));
assert.equal(ford.step(frame(94, -50, -108)).status, "complete");

const runway = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "runway-circuit",
});
runway.step(frame(1, -112, 154, { speedMps: 4 }));
runway.step(frame(2, -105, 154, { speedMps: 5 }));
runway.step(frame(3, -55, 154, { grounded: false, speedMps: 28 }));
runway.step(frame(4, 23, 154, { grounded: false, speedMps: 30 }));
runway.step(frame(5, 60, 154, { grounded: true, speedMps: 22 }));
runway.step(frame(6, 110, 154, { speedMps: 3 }));
assert.equal(
  runway.step(frame(66, 108, 154, { speedMps: 0 })).status,
  "complete",
);

const landing = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "helipad-precision",
});
assert.equal(landing.step(frame(1, 178, 124)).status, "running");
assert.equal(landing.snapshot().nextGateId, "helipad-approach");
landing.step(frame(2, 145, 124, { grounded: false, speedMps: 4 }));
landing.step(frame(3, 160, 124, { grounded: false, speedMps: 2 }));
const touchdown = landing.step(frame(184, 178, 124, { speedMps: 0.5 }));
assert.equal(touchdown.status, "complete");

const boundarySite = {
    id: "boundary-site",
    zones: [
      {
        id: "state-gate",
        shape: {
          kind: "rectangle",
          centerM: [0, 0],
          sizeM: [2, 2],
          rotationRad: Math.PI / 6,
        },
      },
    ],
    routes: [
      {
        id: "state-route",
        gateIds: ["state-gate"],
        requirements: [
          {
            kind: "gate-state",
            gateId: "state-gate",
            grounded: null,
            minSpeedMps: 5,
            maxSpeedMps: 10,
          },
        ],
        finish: { grounded: false, maxSpeedMps: 10, holdS: 0 },
      },
    ],
  },
  boundaryFrame = (tick, x, speedMps, components = null) => ({
    tick,
    systems: {
      structures: { failedCount: 0, detachedPartIds: [] },
      testSite: {
        siteId: boundarySite.id,
        components: components || [
          {
            componentId: "boundary-machine",
            partIds: [9, 3],
            position: { x, y: 0, z: 0 },
            districtId: "boundary",
            materialKey: "material-a",
            fluidId: "fluid-a",
            grounded: false,
            speedMps,
          },
        ],
      },
    },
  });
for (const speed of [5, 10]) {
  const run = new TestCourseRun({
    testSite: boundarySite,
    routeId: "state-route",
    targetPartId: 9,
  });
  run.step(boundaryFrame(1, -3, speed));
  const result = run.step(boundaryFrame(2, 0, speed));
  assert.equal(result.status, "complete");
  assert.equal(result.progress, 1);
  assert.deepEqual(result.binding, {
    componentId: "boundary-machine",
    partIds: [3, 9],
    rootPartId: 3,
  });
  assert.equal(result.districtId, "boundary");
  assert.equal(result.materialKey, "material-a");
  assert.equal(result.fluidId, "fluid-a");
  assert.equal(result.grounded, false);
  assert.equal(result.speedMps, speed);
  assert.deepEqual(result.requirements, [
    { kind: "gate-state", id: "state-gate", met: true },
  ]);
}
const tooFast = new TestCourseRun({
  testSite: boundarySite,
  routeId: "state-route",
});
tooFast.step(boundaryFrame(1, -3, 10.01));
assert.equal(
  tooFast.step(boundaryFrame(2, 0, 10.01)).failureReason,
  "gate-condition:state-gate",
);

const bindingRun = new TestCourseRun({
  testSite: boundarySite,
  routeId: "state-route",
});
const bindings = [
  {
    componentId: "z-component",
    partIds: [20],
    position: { x: -3, y: 0, z: 0 },
    grounded: true,
    speedMps: 5,
  },
  {
    componentId: "b-component",
    partIds: [30, 31],
    position: { x: -3, y: 0, z: 0 },
    grounded: true,
    speedMps: 5,
  },
  {
    componentId: "a-component",
    partIds: [40, 41],
    position: { x: -3, y: 0, z: 0 },
    grounded: true,
    speedMps: 5,
  },
];
assert.equal(
  bindingRun.step(boundaryFrame(1, -3, 5, bindings)).binding.componentId,
  "a-component",
);

const payloadBinding = new TestCourseRun({
  testSite: boundarySite,
  routeId: "state-route",
});
const payloadTelemetry = boundaryFrame(1, -3, 5, bindings);
payloadTelemetry.systems.challengeBinding = { payloadPartId: 20 };
assert.equal(
  payloadBinding.step(payloadTelemetry).binding.componentId,
  "z-component",
);

console.log(
  "test course evaluators verified swept gates, state criteria, surfaces, water, damage and controlled finishes",
);
