import * as CANNON from "cannon-es";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { TYPES } from "../src/model/component-catalog.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { startMultibodyRuntime } from "../src/simulation/multibody-runtime.js";
import { PowerSystem } from "../src/simulation/systems/power-system.js";
import { SignalSystem } from "../src/simulation/systems/signal-system.js";
import { CommandRoutingSystem } from "../src/simulation/systems/command-routing-system.js";
import { ArticulatedConstraintSystem } from "../src/simulation/systems/articulated-constraint-system.js";
import { MechanismSystem } from "../src/simulation/systems/mechanism-system.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { StructureSystem } from "../src/simulation/systems/structure-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";
import { assert } from "./lib/assert.mjs";
import { quaternionFromEulerXYZ } from "../src/model/primitives.js";
import { mechanismComponentDefinition } from "../src/model/mechanism-component-definitions.js";
import {
  boundsDimensions,
  posePartForPortMatch,
} from "../src/model/component-geometry-contract.js";
import { captureProductionSystemTelemetry } from "../src/application/simulation-system-composition.js";

function createWorld({ ground = true, slopeRad = 0, stepHeight = 0 } = {}) {
  const world = new CANNON.World({
      gravity: new CANNON.Vec3(0, -9.80665, 0),
    }),
    groundMaterial = new CANNON.Material("ground"),
    footMaterial = new CANNON.Material("robot-foot"),
    componentMaterial = new CANNON.Material("component");
  world.solver.iterations = 20;
  world.solver.tolerance = 0.001;
  let groundBody = null;
  if (ground) {
    groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      shape: new CANNON.Box(new CANNON.Vec3(30, 0.25, 30)),
      material: groundMaterial,
      position: new CANNON.Vec3(0, -0.25, 0),
    });
    groundBody.quaternion.setFromEuler(slopeRad, 0, 0);
    groundBody.userData = {
      externalBodyId: "environment:test-ground",
      surface: "test ground",
    };
    world.addBody(groundBody);
    if (stepHeight > 0) {
      const stepBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        shape: new CANNON.Box(new CANNON.Vec3(15, stepHeight / 2, 30)),
        material: groundMaterial,
        position: new CANNON.Vec3(-15, stepHeight / 2, 0),
      });
      stepBody.userData = {
        externalBodyId: "environment:test-step",
        surface: "test step",
      };
      world.addBody(stepBody);
    }
  }
  world.addContactMaterial(
    new CANNON.ContactMaterial(footMaterial, groundMaterial, {
      friction: 1.15,
      restitution: 0.02,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 3,
      frictionEquationStiffness: 1e8,
    }),
  );
  world.addContactMaterial(
    new CANNON.ContactMaterial(componentMaterial, groundMaterial, {
      friction: 0.68,
      restitution: 0.02,
      contactEquationStiffness: 1e8,
      contactEquationRelaxation: 3,
    }),
  );
  return {
    world,
    worldAdapter: new CannonWorldAdapter(world),
    groundBody,
    footMaterial,
    componentMaterial,
  };
}

function controlsFor(blueprint, overrides = {}) {
  const find = (type) => blueprint.parts.find((part) => part.type === type),
    motor = find("motor"),
    hinge = find("hinge"),
    computer = find("computer");
  return [
    [motor, "gait_speed", overrides.gaitSpeed ?? 0.6],
    [hinge, "stride", overrides.stride ?? 0.55],
    [computer, "balance", overrides.balance ?? 1],
    [hinge, "crouch", overrides.crouch ?? 0],
    [motor, "brake", overrides.brake ?? 0],
  ]
    .filter(([part]) => part)
    .map(([part, channel, value]) => ({
      targetId: part.id,
      channel,
      value,
      active: true,
    }));
}

