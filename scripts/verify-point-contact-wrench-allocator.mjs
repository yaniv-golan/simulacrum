import assert from "node:assert/strict";
import { allocatePointContactWrench } from "../src/simulation/point-contact-wrench-allocator.js";

const close = (actual, expected, label, tolerance = 1e-6) =>
    assert.ok(
      Math.abs(actual - expected) <= tolerance,
      `${label}: expected ${expected}, received ${actual}`,
    ),
  closeVector = (actual, expected, label, tolerance = 1e-6) => {
    for (let index = 0; index < expected.length; index++)
      close(actual[index], expected[index], `${label}[${index}]`, tolerance);
  },
  rotate = (value, quaternion) => {
    const [x, y, z] = value,
      [qx, qy, qz, qw] = quaternion,
      tx = 2 * (qy * z - qz * y),
      ty = 2 * (qz * x - qx * z),
      tz = 2 * (qx * y - qy * x);
    return [
      x + qw * tx + (qy * tz - qz * ty),
      y + qw * ty + (qz * tx - qx * tz),
      z + qw * tz + (qx * ty - qy * tx),
    ];
  },
  add = (left, right) => left.map((entry, index) => entry + right[index]),
  contact = ({
    contactId = "contact/center",
    tick = 7,
    pointWorldM = [0, 0, 0],
    normalWorld = [0, 1, 0],
    frictionCoefficient = 0.5,
    normalForceLimitN = 100,
    tangentialForceLimitN = 100,
    geometryValid = true,
    frictionValid = true,
    limitValid = true,
  } = {}) => ({
    contactId,
    tick,
    geometryValid,
    frictionValid,
    limitValid,
    pointWorldM,
    normalWorld,
    frictionCoefficient,
    normalForceLimitN,
    tangentialForceLimitN,
  }),
  request = ({
    tick = 7,
    frameId = "frame/body",
    positionWorldM = [0, 0, 0],
    quaternionWorldFromFrame = [0, 0, 0, 1],
    targetValid = true,
    forceN = [0, 50, 0],
    momentNm = [0, 0, 0],
    contacts = [contact()],
    forceResidualToleranceN = 1e-6,
    momentResidualToleranceNm = 1e-6,
    momentReferenceLengthM = 1,
    maxIterations = 10000,
    projectedGradientToleranceN = 1e-10,
  } = {}) => ({
    tick,
    targetFrame: {
      frameId,
      positionWorldM,
      quaternionWorldFromFrame,
    },
    targetWrenchFrame: { valid: targetValid, forceN, momentNm },
    contacts,
    acceptance: {
      forceResidualToleranceN,
      momentResidualToleranceNm,
      momentReferenceLengthM,
    },
    solver: { maxIterations, projectedGradientToleranceN },
  }),
  allocateRaw = (value) => allocatePointContactWrench(JSON.stringify(value)),
  allocate = (value) => allocateRaw(request(value));

const vertical = allocate();
assert.equal(vertical.authorityValid, true);
assert.equal(vertical.solverConverged, true);
assert.equal(vertical.accepted, true);
assert.equal(vertical.reason, "accepted-v1");
closeVector(vertical.allocations[0].forceFrameN, [0, 50, 0], "vertical");
close(vertical.residualWrenchFrame.forceNormN, 0, "vertical residual");
assert.equal(vertical.allocations[0].saturated, false);
assert.throws(() => (vertical.allocations[0].forceFrameN[0] = 1), TypeError);

const frictionInterior = allocate({ forceN: [20, 50, 0] });
assert.equal(frictionInterior.accepted, true);
closeVector(
  frictionInterior.allocations[0].forceFrameN,
  [20, 50, 0],
  "friction interior",
);
assert.equal(frictionInterior.allocations[0].frictionSaturated, false);

