import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { TYPES } from "../src/model/component-catalog.js";
import { contactMaterialPair } from "../src/model/contact-material-pairs.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { observeContactNormalWrench } from "../src/simulation/contact-normal-wrench-observation.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const DT = 1 / 120,
  AUTHORED_YAW_RAD = 0.43,
  READING_KEYS = [
    "contact_force_n",
    "contact_normal_force_part_x_n",
    "contact_normal_force_part_y_n",
    "contact_normal_force_part_z_n",
    "contact_normal_moment_part_x_nm",
    "contact_normal_moment_part_y_nm",
    "contact_normal_moment_part_z_nm",
    "contact_min_friction_coefficient",
  ],
  part = (id, type) => ({
    id,
    type,
    config: {},
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
  }),
  sensor = {
    ...part("contact-observer", "contactsensor"),
    pos: [0, 0.08, 0],
    orientation: [
      0,
      Math.sin(AUTHORED_YAW_RAD / 2),
      0,
      Math.cos(AUTHORED_YAW_RAD / 2),
    ],
  },
  controller = {
    ...part("wrench-reader", "computer"),
    controllerBindings: READING_KEYS.map((reading) => ({
      id: reading,
      direction: "input",
      endpointPartId: sensor.id,
      endpointPortId: "SIGNAL",
      reading,
    })),
  },
  floorObserver = part("floor-observer", "contactsensor"),
  parts = [sensor, controller, floorObserver],
  connections = [
    {
      id: "observation-signal",
      a: sensor.id,
      b: controller.id,
      kind: "signal",
      portA: "SIGNAL",
      portB: "IN A",
    },
  ],
  signals = {
    controllerSensors: [
      {
        controllerId: controller.id,
        endpoints: [{ partId: sensor.id, portIds: ["SIGNAL"] }],
      },
    ],
  },
  world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.80665, 0),
  }),
  adapter = new CannonWorldAdapter(world),
  structureMaterial = new CANNON.Material("generic-structure"),
  steelMaterial = new CANNON.Material("workshop-steel"),
  asphaltMaterial = new CANNON.Material("dry-asphalt"),
  markerShape = new CANNON.Sphere(0.01),
  floorShape = new CANNON.Plane(),
  floor = new CANNON.Body({ mass: 0 });

function installContactLaw(left, right) {
  const law = contactMaterialPair(left.name, right.name);
  world.addContactMaterial(
    new CANNON.ContactMaterial(left, right, {
      friction: Math.min(
        law.longitudinalFrictionCoefficient,
        law.lateralFrictionCoefficient,
      ),
      restitution: law.restitutionCoefficient,
    }),
  );
}

floorShape.material = steelMaterial;
floorShape.userData = {
  shapeId: "ordinary-floor-shape",
  materialKey: "workshop-steel",
};
floor.addShape(floorShape);
floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
floor.userData = {
  externalBodyId: "ordinary-floor",
  surface: "ordinary-floor",
};
world.addBody(floor);
installContactLaw(structureMaterial, steelMaterial);
installContactLaw(structureMaterial, asphaltMaterial);

const physicalAssembly = {
    revision: 1,
    parts: [sensor],
    connections: [],
  },
  multibodyRuntime = new MultibodyRuntime({
    world,
    worldAdapter: adapter,
    material: structureMaterial,
    materialForKey: (key) =>
      key === structureMaterial.name ? structureMaterial : null,
    catalog: JSON.stringify(TYPES),
    groundBody: floor,
    fieldBody: floor,
    fixedDt: DT,
  });
multibodyRuntime.start(JSON.stringify(physicalAssembly));
const body = multibodyRuntime.bodyByPart.get(sensor.id),
  boxShape = body.shapes[0],
  initialBoxShapeId = boxShape.userData.shapeId,
  initialBodyQuaternion = body.quaternion.clone(),
  authoredQuaternion = new CANNON.Quaternion(...sensor.orientation),
  authoredComOffsetWorld = authoredQuaternion.vmult(
    body.userData.massFrame.comPart,
  ),
  integrate = adapter.integrate.bind(adapter),
  session = new SimulationSession({
    systems: [new RigidBodySystem(), new TelemetrySystem()],
  }).start(
    { parts, connections },
    {
      worldAdapter: adapter,
      multibodyRuntime,
      compiledAssembly: multibodyRuntime.compiled,
      catalog: multibodyRuntime.catalog,
    },
  ),
  bank = new ControllerSensorBank(),
  capture = () => {
    const telemetry = session.telemetry();
    return {
      telemetry,
      readings: bank.capture({
        parts,
        connections,
        bodies: telemetry.bodies,
        signals,
        fixedDt: DT,
        time: telemetry.time,
      })[controller.id],
    };
  },
  close = (actual, expected, label, tolerance = 1e-8) =>
    assert.ok(
      Math.abs(actual - expected) <= tolerance,
      `${label}: expected ${expected}, received ${actual}`,
    );

