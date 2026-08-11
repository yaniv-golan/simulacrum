import assert from "node:assert/strict";
import { TYPES } from "../src/model/component-catalog.js";
import { contactMaterialPair } from "../src/model/contact-material-pairs.js";
import { SENSOR_PART_DEFINITIONS } from "../src/model/sensor-contracts.js";
import { controllerSensorFrameForId } from "../src/model/controller-sensor-frame-evidence.js";
import { observeContactNormalWrench } from "../src/simulation/contact-normal-wrench-observation.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import {
  BodyRegistry,
  importBodyRegistryCheckpointStateForRestore,
} from "../src/simulation/body-registry.js";

const WRENCH_READING_KEYS = [
    "contact_force_n",
    "contact_normal_force_part_x_n",
    "contact_normal_force_part_y_n",
    "contact_normal_force_part_z_n",
    "contact_normal_moment_part_x_nm",
    "contact_normal_moment_part_y_nm",
    "contact_normal_moment_part_z_nm",
  ],
  POINT_CONTACT_READING_KEYS = [
    "contact_resultant_point_world_x_m",
    "contact_resultant_point_world_y_m",
    "contact_resultant_point_world_z_m",
    "contact_resultant_normal_world_x",
    "contact_resultant_normal_world_y",
    "contact_resultant_normal_world_z",
    "contact_resultant_normal_force_n",
  ],
  READING_KEYS = [
    ...WRENCH_READING_KEYS,
    "contact_min_friction_coefficient",
    ...POINT_CONTACT_READING_KEYS,
  ],
  identityPose = {
    position: { x: 0, y: 0, z: 0 },
    quaternion: { x: 0, y: 0, z: 0, w: 1 },
  },
  close = (actual, expected, label, tolerance = 1e-10) =>
    assert.ok(
      Math.abs(actual - expected) <= tolerance,
      `${label}: expected ${expected}, received ${actual}`,
    ),
  closeVector = (actual, expected, label, tolerance) => {
    for (const axis of ["x", "y", "z"])
      close(actual[axis], expected[axis], `${label}.${axis}`, tolerance);
  },
  rotate = (value, quaternion) => {
    const tx = 2 * (quaternion.y * value.z - quaternion.z * value.y),
      ty = 2 * (quaternion.z * value.x - quaternion.x * value.z),
      tz = 2 * (quaternion.x * value.y - quaternion.y * value.x);
    return {
      x: value.x + quaternion.w * tx + (quaternion.y * tz - quaternion.z * ty),
      y: value.y + quaternion.w * ty + (quaternion.z * tx - quaternion.x * tz),
      z: value.z + quaternion.w * tz + (quaternion.x * ty - quaternion.y * tx),
    };
  },
  contact = ({
    id,
    point,
    normal = { x: 0, y: 1, z: 0 },
    forceN,
    tick = 1,
    materialKey = "generic-structure",
    otherMaterialKey = "workshop-steel",
    frictionCoefficient,
    frictionCoefficientValid = true,
    validity = "measured",
    observationFrame = identityPose,
  }) => {
    if (frictionCoefficient === undefined)
      try {
        const law = contactMaterialPair(materialKey, otherMaterialKey);
        frictionCoefficient = Math.min(
          law.longitudinalFrictionCoefficient,
          law.lateralFrictionCoefficient,
        );
      } catch {
        frictionCoefficient = 0;
      }
    return {
      tick,
      contactId: id,
      normalForceValid: true,
      frictionCoefficientValid,
      frictionCoefficient,
      observationFrame,
      point,
      normal,
      forceN,
      forceWorldN: {
        x: normal.x * forceN,
        y: normal.y * forceN,
        z: normal.z * forceN,
      },
      materialKey,
      otherMaterialKey,
      shapeId: id + ".shape",
      otherShapeId: id + ".support-shape",
      validity,
    };
  };

const contacts = [
    contact({
      id: "alpha",
      point: { x: -1, y: 0, z: 0 },
      forceN: 20,
    }),
    contact({
      id: "bravo",
      point: { x: 1, y: 0, z: 0 },
      forceN: 10,
      otherMaterialKey: "dry-asphalt",
    }),
  ],
  observed = observeContactNormalWrench({ contacts, pose: identityPose });
assert.equal(observed.wrenchValid, true);
assert.equal(observed.frictionValid, true);
assert.equal(observed.pointContactValid, true);
assert.equal(observed.activeContactCount, 2);
assert.equal(observed.normalForceSumN, 30);
closeVector(observed.forcePartN, { x: 0, y: 30, z: 0 }, "force");
closeVector(observed.momentPartNm, { x: 0, y: 0, z: -10 }, "moment");
close(observed.minimumFrictionCoefficient, 0.6624, "conservative friction");
closeVector(
  observed.pointWorldM,
  { x: -1 / 3, y: 0, z: 0 },
  "force-weighted resultant point",
);
closeVector(observed.normalWorld, { x: 0, y: 1, z: 0 }, "resultant normal");
assert.equal(
  observeContactNormalWrench({
    contacts,
    pose: identityPose,
    expectedTick: 1,
  }).wrenchValid,
  true,
  "same-tick contact evidence was rejected",
);
for (const expectedTick of [null, -1, 0.5]) {
  const tickObservation = observeContactNormalWrench({
    contacts: contacts.map((sample) => ({ ...sample, tick: expectedTick })),
    pose: identityPose,
    expectedTick,
  });
  assert.equal(tickObservation.wrenchValid, false);
  assert.equal(tickObservation.normalForceSumN, 0);
}
assert.equal(
  observeContactNormalWrench({
    contacts: contacts.map((sample) => ({ ...sample, tick: 0 })),
    pose: identityPose,
    expectedTick: 0,
  }).wrenchValid,
  true,
  "tick zero was not accepted as a valid owned observation tick",
);

