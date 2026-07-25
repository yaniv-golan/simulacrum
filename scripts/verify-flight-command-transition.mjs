import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DEFAULT_WAT_SOURCE,
  DRONE_TS_SOURCE,
  MISSION_TS_SOURCE,
} from "../src/application/content.js";
import {
  controllerBindingManifest,
  controllerBindingManifestIdentity,
} from "../src/model/controller-bindings.js";
import { TYPES } from "../src/model/component-catalog.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { decodeBlueprintOrThrow } from "../src/model/blueprint-decoder.js";
import { compileAssembly } from "../src/model/assembly-compiler.js";
import { compileVisualProgram } from "../src/model/visual-logic.js";
import { rotateVectorByQuaternion } from "../src/model/primitives.js";
import {
  createSharePackage,
  decodeSharePackage,
} from "../src/model/share-packages.js";
import {
  createSubassemblyTemplate,
  instantiateSubassembly,
} from "../src/model/subassemblies.js";
import {
  prepareControlIRController,
  prepareTypeScriptController,
  prepareWasmController,
} from "../src/scripting/controller-compilers.js";
import { MaterialResourceNetwork } from "../src/simulation/material-resource-network.js";

const DT = 1 / 120;
const DEMO_SOURCES = Object.freeze({
  wat: DEFAULT_WAT_SOURCE,
  typescript: MISSION_TS_SOURCE,
  droneTypescript: DRONE_TS_SOURCE,
});
const EXPECTED_OUTPUTS = Object.freeze({
  drone: Object.freeze([
    "motor.0.throttle",
    "motor.1.throttle",
    "motor.2.throttle",
    "motor.3.throttle",
  ]),
  mission: Object.freeze([
    "coupler.release",
    "engine.gimbal",
    "engine.throttle",
    "rcs.0.throttle",
    "rcs.1.throttle",
    "rcs.2.throttle",
    "rcs.3.throttle",
  ]),
});

function machine(kind) {
  const blueprint = builtInDemo(kind, DEMO_SOURCES).blueprint,
    decoded = decodeBlueprintOrThrow(blueprint),
    assembly = decoded.assembly,
    controller = assembly.parts.find((part) => part.type === "computer"),
    manifest = controllerBindingManifest(
      controller,
      assembly.parts,
      assembly.connections,
    );
  return {
    kind,
    blueprint,
    assembly,
    controller,
    manifest,
    compiled: compileAssembly(assembly, TYPES),
  };
}

