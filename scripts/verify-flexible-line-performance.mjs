import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import * as CANNON from "cannon-es";
import { compileAssembly } from "../src/model/assembly-compiler.js";
import { TYPES } from "../src/model/component-catalog.js";
import { componentDefaults } from "../src/model/component-resolver.js";
import { FlexibleLineRuntime } from "../src/simulation/flexible-line-runtime.js";

const parts = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    type: "rope",
    pos: [index * 20, 30, 0],
    orientation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    config: {
      ...componentDefaults("rope"),
      lengthM: index === 7 ? 14 : 16,
      targetElementLengthM: 0.25,
    },
  })),
  compileStart = performance.now(),
  compiled = compileAssembly({ revision: 1, parts, connections: [] }, TYPES),
  compileMs = performance.now() - compileStart,
  entityCount = compiled.flexibleLines.reduce(
    (sum, line) => sum + line.entities.length,
    0,
  ),
  edgeCount = compiled.flexibleLines.reduce(
    (sum, line) => sum + line.internalEdges.length,
    0,
  );
assert.equal(compiled.diagnostics.length, 0);
assert.equal(entityCount, 512, "fixture must exercise the global entity cap");
assert.equal(edgeCount, 504);
assert.ok(compileMs < 1_000, `512-entity compilation took ${compileMs} ms`);

const overBudget = compileAssembly(
  {
    revision: 1,
    parts: [
      ...parts,
      {
        ...parts[0],
        id: 9,
        pos: [180, 30, 0],
        config: { ...parts[0].config, lengthM: 0.5 },
      },
    ],
    connections: [],
  },
  TYPES,
);
assert.equal(
  overBudget.diagnostics.at(-1).code,
  "FLEXIBLE_LINE_GLOBAL_ENTITY_BUDGET_EXCEEDED",
);

const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -9.80665, 0),
  }),
  material = new CANNON.Material("nylon-rope"),
  runtime = new FlexibleLineRuntime({
    world,
    material,
    multibodyRuntime: { bodyByPart: new Map() },
  }).start(compiled),
  runStart = performance.now();
let telemetry;
for (let tick = 1; tick <= 120; tick++) {
  runtime.beforeIntegration(1 / 120);
  world.step(1 / 120);
  telemetry = runtime.afterIntegration(tick);
}
const fixedSecondMs = performance.now() - runStart,
  telemetryBytes = Buffer.byteLength(JSON.stringify(telemetry)),
  checkpointBytes = Buffer.byteLength(JSON.stringify(runtime.exportState()));
assert.equal(world.bodies.length, 512);
assert.equal(world.constraints.length, 504);
assert.ok(
  fixedSecondMs < 20_000,
  `512-entity fixed second took ${fixedSecondMs} ms`,
);
assert.ok(
  telemetryBytes < 1_500_000,
  `Rope telemetry grew to ${telemetryBytes} bytes`,
);
assert.ok(
  checkpointBytes < 1_500_000,
  `Rope checkpoint grew to ${checkpointBytes} bytes`,
);
runtime.dispose();
assert.equal(world.bodies.length, 0);
assert.equal(world.constraints.length, 0);

console.log(
  `flexible-line budgets passed (${compileMs.toFixed(1)} ms compile, ${fixedSecondMs.toFixed(1)} ms/fixed-second, ${telemetryBytes} telemetry bytes, ${checkpointBytes} checkpoint bytes)`,
);