close(
  observeContactNormalWrench({
    contacts: [{ ...contacts[0], frictionCoefficient: 0.3 }],
    pose: identityPose,
  }).minimumFrictionCoefficient,
  0.3,
  "solver-enforced friction below the catalog ceiling",
);
close(
  observeContactNormalWrench({
    contacts: [{ ...contacts[0], frictionCoefficient: 0.99 }],
    pose: identityPose,
  }).minimumFrictionCoefficient,
  0.68,
  "catalog ceiling on a larger solver-enforced coefficient",
);
const knownZeroFriction = observeContactNormalWrench({
  contacts: [{ ...contacts[0], frictionCoefficient: 0 }],
  pose: identityPose,
});
assert.equal(knownZeroFriction.frictionValid, true);
assert.equal(knownZeroFriction.minimumFrictionCoefficient, 0);

assert.deepEqual(
  observeContactNormalWrench({
    contacts: [...contacts].reverse(),
    pose: identityPose,
  }),
  observed,
  "contact insertion order changed the reduced physical observation",
);

const halfAngle = Math.PI / 4,
  orientation = {
    x: 0,
    y: Math.sin(halfAngle),
    z: 0,
    w: Math.cos(halfAngle),
  },
  translation = { x: 7, y: -3, z: 11 },
  transformedContacts = contacts.map((sample) => {
    const point = rotate(sample.point, orientation),
      normal = rotate(sample.normal, orientation),
      transformed = contact({
        id: sample.contactId,
        point: {
          x: point.x + translation.x,
          y: point.y + translation.y,
          z: point.z + translation.z,
        },
        normal,
        forceN: sample.forceN,
        materialKey: sample.materialKey,
        otherMaterialKey: sample.otherMaterialKey,
        observationFrame: {
          position: translation,
          quaternion: orientation,
        },
      });
    return transformed;
  }),
  transformedObservation = observeContactNormalWrench({
    contacts: transformedContacts,
    pose: { position: translation, quaternion: orientation },
  });
closeVector(
  transformedObservation.forcePartN,
  observed.forcePartN,
  "rigid-transform force covariance",
);
closeVector(
  transformedObservation.momentPartNm,
  observed.momentPartNm,
  "rigid-transform moment covariance",
);
close(
  transformedObservation.minimumFrictionCoefficient,
  observed.minimumFrictionCoefficient,
  "rigid-transform friction invariance",
);
assert.equal(transformedObservation.pointContactValid, true);
closeVector(
  transformedObservation.pointWorldM,
  {
    ...rotate(observed.pointWorldM, orientation),
    x: rotate(observed.pointWorldM, orientation).x + translation.x,
    y: rotate(observed.pointWorldM, orientation).y + translation.y,
    z: rotate(observed.pointWorldM, orientation).z + translation.z,
  },
  "resultant point world covariance",
  1e-9,
);
closeVector(
  transformedObservation.normalWorld,
  rotate(observed.normalWorld, orientation),
  "resultant normal world covariance",
  1e-9,
);

const largeTranslation = { x: 9_000_000, y: -8_000_000, z: 7_000_000 },
  largeTranslatedObservation = observeContactNormalWrench({
    contacts: contacts.map((sample) =>
      contact({
        id: sample.contactId,
        point: {
          x: sample.point.x + largeTranslation.x,
          y: sample.point.y + largeTranslation.y,
          z: sample.point.z + largeTranslation.z,
        },
        normal: sample.normal,
        forceN: sample.forceN,
        materialKey: sample.materialKey,
        otherMaterialKey: sample.otherMaterialKey,
        observationFrame: {
          position: largeTranslation,
          quaternion: identityPose.quaternion,
        },
      }),
    ),
    pose: identityPose,
  });
assert.equal(
  largeTranslatedObservation.pointContactValid,
  true,
  "large translation invalidated the same local point contact",
);
closeVector(
  largeTranslatedObservation.pointWorldM,
  {
    x: largeTranslation.x - 1 / 3,
    y: largeTranslation.y,
    z: largeTranslation.z,
  },
  "large-translation resultant point",
  4e-9,
);
closeVector(
  largeTranslatedObservation.normalWorld,
  observed.normalWorld,
  "large-translation resultant normal",
  1e-12,
);

const fullAxisContacts = [
    contact({
      id: "full-axis-alpha",
      point: { x: 1, y: 2, z: 3 },
      normal: { x: 1 / 3, y: 2 / 3, z: 2 / 3 },
      forceN: 9,
    }),
    contact({
      id: "full-axis-bravo",
      point: { x: -2, y: 0.5, z: 0.5 },
      normal: { x: -2 / 3, y: 1 / 3, z: 2 / 3 },
      forceN: 6,
      otherMaterialKey: "dry-asphalt",
    }),
  ],
  fullAxisObservation = observeContactNormalWrench({
    contacts: fullAxisContacts,
    pose: identityPose,
  }),
  rotationAxisNorm = Math.hypot(1, 2, 3),
  generalHalfAngle = 0.37,
  generalOrientation = {
    x: (Math.sin(generalHalfAngle) * 1) / rotationAxisNorm,
    y: (Math.sin(generalHalfAngle) * 2) / rotationAxisNorm,
    z: (Math.sin(generalHalfAngle) * 3) / rotationAxisNorm,
    w: Math.cos(generalHalfAngle),
  },
  generalTranslation = { x: -17, y: 5, z: 9 },
  generalWorldContacts = fullAxisContacts.map((sample) => {
    const point = rotate(sample.point, generalOrientation),
      normal = rotate(sample.normal, generalOrientation);
    return contact({
      id: sample.contactId,
      point: {
        x: point.x + generalTranslation.x,
        y: point.y + generalTranslation.y,
        z: point.z + generalTranslation.z,
      },
      normal,
      forceN: sample.forceN,
      materialKey: sample.materialKey,
      otherMaterialKey: sample.otherMaterialKey,
      observationFrame: {
        position: generalTranslation,
        quaternion: generalOrientation,
      },
    });
  }),
  generalWorldObservation = observeContactNormalWrench({
    contacts: generalWorldContacts,
    pose: {
      position: generalTranslation,
      quaternion: generalOrientation,
    },
  });