const frictionLimited = allocate({ forceN: [30, 50, 0] });
assert.equal(frictionLimited.solverConverged, true);
assert.equal(frictionLimited.accepted, false);
assert.equal(frictionLimited.reason, "residual-tolerance-exceeded-v1");
closeVector(
  frictionLimited.allocations[0].forceFrameN,
  [26, 52, 0],
  "friction projection",
  2e-6,
);
close(
  frictionLimited.residualWrenchFrame.forceNormN,
  Math.sqrt(20),
  "friction residual",
  2e-6,
);
assert.equal(frictionLimited.allocations[0].frictionSaturated, true);
assert.equal(frictionLimited.saturated, true);
const toleratedResidual = allocate({
  forceN: [30, 50, 0],
  forceResidualToleranceN: 5,
});
assert.equal(toleratedResidual.accepted, true);
assert.equal(toleratedResidual.reason, "accepted-v1");
close(
  toleratedResidual.residualWrenchFrame.forceNormN,
  Math.sqrt(20),
  "caller-tolerated residual",
  2e-6,
);

const tangentialLimited = allocate({
  forceN: [20, 50, 0],
  contacts: [contact({ frictionCoefficient: 1, tangentialForceLimitN: 10 })],
});
assert.equal(tangentialLimited.accepted, false);
closeVector(
  tangentialLimited.allocations[0].forceFrameN,
  [10, 50, 0],
  "tangential actuator limit",
);
assert.equal(tangentialLimited.allocations[0].tangentialLimitSaturated, true);
assert.equal(tangentialLimited.allocations[0].frictionSaturated, false);

const normalLimited = allocate({
  forceN: [0, 120, 0],
  contacts: [contact({ normalForceLimitN: 100 })],
});
assert.equal(normalLimited.accepted, false);
closeVector(
  normalLimited.allocations[0].forceFrameN,
  [0, 100, 0],
  "normal actuator limit",
);
close(normalLimited.residualWrenchFrame.forceNormN, 20, "normal residual");
assert.equal(normalLimited.allocations[0].normalSaturated, true);

const unilateral = allocate({ forceN: [0, -10, 0] });
assert.equal(unilateral.accepted, false);
closeVector(unilateral.allocations[0].forceFrameN, [0, 0, 0], "unilateral");
close(unilateral.residualWrenchFrame.forceNormN, 10, "unilateral residual");
assert.equal(unilateral.saturated, false);

const zeroFriction = allocate({
  forceN: [10, 50, 0],
  contacts: [contact({ frictionCoefficient: 0 })],
});
assert.equal(zeroFriction.accepted, false);
closeVector(
  zeroFriction.allocations[0].forceFrameN,
  [0, 50, 0],
  "zero friction",
);
assert.equal(zeroFriction.allocations[0].frictionSaturated, false);
const zeroNormalCapacity = allocate({
  forceN: [0, 10, 0],
  contacts: [contact({ normalForceLimitN: 0 })],
});
assert.equal(zeroNormalCapacity.accepted, false);
closeVector(
  zeroNormalCapacity.allocations[0].forceFrameN,
  [0, 0, 0],
  "zero normal capacity",
);
assert.equal(zeroNormalCapacity.allocations[0].normalSaturated, false);

const zeroTangentialCapacity = allocate({
  forceN: [0, 50, 0],
  contacts: [contact({ tangentialForceLimitN: 0 })],
});
assert.equal(
  zeroTangentialCapacity.allocations[0].tangentialLimitSaturated,
  false,
);

const highFrictionInterior = allocate({
    forceN: [80, 50, 0],
    contacts: [contact({ frictionCoefficient: 2, tangentialForceLimitN: 200 })],
  }),
  highFrictionLimited = allocate({
    forceN: [120, 50, 0],
    contacts: [contact({ frictionCoefficient: 2, tangentialForceLimitN: 200 })],
  });
assert.equal(highFrictionInterior.accepted, true);
closeVector(
  highFrictionInterior.allocations[0].forceFrameN,
  [80, 50, 0],
  "high-friction interior",
);
assert.equal(highFrictionLimited.accepted, false);
closeVector(
  highFrictionLimited.allocations[0].forceFrameN,
  [116, 58, 0],
  "high-friction projection",
  2e-6,
);
assert.equal(highFrictionLimited.allocations[0].frictionSaturated, true);

const extremeHighFriction = allocate({
    forceN: [1, 1, 0],
    contacts: [
      contact({
        frictionCoefficient: 1e200,
        normalForceLimitN: 10,
        tangentialForceLimitN: 10,
      }),
    ],
  }),
  extremeLowFriction = allocate({
    forceN: [1, 1, 0],
    contacts: [
      contact({
        frictionCoefficient: 1e-200,
        normalForceLimitN: 10,
        tangentialForceLimitN: 10,
      }),
    ],
  });