session.context.bodyRegistry.registerBody(
  "external:ordinary-floor-observer",
  [floorObserver.id],
  {
    engineBody: floor,
    pose: { position: floor.position, quaternion: floor.quaternion },
  },
);

markerShape.material = structureMaterial;
markerShape.userData = {
  shapeId: "non-contacting-marker-shape",
  materialKey: "generic-structure",
};
body.addShape(markerShape);

function placeBody(partOriginY) {
  body.position.set(
    sensor.pos[0] + authoredComOffsetWorld.x,
    partOriginY + authoredComOffsetWorld.y,
    sensor.pos[2] + authoredComOffsetWorld.z,
  );
  body.quaternion.copy(initialBodyQuaternion);
  body.velocity.set(0, 0, 0);
  body.angularVelocity.set(0, 0, 0);
  body.aabbNeedsUpdate = true;
}

session.stepFixed(240);
let { telemetry, readings } = capture(),
  observedBody = telemetry.bodies.bodies.find(
    (candidate) => candidate.partIds[0] === sensor.id,
  ),
  direct = observeContactNormalWrench({
    contacts: observedBody.contacts,
    pose: observedBody.pose,
  });
assert.ok(
  observedBody.contacts.length > 0,
  "ordinary box did not contact floor",
);
assert.ok(
  observedBody.contacts.every(
    (sample) =>
      sample.materialKey === "generic-structure" &&
      sample.shapeId === initialBoxShapeId &&
      sample.otherMaterialKey === "workshop-steel" &&
      sample.otherShapeId === "ordinary-floor-shape" &&
      sample.frictionCoefficientValid === true &&
      Math.abs(sample.frictionCoefficient - 0.68) < 1e-12,
  ),
  `physics boundary lost participant shape, material, or validity authority: ${JSON.stringify(observedBody.contacts)}`,
);
assert.ok(readings.contact_normal_force_part_y_n > 10);
close(
  readings.contact_force_n,
  readings.contact_normal_force_part_y_n,
  "legacy summed normal force relay",
  1e-6,
);
assert.ok(
  Math.hypot(
    readings.contact_normal_force_part_x_n,
    readings.contact_normal_force_part_z_n,
  ) <
    readings.contact_normal_force_part_y_n * 1e-5,
  `settled normal force did not remain aligned with the box frame: ${JSON.stringify(readings)}`,
);
assert.ok(
  Math.abs(
    observedBody.pose.quaternion.x * body.quaternion.x +
      observedBody.pose.quaternion.y * body.quaternion.y +
      observedBody.pose.quaternion.z * body.quaternion.z +
      observedBody.pose.quaternion.w * body.quaternion.w,
  ) < 0.9,
  "production body registry leaked the Cannon principal-axis frame as the authored part frame",
);
for (const axis of ["x", "y", "z"]) {
  close(
    readings[`contact_normal_force_part_${axis}_n`],
    direct.forcePartN[axis],
    `production force relay ${axis}`,
  );
  close(
    readings[`contact_normal_moment_part_${axis}_nm`],
    direct.momentPartNm[axis],
    `production moment relay ${axis}`,
  );
}
close(readings.contact_min_friction_coefficient, 0.68, "steel friction law");
for (const key of READING_KEYS) assert.equal(readings.__validity[key], 1);

const preIntegrationPose = multibodyRuntime.bodyPose(sensor.id),
  solverTimeAuthoredFrame = {
    position: {
      x: preIntegrationPose.position.x,
      y: preIntegrationPose.position.y,
      z: preIntegrationPose.position.z,
    },
    quaternion: {
      x: preIntegrationPose.quaternion.x,
      y: preIntegrationPose.quaternion.y,
      z: preIntegrationPose.quaternion.z,
      w: preIntegrationPose.quaternion.w,
    },
  };