closeVector(
  fullAxisObservation.forcePartN,
  { x: -1, y: 8, z: 10 },
  "full-axis force",
);
closeVector(
  fullAxisObservation.momentPartNm,
  { x: -5, y: 9, z: -2 },
  "full-axis moment",
);
closeVector(
  generalWorldObservation.forcePartN,
  fullAxisObservation.forcePartN,
  "general rotation force covariance",
  1e-9,
);
closeVector(
  generalWorldObservation.momentPartNm,
  fullAxisObservation.momentPartNm,
  "general rotation moment covariance",
  1e-9,
);
for (const [label, result] of [
  ["full-axis", fullAxisObservation],
  ["transformed full-axis", generalWorldObservation],
]) {
  assert.equal(
    result.pointContactValid,
    false,
    `${label} mixed-normal patch was collapsed into one point contact`,
  );
  assert.deepEqual(result.pointWorldM, { x: 0, y: 0, z: 0 });
  assert.deepEqual(result.normalWorld, { x: 0, y: 0, z: 0 });
}

const obliquePointContact = observeContactNormalWrench({
  contacts: [
    contact({
      id: "oblique-point-contact",
      point: { x: 2, y: 3, z: 5 },
      normal: { x: 1 / 3, y: 2 / 3, z: 2 / 3 },
      forceN: 9,
    }),
  ],
  pose: identityPose,
});
assert.equal(obliquePointContact.pointContactValid, true);
closeVector(
  obliquePointContact.pointWorldM,
  { x: 2, y: 3, z: 5 },
  "oblique point contact point",
);
closeVector(
  obliquePointContact.normalWorld,
  { x: 1 / 3, y: 2 / 3, z: 2 / 3 },
  "oblique point contact normal",
);

const obliquePointWorld = rotate(
    obliquePointContact.pointWorldM,
    generalOrientation,
  ),
  obliqueNormalWorld = rotate(
    obliquePointContact.normalWorld,
    generalOrientation,
  ),
  transformedObliquePointContact = observeContactNormalWrench({
    contacts: [
      contact({
        id: "transformed-oblique-point-contact",
        point: {
          x: obliquePointWorld.x + generalTranslation.x,
          y: obliquePointWorld.y + generalTranslation.y,
          z: obliquePointWorld.z + generalTranslation.z,
        },
        normal: obliqueNormalWorld,
        forceN: 9,
        observationFrame: {
          position: generalTranslation,
          quaternion: generalOrientation,
        },
      }),
    ],
    pose: identityPose,
  });
assert.equal(transformedObliquePointContact.pointContactValid, true);
closeVector(
  transformedObliquePointContact.pointWorldM,
  {
    x: obliquePointWorld.x + generalTranslation.x,
    y: obliquePointWorld.y + generalTranslation.y,
    z: obliquePointWorld.z + generalTranslation.z,
  },
  "transformed oblique point",
  1e-9,
);
closeVector(
  transformedObliquePointContact.normalWorld,
  obliqueNormalWorld,
  "transformed oblique normal",
  1e-9,
);

const samePointMixedNormals = observeContactNormalWrench({
  contacts: [
    contact({
      id: "same-point-up",
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      forceN: 1,
    }),
    contact({
      id: "same-point-side",
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      forceN: 1,
    }),
  ],
  pose: identityPose,
});
assert.equal(samePointMixedNormals.wrenchValid, true);
assert.equal(
  samePointMixedNormals.pointContactValid,
  false,
  "coincident mixed normals bypassed resultant magnitude authority",
);
assert.deepEqual(samePointMixedNormals.pointWorldM, { x: 0, y: 0, z: 0 });
assert.deepEqual(samePointMixedNormals.normalWorld, { x: 0, y: 0, z: 0 });

const rowConsistencyOffset = 2 ** -31,
  cancellingMomentErrors = observeContactNormalWrench({
    contacts: [
      {
        ...contact({
          id: "positive-lever-error",
          point: { x: 1e9, y: 0, z: 0 },
          forceN: 1,
        }),
        forceWorldN: { x: 0, y: 1 + rowConsistencyOffset, z: 0 },
      },
      {
        ...contact({
          id: "negative-lever-error",
          point: { x: -1e9, y: 0, z: 0 },
          forceN: 1,
        }),
        forceWorldN: { x: 0, y: 1 - rowConsistencyOffset, z: 0 },
      },
    ],
    pose: identityPose,
  });
assert.equal(cancellingMomentErrors.wrenchValid, true);
assert.equal(
  cancellingMomentErrors.pointContactValid,
  false,
  "row-local force tolerance invented a resultant point contact",
);
assert.deepEqual(cancellingMomentErrors.pointWorldM, { x: 0, y: 0, z: 0 });
assert.deepEqual(cancellingMomentErrors.normalWorld, { x: 0, y: 0, z: 0 });

const withinUnitToleranceScale = 1 + 2 ** -21,
  normalizedPoseObservation = observeContactNormalWrench({
    contacts: generalWorldContacts.map((sample) => ({
      ...sample,
      observationFrame: {
        position: generalTranslation,
        quaternion: Object.fromEntries(
          Object.entries(generalOrientation).map(([axis, value]) => [
            axis,
            value * withinUnitToleranceScale,
          ]),
        ),
      },
    })),
    pose: identityPose,
  });