assert.equal(extremeHighFriction.accepted, true);
closeVector(
  extremeHighFriction.allocations[0].forceFrameN,
  [1, 1, 0],
  "overflow-safe high-friction projection",
);
assert.equal(extremeLowFriction.accepted, false);
assert.ok(extremeLowFriction.allocations[0].tangentialForceN < 1e-100);

for (const boundary of [
  {
    label: "normal",
    request: {
      forceN: [0, 100, 0],
      contacts: [contact({ normalForceLimitN: 100 })],
    },
    field: "normalSaturated",
  },
  {
    label: "friction",
    request: { forceN: [25, 50, 0] },
    field: "frictionSaturated",
  },
  {
    label: "tangential",
    request: {
      forceN: [10, 50, 0],
      contacts: [
        contact({ frictionCoefficient: 1, tangentialForceLimitN: 10 }),
      ],
    },
    field: "tangentialLimitSaturated",
  },
]) {
  const result = allocate(boundary.request);
  assert.equal(result.accepted, true, `${boundary.label} boundary rejected`);
  assert.equal(result.allocations[0][boundary.field], true);
}

const left = contact({
    contactId: "contact/left",
    pointWorldM: [-1, 0, 0],
    frictionCoefficient: 0,
  }),
  right = contact({
    contactId: "contact/right",
    pointWorldM: [1, 0, 0],
    frictionCoefficient: 0,
  }),
  momentAllocation = allocate({
    forceN: [0, 100, 0],
    momentNm: [0, 0, 20],
    contacts: [right, left],
  });
assert.equal(momentAllocation.accepted, true);
assert.deepEqual(
  momentAllocation.allocations.map(({ contactId }) => contactId),
  ["contact/left", "contact/right"],
);
close(momentAllocation.allocations[0].normalForceN, 40, "left force", 2e-6);
close(momentAllocation.allocations[1].normalForceN, 60, "right force", 2e-6);
closeVector(
  momentAllocation.achievedWrenchFrame.momentNm,
  [0, 0, 20],
  "allocated moment",
  2e-6,
);
assert.deepEqual(
  allocate({
    forceN: [0, 100, 0],
    momentNm: [0, 0, 20],
    contacts: [left, right],
  }),
  momentAllocation,
  "allocation depended on contact input order",
);

const allAxisContacts = [
    contact({
      contactId: "contact/x",
      pointWorldM: [1, 2, 3],
      normalWorld: [1, 0, 0],
      frictionCoefficient: 0,
    }),
    contact({
      contactId: "contact/y",
      pointWorldM: [-2, 1, 0.5],
      normalWorld: [0, 1, 0],
      frictionCoefficient: 0,
    }),
    contact({
      contactId: "contact/z",
      pointWorldM: [0.25, -1, 2],
      normalWorld: [0, 0, 1],
      frictionCoefficient: 0,
    }),
  ],
  allAxis = allocate({
    forceN: [10, 20, 30],
    momentNm: [-40, 22.5, -60],
    momentReferenceLengthM: 2,
    contacts: allAxisContacts,
  });
assert.equal(allAxis.accepted, true);
closeVector(
  allAxis.achievedWrenchFrame.forceN,
  [10, 20, 30],
  "all-axis force",
  3e-6,
);
closeVector(
  allAxis.achievedWrenchFrame.momentNm,
  [-40, 22.5, -60],
  "all-axis moment",
  3e-6,
);

const axisMagnitude = Math.sqrt(14),
  angle = 0.7,
  halfSine = Math.sin(angle / 2),
  quaternion = [
    (halfSine * 1) / axisMagnitude,
    (halfSine * 2) / axisMagnitude,
    (halfSine * 3) / axisMagnitude,
    Math.cos(angle / 2),
  ],
  translation = [4, -3, 2],
  transformedContacts = allAxisContacts.map((sample) => ({
    ...sample,
    pointWorldM: add(translation, rotate(sample.pointWorldM, quaternion)),
    normalWorld: rotate(sample.normalWorld, quaternion),
  })),
  transformed = allocate({
    positionWorldM: translation,
    quaternionWorldFromFrame: quaternion,
    forceN: [10, 20, 30],
    momentNm: [-40, 22.5, -60],
    momentReferenceLengthM: 2,
    contacts: transformedContacts,
  });
