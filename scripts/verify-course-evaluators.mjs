import { assert } from "./lib/assert.mjs";
import { WORKSHOP_TEST_SITE } from "../src/application/testing-playground-content.js";
import {
  sweptTestSiteShapeEntry,
  TestCourseRun,
} from "../src/model/test-course-evaluator.js";

const close = (actual, expected, tolerance = 1e-10) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
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
assert.equal(
  sweptTestSiteShapeEntry(rectangle, { x: -4, z: 2 }, { x: 4, z: 4 }),
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
const rotate = ([x, z], angle) => ({
    x: x * Math.cos(angle) - z * Math.sin(angle),
    z: x * Math.sin(angle) + z * Math.cos(angle),
  }),
  obliqueAngle = Math.PI / 6,
  obliqueRectangle = { ...rectangle, rotationRad: obliqueAngle },
  obliqueEllipse = { ...ellipse, rotationRad: obliqueAngle };
close(
  sweptTestSiteShapeEntry(
    obliqueRectangle,
    rotate([-3, 0.4], obliqueAngle),
    rotate([3, 0.4], obliqueAngle),
  ),
  1 / 6,
);
close(
  sweptTestSiteShapeEntry(
    obliqueEllipse,
    rotate([-3, 0], obliqueAngle),
    rotate([3, 0], obliqueAngle),
  ),
  1 / 6,
);
close(
  sweptTestSiteShapeEntry(rectangle, { x: -4, z: -2 }, { x: 4, z: 2 }),
  1 / 4,
);
close(sweptTestSiteShapeEntry(rectangle, { x: -3, z: 0 }, { x: -2, z: 0 }), 1);
close(sweptTestSiteShapeEntry(ellipse, { x: -3, z: 0 }, { x: -2, z: 0 }), 1);
assert.equal(
  sweptTestSiteShapeEntry(rectangle, { x: 0.5, z: 0.5 }, { x: 0.5, z: 0.5 }),
  0,
);
const polygonGate = {
    kind: "polygon",
    centerM: [0, 0],
    ringsM: [
      [
        [-2, -1],
        [2, -1],
        [2, 1],
        [-2, 1],
      ],
    ],
    rotationRad: 0,
  },
  corridorGate = {
    kind: "corridor-network",
    centerM: [0, 0],
    pathsM: [
      [
        [-2, 0],
        [2, 0],
      ],
    ],
    widthM: 2,
    cap: "round",
    join: "round",
    rotationRad: 0,
  };
close(
  sweptTestSiteShapeEntry(polygonGate, { x: -4, z: 0 }, { x: 4, z: 0 }),
  1 / 4,
  1e-8,
);
close(
  sweptTestSiteShapeEntry(
    polygonGate,
    { x: -4.3, z: 0.27 },
    { x: 3.7, z: 0.27 },
  ),
  2.3 / 8,
  1e-8,
);
close(
  sweptTestSiteShapeEntry(corridorGate, { x: 0, z: -4 }, { x: 0, z: 4 }),
  3 / 8,
  1e-8,
);
assert.equal(
  sweptTestSiteShapeEntry(polygonGate, { x: -4, z: 3 }, { x: 4, z: 3 }),
  null,
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
swept.step(frame(1, -175, -80));
const highSpeed = swept.step(frame(2, -175, 35));
assert.equal(highSpeed.status, "running");
assert.deepEqual(highSpeed.passedGateIds, [
  "durability-entry",
  "durability-mid",
  "durability-finish",
]);
assert.equal(swept.step(frame(92, -175, 27)).status, "complete");
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
reverse.step(frame(1, -175, 35));
const reverseResult = reverse.step(frame(2, -175, -80));
assert.equal(reverseResult.status, "failed");
assert.equal(reverseResult.failureReason, "out-of-order:durability-finish");

const mismatch = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "suspension-shakedown",
});
assert.equal(
  mismatch.step(frame(1, -175, -80, { siteId: "different-site" })).status,
  "failed",
);
assert.throws(
  () => mismatch.step(frame(1, -175, -80)),
  (error) => error.code === "NON_MONOTONIC_TEST_COURSE_TICK",
);

const replay = () => {
  const run = new TestCourseRun({
    testSite: WORKSHOP_TEST_SITE,
    routeId: "suspension-shakedown",
  });
  return [
    run.step(frame(1, -175, -80)),
    run.step(frame(2, -175, -20)),
    run.step(frame(3, -175, 27)),
  ];
};
assert.deepEqual(replay(), replay(), "course replay was not deterministic");

const damaged = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "suspension-shakedown",
});
assert.equal(damaged.step(frame(1, -175, -80, { damage: 1 })).status, "failed");
assert.equal(damaged.snapshot().failureReason, "damage-limit-exceeded");
const detachedDamage = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "suspension-shakedown",
});
const detachedFrame = frame(1, -175, -80);
detachedFrame.systems.structures = {
  failedCount: 0,
  detachedPartIds: [88],
};
assert.equal(detachedDamage.step(detachedFrame).status, "failed");