closeVector(
  normalizedPoseObservation.forcePartN,
  fullAxisObservation.forcePartN,
  "accepted quaternion normalization",
  1e-9,
);
closeVector(
  normalizedPoseObservation.momentPartNm,
  fullAxisObservation.momentPartNm,
  "accepted quaternion moment normalization",
  1e-9,
);
assert.equal(
  observeContactNormalWrench({
    contacts: contacts.map((sample) => ({
      ...sample,
      observationFrame: {
        position: identityPose.position,
        quaternion: { x: 0, y: 0, z: 0, w: 1 + 2 ** -20 },
      },
    })),
    pose: identityPose,
  }).wrenchValid,
  true,
  "quaternion at the declared unit tolerance boundary was rejected",
);

const orderedExtremeContacts = [
    contact({
      id: "alpha",
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      forceN: 1e16,
    }),
    contact({
      id: "bravo",
      point: { x: 0, y: 0, z: 0 },
      normal: { x: -1, y: 0, z: 0 },
      forceN: 1e16,
    }),
    contact({
      id: "charlie",
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      forceN: 1,
    }),
  ],
  orderedExtreme = observeContactNormalWrench({
    contacts: [
      orderedExtremeContacts[0],
      orderedExtremeContacts[2],
      orderedExtremeContacts[1],
    ],
    pose: identityPose,
  });
assert.equal(
  orderedExtreme.forcePartN.x,
  1,
  "canonical contact order did not stabilize floating-point reduction",
);
assert.deepEqual(
  observeContactNormalWrench({
    contacts: [...orderedExtremeContacts].reverse(),
    pose: identityPose,
  }),
  orderedExtreme,
);

const equalKeyVariableForces = [0, 2, 4].map((offset) => ({
    ...contact({
      id: "same-canonical-identity",
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      forceN: 1e16,
    }),
    forceWorldN: { x: 1e16 + offset, y: 0, z: 0 },
  })),
  orderedVariableForces = observeContactNormalWrench({
    contacts: equalKeyVariableForces,
    pose: identityPose,
  });
assert.deepEqual(
  observeContactNormalWrench({
    contacts: [...equalKeyVariableForces].reverse(),
    pose: identityPose,
  }),
  orderedVariableForces,
  "canonical order omitted an accepted force-vector degree of freedom",
);

const validZeroContact = contact({
  id: "valid-zero",
  point: { x: 0.25, y: 0, z: -0.5 },
  forceN: 0,
});
assert.deepEqual(
  observeContactNormalWrench({
    contacts: [...contacts, validZeroContact],
    pose: identityPose,
  }),
  observed,
  "zero-load solver rows changed the active normal wrench",
);

const zeroOnlyObservation = observeContactNormalWrench({
  contacts: [validZeroContact],
  pose: identityPose,
});
assert.equal(zeroOnlyObservation.wrenchValid, true);
assert.equal(zeroOnlyObservation.frictionValid, false);
assert.equal(zeroOnlyObservation.pointContactValid, false);
assert.deepEqual(zeroOnlyObservation.forcePartN, { x: 0, y: 0, z: 0 });
assert.deepEqual(zeroOnlyObservation.momentPartNm, { x: 0, y: 0, z: 0 });
assert.equal(zeroOnlyObservation.activeContactCount, 0);
assert.deepEqual(
  observeContactNormalWrench({ contacts: [], pose: identityPose }),
  zeroOnlyObservation,
  "an authoritative empty manifold did not produce a valid zero wrench",
);

for (const boundaryContact of [
  contact({
    id: "unit-boundary",
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 0, y: 1 + 2 ** -20, z: 0 },
    forceN: 1,
  }),
  {
    ...contact({
      id: "consistency-boundary",
      point: { x: 0, y: 0, z: 0 },
      forceN: 1,
    }),
    forceWorldN: { x: 2 ** -30, y: 1, z: 0 },
  },
  {
    ...contact({
      id: "scaled-consistency",
      point: { x: 0, y: 0, z: 0 },
      forceN: 100,
    }),
    forceWorldN: { x: 0, y: 100 + 2 ** -25, z: 0 },
  },
])
  assert.equal(
    observeContactNormalWrench({
      contacts: [boundaryContact],
      pose: identityPose,
    }).wrenchValid,
    true,
    `valid numerical boundary was rejected for ${boundaryContact.contactId}`,
  );

