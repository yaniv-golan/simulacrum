import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  MaterialResourceNetwork,
  RunAssemblyGraph,
  TYPES,
  compileAssembly,
  decodeBlueprintOrThrow,
  pressureNozzlePerformance,
} from "../src/core/index.js";
import { sha256Hex } from "../src/model/sha256.js";

const fixturePath = new URL(
    "../test/fixtures/flight/chemical-drone-depletion-v1.blueprint.json",
    import.meta.url,
  ),
  source = await fs.readFile(fixturePath, "utf8"),
  expectedSourceSha256 =
    "8fc303cbbe63ade79259b5d81b8430159778f3271a2e8f9a7d52c7ad2076e141";
assert.equal(sha256Hex(source), expectedSourceSha256);
assert.doesNotMatch(source, /shaft-rotor-aerodynamics-v1/);
const assembly = decodeBlueprintOrThrow(JSON.parse(source)).assembly,
  compiled = compileAssembly(assembly, TYPES),
  tank = assembly.parts.find((part) => part.type === "propellanttank"),
  engines = compiled.bodies.filter(
    (body) => body.capabilities.propulsion?.kind === "pressure-nozzle-v1",
  ),
  graph = new RunAssemblyGraph(assembly),
  network = new MaterialResourceNetwork(compiled),
  dt = 1 / 120;
assert.equal(compiled.stats.errorCount, 0);
assert.equal(tank.config.initialUsableMassKg, 80);
assert.equal(
  assembly.parts.some((part) => part.type === "rotor"),
  false,
);
assert.equal(engines.length, 4);
assert.deepEqual(
  engines.map((engine) => engine.capabilities.propulsion.maximumMassFlowKgS),
  [2.4, 2.4, 2.4, 2.4],
);
let lastPoweredTick = 0,
  firstUnpoweredTick = null,
  deliveredTotalKg = 0,
  finalPoweredThrustN = 0;
for (let tick = 1; tick <= 1_100; tick++) {
  network.resolve(graph);
  const allocation = network.allocate(
      engines.map((engine) => ({
        consumerPartId: engine.partId,
        mediumId: engine.capabilities.propulsion.mediumId,
        requestedMassKg: engine.capabilities.propulsion.maximumMassFlowKgS * dt,
      })),
      { tick, dt },
    ),
    deliveredKg = allocation.reduce(
      (sum, record) => sum + record.deliveredMassKg,
      0,
    );
  deliveredTotalKg += deliveredKg;
  if (deliveredKg > 1e-9) {
    lastPoweredTick = tick;
    finalPoweredThrustN = allocation.reduce((sum, record, index) => {
      const flowKgS = record.deliveredMassKg / dt;
      return (
        sum +
        pressureNozzlePerformance(
          engines[index].capabilities.propulsion,
          flowKgS,
          101_325,
        ).thrustN
      );
    }, 0);
  } else if (firstUnpoweredTick == null) firstUnpoweredTick = tick;
}
assert.ok(Math.abs(deliveredTotalKg - 80) < 1e-9, deliveredTotalKg);
assert.equal(lastPoweredTick, 1_000);
assert.equal(firstUnpoweredTick, 1_001);
assert.ok(finalPoweredThrustN > 0);
assert.equal(
  pressureNozzlePerformance(engines[0].capabilities.propulsion, 0, 101_325)
    .thrustN,
  0,
);
console.log(
  `chemical predecessor depletion passed: 80 kg / 9.6 kg/s = ${(lastPoweredTick * dt).toFixed(3)} s, then zero material-backed thrust`,
);