function startScenario(
  blueprint,
  worldOptions = {},
  controlOverrides = {},
  serviceOverrides = {},
) {
  const environment = createWorld(worldOptions),
    runtime = startMultibodyRuntime(blueprint, {
      world: environment.world,
      worldAdapter: environment.worldAdapter,
      material: environment.componentMaterial,
      materialForPart: (part) =>
        ["footL", "footR"].includes(part?.rigRole)
          ? environment.footMaterial
          : environment.componentMaterial,
      catalog: TYPES,
      groundBody: environment.groundBody,
    }),
    remote = controlsFor(blueprint, controlOverrides),
    session = new SimulationSession({
      systems: [
        new PowerSystem(),
        new SignalSystem(),
        new CommandRoutingSystem(),
        new ArticulatedConstraintSystem(),
        new MechanismSystem(),
        new RigidBodySystem(),
        new StructureSystem(),
        new TelemetrySystem(),
      ],
    }).start(blueprint, {
      world: environment.world,
      worldAdapter: environment.worldAdapter,
      catalog: TYPES,
      multibodyRuntime: runtime,
      readCommandCandidates: () => ({ remote, scripts: [] }),
      connectionValid: (connection) => !connection.failed,
      partMass: (part) => TYPES[part.type]?.mass || 0,
      ...serviceOverrides,
    });
  return { ...environment, runtime, session, remote };
}

function runSeconds(scenario, seconds, samples = [], sampleHz = 10) {
  const count = Math.round(seconds * 120),
    sampleEvery = Math.max(1, Math.round(120 / sampleHz));
  for (let step = 0; step < count; step++) {
    scenario.session.stepFixed();
    if (step % sampleEvery === 0 || step === count - 1) {
      const articulated = scenario.session.telemetry().systems.articulated;
      samples.push({
        time: scenario.session.time,
        forward: articulated?.forwardDistance || 0,
        fallen: articulated?.fallen,
        contacts: articulated?.contacts,
        phase: articulated?.gaitPhase,
        balance: articulated?.balanceError,
        pelvis: articulated?.pelvis,
        com: articulated?.com,
        feet: articulated?.feet,
        supportPolygon: articulated?.supportPolygon,
        gyroMomentum: articulated?.groups?.[0]?.gyroMomentum,
        joints: articulated?.joints?.map(({ name, angle, target }) => ({
          name,
          angle,
          target,
        })),
      });
    }
  }
  return scenario.session.telemetry().systems.articulated;
}

function scaledAssembly(snapshot, factor) {
  return {
    ...structuredClone(snapshot),
    parts: snapshot.parts.map((part) => ({
      ...structuredClone(part),
      pos: part.pos.map((value) => value * factor),
      scale: part.mechanism
        ? { x: 1, y: 1, z: 1 }
        : {
            x: part.scale.x * factor,
            y: part.scale.y * factor,
            z: part.scale.z * factor,
          },
    })),
    connections: snapshot.connections.map((connection) => ({
      ...structuredClone(connection),
      ...(connection.anchorA
        ? { anchorA: connection.anchorA.map((value) => value * factor) }
        : {}),
      ...(connection.anchorB
        ? { anchorB: connection.anchorB.map((value) => value * factor) }
        : {}),
    })),
  };
}

function combinedAssemblies(snapshot, idOffset = 1000, xOffset = 4) {
  const shifted = snapshot.parts.map((part) => ({
    ...structuredClone(part),
    id: part.id + idOffset,
    pos: [part.pos[0] + xOffset, part.pos[1], part.pos[2]],
  }));
  return {
    revision: 0,
    parts: [...structuredClone(snapshot.parts), ...shifted],
    connections: [
      ...structuredClone(snapshot.connections),
      ...snapshot.connections.map((connection) => ({
        ...structuredClone(connection),
        id: `copy-${connection.id}`,
        a: connection.a + idOffset,
        b: connection.b + idOffset,
      })),
    ],
  };
}

function reversedRotaryConnectionOrder(snapshot) {
  const assembly = structuredClone(snapshot);
  assembly.connections = assembly.connections.map((connection) => {
    if (
      connection.kind !== "mechanical" ||
      ![connection.portA, connection.portB].includes("ARM")
    )
      return connection;
    const { anchorA, anchorB, ...fields } = connection;
    return {
      ...fields,
      a: connection.b,
      b: connection.a,
      portA: connection.portB,
      portB: connection.portA,
      ...(anchorB ? { anchorA: anchorB } : {}),
      ...(anchorA ? { anchorB: anchorA } : {}),
    };
  });
  return assembly;
}