assert.equal(transformed.accepted, true);
for (let index = 0; index < transformed.allocations.length; index++) {
  closeVector(
    transformed.allocations[index].forceFrameN,
    allAxis.allocations[index].forceFrameN,
    `frame force ${index}`,
    3e-6,
  );
  closeVector(
    transformed.allocations[index].forceWorldN,
    rotate(allAxis.allocations[index].forceFrameN, quaternion),
    `world force ${index}`,
    3e-6,
  );
}

const unitTolerance = 2 ** -20,
  boundaryQuaternion = quaternion.map((entry) => entry * (1 + unitTolerance)),
  normalizedBoundary = allocate({
    positionWorldM: translation,
    quaternionWorldFromFrame: boundaryQuaternion,
    forceN: [10, 20, 30],
    momentNm: [-40, 22.5, -60],
    momentReferenceLengthM: 2,
    contacts: transformedContacts.map((sample) => ({
      ...sample,
      normalWorld: sample.normalWorld.map(
        (entry) => entry * (1 + unitTolerance),
      ),
    })),
  });
assert.equal(normalizedBoundary.accepted, true);
for (let index = 0; index < normalizedBoundary.allocations.length; index++)
  closeVector(
    normalizedBoundary.allocations[index].forceFrameN,
    allAxis.allocations[index].forceFrameN,
    `inclusive unit boundary ${index}`,
    4e-6,
  );

const noContactZero = allocate({ forceN: [0, 0, 0], contacts: [] });
assert.equal(noContactZero.accepted, true);
assert.equal(noContactZero.solverConverged, true);
assert.deepEqual(noContactZero.allocations, []);
const noContactLoad = allocate({ forceN: [0, 1, 0], contacts: [] });
assert.equal(noContactLoad.accepted, false);
assert.equal(noContactLoad.reason, "residual-tolerance-exceeded-v1");
assert.equal(
  allocate({
    forceN: [0, 1, 0],
    contacts: [],
    forceResidualToleranceN: 1,
  }).accepted,
  true,
  "inclusive force residual tolerance boundary rejected",
);
assert.equal(
  allocate({
    forceN: [0, 0, 0],
    momentNm: [1, 0, 0],
    contacts: [],
    momentResidualToleranceNm: 1,
  }).accepted,
  true,
  "inclusive moment residual tolerance boundary rejected",
);
assert.equal(
  allocate({
    forceN: [0, 0, 0],
    momentNm: [1, 0, 0],
    contacts: [],
    momentResidualToleranceNm: 0.5,
  }).accepted,
  false,
);
assert.equal(
  allocate({
    tick: 0,
    contacts: [contact({ tick: 0 })],
  }).accepted,
  true,
  "tick zero was rejected",
);
assert.equal(
  allocate({
    forceN: [0, 0, 0],
    contacts: [],
    maxIterations: 1_000_000,
  }).accepted,
  true,
  "maximum declared iteration budget was rejected",
);
assert.equal(
  allocate({
    forceN: [0, 0, 0],
    contacts: Array.from({ length: 64 }, (_, index) =>
      contact({
        contactId: `contact/${index}`,
        normalForceLimitN: 0,
      }),
    ),
  }).accepted,
  true,
  "maximum declared contact count was rejected",
);

for (const unavailable of [
  { contacts: [contact({ tick: 6 })] },
  { contacts: [contact({ geometryValid: false })] },
  { contacts: [contact({ frictionValid: false })] },
  { contacts: [contact({ limitValid: false })] },
  { targetValid: false },
]) {
  const result = allocate(unavailable);
  assert.equal(result.authorityValid, false);
  assert.equal(result.solverConverged, false);
  assert.equal(result.accepted, false);
  assert.equal(result.reason, "invalid-authority-v1");
  for (const allocation of result.allocations)
    closeVector(allocation.forceFrameN, [0, 0, 0], "invalid authority");
}

for (const result of [
  vertical,
  frictionInterior,
  frictionLimited,
  tangentialLimited,
  normalLimited,
  unilateral,
  momentAllocation,
  allAxis,
  transformed,
]) {
  for (const allocation of result.allocations) {
    assert.ok(allocation.normalForceN >= -1e-9);
    assert.ok(allocation.normalForceN <= allocation.normalForceLimitN + 1e-9);
    assert.ok(allocation.tangentialForceN <= allocation.frictionLimitN + 1e-9);
    assert.ok(
      allocation.tangentialForceN <= allocation.tangentialForceLimitN + 1e-9,
    );
  }
}

