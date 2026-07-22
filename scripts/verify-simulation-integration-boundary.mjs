import * as CANNON from "cannon-es";
import { assert } from "./lib/assert.mjs";
import { CannonWorldAdapter } from "../src/simulation/cannon-world-adapter.js";
import { SimulationSession } from "../src/simulation/simulation-session.js";
import { ArticulatedConstraintSystem } from "../src/simulation/systems/articulated-constraint-system.js";
import { MechanismSystem } from "../src/simulation/systems/mechanism-system.js";
import { RigidBodySystem } from "../src/simulation/systems/rigid-body-system.js";
import { TelemetrySystem } from "../src/simulation/systems/telemetry-system.js";
import { createSimulationPlaybackController } from "../src/application/simulation-playback-controller.js";

assert.throws(
  () =>
    new SimulationSession({ systems: [new MechanismSystem()] }).start({
      parts: [],
      connections: [],
    }),
  (error) =>
    error instanceof AggregateError &&
    error.cause?.code === "MISSING_COMPILED_MULTIBODY_RUNTIME",
  "MechanismSystem started without a compiled physical runtime",
);

const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.80665, 0),
  }),
  worldAdapter = new CannonWorldAdapter(world),
  body = new CANNON.Body({
    mass: 10,
    shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
    position: new CANNON.Vec3(0, 3, 0),
  }),
  snapshot = {
    parts: [
      {
        id: 1,
        type: "plate",
        pos: [0, 3, 0],
        orientation: [0, 0, 0, 1],
        scale: { x: 1, y: 1, z: 1 },
        config: {},
      },
    ],
    connections: [],
  },
  editorBefore = structuredClone(snapshot),
  calls = {
    multibodyPrepare: 0,
    multibodyAfter: 0,
  };
world.addBody(body);

const multibodyRuntime = {
    compiled: { bodies: [{ partId: 1 }] },
    bodyByPart: new Map([[1, body]]),
    constraintEntries: [],
    hasArticulation: () => false,
    hasWheels: () => false,
    bodyPose: () => ({
      position: body.position,
      quaternion: body.quaternion,
    }),
    constraintPoseForPart: () => null,
    stepActuators() {
      calls.multibodyPrepare++;
    },
    afterIntegration() {
      calls.multibodyAfter++;
      return { active: true };
    },
  },
  session = new SimulationSession({
    systems: [
      new ArticulatedConstraintSystem(),
      new MechanismSystem(),
      new RigidBodySystem(),
      new TelemetrySystem(),
    ],
  }).start(snapshot, {
    worldAdapter,
    multibodyRuntime,
  });

session.stepFixed(5);
assert.equal(worldAdapter.telemetry().integrationCount, 5);
assert.deepEqual(calls, {
  multibodyPrepare: 5,
  multibodyAfter: 5,
});
assert.equal(session.telemetry().tick, 5);
assert.equal(session.telemetry().systems.integration.integrationCount, 5);
assert.equal(session.telemetry().bodies.bodies.length, 1);
assert.equal(session.telemetry().bodies.bodies[0].bound, true);
assert.equal(
  session.telemetry().run.parts[0].energyJ,
  undefined,
  "non-battery runtime parts acquired an energy store",
);
assert.deepEqual(
  snapshot,
  editorBefore,
  "simulation mutated its editor snapshot",
);
assert.throws(
  () => worldAdapter.integrate(1 / 120, { tick: 5 }),
  /already integrated/,
);
session.dispose();

const playbackState = {
    running: true,
    simulationPaused: false,
    timeScale: 1,
    elapsed: 0,
  },
  playbackSession = {
    time: 0,
    step(dt) {
      this.time += dt;
    },
    telemetry() {
      return Object.freeze({ time: this.time });
    },
  },
  presentations = [],
  playback = createSimulationPlaybackController({
    state: playbackState,
    getSession: () => playbackSession,
    onTelemetry: (telemetry, dt, options) =>
      presentations.push({ telemetry, dt, present: options.present }),
    render: () => {},
    notify: () => {},
  });
assert.equal(playback.simulateFrames(3, 1 / 60), 3 / 60);
assert.deepEqual(
  presentations.map(({ present }) => present),
  [false, false, true],
  "batched deterministic advancement did not preserve every authoritative frame while presenting only the final frame",
);
assert.equal(playbackState.elapsed, 3 / 60);

console.log(
  "simulation integration boundary passed (5 physics ticks, 3 batched playback frames)",
);
