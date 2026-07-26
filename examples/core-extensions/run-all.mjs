import assert from "node:assert/strict";
import {
  CHECKPOINT_STATE_OWNER_VERSIONS,
  CONTROL_IR_VERSION,
} from "@yaniv-golan/simulacrum-core";
import { challengeExample } from "./challenge.mjs";
import { componentExample } from "./component.mjs";
import { componentInspectionExample } from "./component-inspection.mjs";
import { controllerProgramExample } from "./controller-program.mjs";
import { environmentBodyExample } from "./environment-body.mjs";
import { flexibleLineExample } from "./flexible-line.mjs";
import { portBehaviorExample } from "./port-behavior.mjs";
import { routeEvidenceExample } from "./route-evidence.mjs";
import { sensorAdapterExample } from "./sensor-adapter.mjs";
import { simulationSystemExample } from "./simulation-system.mjs";
import { telemetryConsumerExample } from "./telemetry-consumer.mjs";

const component = componentExample();
assert.deepEqual(component.descriptor.dimensions, [0.8, 0.5, 0.8]);
assert.deepEqual(Object.keys(component.descriptor.portFrames), ["MOUNT"]);
assert.equal(component.topology.bodies[0].mass, 12);

const ports = portBehaviorExample();
assert.equal(ports.source.direction, "source");
assert.equal(ports.sink.direction, "sink");

const route = routeEvidenceExample();
assert.equal(route.status, "resolved");
assert.deepEqual(
  route.hops.map((hop) => hop.connectionId),
  ["power-link"],
);
assert.equal(CHECKPOINT_STATE_OWNER_VERSIONS["material-resources"], 2);

const inspection = await componentInspectionExample();
assert.match(inspection.fingerprint, /^sim-sha256-[0-9a-f]{64}$/);
assert.equal(inspection.motor.connections[0].counterpartPartId, 1);
assert.equal(inspection.preflight.status, "passed");

assert.deepEqual(simulationSystemExample(), { doseRateMsvH: 0.004 });
assert.equal(sensorAdapterExample(), 0.004);
assert.equal(challengeExample().status, "complete");
assert.deepEqual(environmentBodyExample(), {
  hit: true,
  hitBodyId: "environment:inspection-target",
  rangeM: 48,
  rangeRateMps: -2,
  relativeVelocityMps: { x: 0, y: -2, z: 0 },
});

const flexibleLine = flexibleLineExample();
assert.equal(flexibleLine.kind, "flexible-line-v1");
assert.equal(flexibleLine.rigidProxyBodies, 0);
assert.ok(flexibleLine.physicalEntities > 2);
assert.equal(flexibleLine.internalEdges, flexibleLine.physicalEntities - 1);
assert.deepEqual(flexibleLine.endpointStates, ["free-v1", "free-v1"]);
assert.equal(flexibleLine.discretization, "flexible-line-discretization-v1");

const controller = await controllerProgramExample();
assert.equal(controller.version, CONTROL_IR_VERSION);
assert.equal(controller.entry, "tick");
assert.equal(
  controller.functions.find((entry) => entry.name === "tick")?.name,
  "tick",
);

assert.deepEqual(telemetryConsumerExample(), {
  elapsed: 2,
  altitude: 12.5,
  label: "ASCENDING",
});

console.log("all eleven public core extension examples passed");