function linkageAssembly(rotation = [0, 0, 0]) {
  const hingeMechanism = structuredClone(mechanismComponentDefinition("hinge"));
  hingeMechanism.config.angleRangeRad = {
    lower: -Math.PI / 3,
    upper: Math.PI / 3,
  };
  hingeMechanism.config.friction.viscousNms = 18;
  hingeMechanism.config.actuation.maximumTorqueNm = 240;
  hingeMechanism.config.actuation.commandRangeRad = {
    lower: -Math.PI / 3,
    upper: Math.PI / 3,
  };
  const part = (id, type, pos, config = {}) => ({
      id,
      type,
      pos,
      orientation: quaternionFromEulerXYZ(
        [2, 3].includes(id) ? rotation : [0, 0, 0],
      ),
      scale: { x: 1, y: 1, z: 1 },
      ...(type === "hinge"
        ? { mechanism: structuredClone(hingeMechanism) }
        : { config }),
      ...(type === "battery" ? { storedEnergyWh: 100 } : {}),
    }),
    connection = (id, a, b, kind, portA, portB) => ({
      id,
      a,
      b,
      kind,
      portA,
      portB,
      ...(["TOP", "BOTTOM", "SURFACE"].includes(portA)
        ? { anchorA: [0, 0, 0] }
        : {}),
      ...(["TOP", "BOTTOM", "SURFACE"].includes(portB)
        ? { anchorB: [0, 0, 0] }
        : {}),
      ...(["mechanical", "mesh"].includes(kind)
        ? {
            capacity: {
              ultimateForceN: 24_000,
              ultimateTorqueNm: 6_000,
            },
          }
        : {}),
    }),
    base = part(1, "plate", [0, 0, 0]),
    hinge = part(3, "hinge", [0, 0, 0], {
      torque: 240,
      damping: 18,
      minAngle: -60,
      maxAngle: 60,
    }),
    unposedArm = part(2, "beam", [0, 0, 0]),
    armPose = posePartForPortMatch({
      movingPart: unposedArm,
      movingPortId: "A",
      targetPart: hinge,
      targetPortId: "ARM",
    }),
    arm = {
      ...unposedArm,
      pos: armPose.positionM,
      orientation: armPose.orientation,
    };
  return {
    revision: 0,
    parts: [
      base,
      arm,
      hinge,
      part(4, "battery", [-1.2, 0, 0], {
        capacityWh: 100,
        maxOutputWatts: 20000,
      }),
      part(5, "computer", [1.2, 0, 0]),
    ],
    connections: [
      connection("base", 1, 3, "mechanical", "TOP", "BASE"),
      connection("arm", 3, 2, "mechanical", "ARM", "A"),
      connection("hinge-power", 4, 3, "power", "POWER", "POWER"),
      connection("controller-power", 4, 5, "power", "POWER", "POWER"),
      connection("control", 5, 3, "signal", "OUT", "CONTROL"),
    ],
  };
}

function disposeScenario(scenario, expectedStaticBodies = 1) {
  scenario.session.dispose();
  scenario.runtime.dispose();
  assert.equal(
    scenario.world.bodies.length,
    expectedStaticBodies,
    "scenario disposal leaked dynamic bodies",
  );
}

const deferralAssembly = decodeBlueprintOrThrow(
    builtInDemo("gearbox").blueprint,
  ).assembly,
  immediateTelemetryScenario = startScenario(deferralAssembly),
  deferredTelemetryScenario = startScenario(
    deferralAssembly,
    {},
    {},
    {
      captureTelemetry: captureProductionSystemTelemetry,
      deferMechanismTelemetryUntilIntegration: true,
      deferPowerTelemetryUntilCompletion: true,
    },
  );
for (let tick = 0; tick < 2; tick++) {
  immediateTelemetryScenario.session.stepFixed();
  deferredTelemetryScenario.session.stepFixed();
}
const immediateSystems = immediateTelemetryScenario.session.telemetry().systems,
  deferredSystems = deferredTelemetryScenario.session.telemetry().systems;
assert.deepEqual(
  deferredSystems.mechanisms,
  immediateSystems.mechanisms,
  "production mechanism telemetry deferral changed completed-tick semantics",
);
assert.deepEqual(
  deferredSystems.power,
  immediateSystems.power,
  "production power telemetry deferral changed completed-tick semantics",
);
disposeScenario(immediateTelemetryScenario);
disposeScenario(deferredTelemetryScenario);

