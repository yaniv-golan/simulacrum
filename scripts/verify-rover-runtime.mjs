import * as CANNON from "cannon-es";
import { assert } from "./lib/assert.mjs";
import { TYPES } from "../src/model/component-catalog.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { CommandBus } from "../src/simulation/command-bus.js";
import { MultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { PowerNetwork } from "../src/simulation/power-network.js";
import { RunAssemblyGraph } from "../src/simulation/run-assembly-graph.js";
import { fixtureMobilityTelemetry } from "./lib/mobility-fixture.mjs";

const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.80665, 0),
  }),
  worldAdapter = new CannonWorldAdapter(world),
  groundMaterial = new CANNON.Material("ground"),
  assemblyMaterial = new CANNON.Material("assembly"),
  groundBody = new CANNON.Body({
    type: CANNON.Body.STATIC,
    shape: new CANNON.Box(new CANNON.Vec3(50, 0.25, 50)),
    material: groundMaterial,
    position: new CANNON.Vec3(0, -0.25, 0),
  });
groundBody.userData = {
  externalBodyId: "fixture:ground",
  surface: "fixture ground",
  materialKey: "workshop-steel",
};
world.solver.iterations = 24;
world.solver.tolerance = 0.0005;
world.addBody(groundBody);
world.addContactMaterial(
  new CANNON.ContactMaterial(assemblyMaterial, groundMaterial, {
    friction: 0.68,
    restitution: 0.02,
  }),
);

