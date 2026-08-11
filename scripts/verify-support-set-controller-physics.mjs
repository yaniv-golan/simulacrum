import assert from "node:assert/strict";
import * as CANNON from "cannon-es";
import { loadBearingContactSetProgram } from "../src/model/autonomous-controller-programs.js";
import { TYPES } from "../src/model/component-catalog.js";
import { controllerSensorFrameForId } from "../src/model/controller-sensor-frame-evidence.js";
import { prepareTypeScriptController } from "../src/scripting/controller-compilers.js";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { ControllerSensorBank } from "../src/simulation/controller-sensors.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";

const DT = 1 / 120,
  part = (id, type, extra = {}) => ({
    id,
    type,
    config: {},
    pos: [0, 0, 0],
    orientation: [0, 0, 0, 1],
    scale: { x: 1, y: 1, z: 1 },
    ...extra,
  }),
  candidate = (key) => ({
    key,
    contactInputBindingId: key + ".contact",
    normalForceInputBindingId: key + ".normal-force",
    membershipOutputBindingId: key + ".loaded-contact",
    confidenceOutputBindingId: key + ".confidence",
  }),
  candidates = ["alpha", "bravo"].map(candidate),
  options = {
    candidates,
    supportCountOutputBindingId: "loaded-contact-set.count",
    setConfidenceOutputBindingId: "loaded-contact-set.confidence",
    enterForceN: 10,
    exitForceN: 5,
  },
  contactSensors = candidates.map((entry) =>
    part(entry.key + "-contact-sensor", "contactsensor"),
  ),
  supportBeams = candidates.map((entry) =>
    part(entry.key + "-support-beam", "beam"),
  ),
  controller = part("contact-set-observer", "computer", {
    controllerBindings: candidates.flatMap((entry) => [
      {
        id: entry.contactInputBindingId,
        direction: "input",
        endpointPartId: entry.key + "-contact-sensor",
        endpointPortId: "SIGNAL",
        reading: "contact",
      },
      {
        id: entry.normalForceInputBindingId,
        direction: "input",
        endpointPartId: entry.key + "-contact-sensor",
        endpointPortId: "SIGNAL",
        reading: "contact_force_n",
      },
    ]),
  }),
  parts = [...supportBeams, ...contactSensors, controller],
  signalConnections = candidates.map((entry) => ({
    id: entry.key + "-signal",
    a: entry.key + "-contact-sensor",
    b: controller.id,
    kind: "signal",
    portA: "SIGNAL",
    portB: "IN A",
  })),
  connections = [
    ...candidates.map((entry) => ({
      id: entry.key + "-sensor-mount",
      a: entry.key + "-contact-sensor",
      b: entry.key + "-support-beam",
      kind: "mechanical",
      portA: "MOUNT",
      portB: "A",
      capacity: { ultimateForceN: 24_000, ultimateTorqueNm: 6_000 },
    })),
    ...signalConnections,
  ],
  signals = {
    controllerSensors: [
      {
        controllerId: controller.id,
        endpoints: candidates.map((entry) => ({
          partId: entry.key + "-contact-sensor",
          portIds: ["SIGNAL"],
        })),
      },
    ],
  },
  rawManifest = [
    {
      id: options.supportCountOutputBindingId,
      direction: "output",
      endpointPartId: "count-sink",
      endpointPortId: "CONTROL",
      channel: "command",
    },
    {
      id: options.setConfidenceOutputBindingId,
      direction: "output",
      endpointPartId: "set-confidence-sink",
      endpointPortId: "CONTROL",
      channel: "command",
    },
    ...candidates.flatMap((entry) => [
      {
        id: entry.membershipOutputBindingId,
        direction: "output",
        endpointPartId: entry.key + "-membership-sink",
        endpointPortId: "CONTROL",
        channel: "command",
      },
      {
        id: entry.confidenceOutputBindingId,
        direction: "output",
        endpointPartId: entry.key + "-confidence-sink",
        endpointPortId: "CONTROL",
        channel: "command",
      },
    ]),
    ...controller.controllerBindings,
  ],
  manifest = rawManifest
    .sort((left, right) => left.id.localeCompare(right.id, "en"))
    .map((binding, index) => ({ ...binding, index })),
  prepared = await prepareTypeScriptController(
    loadBearingContactSetProgram({ ...options, bindingManifest: manifest }),
    manifest,
  ),
  observer = prepared.instantiate(),
  world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.80665, 0),
  }),
  adapter = new CannonWorldAdapter(world),
  ground = new CANNON.Body({ mass: 0 }),
  engineBodies = new Map();