body.angularVelocity.set(6, 0, 0);
session.stepFixed(1);
({ telemetry, readings } = capture());
observedBody = telemetry.bodies.bodies.find(
  (candidate) => candidate.partIds[0] === sensor.id,
);
assert.ok(
  observedBody.contacts.length > 0,
  "rotating solver-frame probe lost its contact manifold",
);
for (const sample of observedBody.contacts) {
  for (const axis of ["x", "y", "z"])
    close(
      sample.observationFrame.position[axis],
      solverTimeAuthoredFrame.position[axis],
      "solver-time authored origin " + axis,
      1e-12,
    );
  for (const axis of ["x", "y", "z", "w"])
    close(
      sample.observationFrame.quaternion[axis],
      solverTimeAuthoredFrame.quaternion[axis],
      "solver-time authored orientation " + axis,
      1e-12,
    );
}
direct = observeContactNormalWrench({
  contacts: observedBody.contacts,
  pose: observedBody.pose,
});
for (const axis of ["x", "y", "z"]) {
  close(
    readings["contact_normal_force_part_" + axis + "_n"],
    direct.forcePartN[axis],
    "rotating solver-frame force " + axis,
  );
  close(
    readings["contact_normal_moment_part_" + axis + "_nm"],
    direct.momentPartNm[axis],
    "rotating solver-frame moment " + axis,
  );
}
const postIntegrationFrameResult = observeContactNormalWrench({
  contacts: observedBody.contacts.map((sample) => ({
    ...sample,
    observationFrame: observedBody.pose,
  })),
  pose: observedBody.pose,
});
assert.ok(
  Math.hypot(
    ...["x", "y", "z"].map(
      (axis) =>
        direct.forcePartN[axis] - postIntegrationFrameResult.forcePartN[axis],
    ),
  ) > 1e-4,
  "rotating probe did not distinguish solver-time from post-integration frames",
);
placeBody(0.08);
session.stepFixed(180);

function injectInvalidSolvedMultiplier(value, label) {
  let injected = false;
  adapter.integrate = (dt, options) => {
    integrate(dt, options);
    if (!injected && world.contacts.length) {
      world.contacts[0].multiplier = value;
      injected = true;
    }
  };
  session.stepFixed(1);
  adapter.integrate = integrate;
  assert.equal(injected, true, `${label} probe found no solved contact row`);
  const invalid = capture();
  assert.ok(
    invalid.telemetry.bodies.bodies
      .find((candidate) => candidate.partIds[0] === sensor.id)
      .contacts.some((sample) => sample.normalForceValid === false),
    `${label} solver corruption did not retain explicit invalidity evidence`,
  );
  for (const key of READING_KEYS) {
    assert.equal(invalid.readings[key], 0, `${label} leaked ${key}`);
    assert.equal(
      invalid.readings.__validity[key],
      0,
      `${label} left ${key} valid`,
    );
  }
  session.stepFixed(1);
  const recovered = capture().readings;
  assert.equal(
    recovered.__validity.contact_normal_force_part_y_n,
    1,
    `${label} did not recover from a clean solver step`,
  );
}

for (const [value, label] of [
  [Number.NaN, "non-finite multiplier"],
  [-1, "negative multiplier"],
  [undefined, "missing multiplier"],
])
  injectInvalidSolvedMultiplier(value, label);

function expectUnsolvedContactExcluded(apply, restore, predicate, label) {
  apply();
  session.stepFixed(1);
  const unsolved = world.contacts.filter(predicate);
  assert.ok(unsolved.length > 0, `${label} produced no unsolved contact row`);
  assert.ok(
    unsolved.some(
      (contact) =>
        Number.isFinite(contact.multiplier) && contact.multiplier > 0,
    ),
    `${label} did not exercise a retained stale multiplier`,
  );
  const excluded = capture();
  assert.equal(
    excluded.telemetry.bodies.bodies.find(
      (candidate) => candidate.partIds[0] === sensor.id,
    ).contacts.length,
    0,
    `${label} entered the solved-contact registry`,
  );
  for (const key of READING_KEYS.slice(0, 7)) {
    assert.equal(excluded.readings[key], 0);
    assert.equal(excluded.readings.__validity[key], 1);
  }
  assert.equal(
    excluded.readings.__validity.contact_min_friction_coefficient,
    0,
  );
  restore();
  session.stepFixed(1);
  assert.equal(
    capture().readings.__validity.contact_normal_force_part_y_n,
    1,
    `${label} did not recover after solver participation resumed`,
  );
}