for (const invalid of [
  null,
  "not-contacts",
  {},
  [{ ...contacts[0], forceN: -1 }],
  [
    {
      ...contacts[0],
      forceN: -20,
      forceWorldN: { x: 0, y: -20, z: 0 },
    },
  ],
  [{ ...contacts[0], forceN: Number.NaN }],
  [{ ...contacts[0], forceN: "20" }],
  [{ ...contacts[0], normalForceValid: false }],
  [{ ...contacts[0], normalForceValid: null }],
  [{ ...contacts[0], normalForceValid: "true" }],
  [contacts[0], { ...contacts[1], forceN: -1 }],
  [contacts[0], { ...contacts[1], forceN: Number.NaN }],
  [contacts[0], { ...contacts[1], forceN: "10" }],
  [contacts[0], { ...contacts[1], normalForceValid: false, forceN: 0 }],
  [{ ...validZeroContact, point: null }],
  [{ ...validZeroContact, normal: null }],
  [{ ...validZeroContact, forceWorldN: null }],
  [{ ...validZeroContact, forceWorldN: { x: 0, y: 1, z: 0 } }],
  [{ ...contacts[0], normal: { x: 0, y: 2, z: 0 } }],
  [
    {
      ...contacts[0],
      normal: { x: 0, y: 2, z: 0 },
      forceWorldN: { x: 0, y: 40, z: 0 },
    },
  ],
  [{ ...contacts[0], forceWorldN: { x: 0, y: 19, z: 0 } }],
  [
    contact({
      id: "overflow-a",
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      forceN: Number.MAX_VALUE,
    }),
    contact({
      id: "overflow-b",
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      forceN: Number.MAX_VALUE,
    }),
  ],
  [
    contact({
      id: "opposing-overflow-a",
      point: { x: 0, y: 0, z: 0 },
      normal: { x: 1, y: 0, z: 0 },
      forceN: Number.MAX_VALUE,
    }),
    contact({
      id: "opposing-overflow-b",
      point: { x: 0, y: 0, z: 0 },
      normal: { x: -1, y: 0, z: 0 },
      forceN: Number.MAX_VALUE,
    }),
  ],
  [
    {
      ...contact({
        id: "consistency-overflow",
        point: { x: 0, y: 0, z: 0 },
        normal: { x: 1 + 2 ** -21, y: 0, z: 0 },
        forceN: Number.MAX_VALUE,
      }),
      forceWorldN: { x: Number.MAX_VALUE, y: 0, z: 0 },
    },
  ],
]) {
  const result = observeContactNormalWrench({
    contacts: invalid,
    pose: identityPose,
  });
  assert.equal(result.wrenchValid, false);
  assert.equal(result.frictionValid, false);
  assert.equal(result.pointContactValid, false);
  assert.deepEqual(result.forcePartN, { x: 0, y: 0, z: 0 });
  assert.deepEqual(result.momentPartNm, { x: 0, y: 0, z: 0 });
  assert.deepEqual(result.pointWorldM, { x: 0, y: 0, z: 0 });
  assert.deepEqual(result.normalWorld, { x: 0, y: 0, z: 0 });
}

for (const field of ["point", "normal", "forceWorldN"])
  for (const axis of ["x", "y", "z"])
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, "0"])
      assert.equal(
        observeContactNormalWrench({
          contacts: [
            {
              ...contacts[0],
              [field]: { ...contacts[0][field], [axis]: bad },
            },
          ],
          pose: identityPose,
        }).wrenchValid,
        false,
        `${field}.${axis} accepted ${String(bad)}`,
      );

assert.equal(
  observeContactNormalWrench({
    contacts: [{ ...contacts[0], validity: "unavailable" }],
    pose: identityPose,
  }).wrenchValid,
  true,
  "diagnostic identity availability incorrectly erased solved wrench values",
);

assert.deepEqual(
  observeContactNormalWrench({
    contacts,
    pose: {
      position: { x: 100, y: -200, z: 300 },
      quaternion: orientation,
    },
  }),
  observed,
  "post-integration host pose changed a solver-time contact observation",
);

for (const invalidFrame of [
  { position: null, quaternion: identityPose.quaternion },
  { position: "origin", quaternion: identityPose.quaternion },
  { position: {}, quaternion: identityPose.quaternion },
  { position: identityPose.position, quaternion: null },
  { position: identityPose.position, quaternion: "orientation" },
  {
    position: identityPose.position,
    quaternion: { x: 0, y: 0, z: 0, w: 2 },
  },
  {
    position: identityPose.position,
    quaternion: { x: 0, y: 0, z: 0, w: 1 + 2 ** -19 },
  },
  ...["x", "y", "z", "w"].flatMap((axis) =>
    [Number.NaN, Number.POSITIVE_INFINITY, "0"].map((bad) => ({
      position: identityPose.position,
      quaternion: { ...identityPose.quaternion, [axis]: bad },
    })),
  ),
])
  assert.equal(
    observeContactNormalWrench({
      contacts: [
        {
          ...contacts[0],
          observationFrame: invalidFrame,
        },
      ],
      pose: identityPose,
    }).wrenchValid,
    false,
  );

assert.equal(
  observeContactNormalWrench({
    contacts: [
      contacts[0],
      {
        ...contacts[1],
        observationFrame: {
          position: { x: 1, y: 0, z: 0 },
          quaternion: identityPose.quaternion,
        },
      },
    ],
    pose: identityPose,
  }).wrenchValid,
  false,
  "one manifold accepted contacts expressed about different solver frames",
);

assert.equal(
  observeContactNormalWrench({
    contacts: [
      contacts[0],
      {
        ...contacts[1],
        observationFrame: {
          position: identityPose.position,
          quaternion: orientation,
        },
      },
    ],
    pose: identityPose,
  }).wrenchValid,
  false,
  "one manifold accepted contacts expressed in different orientations",
);

assert.equal(
  observeContactNormalWrench({
    contacts: contacts.map((sample, index) => ({
      ...sample,
      observationFrame: {
        position: generalTranslation,
        quaternion:
          index === 0
            ? generalOrientation
            : Object.fromEntries(
                Object.entries(generalOrientation).map(([axis, value]) => [
                  axis,
                  -value,
                ]),
              ),
      },
    })),
    pose: identityPose,
  }).wrenchValid,
  true,
  "equivalent opposite-sign quaternions did not identify one physical frame",
);

assert.equal(
  observeContactNormalWrench({
    contacts: [],
    pose: { position: null, quaternion: identityPose.quaternion },
  }).wrenchValid,
  false,
  "empty manifold accepted an invalid declared frame",
);

for (const malformedIdentity of [1n, Symbol("shape"), { id: "shape" }]) {
  const result = observeContactNormalWrench({
    contacts: [{ ...contacts[0], shapeId: malformedIdentity }],
    pose: identityPose,
  });
  assert.equal(result.wrenchValid, true);
  assert.equal(result.frictionValid, false);
  assert.equal(result.minimumFrictionCoefficient, 0);
}