ground.addShape(new CANNON.Plane());
ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
ground.userData = { surface: "synthetic-floor" };
world.addBody(ground);
for (const [index, beam] of supportBeams.entries()) {
  const body = new CANNON.Body({
    mass: index === 0 ? 10 : 0,
    shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.1, 0.5)),
    position: new CANNON.Vec3(index * 2, index === 0 ? 0.12 : 3, 0),
  });
  body.allowSleep = false;
  body.userData = { partId: beam.id };
  world.addBody(body);
  engineBodies.set(beam.id, body);
}

const multibodyRuntime = {
    compiled: {
      bodies: supportBeams.map((beam) => ({
        id: "body:" + beam.id,
        partId: beam.id,
      })),
    },
    bodyByPart: engineBodies,
    constraintEntries: [],
    loadByConnection: new Map(),
    torqueByConnection: new Map(),
    hasArticulation: () => false,
    hasWheels: () => false,
    bodyPose(partId) {
      const body = engineBodies.get(partId);
      return {
        position: body.position,
        quaternion: body.quaternion,
        velocity: body.velocity,
        angularVelocity: body.angularVelocity,
      };
    },
    constraintPoseForPart: () => null,
    afterIntegration: () => ({ active: true }),
  },
  session = new SimulationSession({
    systems: [new RigidBodySystem(), new TelemetrySystem()],
  }).start(
    { parts, connections },
    {
      worldAdapter: adapter,
      multibodyRuntime,
    },
  ),
  sensorBank = new ControllerSensorBank(),
  capture = () => {
    const telemetry = session.telemetry();
    return controllerSensorFrameForId(
      sensorBank.capture({
        parts,
        connections,
        bodies: telemetry.bodies,
        signals,
        fixedDt: DT,
        time: telemetry.time,
      }),
      controller.id,
    );
  },
  observe = (readings) => Object.fromEntries(observer.tick(DT, readings));

session.stepFixed(240);
let readings = capture(),
  output = observe(readings);
assert.equal(readings["alpha.contact"], 1);
assert.ok(
  readings["alpha.normal-force"] > 50,
  "settled ordinary beam did not carry solved normal force",
);
assert.equal(readings.__validity["alpha.contact"], 1);
assert.equal(readings.__validity["alpha.normal-force"], 1);
assert.equal(readings["bravo.contact"], 0);
assert.equal(output["alpha.loaded-contact"], 1);
assert.equal(output["bravo.loaded-contact"], 0);
assert.equal(output["loaded-contact-set.count"], 1);
assert.equal(output["loaded-contact-set.confidence"], 1);

const alphaBody = engineBodies.get("alpha-support-beam");
alphaBody.position.y = 2;
alphaBody.velocity.set(0, 0, 0);
alphaBody.angularVelocity.set(0, 0, 0);
alphaBody.aabbNeedsUpdate = true;
session.stepFixed(2);
readings = capture();
output = observe(readings);
assert.equal(readings["alpha.contact"], 0);
assert.equal(readings["alpha.normal-force"], 0);
assert.equal(output["alpha.loaded-contact"], 0);
assert.equal(output["alpha.confidence"], 1);
assert.equal(output["loaded-contact-set.count"], 0);

alphaBody.position.y = 0.12;
alphaBody.velocity.set(0, 0, 0);
alphaBody.angularVelocity.set(0, 0, 0);
alphaBody.aabbNeedsUpdate = true;
session.stepFixed(120);
readings = capture();
output = observe(readings);
assert.equal(readings["alpha.contact"], 1);
assert.ok(readings["alpha.normal-force"] > 50);
assert.equal(output["alpha.loaded-contact"], 1);
assert.equal(output["loaded-contact-set.count"], 1);
assert.equal(output["loaded-contact-set.confidence"], 1);

assert.ok(TYPES.beam && TYPES.contactsensor && TYPES.computer);
session.dispose();
console.log(
  "support-set controller physics passed (solved contact, loss, and recovery)",
);