const exhausted = allocate({
  maxIterations: 1,
  projectedGradientToleranceN: 0,
  forceResidualToleranceN: 100,
});
assert.equal(exhausted.authorityValid, true);
assert.equal(exhausted.solverConverged, false);
assert.equal(exhausted.accepted, false);
assert.equal(exhausted.reason, "solver-budget-exhausted-v1");
assert.equal(exhausted.iterations, 1);

const convergenceMetric = allocate({
    maxIterations: 1,
    projectedGradientToleranceN: 10,
    forceResidualToleranceN: 100,
  }),
  inclusiveConvergenceBoundary = allocate({
    maxIterations: 1,
    projectedGradientToleranceN: 50,
  });
assert.equal(
  convergenceMetric.solverConverged,
  false,
  "solver accepted the weaker update-times-step convergence metric",
);
assert.equal(convergenceMetric.reason, "solver-budget-exhausted-v1");
assert.equal(
  inclusiveConvergenceBoundary.solverConverged,
  true,
  "inclusive projected-gradient tolerance boundary rejected",
);
assert.equal(
  inclusiveConvergenceBoundary.reason,
  "residual-tolerance-exceeded-v1",
  "stationary residual was mislabeled as a feasibility certificate",
);

const maximumLengthId = "a".repeat(160);
assert.equal(
  allocate({ frameId: maximumLengthId }).targetFrameId,
  maximumLengthId,
  "maximum-length canonical ID was rejected",
);
assert.deepEqual(
  allocate({
    contacts: [
      contact({ contactId: "contact/z" }),
      contact({ contactId: "contact/a" }),
      contact({ contactId: "contact/m" }),
    ],
  }).allocations.map(({ contactId }) => contactId),
  ["contact/a", "contact/m", "contact/z"],
  "three-contact allocation was not canonically ordered",
);

const malformedEdits = [
  ["null target frame", (value) => (value.targetFrame = null)],
  ["scalar target frame", (value) => (value.targetFrame = 7)],
  ["array target frame", (value) => (value.targetFrame = [])],
  ["null frame position", (value) => (value.targetFrame.positionWorldM = null)],
  [
    "short frame position",
    (value) => (value.targetFrame.positionWorldM = [0, 0]),
  ],
  [
    "nonfinite frame position",
    (value) => (value.targetFrame.positionWorldM = [0, NaN, 0]),
  ],
  [
    "null orientation",
    (value) => (value.targetFrame.quaternionWorldFromFrame = null),
  ],
  [
    "short orientation",
    (value) => (value.targetFrame.quaternionWorldFromFrame = [0, 0, 1]),
  ],
  [
    "nonfinite orientation",
    (value) =>
      (value.targetFrame.quaternionWorldFromFrame = [0, 0, 0, Infinity]),
  ],
  ["nonstring frame ID", (value) => (value.targetFrame.frameId = 1)],
  ["empty frame ID", (value) => (value.targetFrame.frameId = "")],
  [
    "overlong frame ID",
    (value) => (value.targetFrame.frameId = "a".repeat(161)),
  ],
  [
    "leading invalid frame ID",
    (value) => (value.targetFrame.frameId = "!frame"),
  ],
  [
    "trailing invalid frame ID",
    (value) => (value.targetFrame.frameId = "frame!"),
  ],
  ["negative tick", (value) => (value.tick = -1)],
  ["object contacts", (value) => (value.contacts = {})],
  [
    "nonboolean geometry validity",
    (value) => (value.contacts[0].geometryValid = "true"),
  ],
  ["null target force", (value) => (value.targetWrenchFrame.forceN = null)],
  ["short target force", (value) => (value.targetWrenchFrame.forceN = [0, 0])],
  [
    "nonfinite target force",
    (value) => (value.targetWrenchFrame.forceN = [NaN, 0, 0]),
  ],
  [
    "string force tolerance",
    (value) => (value.acceptance.forceResidualToleranceN = "0"),
  ],
  [
    "negative force tolerance",
    (value) => (value.acceptance.forceResidualToleranceN = -1),
  ],
  [
    "nonfinite moment tolerance",
    (value) => (value.acceptance.momentResidualToleranceNm = Infinity),
  ],
  [
    "negative moment reference",
    (value) => (value.acceptance.momentReferenceLengthM = -1),
  ],
  [
    "negative solver tolerance",
    (value) => (value.solver.projectedGradientToleranceN = -1),
  ],
];
for (const [label, edit] of malformedEdits) {
  const value = request();
  edit(value);
  assert.throws(
    () => allocateRaw(value),
    /must|invalid|range|array|canonical/i,
    "allocator accepted " + label,
  );
}