const atlas = decodeBlueprintOrThrow(
    builtInDemo("humanoid").blueprint,
  ).assembly,
  samples = [],
  flat = startScenario(
    atlas,
    {},
    {
      gaitSpeed:
        process.env.SIM_GAIT_SPEED == null
          ? 0.6
          : Number(process.env.SIM_GAIT_SPEED),
      stride:
        process.env.SIM_STRIDE == null ? 0.55 : Number(process.env.SIM_STRIDE),
    },
  ),
  telemetry = runSeconds(flat, 15, samples, 10);

assert.equal(telemetry.active, true, "compiled articulation must be active");
assert.equal(
  telemetry.groups.length,
  1,
  "one Atlas blueprint must create one articulated graph",
);
assert.equal(
  telemetry.groups[0].locomotionAvailable,
  true,
  `valid unique roles and hinge topology must enable locomotion: ${JSON.stringify({ validationErrors: telemetry.groups[0].validationErrors, structures: flat.session.telemetry().systems.structures, events: flat.session.context.runGraph.events() })}`,
);
assert.equal(
  telemetry.groups[0].inputTick,
  flat.session.telemetry().tick - 1,
  "controller must consume the previous completed body/contact snapshot",
);
assert.equal(
  telemetry.fallen,
  false,
  "Atlas must remain upright for 15 seconds",
);
assert.ok(
  telemetry.forwardDistance > 0.18,
  `Atlas must advance in its +Z forward direction; reached ${telemetry.forwardDistance} m`,
);
assert.ok(
  samples.some(
    (sample) =>
      Boolean(sample.contacts?.left) !== Boolean(sample.contacts?.right),
  ),
  "walking must include a measured one-foot support interval",
);
assert.ok(
  Object.values(telemetry.groups[0].gyroMomentum).every(
    (value) =>
      Math.abs(value) <= telemetry.groups[0].gyroMomentumCapacityNms + 1e-9,
  ),
  "reaction-wheel momentum exceeded its physical storage capacity",
);
const supportingContact = flat.session
  .telemetry()
  .bodies.bodies.filter(({ partIds }) =>
    partIds.some((id) =>
      [
        telemetry.groups[0].roles.footL,
        telemetry.groups[0].roles.footR,
      ].includes(id),
    ),
  )
  .flatMap((body) => body.contacts)
  .find(
    (contact) =>
      contact.otherBodyId === "environment:test-ground" && contact.forceN > 0,
  );
assert.ok(supportingContact, "support contact lost its external body identity");
assert.ok(
  supportingContact.impulseNs > 0 &&
    Object.values(supportingContact.relativeVelocity).every(Number.isFinite),
  "support contact omitted impulse or relative velocity",
);
assert.ok(
  flat.runtime.bodyByPart.size === atlas.parts.length,
  "every authored solid component, including hinge housings, must be compiled",
);
assert.equal(
  flat.runtime.constraintEntries.filter(
    (entry) =>
      entry.active !== false &&
      entry.descriptor.kind === "revolute" &&
      atlas.parts.some(
        (part) =>
          part.mechanism?.config?.actuation != null &&
          part.id === entry.descriptor.sourcePartId,
      ),
  ).length,
  atlas.parts.filter((part) => part.mechanism?.config?.actuation != null)
    .length,
  "every authored rotary actuator must have a physical coordinate binding",
);

const slope = startScenario(atlas, { slopeRad: 0.06 }, { gaitSpeed: 0 }),
  slopeTelemetry = runSeconds(slope, 6);
assert.equal(
  slopeTelemetry.fallen,
  false,
  `standing controller failed on slope: ${JSON.stringify(slopeTelemetry)}`,
);
assert.ok(
  Math.abs(slopeTelemetry.supportNormal.z) > 0.02,
  "slope stance ignored measured contact normals",
);

const stepped = startScenario(atlas, { stepHeight: 0.08 }, { gaitSpeed: 0 }),
  stepTelemetry = runSeconds(stepped, 6);
if (process.env.SIM_DEBUG_STEP)
  console.log(JSON.stringify({ stepTelemetry }, null, 2));
assert.equal(stepTelemetry.fallen, false, "standing controller failed on step");
assert.ok(
  stepTelemetry.supportPolygon.length >= 2,
  "step stance did not publish a measured support polygon",
);

