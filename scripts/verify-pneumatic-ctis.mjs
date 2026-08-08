import assert from "node:assert/strict";
import {
  AssemblyModel,
  PneumaticNetwork,
  RunAssemblyGraph,
  TYPES,
} from "../src/core/index.js";
import { compileAssembly } from "./lib/compile-assembly.mjs";
import { builtInMechanismSubassemblies } from "../src/model/built-in-mechanism-subassemblies.js";
import {
  controllerBindingManifest,
  controllerBindingManifestIdentity,
} from "../src/model/controller-bindings.js";
import { compileVisualProgram } from "../src/model/visual-logic.js";
import {
  createSharePackage,
  decodeSharePackageOrThrow,
} from "../src/model/share-packages.js";
import {
  decodeSubassemblyOrThrow,
  instantiateSubassembly,
} from "../src/model/subassemblies.js";
import {
  prepareControlIRController,
  prepareTypeScriptController,
  prepareWasmController,
} from "../src/scripting/controller-compilers.js";

const record = builtInMechanismSubassemblies().find(
  (candidate) =>
    candidate.asset.name === "Four-wheel central tire inflation system",
);
assert.ok(record, "ordinary four-wheel CTIS subassembly is missing");
const sharedCtIS = await createSharePackage({
    kind: "subassembly",
    asset: record.asset,
    metadata: {
      title: record.asset.name,
      tags: ["pneumatic", "ctis"],
    },
  }),
  decodedCtIS = await decodeSharePackageOrThrow(JSON.stringify(sharedCtIS)),
  portableCtIS = decodeSubassemblyOrThrow(decodedCtIS.item.asset),
  roundTrippedCtIS = instantiateSubassembly(portableCtIS.wire, {
    nextId: 10_000,
  });
assert.deepEqual(
  portableCtIS.wire,
  record.asset,
  "CTIS share package changed the strict subassembly contract",
);
assert.equal(roundTrippedCtIS.parts.length, record.asset.parts.length);
assert.equal(
  roundTrippedCtIS.connections.length,
  record.asset.connections.length,
);
assert.ok(
  roundTrippedCtIS.connections
    .filter(({ kind }) => kind === "resource")
    .every(({ transport }) => transport?.kind === "compressible-gas-v1"),
  "CTIS share/instantiate round-trip lost gas transport contracts",
);
const snapshot = {
    parts: structuredClone(record.asset.parts),
    connections: structuredClone(record.asset.connections),
  },
  wheels = snapshot.parts.filter(({ type }) => type === "wheel"),
  valves = snapshot.parts.filter(({ type }) => type === "pneumaticvalve"),
  sensors = snapshot.parts.filter(({ type }) => type === "tirepressureprobe"),
  compressor = snapshot.parts.find(({ type }) => type === "aircompressor"),
  reservoir = snapshot.parts.find(({ type }) => type === "airreservoir"),
  controller = snapshot.parts.find(({ type }) => type === "computer");
assert.equal(wheels.length, 4);
assert.equal(valves.length, 4);
assert.equal(sensors.length, 4);
assert.ok(compressor && reservoir && controller);
assert.equal(controller.controllerBindings.length, 9);
assert.equal(
  controller.controllerBindings.filter(({ direction }) => direction === "input")
    .length,
  4,
);
assert.equal(
  controller.controllerBindings.filter(
    ({ direction }) => direction === "output",
  ).length,
  5,
);
const manifest = controllerBindingManifest(
    controller,
    snapshot.parts,
    snapshot.connections,
  ),
  outputBindings = manifest.filter(({ direction }) => direction === "output"),
  values = new Map(
    outputBindings.map((binding, index) => [binding.id, (index + 1) / 10]),
  ),
  typescript = `interface ControlAPI { read(binding: string): number; write(binding: string, value: number): void; }
function tick(api: ControlAPI, dt: number): void { void dt;
${outputBindings.map((binding) => `api.write('${binding.id}', ${values.get(binding.id)});`).join("\n")}
}`,
  visual = {
    version: 1,
    name: "CTIS endpoint parity",
    nodes: outputBindings.flatMap((binding, index) => [
      {
        id: `value-${index}`,
        type: "constant",
        value: values.get(binding.id),
        x: 0,
        y: index * 80,
      },
      {
        id: `output-${index}`,
        type: "output",
        bindingId: binding.id,
        x: 240,
        y: index * 80,
      },
    ]),
    links: outputBindings.map((_binding, index) => ({
      from: `value-${index}`,
      to: `output-${index}`,
      input: 0,
    })),
  },
  wat = `(module
  (import "env" "write_binding" (func $write (param i32 f32)))
  (func (export "tick") (param f32)
${outputBindings.map((binding) => `    (call $write (i32.const ${binding.index}) (f32.const ${values.get(binding.id)}))`).join("\n")}))`,
  prepared = [
    await prepareTypeScriptController(typescript, manifest),
    await prepareControlIRController(compileVisualProgram(visual, manifest).ir),
    await prepareWasmController(wat, manifest),
  ],
  manifestIdentity = controllerBindingManifestIdentity(manifest);