for (const materialMutation of [
  { materialKey: null },
  { otherMaterialKey: null },
  { materialKey: "unknown-material" },
  { frictionCoefficientValid: false },
  { frictionCoefficientValid: null },
  { frictionCoefficient: Number.NaN },
  { frictionCoefficient: -1 },
  { shapeId: null },
  { otherShapeId: null },
  { shapeId: "" },
]) {
  const result = observeContactNormalWrench({
    contacts: [{ ...contacts[0], ...materialMutation }],
    pose: identityPose,
  });
  assert.equal(result.wrenchValid, true);
  assert.equal(result.frictionValid, false);
  assert.equal(result.minimumFrictionCoefficient, 0);
}

const knownThenUnknownMaterial = observeContactNormalWrench({
  contacts: [
    contacts[0],
    contact({
      id: "zulu-unknown-material",
      point: { x: 0, y: 0, z: 0 },
      forceN: 1,
      materialKey: "unknown-material",
    }),
  ],
  pose: identityPose,
});
assert.equal(knownThenUnknownMaterial.wrenchValid, true);
assert.equal(knownThenUnknownMaterial.frictionValid, false);
assert.equal(knownThenUnknownMaterial.minimumFrictionCoefficient, 0);

const mixedMaterialValidity = observeContactNormalWrench({
  contacts: [
    { ...contacts[0], materialKey: null },
    { ...contacts[1], otherMaterialKey: "workshop-steel" },
  ],
  pose: identityPose,
});
assert.equal(mixedMaterialValidity.wrenchValid, true);
assert.equal(mixedMaterialValidity.frictionValid, false);
assert.equal(mixedMaterialValidity.minimumFrictionCoefficient, 0);

assert.deepEqual(
  TYPES.contactsensor.readings,
  SENSOR_PART_DEFINITIONS.contactsensor.map(({ key }) => key),
  "catalog and sensor-model contact readings diverged",
);
for (const key of READING_KEYS)
  assert.ok(
    TYPES.contactsensor.readings.includes(key),
    `contact sensor omitted ${key}`,
  );

const bindings = READING_KEYS.map((reading) => ({
    id: reading,
    direction: "input",
    endpointPartId: "contact-sensor",
    endpointPortId: "SIGNAL",
    reading,
  })),
  parts = [
    { id: "contact-sensor", type: "contactsensor" },
    {
      id: "observer",
      type: "computer",
      controllerBindings: bindings,
    },
  ],
  connections = [
    {
      id: "contact-signal",
      a: "contact-sensor",
      b: "observer",
      kind: "signal",
      portA: "SIGNAL",
      portB: "IN A",
    },
  ],
  signals = {
    controllerSensors: [
      {
        controllerId: "observer",
        endpoints: [{ partId: "contact-sensor", portIds: ["SIGNAL"] }],
      },
    ],
  },
  snapshot = (samples, tick = 1) => ({
    tick,
    bodies: [
      {
        bodyId: "contact-body",
        partIds: ["contact-sensor"],
        bound: true,
        detached: false,
        pose: identityPose,
        velocity: { x: 0, y: 0, z: 0 },
        angularVelocity: { x: 0, y: 0, z: 0 },
        acceleration: { x: 0, y: 0, z: 0 },
        contacts: samples,
        loads: [],
        thermal: {},
      },
    ],
    bodyByPart: [{ partId: "contact-sensor", bodyId: "contact-body" }],
  }),
  bank = new ControllerSensorBank(),
  capture = (samples, tick = 1) =>
    controllerSensorFrameForId(
      bank.capture({
        parts,
        connections,
        signals,
        bodies: snapshot(samples, tick),
      }),
      "observer",
    );

let readings = capture(contacts);
close(readings.contact_force_n, 30, "legacy summed normal force");
close(readings.contact_normal_force_part_y_n, 30, "sensor force Y");
close(readings.contact_normal_moment_part_z_nm, -10, "sensor moment Z");
close(readings.contact_min_friction_coefficient, 0.6624, "sensor friction");
close(readings.contact_resultant_point_world_x_m, -1 / 3, "sensor point X");
close(readings.contact_resultant_point_world_y_m, 0, "sensor point Y");
close(readings.contact_resultant_point_world_z_m, 0, "sensor point Z");
close(readings.contact_resultant_normal_world_x, 0, "sensor normal X");
close(readings.contact_resultant_normal_world_y, 1, "sensor normal Y");
close(readings.contact_resultant_normal_world_z, 0, "sensor normal Z");
close(readings.contact_resultant_normal_force_n, 30, "sensor point force");
for (const key of READING_KEYS) assert.equal(readings.__validity[key], 1);

readings = capture([{ ...contacts[0], tick: 0 }]);
for (const key of READING_KEYS) {
  assert.equal(readings[key], 0);
  assert.equal(readings.__validity[key], 0);
}
readings = capture([{ ...contacts[0], tick: 0 }], 0);
for (const key of READING_KEYS) assert.equal(readings.__validity[key], 1);
readings = capture(contacts, null);
for (const key of READING_KEYS) {
  assert.equal(readings[key], 0);
  assert.equal(readings.__validity[key], 0);
}

readings = capture(fullAxisContacts);
for (const key of WRENCH_READING_KEYS)
  assert.equal(readings.__validity[key], 1);
for (const key of POINT_CONTACT_READING_KEYS) {
  assert.equal(readings[key], 0);
  assert.equal(
    readings.__validity[key],
    0,
    `${key} accepted a mixed-normal patch`,
  );
}