expectUnsolvedContactExcluded(
  () => {
    body.collisionResponse = false;
  },
  () => {
    body.collisionResponse = true;
  },
  (contact) => contact.enabled === false,
  "disabled contact equation",
);
expectUnsolvedContactExcluded(
  () => {
    body.isTrigger = true;
  },
  () => {
    body.isTrigger = false;
  },
  (contact) => contact.bi.isTrigger || contact.bj.isTrigger,
  "trigger contact equation",
);
expectUnsolvedContactExcluded(
  () => {
    floor.isTrigger = true;
  },
  () => {
    floor.isTrigger = false;
  },
  (contact) => contact.bi.isTrigger || contact.bj.isTrigger,
  "counterpart trigger contact equation",
);

function injectFrictionMetadata(mutate, label, expectedValid) {
  let injected = false;
  adapter.integrate = (dt, options) => {
    integrate(dt, options);
    if (world.contacts.length) {
      for (const contact of world.contacts) mutate(contact);
      injected = true;
    }
  };
  session.stepFixed(1);
  adapter.integrate = integrate;
  assert.equal(injected, true, `${label} probe found no contact row`);
  const result = capture(),
    samples = result.telemetry.bodies.bodies.find(
      (candidate) => candidate.partIds[0] === sensor.id,
    ).contacts;
  assert.ok(samples.length > 0, `${label} lost the normal-contact manifold`);
  assert.ok(
    samples.every(
      (sample) =>
        sample.frictionCoefficientValid === expectedValid &&
        (expectedValid || sample.frictionCoefficient === 0),
    ),
    `${label} crossed the registry with contradictory friction authority`,
  );
  assert.equal(
    result.readings.__validity.contact_normal_force_part_y_n,
    1,
    `${label} invalidated independent normal-force evidence`,
  );
  assert.equal(
    result.readings.__validity.contact_min_friction_coefficient,
    expectedValid ? 1 : 0,
    `${label} produced the wrong friction validity`,
  );
  session.stepFixed(1);
}

for (const [mutate, label] of [
  [
    (contact) => {
      contact.simulacrumFrictionCoefficientValid = false;
    },
    "explicit invalid friction row metadata",
  ],
  [
    (contact) => {
      delete contact.simulacrumFrictionCoefficientValid;
    },
    "missing friction row validity",
  ],
  [
    (contact) => {
      contact.simulacrumFrictionCoefficient = Number.NaN;
    },
    "non-finite friction row coefficient",
  ],
  [
    (contact) => {
      contact.simulacrumFrictionCoefficient = -1;
    },
    "negative friction row coefficient",
  ],
])
  injectFrictionMetadata(mutate, label, false);
injectFrictionMetadata(
  (contact) => {
    contact.simulacrumFrictionCoefficientValid = true;
    contact.simulacrumFrictionCoefficient = 0;
  },
  "known zero friction row coefficient",
  true,
);

let zeroInjected = false;
adapter.integrate = (dt, options) => {
  integrate(dt, options);
  if (!zeroInjected && world.contacts.length > 1) {
    world.contacts[0].multiplier = 0;
    zeroInjected = true;
  }
};
session.stepFixed(1);
adapter.integrate = integrate;
assert.equal(zeroInjected, true, "zero-load probe requires a contact manifold");
const zeroRowCapture = capture();
assert.ok(
  zeroRowCapture.telemetry.bodies.bodies
    .find((candidate) => candidate.partIds[0] === sensor.id)
    .contacts.some(
      (sample) => sample.forceN === 0 && sample.normalForceValid === true,
    ),
  "a finite zero solver multiplier was not preserved as valid zero-load evidence",
);
assert.equal(
  zeroRowCapture.readings.__validity.contact_normal_force_part_y_n,
  1,
  "one valid zero-load row invalidated the remaining active contact manifold",
);

placeBody(2);
session.stepFixed(2);
({ readings } = capture());
for (const key of READING_KEYS.slice(0, 7)) {
  assert.equal(readings[key], 0);
  assert.equal(readings.__validity[key], 1);
}
assert.equal(readings.contact_min_friction_coefficient, 0);
assert.equal(readings.__validity.contact_min_friction_coefficient, 0);

floorShape.material = asphaltMaterial;
floor.material = asphaltMaterial;
floorShape.userData.materialKey = "dry-asphalt";
placeBody(0.08);
session.stepFixed(180);
({ readings } = capture());
assert.equal(readings.__validity.contact_normal_force_part_y_n, 1);
assert.equal(readings.__validity.contact_min_friction_coefficient, 1);
close(
  readings.contact_min_friction_coefficient,
  0.6624,
  "changed support material law",
);