for (const runtime of prepared) {
  assert.equal(runtime.bindingManifestIdentity, manifestIdentity);
  const output = Object.fromEntries(runtime.instantiate().tick(1 / 120, {}));
  for (const [bindingId, expected] of values)
    assert.ok(Math.abs(output[bindingId] - expected) < 1e-6);
}
for (const connection of snapshot.connections.filter(
  ({ kind }) => kind === "resource",
)) {
  assert.equal(connection.transport.kind, "compressible-gas-v1");
  assert.ok(connection.transport.effectiveOrificeAreaM2 > 0);
}

for (const wheel of wheels)
  wheel.mechanism.config.tireConstitutiveLaw.pneumaticChamber.initialColdGaugePressurePa = 150_000;
const model = new AssemblyModel(snapshot),
  compiled = compileAssembly(model.snapshot(), TYPES),
  graph = new RunAssemblyGraph(model.snapshot()),
  network = new PneumaticNetwork(compiled),
  selectedValve = valves[0],
  selectedWheel = wheels.find((wheel) =>
    snapshot.connections.some(
      (connection) =>
        connection.kind === "resource" &&
        ((connection.a === selectedValve.id && connection.b === wheel.id) ||
          (connection.b === selectedValve.id && connection.a === wheel.id)),
    ),
  ),
  commands = new Map([
    [`${compressor.id}\0inflate`, 1],
    [`${selectedValve.id}\0position`, 1],
  ]),
  context = {
    runGraph: graph,
    commandBus: {
      read(partId, channel, fallback) {
        return {
          value: commands.get(`${partId}\0${channel}`) ?? fallback,
          conflict: false,
        };
      },
    },
    powerNetwork: {
      allocationFor() {
        return { operational: true };
      },
      isPowered() {
        return true;
      },
      drawPower(_partId, requestedW) {
        return requestedW;
      },
    },
  },
  pressureBefore = new Map(
    network
      .telemetry()
      .chambers.map(({ partId, gaugePressurePa }) => [partId, gaugePressurePa]),
  );
for (let tick = 0; tick < 240; tick++) network.resolve(context, 1 / 120);
const after = new Map(
  network.telemetry().chambers.map((chamber) => [chamber.partId, chamber]),
);
assert.ok(
  after.get(selectedWheel.id).gaugePressurePa >
    pressureBefore.get(selectedWheel.id),
  "selected CTIS corner did not inflate",
);
for (const wheel of wheels.filter(({ id }) => id !== selectedWheel.id))
  assert.ok(
    after.get(selectedWheel.id).gaugePressurePa >
      after.get(wheel.id).gaugePressurePa,
    "closed CTIS branch received the selected corner's inflation",
  );
assert.ok(
  network
    .telemetry()
    .devices.some(
      (device) => device.partId === selectedValve.id && device.position > 0.9,
    ),
);

console.log(
  `pneumatic CTIS passed (${wheels.length} independently routed tire branches)`,
);