assert.throws(
  () => allocateRaw(null),
  /invalid field set/i,
  "allocator accepted a null serialized root",
);

for (const mutation of [
  { contacts: [contact({ normalWorld: [0, 2, 0] })] },
  { quaternionWorldFromFrame: [0, 0, 0, 2] },
  { contacts: [contact(), contact()] },
  { contacts: [contact({ normalForceLimitN: -1 })] },
  { contacts: [contact({ tangentialForceLimitN: -1 })] },
  { contacts: [contact({ frictionCoefficient: -1 })] },
  { momentReferenceLengthM: 0 },
  { maxIterations: 0 },
  { maxIterations: 1_000_001 },
  { targetValid: "true" },
  { tick: 0.5 },
  {
    contacts: Array.from({ length: 65 }, (_, index) =>
      contact({ contactId: `contact/${index}` }),
    ),
  },
])
  assert.throws(
    () => allocate(mutation),
    /must|invalid|unique|positive|large|many/i,
    `allocator accepted malformed input ${JSON.stringify(mutation)}`,
  );

assert.throws(
  () =>
    allocate({
      momentNm: [Number.MAX_VALUE, 0, 0],
      momentReferenceLengthM: Number.MIN_VALUE,
    }),
  /finite numerical range/i,
  "allocator accepted an overflowing moment normalization",
);
assert.throws(
  () =>
    allocate({
      contacts: [
        contact({
          pointWorldM: [Number.MAX_VALUE, 0, 0],
          normalForceLimitN: 1,
        }),
      ],
      momentReferenceLengthM: Number.MIN_VALUE,
    }),
  /finite numerical range/i,
  "allocator accepted an overflowing contact lever arm",
);
assert.throws(
  () =>
    allocate({
      forceN: [Number.MAX_VALUE, Number.MAX_VALUE, 0],
      contacts: [
        contact({
          frictionCoefficient: Number.MAX_VALUE,
          normalForceLimitN: Number.MAX_VALUE,
          tangentialForceLimitN: Number.MAX_VALUE,
        }),
      ],
    }),
  /finite numerical range/i,
  "allocator published a non-finite derived friction limit",
);
assert.throws(
  () =>
    allocate({
      forceN: [1, 2, 0],
      contacts: [
        contact({
          frictionCoefficient: Number.MAX_VALUE,
          normalForceLimitN: 10,
        }),
      ],
    }),
  /result exceeds finite numerical range/i,
  "invalid authority bypassed the finite result guard",
);

const extraField = request();
extraField.demoRole = "special-case";
assert.throws(
  () => allocatePointContactWrench(JSON.stringify(extraField)),
  /invalid field set/i,
  "allocator accepted undeclared authority fields",
);
assert.throws(
  () => allocatePointContactWrench(request()),
  (error) => error?.code === "INVALID_POINT_CONTACT_ALLOCATOR_INPUT",
);
let proxyReads = 0;
const proxy = new Proxy(request(), {
  get() {
    proxyReads++;
    return undefined;
  },
  getPrototypeOf() {
    proxyReads++;
    return Object.prototype;
  },
  ownKeys() {
    proxyReads++;
    return [];
  },
  getOwnPropertyDescriptor() {
    proxyReads++;
    return undefined;
  },
});
assert.throws(
  () => allocatePointContactWrench(proxy),
  (error) => error?.code === "INVALID_POINT_CONTACT_ALLOCATOR_INPUT",
);
assert.equal(proxyReads, 0, "allocator input boundary invoked a Proxy trap");

console.log(
  "point-contact wrench allocator passed (unilateral/friction/actuator bounds, residual rejection, covariance, permutation, authority)",
);