const clonedStructureMaterial = new CANNON.Material("generic-structure"),
  clonedAsphaltMaterial = new CANNON.Material("dry-asphalt");
boxShape.material = clonedStructureMaterial;
body.material = clonedStructureMaterial;
floorShape.material = clonedAsphaltMaterial;
floor.material = clonedAsphaltMaterial;
assert.equal(
  world.getContactMaterial(clonedStructureMaterial, clonedAsphaltMaterial),
  undefined,
);
placeBody(2);
session.stepFixed(2);
placeBody(0.08);
session.stepFixed(180);
({ telemetry, readings } = capture());
observedBody = telemetry.bodies.bodies.find(
  (candidate) => candidate.partIds[0] === sensor.id,
);
assert.ok(
  observedBody.contacts.every(
    (sample) =>
      sample.materialKey === "generic-structure" &&
      sample.otherMaterialKey === "dry-asphalt" &&
      sample.shapeId === initialBoxShapeId &&
      sample.otherShapeId === "ordinary-floor-shape" &&
      sample.frictionCoefficientValid === true &&
      Math.abs(
        sample.frictionCoefficient - world.defaultContactMaterial.friction,
      ) < 1e-12,
  ),
  "same-name unregistered Cannon objects lost the coefficient actually enforced by the default law",
);
assert.equal(readings.__validity.contact_normal_force_part_y_n, 1);
assert.equal(readings.__validity.contact_min_friction_coefficient, 1);
close(
  readings.contact_min_friction_coefficient,
  world.defaultContactMaterial.friction,
  "same-name clone solver-enforced default friction",
);

boxShape.material = structureMaterial;
body.material = structureMaterial;
floorShape.material = asphaltMaterial;
floor.material = asphaltMaterial;
placeBody(2);
session.stepFixed(2);
placeBody(0.08);
session.stepFixed(180);
({ readings } = capture());
assert.equal(readings.__validity.contact_min_friction_coefficient, 1);
close(
  readings.contact_min_friction_coefficient,
  0.6624,
  "registered material-object authority recovery",
);

body.userData.contactMaterialAt = (_x, _z, participantMaterialKey) => {
  const law = contactMaterialPair("generic-structure", participantMaterialKey);
  return {
    materialKey: "generic-structure",
    shapeId: "procedural-box-surface",
    friction: Math.min(
      law.longitudinalFrictionCoefficient,
      law.lateralFrictionCoefficient,
    ),
    restitution: law.restitutionCoefficient,
    contactEquationStiffness: 1e8,
    contactEquationRelaxation: 3,
    frictionEquationStiffness: 1e8,
    frictionEquationRelaxation: 3,
  };
};
placeBody(2);
session.stepFixed(2);
placeBody(0.08);
session.stepFixed(180);
({ telemetry, readings } = capture());
observedBody = telemetry.bodies.bodies.find(
  (candidate) => candidate.partIds[0] === sensor.id,
);
assert.ok(
  observedBody.contacts.every(
    (sample) =>
      sample.materialKey === "generic-structure" &&
      sample.shapeId === "procedural-box-surface" &&
      sample.otherMaterialKey === "dry-asphalt" &&
      sample.otherShapeId === "ordinary-floor-shape" &&
      sample.surfaceRegionId === "procedural-box-surface",
  ),
  "procedural surface law was not authoritative for its own participant identity",
);
assert.ok(
  world.frictionEquations.length > 0 &&
    world.frictionEquations.every(
      (equation) =>
        equation.surfaceLawParticipant === (equation.bi === body ? "bi" : "bj"),
    ),
  "friction rows lost the procedural body's participant ownership",
);
const proceduralBodyCounterpart = telemetry.bodies.bodies.find((candidate) =>
  candidate.partIds.includes(floorObserver.id),
);
assert.ok(
  proceduralBodyCounterpart.contacts.every(
    (sample) =>
      sample.materialKey === "dry-asphalt" &&
      sample.shapeId === "ordinary-floor-shape" &&
      sample.otherMaterialKey === "generic-structure" &&
      sample.otherShapeId === "procedural-box-surface" &&
      sample.surfaceRegionId === "procedural-box-surface",
  ),
  "procedural body law leaked across its ordinary contact counterpart",
);
assert.equal(readings.__validity.contact_min_friction_coefficient, 1);
close(
  readings.contact_min_friction_coefficient,
  0.6624,
  "procedural surface friction law",
);
delete body.userData.contactMaterialAt;