const legacyPermutationContacts = [
    contact({
      id: "legacy-large",
      point: { x: 0, y: 0, z: 0 },
      forceN: 1e16,
    }),
    contact({
      id: "legacy-small-a",
      point: { x: 0, y: 0, z: 0 },
      forceN: 1,
    }),
    contact({
      id: "legacy-small-b",
      point: { x: 0, y: 0, z: 0 },
      forceN: 1,
    }),
  ],
  legacyForward = capture(legacyPermutationContacts),
  legacyReverse = capture([...legacyPermutationContacts].reverse());
assert.equal(legacyForward.contact_force_n, legacyReverse.contact_force_n);
assert.equal(legacyForward.__validity.contact_force_n, 1);
assert.equal(legacyReverse.__validity.contact_force_n, 1);
for (const key of POINT_CONTACT_READING_KEYS)
  assert.equal(
    legacyForward[key],
    legacyReverse[key],
    `${key} changed with contact insertion order`,
  );

readings = capture([
  contact({
    id: "legacy-overflow-a",
    point: { x: 0, y: 0, z: 0 },
    normal: { x: 1, y: 0, z: 0 },
    forceN: Number.MAX_VALUE,
  }),
  contact({
    id: "legacy-overflow-b",
    point: { x: 0, y: 0, z: 0 },
    normal: { x: -1, y: 0, z: 0 },
    forceN: Number.MAX_VALUE,
  }),
]);
for (const key of READING_KEYS) {
  assert.equal(readings[key], 0);
  assert.equal(readings.__validity[key], 0);
}

readings = capture([]);
for (const key of WRENCH_READING_KEYS) {
  assert.equal(readings[key], 0);
  assert.equal(readings.__validity[key], 1);
}
assert.equal(readings.contact_min_friction_coefficient, 0);
assert.equal(readings.__validity.contact_min_friction_coefficient, 0);
for (const key of POINT_CONTACT_READING_KEYS) {
  assert.equal(readings[key], 0);
  assert.equal(readings.__validity[key], 0);
}

readings = capture([{ ...contacts[0], otherMaterialKey: null }]);
for (const key of WRENCH_READING_KEYS)
  assert.equal(readings.__validity[key], 1);
assert.equal(readings.__validity.contact_min_friction_coefficient, 0);
assert.equal(readings.contact_min_friction_coefficient, 0);
for (const key of POINT_CONTACT_READING_KEYS)
  assert.equal(readings.__validity[key], 1);

readings = capture([validZeroContact]);
for (const key of WRENCH_READING_KEYS) {
  assert.equal(readings[key], 0);
  assert.equal(readings.__validity[key], 1);
}
assert.equal(readings.__validity.contact_min_friction_coefficient, 0);
for (const key of POINT_CONTACT_READING_KEYS) {
  assert.equal(readings[key], 0);
  assert.equal(readings.__validity[key], 0);
}

readings = capture([{ ...validZeroContact, point: null }]);
for (const key of READING_KEYS) {
  assert.equal(readings[key], 0);
  assert.equal(readings.__validity[key], 0);
}

readings = capture([
  contacts[0],
  { ...contacts[1], normalForceValid: false, forceN: 0 },
]);
for (const key of READING_KEYS) {
  assert.equal(readings[key], 0);
  assert.equal(readings.__validity[key], 0);
}

const checkpointPart = {
    id: "checkpoint-contact",
    type: "contactsensor",
    config: {},
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
  },
  checkpointRegistry = new BodyRegistry({
    parts: [checkpointPart],
    connections: [],
  }),
  checkpointBody = checkpointRegistry.bodyForPart(checkpointPart.id);
checkpointRegistry.beginTick(1);
checkpointRegistry.recordContact(checkpointBody.bodyId, {
  ...contacts[0],
  tick: 1,
  impulseNs: contacts[0].forceN / 120,
  relativeVelocity: { x: 0, y: 0, z: 0 },
});
const checkpoint = checkpointRegistry.exportCheckpointState(),
  checkpointContact = checkpoint.bodies[0].contacts[0],
  publicState = checkpointRegistry.exportState();