const custom = startScenario(scaledAssembly(atlas, 0.82), {}, { gaitSpeed: 0 }),
  customTelemetry = runSeconds(custom, 6);
assert.equal(
  customTelemetry.fallen,
  false,
  "controller assumed built-in Atlas limb dimensions",
);
assert.ok(
  custom.runtime.compiled.bodies.some(
    (body) =>
      body.partId === customTelemetry.groups[0].roles.thighL &&
      Math.max(...boundsDimensions(body.geometry.bodyBoundsPartM)) < 1,
  ),
  "custom limb geometry was not compiled into collision bodies",
);

const reordered = startScenario(reversedRotaryConnectionOrder(atlas)),
  reorderedTelemetry = runSeconds(reordered, 8);
assert.equal(
  reorderedTelemetry.fallen,
  false,
  "locomotion depended on mechanical connection endpoint order",
);
assert.ok(
  reorderedTelemetry.forwardDistance > 0.12,
  "joint coordinate signs did not follow reversed rotor/body ordering",
);

const falling = startScenario(atlas, { ground: false }, { gaitSpeed: 0 }),
  fallingTelemetry = runSeconds(falling, 1.2);
assert.equal(fallingTelemetry.fallen, true, "airborne assembly did not fall");
assert.deepEqual(
  fallingTelemetry.contacts,
  { left: false, right: false },
  "airborne feet reported heuristic ground support",
);

const detached = startScenario(atlas, {}, { gaitSpeed: 0 }),
  detachedFoot = atlas.parts.find((part) => part.rigRole === "footL"),
  detachedAnkle = atlas.parts.find((part) => part.rigRole === "ankleL");
runSeconds(detached, 1);
detached.session.context.runGraph.detachComponent(detachedFoot.id, {
  reason: "articulation regression",
  time: detached.session.time,
});
detached.session.stepFixed(3);
const detachedTelemetry = detached.session.telemetry().systems.articulated;
assert.equal(
  detachedTelemetry.groups[0].locomotionAvailable,
  false,
  "detached foot left locomotion policy enabled",
);
assert.equal(
  detached.session
    .telemetry()
    .bodies.bodyByPart.find(({ partId }) => partId === detachedFoot.id) == null,
  false,
  "detached foot lost its physical body binding",
);
assert.equal(
  detached.session
    .telemetry()
    .bodies.bodies.find(({ partIds }) => partIds.includes(detachedFoot.id))
    ?.detached,
  true,
  "run-graph detachment did not propagate to body telemetry",
);
assert.equal(
  detached.runtime.constraintEntries.find(
    ({ descriptor }) => descriptor.sourcePartId === detachedAnkle.id,
  )?.active,
  false,
  "failed ankle coordinate remained active in the physical runtime",
);

const linkage = startScenario(linkageAssembly([0, -Math.PI / 2, 0]), {
  ground: false,
});
linkage.world.gravity.set(0, 0, 0);
linkage.remote.splice(0, linkage.remote.length, {
  targetId: 3,
  channel: "joint_target",
  value: 0.65,
  active: true,
});
const linkageTelemetry = runSeconds(linkage, 2);
if (process.env.SIM_DEBUG_LINKAGE)
  console.log(
    JSON.stringify(
      {
        linkageTelemetry,
        commands: linkage.session.telemetry().systems.commands,
        power: linkage.session.telemetry().systems.power,
        signals: linkage.session.telemetry().systems.signals,
      },
      null,
      2,
    ),
  );
const linkageJoint = linkageTelemetry.groups[0].joints[0],
  linkageDescriptor = linkage.runtime.constraintEntries.find(
    (entry) => entry.descriptor.sourcePartId === 3,
  ).descriptor;
assert.equal(
  linkageTelemetry.groups[0].mode,
  "joint-control",
  "role-free linkage was incorrectly classified as a humanoid",
);
assert.ok(linkageJoint.angle > 0.25, "generic hinge command did not actuate");
assert.ok(
  Math.abs(linkageDescriptor.axisWorld[0] + 1) < 1e-9,
  "authored hinge rotation was not applied to its physical axis",
);
assert.ok(
  linkageJoint.angle <= linkageDescriptor.limits[1] + 0.02,
  "measured hinge angle exceeded its authored limit",
);
const heldAngle = linkageJoint.angle;
linkage.remote[0].value = heldAngle / linkageDescriptor.limits[1];
const heldTelemetry = runSeconds(linkage, 1),
  heldJoint = heldTelemetry.groups[0].joints[0];