body.material = structureMaterial;
floorShape.material = steelMaterial;
floor.material = steelMaterial;
floor.userData.contactMaterialAt = (_x, _z, participantMaterialKey) => {
  const law = contactMaterialPair("dry-asphalt", participantMaterialKey);
  return {
    materialKey: "dry-asphalt",
    shapeId: "procedural-floor-surface",
    friction: Math.min(
      law.longitudinalFrictionCoefficient,
      law.lateralFrictionCoefficient,
    ),
    restitution: law.restitutionCoefficient,
    contactEquationStiffness: 1e8,
    contactEquationRelaxation: 3,
    frictionEquationStiffness: 1e8,
    frictionEquationRelaxation: 3,
  };
};
placeBody(2);
session.stepFixed(2);
placeBody(0.08);
session.stepFixed(180);
({ telemetry, readings } = capture());
observedBody = telemetry.bodies.bodies.find(
  (candidate) => candidate.partIds[0] === sensor.id,
);
assert.ok(
  observedBody.contacts.every(
    (sample) =>
      sample.otherMaterialKey === "dry-asphalt" &&
      sample.otherShapeId === "procedural-floor-surface" &&
      sample.materialKey === "generic-structure" &&
      sample.shapeId === initialBoxShapeId &&
      sample.surfaceRegionId === "procedural-floor-surface",
  ),
  "procedural surface law was not authoritative for the other participant identity",
);
const proceduralFloorOwner = telemetry.bodies.bodies.find((candidate) =>
  candidate.partIds.includes(floorObserver.id),
);
assert.ok(
  proceduralFloorOwner.contacts.every(
    (sample) =>
      sample.materialKey === "dry-asphalt" &&
      sample.shapeId === "procedural-floor-surface" &&
      sample.otherMaterialKey === "generic-structure" &&
      sample.otherShapeId === initialBoxShapeId &&
      sample.surfaceRegionId === "procedural-floor-surface",
  ),
  "procedural floor law was not scoped to its owning participant",
);
assert.ok(
  world.frictionEquations.length > 0 &&
    world.frictionEquations.every(
      (equation) =>
        equation.surfaceLawParticipant ===
        (equation.bi === floor ? "bi" : "bj"),
    ),
  "friction rows lost the procedural floor's participant ownership",
);
assert.equal(readings.__validity.contact_min_friction_coefficient, 1);
delete floor.userData.contactMaterialAt;
floorShape.material = asphaltMaterial;
floor.material = asphaltMaterial;

boxShape.userData.shapeId = null;
placeBody(2);
session.stepFixed(2);
placeBody(0.08);
session.stepFixed(180);
({ telemetry, readings } = capture());
observedBody = telemetry.bodies.bodies.find(
  (candidate) => candidate.partIds[0] === sensor.id,
);
assert.ok(
  observedBody.contacts.every((sample) => sample.shapeId === "body-shape:0"),
  "untagged participant shape did not receive deterministic body-local identity",
);
assert.equal(readings.__validity.contact_min_friction_coefficient, 1);

boxShape.userData.materialKey = "low-grip-polymer";
placeBody(2);
session.stepFixed(2);
placeBody(0.08);
session.stepFixed(180);
({ readings } = capture());
assert.equal(readings.__validity.contact_normal_force_part_y_n, 1);
assert.equal(
  readings.__validity.contact_min_friction_coefficient,
  0,
  "conflicting declared and physical material identities invented a law",
);

boxShape.userData.materialKey = "generic-structure";
boxShape.material = null;
body.material = null;
placeBody(2);
session.stepFixed(2);
placeBody(0.08);
session.stepFixed(180);
({ readings } = capture());
assert.equal(
  readings.__validity.contact_normal_force_part_y_n,
  1,
  "missing material identity erased otherwise valid solved wrench evidence",
);
assert.equal(
  readings.__validity.contact_min_friction_coefficient,
  0,
  "declared material without a physical Cannon material invented a law",
);
assert.equal(readings.contact_min_friction_coefficient, 0);