const cart = decodeBlueprintOrThrow(builtInDemo("cart").blueprint).assembly,
  looseWheel = {
    id: 999,
    type: "wheel",
    pos: [-8, 3.5, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    mechanism: structuredClone(TYPES.wheel.mechanism),
  },
  assembly = {
    revision: 1,
    parts: [...cart.parts, looseWheel],
    connections: [...cart.connections],
  },
  runGraph = new RunAssemblyGraph(assembly),
  powerNetwork = new PowerNetwork(TYPES),
  commandBus = new CommandBus(),
  runtime = new MultibodyRuntime({
    world,
    worldAdapter,
    material: assemblyMaterial,
    catalog: TYPES,
    groundBody,
    fieldBody: groundBody,
    surfaceHeightAt: () => 0,
    terrainHeightAt: () => 0,
  }),
  context = { runGraph, powerNetwork, commandBus, services: {} },
  dt = 1 / 120,
  drivenWheelIds = new Set(
    cart.parts.filter((part) => part.type === "wheel").map((part) => part.id),
  ),
  drivenWheelIdList = [...drivenWheelIds],
  chassisId = cart.parts.find((part) => part.type === "plate")?.id,
  cartPartIds = cart.parts.map((part) => part.id),
  driveMotorIds = cart.parts
    .filter((part) => part.type === "motor")
    .map((part) => part.id),
  steeringHingeIds = cart.parts
    .filter((part) => part.type === "hinge")
    .map((part) => part.id),
  frontGuideIds = new Set(
    cart.connections
      .filter(
        (connection) =>
          (steeringHingeIds.includes(connection.a) &&
            connection.portA === "BASE") ||
          (steeringHingeIds.includes(connection.b) &&
            connection.portB === "BASE"),
      )
      .map((connection) =>
        steeringHingeIds.includes(connection.a) ? connection.b : connection.a,
      ),
  ),
  frontCornerIds = new Set([
    ...driveMotorIds.slice(0, steeringHingeIds.length),
    ...cart.connections
      .filter(
        (connection) =>
          (steeringHingeIds.includes(connection.a) &&
            connection.portA === "ARM") ||
          (steeringHingeIds.includes(connection.b) &&
            connection.portB === "ARM"),
      )
      .map((connection) =>
        steeringHingeIds.includes(connection.a) ? connection.b : connection.a,
      ),
  ]),
  steeringHingeId = steeringHingeIds[0],
  steeredWheelIds = drivenWheelIdList.slice(0, steeringHingeIds.length),
  steeredWheelId = steeredWheelIds[0];

runtime.start(assembly);
assert.equal(
  runtime.bodyByPart.size,
  runtime.compiled.bodies.length,
  "compiler collapsed independent components into a vehicle body",
);
assert.notEqual(
  runtime.bodyByPart.get(drivenWheelIdList[0]),
  runtime.bodyByPart.get(drivenWheelIdList[1]),
  "distinct authored wheels share one rigid body",
);
const rollingConstraints = runtime.constraintEntries.filter(
  (entry) => entry.kind === "rolling-contact-v1",
);
assert.equal(
  rollingConstraints.length,
  runtime.compiled.contactRegions.length,
  "an authored rolling-contact region has no tire constraint owner",
);
for (const wheelId of [...drivenWheelIds, looseWheel.id]) {
  const body = runtime.bodyByPart.get(wheelId);
  const roundedShape = body.shapes.find(
    (shape) =>
      shape instanceof CANNON.ConvexPolyhedron &&
      shape.userData?.geometryKind === "rounded-wheel-v1",
  );
  assert.ok(roundedShape, `wheel ${wheelId} has no rounded collision hull`);
  assert.ok(
    roundedShape.vertices.length <= 112,
    `wheel ${wheelId} collision hull exceeded the validated vertex budget`,
  );
  for (const [axisIndex, axis] of roundedShape.uniqueAxes.entries())
    for (const other of roundedShape.uniqueAxes.slice(axisIndex + 1))
      assert.ok(
        Math.abs(axis.dot(other)) < 1 - 1e-7,
        `wheel ${wheelId} retains a duplicate undirected SAT face axis`,
      );
  for (const [edgeIndex, edge] of roundedShape.uniqueEdges.entries())
    for (const other of roundedShape.uniqueEdges.slice(edgeIndex + 1))
      assert.ok(
        Math.abs(edge.dot(other)) < 1 - 1e-7,
        `wheel ${wheelId} retains a duplicate undirected SAT edge axis`,
      );
  const maximumRadius = Math.max(
      ...roundedShape.vertices.map((vertex) => Math.hypot(vertex.x, vertex.y)),
    ),
    treadAngles = new Set(
      roundedShape.vertices
        .filter(
          (vertex) =>
            Math.abs(Math.hypot(vertex.x, vertex.y) - maximumRadius) < 1e-9,
        )
        .map((vertex) => Math.atan2(vertex.y, vertex.x).toFixed(9)),
    ),
    radialChordErrorRatio =
      1 - Math.cos(Math.PI / Math.max(1, treadAngles.size));
  assert.ok(
    treadAngles.size >= 32 && radialChordErrorRatio <= 0.005,
    `wheel ${wheelId} collision envelope is too coarse for tire contact`,
  );
  assert.ok(
    body.shapes.every(
      (shape) =>
        !(shape instanceof CANNON.Box) && !(shape instanceof CANNON.Cylinder),
    ),
    `wheel ${wheelId} regressed to a box or sharp cylinder hitbox`,
  );
}

assert.ok(steeringHingeId != null && steeredWheelId != null);
const initialMobility = fixtureMobilityTelemetry(runtime, {
    context,
    dt,
    partIds: cartPartIds,
  }),
  initialWheel = initialMobility.wheelStates.find(
    (wheel) => wheel.partId === steeredWheelId,
  ),
  initialSteeringAngleRad = initialWheel?.steeringAngleRad;
assert.ok(
  Math.abs(initialSteeringAngleRad) < 1e-6,
  `authored straight wheel did not report a straight heading: ${JSON.stringify({ pose: initialMobility.pose, framePartId: initialMobility.framePartId, wheel: initialWheel })}`,
);

const startX = runtime.bodyByPart.get(chassisId).position.x,
  startZ = runtime.bodyByPart.get(chassisId).position.z;
let maximumContacts = 0,
  maximumDeflectionM = 0,
  maximumDissipatedEnergyJ = 0,
  maximumEllipseUtilization = 0,
  maximumDrivenAngularSpeed = 0,
  idleMotorTelemetry = null,
  maximumForceUtilization = 0,
  maximumForceUtilizationRecord = null,
  maximumTorqueUtilization = 0,
  maximumTorqueUtilizationRecord = null,
  maximumMinimumLeftSteeringAngleRad = 0,
  steeringInterferenceContacts = [],
  connectionById = new Map(
    assembly.connections.map((connection) => [connection.id, connection]),
  );
for (let tick = 1; tick <= 600; tick++) {
  commandBus.clearTick();
  for (const motorId of driveMotorIds)
    commandBus.writeRemote(
      motorId,
      "throttle",
      tick <= 120 ? 0 : tick <= 144 ? 1 : 0.65,
    );
  for (const hingeId of steeringHingeIds)
    commandBus.writeRemote(
      hingeId,
      "joint_target",
      tick <= 180 ? 0 : tick <= 480 ? 1 : 0,
    );
  powerNetwork.resolve(runGraph, dt);
  const actuatorTelemetry = runtime.stepActuators(context, dt);
  if (tick <= 120) {
    idleMotorTelemetry = actuatorTelemetry;
    assert.equal(
      actuatorTelemetry.activeMotors,
      0,
      "zero throttle engaged a hidden motor-speed servo instead of freewheeling",
    );
    assert.ok(
      driveMotorIds.every(
        (motorId) => (runtime.motorElectricalWByPart.get(motorId) || 0) === 0,
      ),
      "neutral motor command consumed electrical power",
    );
    assert.ok(
      runtime.constraintEntries
        .filter((entry) => driveMotorIds.includes(entry.descriptor.motorId))
        .every((entry) => !entry.constraint.motorEquation.enabled),
      "neutral motor command left a drivetrain motor equation enabled",
    );
  }
  worldAdapter.integrate(dt, { tick });
  runtime.afterIntegration(dt);
  for (const contact of world.contacts) {
    const left = contact.bi.userData?.partId,
      right = contact.bj.userData?.partId;
    if (
      (frontGuideIds.has(left) && frontCornerIds.has(right)) ||
      (frontGuideIds.has(right) && frontCornerIds.has(left))
    )
      steeringInterferenceContacts.push({ tick, left, right });
  }
  for (const [connectionId, loadN] of runtime.loadByConnection) {
    const utilization =
      loadN /
      Math.max(
        1,
        connectionById.get(connectionId)?.capacity?.ultimateForceN || 1,
      );
    if (utilization > maximumForceUtilization) {
      maximumForceUtilization = utilization;
      maximumForceUtilizationRecord = {
        tick,
        connectionId,
        loadN,
        utilization,
      };
    }
  }
  for (const [connectionId, torqueNm] of runtime.torqueByConnection) {
    const utilization =
      torqueNm /
      Math.max(
        1,
        connectionById.get(connectionId)?.capacity?.ultimateTorqueNm || 1,
      );
    if (utilization > maximumTorqueUtilization) {
      maximumTorqueUtilization = utilization;
      maximumTorqueUtilizationRecord = {
        tick,
        connectionId,
        torqueNm,
        utilization,
      };
    }
  }
  const telemetry = fixtureMobilityTelemetry(runtime, {
      context,
      dt,
      partIds: cartPartIds,
    }),
    drivenStates = telemetry.wheelStates.filter((state) =>
      drivenWheelIds.has(state.partId),
    );
  if (tick > 240 && tick <= 480)
    maximumMinimumLeftSteeringAngleRad = Math.max(
      maximumMinimumLeftSteeringAngleRad,
      Math.min(
        ...drivenStates
          .filter((wheel) => steeredWheelIds.includes(wheel.partId))
          .map((wheel) => wheel.steeringAngleRad),
      ),
    );
  maximumContacts = Math.max(
    maximumContacts,
    drivenStates.filter((state) => state.touching).length,
  );
  maximumDeflectionM = Math.max(
    maximumDeflectionM,
    ...drivenStates.map((state) => state.carcassDeflectionM),
  );
  maximumDissipatedEnergyJ = Math.max(
    maximumDissipatedEnergyJ,
    ...drivenStates.map((state) => state.dissipatedEnergyJ),
  );
  maximumEllipseUtilization = Math.max(
    maximumEllipseUtilization,
    ...drivenStates.map((state) => state.frictionEllipseUtilization),
  );
  maximumDrivenAngularSpeed = Math.max(
    maximumDrivenAngularSpeed,
    ...drivenStates.map((state) => Math.abs(state.angularSpeed)),
  );
}

const finalDrivenStates = fixtureMobilityTelemetry(runtime, {
    context,
    dt,
    partIds: cartPartIds,
  }).wheelStates.filter((state) => drivenWheelIds.has(state.partId)),
  travelM = Math.abs(runtime.bodyByPart.get(chassisId).position.z - startZ),
  lateralTravelM = runtime.bodyByPart.get(chassisId).position.x - startX;
assert.ok(
  maximumForceUtilization < 1,
  `nominal suspension exceeded an attachment capacity: ${JSON.stringify(maximumForceUtilizationRecord)}`,
);
assert.ok(
  maximumTorqueUtilization < 1,
  `nominal suspension exceeded an attachment torque capacity: ${JSON.stringify(maximumTorqueUtilizationRecord)}`,
);
assert.ok(
  travelM > 12,
  `generic rotary drive and tire contact advanced only ${travelM} m: ${JSON.stringify({ maximumDrivenAngularSpeed, finalDrivenStates })}`,
);
assert.ok(
  lateralTravelM < -2.8,
  `the authored left command moved the rover toward signed vehicle-right: ${lateralTravelM} m`,
);
assert.deepEqual(
  steeringInterferenceContacts,
  [],
  `front guide rails physically jammed the steering corner: ${JSON.stringify(steeringInterferenceContacts.slice(0, 8))}`,
);
assert.ok(
  maximumMinimumLeftSteeringAngleRad > 0.055,
  `the cart's authored left command did not turn both physical tires left: ${JSON.stringify({ lateralTravelM, maximumMinimumLeftSteeringAngleRad })}`,
);
assert.ok(
  maximumContacts === drivenWheelIds.size,
  "the passive suspension never established four-wheel contact",
);
assert.ok(
  finalDrivenStates.every((state) => state.touching),
  `nominal flat-ground drive ended with a suspended wheel airborne: ${JSON.stringify(finalDrivenStates)}`,
);
assert.ok(
  finalDrivenStates
    .flatMap((state) => state.contactRoles)
    .some((role) => role === "tread" || role === "shoulder"),
  "ground contact was misclassified as wheel sidewall contact",
);
assert.ok(
  maximumDeflectionM > 0 &&
    maximumDeflectionM <=
      TYPES.wheel.mechanism.config.tireConstitutiveLaw.normalModel
        .maximumDeflectionM,
  `carcass deflection left its authored bounds: ${maximumDeflectionM}`,
);
assert.ok(
  maximumDissipatedEnergyJ > 0,
  "tire contact published no dissipated energy",
);
assert.ok(
  maximumEllipseUtilization <= 1 + 1e-9,
  `combined slip escaped the friction ellipse: ${maximumEllipseUtilization}`,
);
assert.ok(
  maximumDrivenAngularSpeed > 1,
  "drive torque did not spin the physical wheel bodies",
);
assert.equal(
  idleMotorTelemetry?.activeMotors,
  0,
  "neutral drivetrain state was not observed",
);
assert.ok(
  runtime.bodyByPart.get(looseWheel.id).position.y < looseWheel.pos[1],
  "unattached wheel did not fall as an independent rigid body",
);
assert.ok(
  rollingConstraints.find(
    (entry) => entry.descriptor.sourcePartId === looseWheel.id,
  )?.constraint.state.dissipatedEnergyJ >= 0,
  "unattached wheel acquired no ordinary environment contact state",
);

const angularSpeedBeforeBrake =
  finalDrivenStates.reduce(
    (sum, state) => sum + Math.abs(state.angularSpeed),
    0,
  ) / finalDrivenStates.length;
let brakeTelemetry = null;
for (let tick = 601; tick <= 720; tick++) {
  commandBus.clearTick();
  for (const motorId of driveMotorIds) {
    commandBus.writeRemote(motorId, "throttle", 0);
    commandBus.writeRemote(motorId, "brake", 1);
  }
  powerNetwork.resolve(runGraph, dt);
  brakeTelemetry = runtime.stepActuators(context, dt);
  worldAdapter.integrate(dt, { tick });
  runtime.afterIntegration(dt);
}
const brakedDrivenStates = fixtureMobilityTelemetry(runtime, {
    context,
    dt,
  }).wheelStates.filter((state) => drivenWheelIds.has(state.partId)),
  angularSpeedAfterBrake =
    brakedDrivenStates.reduce(
      (sum, state) => sum + Math.abs(state.angularSpeed),
      0,
    ) / brakedDrivenStates.length;
assert.equal(
  brakeTelemetry?.activeMotors,
  driveMotorIds.length,
  "explicit brake command did not engage every powered drivetrain actuator",
);
assert.ok(
  angularSpeedAfterBrake < angularSpeedBeforeBrake * 0.35,
  `explicit brake did not dissipate wheel rotation (${angularSpeedBeforeBrake} -> ${angularSpeedAfterBrake} rad/s)`,
);

const drivenWheelConnection = runGraph
  .connections()
  .find(
    (connection) =>
      connection.kind === "mechanical" &&
      (connection.a === drivenWheelIdList[1] ||
        connection.b === drivenWheelIdList[1]),
  );
runGraph.failConnection(drivenWheelConnection.id, {
  reason: "test axle separation",
  time: 4,
});
const detachedConstraints = runtime.applyConnectionFailures(
  runGraph.connections(),
);
assert.ok(
  detachedConstraints.includes(`shaft:${drivenWheelConnection.id}`),
  "failed axle connection remained load-bearing",
);
assert.ok(
  runtime.constraintEntries.some(
    (entry) =>
      entry.kind === "rolling-contact-v1" &&
      entry.descriptor.sourcePartId === drivenWheelIdList[1],
  ),
  "detached wheel lost its independent environment contact law",
);

runtime.dispose();
assert.equal(runtime.bodyByPart.size, 0, "component bodies leaked on dispose");
assert.equal(
  world.bodies.filter((body) => body !== groundBody).length,
  0,
  "Cannon world retained assembly bodies after dispose",
);
console.log(
  `rounded wheel runtime passed (${assembly.parts.length} bodies, ${travelM.toFixed(2)} m forward travel, ${lateralTravelM.toFixed(2)} m signed left response, ${maximumDeflectionM.toFixed(4)} m peak tire deflection)`,
);