const braking = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "brake-lab",
});
braking.step(frame(1, -120, 68, { speedMps: 5 }));
assert.equal(
  braking.step(frame(2, -132, 68, { speedMps: 5 })).status,
  "running",
);
braking.step(frame(3, -165, 82));
assert.equal(braking.step(frame(123, -165, 82)).status, "complete");
const slowEntry = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "brake-lab",
});
slowEntry.step(frame(1, -120, 68, { speedMps: 2 }));
assert.equal(
  slowEntry.step(frame(2, -132, 68, { speedMps: 2 })).failureReason,
  "gate-condition:handling-entry",
);

const surface = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "surface-sampler",
});
surface.step(frame(1, -100, 82, { materialKey: "dry-asphalt" }));
surface.step(frame(2, -92, 82, { materialKey: "dry-asphalt" }));
surface.step(frame(3, -48, 82, { materialKey: "short-grass" }));
surface.step(frame(4, -37, 82, { materialKey: "loose-gravel" }));
surface.step(frame(5, -15, 82, { materialKey: "saturated-mud" }));
surface.step(frame(6, 2, 82, { materialKey: "saturated-mud" }));
assert.equal(
  surface.step(frame(96, 2, 82, { materialKey: "saturated-mud" })).status,
  "complete",
);

const ford = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "ford-crossing",
});
ford.step(frame(1, -205, -94));
ford.step(frame(2, -199, -94));
ford.step(frame(3, -181, -94, { fluidId: "shallow-ford" }));
ford.step(frame(4, -163, -94));
assert.equal(ford.step(frame(94, -163, -94)).status, "complete");

const runway = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "runway-circuit",
});
runway.step(frame(1, 192, -140, { speedMps: 4 }));
runway.step(frame(2, 192, -132, { speedMps: 5 }));
runway.step(frame(3, 192, -72, { grounded: false, speedMps: 28 }));
runway.step(frame(4, 192, 15, { grounded: false, speedMps: 30 }));
runway.step(frame(5, 192, 48, { grounded: true, speedMps: 22 }));
runway.step(frame(6, 192, 100, { speedMps: 3 }));
assert.equal(
  runway.step(frame(66, 192, 100, { speedMps: 0 })).status,
  "complete",
);

const landing = new TestCourseRun({
  testSite: WORKSHOP_TEST_SITE,
  routeId: "helipad-precision",
});
assert.equal(landing.step(frame(1, 104, -90)).status, "running");
assert.equal(landing.snapshot().nextGateId, "helipad-approach");
landing.step(frame(2, 104, -75, { grounded: false, speedMps: 4 }));
landing.step(frame(3, 104, -60, { grounded: false, speedMps: 2 }));
const touchdown = landing.step(frame(184, 104, -43, { speedMps: 0.5 }));
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
const outsideFinish = new TestCourseRun({
  testSite: boundarySite,
  routeId: "state-route",
  targetPartId: 9,
});
outsideFinish.step(boundaryFrame(1, -3, 5));
assert.equal(outsideFinish.step(boundaryFrame(2, 3, 5)).status, "running");
for (const { grounded, speedMps } of [
  { grounded: false, speedMps: 10.01 },
  { grounded: false, speedMps: 5 },
]) {
  const finishSite = structuredClone(boundarySite);
  finishSite.id = `finish-site-${speedMps}`;
  finishSite.routes[0].requirements[0].maxSpeedMps = 20;
  finishSite.routes[0].finish = {
    grounded: speedMps === 5,
    maxSpeedMps: 10,
    holdS: 0,
  };
  const run = new TestCourseRun({
    testSite: finishSite,
    routeId: "state-route",
    targetPartId: 9,
  });
  const startFrame = boundaryFrame(1, -3, 5);
  startFrame.systems.testSite.siteId = finishSite.id;
  run.step(startFrame);
  const finishFrame = boundaryFrame(2, 0, speedMps);
  finishFrame.systems.testSite.siteId = finishSite.id;
  finishFrame.systems.testSite.components[0].grounded = grounded;
  assert.equal(run.step(finishFrame).status, "running");
}
const terminalRun = new TestCourseRun({
  testSite: boundarySite,
  routeId: "state-route",
  targetPartId: 9,
});
terminalRun.step(boundaryFrame(1, -3, 5));
const terminalSnapshot = terminalRun.step(boundaryFrame(2, 0, 5));
assert.equal(terminalSnapshot.status, "complete");
assert.deepEqual(terminalRun.step(boundaryFrame(3, 3, 50)), {
  ...terminalSnapshot,
  tick: 3,
});
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