boxShape.material = structureMaterial;
boxShape.userData.shapeId = initialBoxShapeId;
floorShape.userData.shapeId = "stale-procedural-box-surface";
body.userData.contactMaterialAt = (_x, _z, participantMaterialKey) => {
  const law = contactMaterialPair("generic-structure", participantMaterialKey);
  return {
    materialKey: "generic-structure",
    shapeId: "stale-procedural-box-surface",
    friction: Math.min(
      law.longitudinalFrictionCoefficient,
      law.lateralFrictionCoefficient,
    ),
    restitution: law.restitutionCoefficient,
    contactEquationStiffness: 1e8,
    contactEquationRelaxation: 3,
    frictionEquationStiffness: 1e8,
    frictionEquationRelaxation: 3,
  };
};
const replacementBoxShape = new CANNON.Box(new CANNON.Vec3(0.4, 0.1, 0.3));
replacementBoxShape.material = structureMaterial;
replacementBoxShape.userData = {
  shapeId: "replacement-box-shape",
  materialKey: "generic-structure",
};
let replacedSolvedShapes = false,
  invalidOwnerInjected = false;
adapter.integrate = (dt, options) => {
  integrate(dt, options);
  if (!replacedSolvedShapes && world.contacts.length) {
    world.contacts[0].surfaceLawParticipant = "invalid-participant";
    invalidOwnerInjected = true;
    body.shapes[0] = replacementBoxShape;
    replacedSolvedShapes = true;
  }
};
session.stepFixed(1);
({ telemetry, readings } = capture());
observedBody = telemetry.bodies.bodies.find(
  (candidate) => candidate.partIds[0] === sensor.id,
);
assert.equal(replacedSolvedShapes, true);
assert.equal(invalidOwnerInjected, true);
assert.ok(
  observedBody.contacts.every(
    (sample) =>
      sample.materialKey === null &&
      sample.shapeId === null &&
      sample.otherMaterialKey === "dry-asphalt" &&
      sample.otherShapeId === "stale-procedural-box-surface" &&
      sample.supportShapeId === "stale-procedural-box-surface" &&
      sample.surfaceRegionId === null,
  ),
  `stale solved shapes retained detached participant identity: ${JSON.stringify(observedBody.contacts)}`,
);
const staleOwnerCounterpart = telemetry.bodies.bodies.find((candidate) =>
  candidate.partIds.includes(floorObserver.id),
);
assert.ok(
  staleOwnerCounterpart.contacts.every(
    (sample) =>
      sample.materialKey === "dry-asphalt" &&
      sample.shapeId === "stale-procedural-box-surface" &&
      sample.otherMaterialKey === null &&
      sample.otherShapeId === null &&
      sample.supportShapeId === null &&
      sample.surfaceRegionId === null,
  ),
  `stale procedural metadata crossed to an attached counterpart with a colliding local ID: ${JSON.stringify(staleOwnerCounterpart.contacts)}`,
);
assert.equal(readings.__validity.contact_normal_force_part_y_n, 1);
assert.equal(readings.__validity.contact_min_friction_coefficient, 0);
assert.equal(readings.contact_min_friction_coefficient, 0);

session.dispose();

const compoundWorld = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.80665, 0),
  }),
  compoundAdapter = new CannonWorldAdapter(compoundWorld),
  compoundStructureMaterial = new CANNON.Material("generic-structure"),
  compoundSteelMaterial = new CANNON.Material("workshop-steel"),
  compoundFloorShape = new CANNON.Plane(),
  compoundFloor = new CANNON.Body({ mass: 0 });
compoundFloorShape.material = compoundSteelMaterial;
compoundFloorShape.userData = {
  shapeId: "compound-floor-shape",
  materialKey: "workshop-steel",
};
compoundFloor.addShape(compoundFloorShape);
compoundFloor.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
compoundFloor.userData = {
  externalBodyId: "compound-floor",
  surface: "compound-floor",
};
compoundWorld.addBody(compoundFloor);
const compoundLaw = contactMaterialPair(
  compoundStructureMaterial.name,
  compoundSteelMaterial.name,
);
compoundWorld.addContactMaterial(
  new CANNON.ContactMaterial(compoundStructureMaterial, compoundSteelMaterial, {
    friction: Math.min(
      compoundLaw.longitudinalFrictionCoefficient,
      compoundLaw.lateralFrictionCoefficient,
    ),
    restitution: compoundLaw.restitutionCoefficient,
  }),
);