function close(actual, expected, label, tolerance = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, received ${actual}`,
  );
}

function outputRecord(runtime, sensors) {
  return Object.fromEntries(runtime.instantiate().tick(DT, sensors));
}

function vectorFixture(manifest) {
  const outputs = manifest.filter((binding) => binding.direction === "output"),
    values = new Map(
      outputs.map((binding, index) => [
        binding.id,
        Number(((index + 1) / (outputs.length + 1)).toFixed(6)),
      ]),
    ),
    typescript = `interface ControlAPI {
  read(binding: string): number;
  write(binding: string, value: number): void;
}
function tick(api: ControlAPI, dt: number): void {
  void dt;
${outputs
  .map((binding) => `  api.write('${binding.id}', ${values.get(binding.id)});`)
  .join("\n")}
}`,
    visual = {
      version: 1,
      name: "Flight endpoint parity",
      nodes: outputs.flatMap((binding, index) => [
        {
          id: `value-${index}`,
          type: "constant",
          value: values.get(binding.id),
          x: 20,
          y: index * 80,
        },
        {
          id: `output-${index}`,
          type: "output",
          bindingId: binding.id,
          x: 260,
          y: index * 80,
        },
      ]),
      links: outputs.map((_binding, index) => ({
        from: `value-${index}`,
        to: `output-${index}`,
        input: 0,
      })),
    },
    wat = `(module
  (import "env" "write_binding" (func $write (param i32 f32)))
  (func (export "tick") (param f32)
${outputs
  .map(
    (binding) =>
      `    (call $write (i32.const ${binding.index}) (f32.const ${values.get(binding.id)}))`,
  )
  .join("\n")}))`;
  return { outputs, values, typescript, visual, wat };
}

async function assertLanguageParity(record) {
  const fixture = vectorFixture(record.manifest),
    prepared = [
      await prepareTypeScriptController(fixture.typescript, record.manifest),
      await prepareControlIRController(
        compileVisualProgram(fixture.visual, record.manifest).ir,
      ),
      await prepareWasmController(fixture.wat, record.manifest),
    ],
    identity = controllerBindingManifestIdentity(record.manifest);
  for (const runtime of prepared) {
    const actual = outputRecord(runtime, {});
    assert.equal(runtime.bindingManifestIdentity, identity);
    assert.deepEqual(
      Object.keys(actual).sort(),
      [...fixture.values.keys()].sort(),
    );
    for (const [bindingId, expected] of fixture.values)
      close(
        actual[bindingId],
        expected,
        `${record.kind} ${runtime.language} ${bindingId}`,
      );
  }
}

function assertTopology(record, expected) {
  const partsByType = groupBy(record.assembly.parts, (part) => part.type),
    // Keep this verification compatible with the repository's Node 20 floor;
    // native Object.groupBy is not available until newer Node releases.
    // The helper is deliberately generic and does not dispatch simulation.
    outputIds = record.manifest
      .filter((binding) => binding.direction === "output")
      .map((binding) => binding.id)
      .sort(),
    resourceEdges = record.assembly.connections.filter(
      (connection) => connection.kind === "resource",
    ),
    compiledResourceEdges = record.compiled.networks.resource;
  assert.equal(partsByType.receiver?.length || 0, expected.receivers);
  assert.equal(partsByType.propellanttank?.length || 0, expected.tanks);
  assert.equal(partsByType.motor?.length || 0, expected.motors || 0);
  assert.equal(partsByType.rotor?.length || 0, expected.rotors || 0);
  assert.deepEqual(outputIds, [...EXPECTED_OUTPUTS[record.kind]].sort());
  assert.equal(resourceEdges.length, expected.resourceEdges);
  assert.equal(compiledResourceEdges.length, expected.resourceEdges);
  assert.deepEqual(
    new Set(resourceEdges.map((connection) => connection.a)),
    new Set((partsByType.propellanttank || []).map((part) => part.id)),
  );
  assert.ok(
    resourceEdges.every(
      (connection) =>
        connection.portA === "OUTLET" && connection.portB === "PROPELLANT",
    ),
  );
  assert.ok(
    compiledResourceEdges.every(
      (connection) => connection.mediumId === "hydrogen-peroxide-90-v1",
    ),
  );
  for (const binding of record.manifest) {
    const endpoint = record.assembly.parts.find(
      (part) => part.id === binding.endpointPartId,
    );
    assert.ok(
      endpoint,
      `${record.kind} binding ${binding.id} lost its endpoint`,
    );
  }
}

function assertRouteFailure(record) {
  const output = record.manifest.find(
      (binding) => binding.direction === "output",
    ),
    routeIndex = record.assembly.connections.findIndex(
      (connection) =>
        connection.kind === "signal" &&
        connection.a === record.controller.id &&
        connection.b === output.endpointPartId,
    ),
    brokenConnections = structuredClone(record.assembly.connections);
  assert.notEqual(
    routeIndex,
    -1,
    `${record.kind} output route was not explicit`,
  );
  brokenConnections.splice(routeIndex, 1);
  assert.throws(
    () =>
      controllerBindingManifest(
        record.controller,
        record.assembly.parts,
        brokenConnections,
      ),
    (error) => error?.code === "OFFLINE_CONTROLLER_OUTPUT_ROUTE",
  );
}

async function assertPortableRoundTrips(record) {
  const share = await createSharePackage({
      kind: "blueprint",
      asset: record.blueprint,
      metadata: {
        title: `${record.kind} flight command transition`,
        createdAt: "2026-07-20T00:00:00.000Z",
      },
    }),
    decodedShare = await decodeSharePackage(share);
  assert.equal(decodedShare.ok, true);
  assert.equal(decodedShare.item.fingerprint, share.fingerprint);
  const sharedController = decodedShare.item.asset.parts.find(
    (part) => part.type === "computer",
  );
  assert.deepEqual(
    sharedController.controllerBindings,
    record.blueprint.parts.find((part) => part.type === "computer")
      .controllerBindings,
  );
  assert.equal(
    decodedShare.item.asset.connections.filter(
      (connection) => connection.kind === "resource",
    ).length,
    record.assembly.connections.filter(
      (connection) => connection.kind === "resource",
    ).length,
  );

  const template = createSubassemblyTemplate(
      record.assembly,
      record.assembly.parts.map((part) => part.id),
      { name: `${record.kind} controller machine` },
    ),
    instance = instantiateSubassembly(template, { nextId: 10_000 }),
    instanceController = instance.parts.find(
      (part) => part.type === "computer",
    ),
    instanceManifest = controllerBindingManifest(
      instanceController,
      instance.parts,
      instance.connections,
    );
  assert.equal(instanceManifest.length, record.manifest.length);
  assert.equal(
    instance.connections.filter((connection) => connection.kind === "resource")
      .length,
    record.assembly.connections.filter(
      (connection) => connection.kind === "resource",
    ).length,
  );
  const sourceCoupler = record.assembly.parts.find(
      (part) => part.type === "release-coupler",
    ),
    sourceBreakaway = record.assembly.connections.find(
      (connection) => connection.releaseCouplerPartId != null,
    ),
    instanceCoupler = instance.parts.find(
      (part) => part.type === "release-coupler",
    ),
    instanceBreakaway = instance.connections.find(
      (connection) => connection.releaseCouplerPartId != null,
    );
  if (sourceCoupler) {
    assert.equal(sourceBreakaway.releaseCouplerPartId, sourceCoupler.id);
    assert.equal(instanceBreakaway.releaseCouplerPartId, instanceCoupler.id);
  }
  assert.ok(
    template.exposedPorts
      .filter((port) => ["OUTLET", "PROPELLANT"].includes(port.port))
      .every((port) => port.role === "resource"),
    `${record.kind} reusable resource ports were mislabeled`,
  );
}

async function sourceFilesMatching(pattern) {
  const root = path.resolve(import.meta.dirname, "..", "src"),
    matches = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && /\.(?:js|json)$/.test(entry.name)) {
        const source = await fs.readFile(absolute, "utf8");
        pattern.lastIndex = 0;
        if (pattern.test(source))
          matches.push(path.relative(path.resolve(root, ".."), absolute));
      }
    }
  }
  await visit(root);
  return matches.sort();
}

const drone = machine("drone"),
  mission = machine("mission");
assertTopology(drone, {
  receivers: 5,
  motors: 4,
  rotors: 4,
  tanks: 0,
  resourceEdges: 0,
});
assertTopology(mission, {
  receivers: 8,
  motors: 0,
  rotors: 0,
  tanks: 2,
  resourceEdges: 5,
});

const droneRuntime = await prepareTypeScriptController(
    drone.controller.scriptSources.typescript,
    drone.manifest,
  ),
  droneOutputs = outputRecord(droneRuntime, {
    "pilot.collective": 0.6,
    "pilot.yaw": 0.2,
    "pilot.pitch": 0.1,
    "pilot.roll": -0.2,
    "pilot.altitude_hold": 0,
    "nav.altitude": 20,
    "imu.roll": 0,
    "imu.pitch": 0,
    "imu.yaw": 0,
    "imu.rate_x": 0,
    "imu.rate_y": 0,
    "imu.rate_z": 0,
  });
for (const [bindingId, expected] of Object.entries({
  "motor.0.throttle": 0.658,
  "motor.1.throttle": 0.57,
  "motor.2.throttle": 0.598,
  "motor.3.throttle": 0.574,
}))
  close(droneOutputs[bindingId], expected, `drone program ${bindingId}`);

const missionRuntime = await prepareTypeScriptController(
    mission.controller.scriptSources.typescript,
    mission.manifest,
  ),
  missionInputs = {
    "pilot.arm": 1,
    "pilot.launch": 1,
    "pilot.throttle": 0.8,
    "pilot.target_altitude": 100_000,
    "pilot.target_x": 100,
    "pilot.target_z": -50,
    "pilot.stage": 0,
    "pilot.abort": 0,
    "nav.altitude": 1_000,
    "nav.position_x": 0,
    "nav.position_z": 0,
    "nav.velocity_x": 0,
    "nav.velocity_z": 0,
    "nav.wind_x": 0,
    "nav.wind_z": 0,
    "air.dynamic_pressure": 0,
    "thermal.temperature": 20,
  },
  missionOutputs = outputRecord(missionRuntime, missionInputs);
for (const [bindingId, expected] of Object.entries({
  "coupler.release": 0,
  "engine.throttle": 0.8,
  "engine.gimbal": 0.245,
  "rcs.0.throttle": 0.245,
  "rcs.1.throttle": 0,
  "rcs.2.throttle": 0,
  "rcs.3.throttle": 0.1225,
}))
  close(missionOutputs[bindingId], expected, `mission program ${bindingId}`);

const abortProgram = missionRuntime.instantiate(),
  tickMission = (overrides = {}) =>
    Object.fromEntries(
      abortProgram.tick(DT, { ...missionInputs, ...overrides }),
    );
assert.equal(tickMission()["engine.throttle"], 0.8);
assert.equal(
  tickMission({ "pilot.abort": 1 })["engine.throttle"],
  0,
  "abort did not override an asserted launch receiver",
);
assert.equal(
  tickMission()["engine.throttle"],
  0,
  "held launch receiver restarted the mission without a new launch edge",
);
tickMission({ "pilot.launch": 0 });
assert.equal(
  tickMission()["engine.throttle"],
  0.8,
  "a released and re-pressed launch command did not restart the mission",
);
assert.equal(
  tickMission({ "pilot.stage": 1 })["coupler.release"],
  1,
  "stage input did not produce a release rising edge",
);
assert.equal(
  tickMission({ "pilot.stage": 1 })["coupler.release"],
  0,
  "held stage input emitted more than one release command",
);
tickMission({ "pilot.stage": 0 });
assert.equal(
  tickMission({ "pilot.stage": 1 })["coupler.release"],
  1,
  "released stage input did not re-arm the edge detector",
);

const rcsAxes = mission.assembly.parts
  .filter((part) => part.type === "rcs")
  .map((part) => rotateVectorByQuaternion([0, 1, 0], part.orientation));
for (const [index, expected] of [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 0, -1],
].entries())
  for (let axis = 0; axis < 3; axis++)
    close(rcsAxes[index][axis], expected[axis], `RCS ${index} axis ${axis}`);

await assertLanguageParity(drone);
await assertLanguageParity(mission);
assertRouteFailure(drone);
assertRouteFailure(mission);
await assertPortableRoundTrips(drone);
await assertPortableRoundTrips(mission);

const inertResources = new MaterialResourceNetwork({ bodies: [] });
assert.equal(typeof inertResources.allocate, "function");
assert.deepEqual(inertResources.allocate([], { tick: 0, dt: DT }), []);

assert.deepEqual(
  await sourceFilesMatching(/alternate\.rcs|\brcs_[xz]\b/g),
  [],
  "removed vector-RCS command authority remains in production source",
);
assert.deepEqual(
  await sourceFilesMatching(/finite-propellant-transverse-thruster-v1/g),
  [],
  "removed private RCS propellant authority remains in production source",
);

console.log(
  "flight command transition passed (ordinary receivers, exact TS/Visual/WAT endpoints, physical nozzle axes, resource/subassembly/share topology, no alternate force authority)",
);

function groupBy(values, keyFor) {
  const groups = {};
  for (const value of values) {
    const key = keyFor(value);
    if (!groups[key]) groups[key] = [];
    groups[key].push(value);
  }
  return groups;
}