assert.ok(
  Math.abs(heldJoint.angle - heldAngle) < 0.12,
  "quaternion-derived hinge measurement drifted while holding position",
);

const incompleteAssembly = linkageAssembly(),
  incompletePelvis = incompleteAssembly.parts.find((part) => part.id === 1);
incompletePelvis.rigRole = "pelvis";
const incomplete = startScenario(incompleteAssembly, { ground: false });
incomplete.world.gravity.set(0, 0, 0);
incomplete.remote.splice(0, incomplete.remote.length, {
  targetId: 3,
  channel: "joint_target",
  value: 0.5,
  active: true,
});
const incompleteTelemetry = runSeconds(incomplete, 1.2);
assert.equal(
  incompleteTelemetry.groups[0].mode,
  "incomplete-locomotion",
  "partial locomotion roles were not reported explicitly",
);
assert.ok(
  incompleteTelemetry.groups[0].joints[0].angle > 0.15,
  "incomplete role metadata disabled generic hinge control",
);

const paired = startScenario(combinedAssemblies(atlas)),
  pairedTelemetry = runSeconds(paired, 0.6),
  commandedMotorId = atlas.parts.find((part) => part.type === "motor").id,
  commandedGroup = pairedTelemetry.groups.find((group) =>
    group.partIds.includes(commandedMotorId),
  ),
  idleGroup = pairedTelemetry.groups.find(
    (group) => !group.partIds.includes(commandedMotorId),
  );
assert.equal(
  pairedTelemetry.groups.length,
  2,
  "disconnected articulations were merged into one controller group",
);
assert.notEqual(
  commandedGroup.gaitPhase,
  "BALANCE HOLD",
  "remote command did not reach its connected articulation",
);
assert.equal(
  idleGroup.gaitPhase,
  "BALANCE HOLD",
  "remote command leaked into a disconnected articulation",
);
const pairedController = paired.session.context.services.articulatedController,
  pairedControllerCheckpoint = pairedController.exportState(),
  pairedPhysicsCheckpoint = paired.runtime.exportState(),
  unknownGroupCheckpoint = structuredClone(pairedControllerCheckpoint),
  missingGroupCheckpoint = structuredClone(pairedControllerCheckpoint);
unknownGroupCheckpoint.stateByGroup[0].id = "ghost-group";
assert.throws(
  () =>
    pairedController.validateState(unknownGroupCheckpoint, {
      physicsState: pairedPhysicsCheckpoint,
    }),
  /does not match target topology/,
  "articulated checkpoint accepted an unknown group identity",
);
missingGroupCheckpoint.stateByGroup.pop();
assert.throws(
  () =>
    pairedController.validateState(missingGroupCheckpoint, {
      physicsState: pairedPhysicsCheckpoint,
    }),
  /does not match target topology/,
  "articulated checkpoint silently omitted authoritative group state",
);

if (process.env.SIM_DEBUG)
  console.log(
    JSON.stringify(
      {
        walk: samples,
        commands: flat.session.telemetry().systems.commands,
        power: flat.session.telemetry().systems.power,
        signals: flat.session.telemetry().systems.signals,
      },
      null,
      2,
    ),
  );
else
  console.log(
    JSON.stringify({
      walkM: telemetry.forwardDistance,
      slopeNormal: slopeTelemetry.supportNormal,
      stepContacts: stepTelemetry.contacts,
      customFallen: customTelemetry.fallen,
      fallingDetected: fallingTelemetry.fallen,
      detachedMode: detachedTelemetry.groups[0].mode,
      linkageAngle: heldJoint.angle,
      incompleteAngle: incompleteTelemetry.groups[0].joints[0].angle,
      independentGroups: pairedTelemetry.groups.length,
    }),
  );

disposeScenario(flat);
disposeScenario(slope);
disposeScenario(stepped, 2);
disposeScenario(custom);
disposeScenario(reordered);
disposeScenario(falling, 0);
disposeScenario(detached);
disposeScenario(linkage, 0);
disposeScenario(incomplete, 0);
disposeScenario(paired);
console.log("component articulation runtime passed (10 physical scenarios)");