assert.doesNotThrow(() =>
  checkpointRegistry.validateState(JSON.stringify(publicState)),
);
const publicRestoredRegistry = new BodyRegistry({
  parts: [checkpointPart],
  connections: [],
});
publicRestoredRegistry.importState(JSON.stringify(publicState));
assert.deepEqual(
  publicRestoredRegistry.exportState(),
  publicState,
  "public body-registry schema-2 state did not round-trip through importState",
);
const stalePublicState = structuredClone(publicState);
stalePublicState.tick++;
assert.throws(
  () => checkpointRegistry.validateState(JSON.stringify(stalePublicState)),
  /contact evidence must belong to the checkpoint tick/i,
  "public body-registry state accepted stale contact evidence",
);
const fractionalTickRegistry = new BodyRegistry({
  parts: [checkpointPart],
  connections: [],
});
assert.throws(
  () => fractionalTickRegistry.beginTick(0.5),
  /ticks must be non-negative safe integers/i,
  "body registry accepted a fractional current tick",
);
fractionalTickRegistry.beginTick();
assert.equal(fractionalTickRegistry.tick, 1);
assert.throws(
  () =>
    fractionalTickRegistry.recordContact(checkpointBody.bodyId, {
      ...contacts[0],
      tick: 0.5,
      impulseNs: contacts[0].forceN / 120,
      relativeVelocity: { x: 0, y: 0, z: 0 },
    }),
  /ticks must be non-negative safe integers/i,
  "body registry accepted a fractional contact tick",
);
assert.throws(
  () =>
    fractionalTickRegistry.recordContact(checkpointBody.bodyId, {
      ...contacts[0],
      tick: 0,
      impulseNs: contacts[0].forceN / 120,
      relativeVelocity: { x: 0, y: 0, z: 0 },
    }),
  /must belong to the current registry tick/i,
  "body registry accepted stale contact evidence",
);
assert.equal(checkpoint.schemaVersion, 6);
assert.equal(checkpointContact.materialKey, "generic-structure");
assert.equal(checkpointContact.shapeId, "alpha.shape");
assert.equal(checkpointContact.normalForceValid, true);
assert.equal(checkpointContact.frictionCoefficientValid, true);
assert.equal(checkpointContact.frictionCoefficient, 0.68);
assert.deepEqual(checkpointContact.observationFrame, identityPose);
assert.equal(checkpointContact.otherMaterialKey, "workshop-steel");
assert.equal(checkpointContact.otherShapeId, "alpha.support-shape");
const fractionalCheckpoint = structuredClone(checkpoint);
fractionalCheckpoint.tick = 0.5;
fractionalCheckpoint.bodies[0].contacts[0].tick = 0.5;
const restoredRegistry = new BodyRegistry({
  parts: [checkpointPart],
  connections: [],
});
assert.throws(
  () =>
    importBodyRegistryCheckpointStateForRestore(
      restoredRegistry,
      JSON.stringify(fractionalCheckpoint),
    ),
  /checkpoint number is invalid/i,
  "schema-6 restore accepted matching fractional checkpoint and contact ticks",
);
importBodyRegistryCheckpointStateForRestore(restoredRegistry, checkpoint);
assert.deepEqual(
  restoredRegistry.bodyForPart(checkpointPart.id).contacts[0],
  checkpointContact,
  "checkpoint restore lost contact participant identities",
);
const invalidFrictionCheckpoint = structuredClone(checkpoint);
invalidFrictionCheckpoint.bodies[0].contacts[0].frictionCoefficientValid = false;
invalidFrictionCheckpoint.bodies[0].contacts[0].frictionCoefficient = 0;
const invalidFrictionRegistry = new BodyRegistry({
  parts: [checkpointPart],
  connections: [],
});
importBodyRegistryCheckpointStateForRestore(
  invalidFrictionRegistry,
  JSON.stringify(invalidFrictionCheckpoint),
);
assert.equal(
  invalidFrictionRegistry.bodyForPart(checkpointPart.id).contacts[0]
    .frictionCoefficientValid,
  false,
  "canonical invalid friction authority was not checkpoint-restorable",
);
const nullFrameCheckpoint = structuredClone(checkpoint);
nullFrameCheckpoint.bodies[0].contacts[0].observationFrame = null;
const nullFrameRegistry = new BodyRegistry({
  parts: [checkpointPart],
  connections: [],
});
assert.doesNotThrow(() =>
  importBodyRegistryCheckpointStateForRestore(
    nullFrameRegistry,
    JSON.stringify(nullFrameCheckpoint),
  ),
);
assert.equal(
  nullFrameRegistry.bodyForPart(checkpointPart.id).contacts[0].observationFrame,
  null,
);
assert.throws(
  () =>
    importBodyRegistryCheckpointStateForRestore(
      restoredRegistry,
      JSON.stringify({ ...structuredClone(checkpoint), schemaVersion: 4 }),
    ),
  /must not duplicate derived mass authority/,
);
assert.throws(
  () =>
    checkpointRegistry.recordContact(checkpointBody.bodyId, {
      ...contacts[0],
      normalForceValid: "true",
    }),
  /normal-force validity must be boolean/,
);
const contactWithoutFrictionAuthority = structuredClone(contacts[0]);
delete contactWithoutFrictionAuthority.frictionCoefficientValid;
delete contactWithoutFrictionAuthority.frictionCoefficient;
delete contactWithoutFrictionAuthority.observationFrame;
const defaultedFriction = checkpointRegistry.recordContact(
  checkpointBody.bodyId,
  contactWithoutFrictionAuthority,
);
assert.equal(defaultedFriction.frictionCoefficientValid, false);
assert.equal(defaultedFriction.frictionCoefficient, 0);
assert.equal(defaultedFriction.observationFrame, null);
assert.throws(
  () =>
    checkpointRegistry.recordContact(checkpointBody.bodyId, {
      ...contacts[0],
      frictionCoefficientValid: "true",
    }),
  /friction-coefficient validity must be boolean/,
);
assert.throws(
  () =>
    checkpointRegistry.recordContact(checkpointBody.bodyId, {
      ...contacts[0],
      normalForceValid: undefined,
    }),
  /normal-force validity must be boolean/,
);
for (const forgedContact of [
  { ...checkpointContact, tick: checkpointContact.tick + 1 },
  { ...checkpointContact, tick: checkpointContact.tick + 0.5 },
  { ...checkpointContact, normalForceValid: "true" },
  { ...checkpointContact, frictionCoefficientValid: "true" },
  { ...checkpointContact, frictionCoefficient: -1 },
  {
    ...checkpointContact,
    frictionCoefficientValid: false,
    frictionCoefficient: 0.68,
  },
  {
    ...checkpointContact,
    forceWorldN: { ...checkpointContact.forceWorldN, y: 0 },
  },
  {
    ...checkpointContact,
    observationFrame: {
      position: identityPose.position,
      quaternion: { x: 0, y: 0, z: 0, w: 2 },
    },
  },
])
  assert.throws(
    () =>
      importBodyRegistryCheckpointStateForRestore(
        restoredRegistry,
        JSON.stringify({
          ...structuredClone(checkpoint),
          bodies: [
            {
              ...structuredClone(checkpoint.bodies[0]),
              contacts: [forgedContact],
            },
          ],
        }),
      ),
    /checkpoint|contact/i,
  );

console.log(
  "contact normal-wrench observation passed (reduction, covariance, validity, materials, controller binding, checkpoint)",
);