const asymmetricBody = {
    ...part("asymmetric-contact-body", "plate"),
    pos: [-0.8, 0.155, 0],
    scale: { x: 0.5, y: 0.5, z: 0.5 },
  },
  companionBody = {
    ...part("asymmetric-companion", "plate"),
    pos: [0.8, 0.155, 0],
    scale: { x: 0.5, y: 0.5, z: 0.5 },
  },
  connector = {
    id: "ordinary-damper",
    type: "damper",
    pos: [0, 0.2, 0.25],
    orientation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
    scale: { x: 1, y: 1, z: 1 },
    mechanism: structuredClone(mechanismComponentDefinition("damper")),
  },
  asymmetricAssembly = {
    revision: 1,
    parts: [asymmetricBody, connector, companionBody],
    connections: [
      {
        id: "asymmetric-end-a",
        a: asymmetricBody.id,
        b: connector.id,
        kind: "mechanical",
        portA: "TOP",
        portB: "END_A",
        anchorA: [0.3, 0.045, 0.25],
        capacity: { ultimateForceN: 24_000, ultimateTorqueNm: 6_000 },
      },
      {
        id: "asymmetric-end-b",
        a: connector.id,
        b: companionBody.id,
        kind: "mechanical",
        portA: "END_B",
        portB: "TOP",
        anchorB: [-0.3, 0.045, 0.25],
        capacity: { ultimateForceN: 24_000, ultimateTorqueNm: 6_000 },
      },
    ],
  },
  compoundRuntime = new MultibodyRuntime({
    world: compoundWorld,
    worldAdapter: compoundAdapter,
    material: compoundStructureMaterial,
    materialForKey: (key) =>
      key === "generic-structure"
        ? compoundStructureMaterial
        : key === "workshop-steel"
          ? compoundSteelMaterial
          : null,
    catalog: JSON.stringify(TYPES),
    groundBody: compoundFloor,
    fieldBody: compoundFloor,
    fixedDt: DT,
  });
compoundRuntime.start(JSON.stringify(asymmetricAssembly));
const compoundSession = new SimulationSession({
    systems: [new RigidBodySystem(), new TelemetrySystem()],
  }).start(asymmetricAssembly, {
    worldAdapter: compoundAdapter,
    multibodyRuntime: compoundRuntime,
    compiledAssembly: compoundRuntime.compiled,
    catalog: compoundRuntime.catalog,
  }),
  compoundDescriptor = compoundRuntime.compiled.bodies.find(
    (candidate) => candidate.partId === asymmetricBody.id,
  ),
  compoundEngineBody = compoundRuntime.bodyByPart.get(asymmetricBody.id),
  compiledCom = compoundDescriptor.massProperties.comPositionPartM;
assert.ok(
  Math.hypot(...compiledCom) > 0.04,
  `ordinary endpoint mass did not create an asymmetric COM: ${JSON.stringify(compiledCom)}`,
);
compoundSession.stepFixed(480);
const compoundTelemetry = compoundSession.telemetry(),
  compoundObservedBody = compoundTelemetry.bodies.bodies.find((candidate) =>
    candidate.partIds.includes(asymmetricBody.id),
  ),
  compoundObservation = observeContactNormalWrench({
    contacts: compoundObservedBody.contacts,
    pose: compoundObservedBody.pose,
  }),
  originToComDistance = Math.hypot(
    compoundObservedBody.pose.position.x - compoundEngineBody.position.x,
    compoundObservedBody.pose.position.y - compoundEngineBody.position.y,
    compoundObservedBody.pose.position.z - compoundEngineBody.position.z,
  ),
  frameDot = Math.abs(
    compoundObservedBody.pose.quaternion.x * compoundEngineBody.quaternion.x +
      compoundObservedBody.pose.quaternion.y * compoundEngineBody.quaternion.y +
      compoundObservedBody.pose.quaternion.z * compoundEngineBody.quaternion.z +
      compoundObservedBody.pose.quaternion.w * compoundEngineBody.quaternion.w,
  );
close(
  originToComDistance,
  Math.hypot(...compiledCom),
  "production authored-origin to center-of-mass separation",
  1e-9,
);
assert.ok(
  frameDot < 0.999,
  "production authored frame collapsed into the Cannon principal-axis frame",
);
assert.equal(compoundObservation.wrenchValid, true);
assert.ok(compoundObservation.forcePartN.y > 200);
close(
  compoundObservation.momentPartNm.x / compoundObservation.forcePartN.y,
  -compiledCom[2],
  "asymmetric support center of pressure X moment arm",
  0.03,
);
close(
  compoundObservation.momentPartNm.z / compoundObservation.forcePartN.y,
  compiledCom[0],
  "asymmetric support center of pressure Z moment arm",
  0.03,
);
compoundSession.dispose();

console.log(
  "contact normal-wrench physics passed (ordinary contact, solver fail-closed recovery, participant identity, authored COM/principal frame, material change)",
);
