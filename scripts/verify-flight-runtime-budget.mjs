import fs from "node:fs/promises";
import path from "node:path";
import { assert } from "./lib/assert.mjs";

const root = path.resolve(import.meta.dirname, ".."),
  ownerFiles = [
    "physical-flight-model.js",
    "aerodynamic-force-owner.js",
    "aerothermal-ablation-owner.js",
    "physical-flight-telemetry-projector.js",
  ].map((name) => path.join(root, "src", "simulation", name)),
  nozzleFile = path.join(
    root,
    "src",
    "simulation",
    "systems",
    "pressure-nozzle-system.js",
  ),
  ownerSources = await Promise.all(
    ownerFiles.map((file) => fs.readFile(file, "utf8")),
  ),
  [modelSource, aerodynamicSource, thermalSource, telemetrySource] =
    ownerSources,
  source = ownerSources.join("\n"),
  nozzleSource = await fs.readFile(nozzleFile, "utf8"),
  hotSections = [
    [modelSource, "  measure(group) {", "\n  primary(context)"],
    [aerodynamicSource, "  step(context) {", "\n  heatRecords()"],
    [thermalSource, "  step(context, dt) {", "\n  initializeTelemetry"],
    [telemetrySource, "  #project(context", "\n  #impactRecord"],
  ].map(([text, startMarker, endMarker]) => {
    const start = text.indexOf(startMarker),
      end = text.indexOf(endMarker, start);
    assert.ok(
      start >= 0 && end > start,
      `flight hot path ${startMarker} missing`,
    );
    return text.slice(start, end);
  }),
  nozzleDemandStart = nozzleSource.indexOf("  step(context, dt) {"),
  nozzleDemandEnd = nozzleSource.indexOf(
    "\n  telemetry(context)",
    nozzleDemandStart,
  ),
  nozzleForceClass = nozzleSource.indexOf(
    "export class PressureNozzleForceSystem",
  ),
  nozzleForceStart = nozzleSource.indexOf(
    "  step(context) {",
    nozzleForceClass,
  ),
  nozzleForceEnd = nozzleSource.indexOf("\n  dispose()", nozzleForceStart),
  hotPath = [
    ...hotSections,
    nozzleSource.slice(nozzleDemandStart, nozzleDemandEnd),
    nozzleSource.slice(nozzleForceStart, nozzleForceEnd),
  ].join("\n"),
  explicitMathAllocations =
    `${source}\n${nozzleSource}`.match(
      /new\s+(?:CANNON\.(?:Vec3|Quaternion)|THREE\.(?:Vector3|Quaternion|Euler))/g,
    ) || [],
  hotMathAllocations =
    hotPath.match(
      /new\s+(?:CANNON\.(?:Vec3|Quaternion)|THREE\.(?:Vector3|Quaternion|Euler))/g,
    ) || [];

assert.ok(
  nozzleDemandStart >= 0 &&
    nozzleDemandEnd > nozzleDemandStart &&
    nozzleForceStart >= 0 &&
    nozzleForceEnd > nozzleForceStart,
  "flight/nozzle hot paths not found",
);
assert.equal(
  hotMathAllocations.length,
  0,
  "120 Hz flight path regained explicit vector/quaternion allocations",
);
assert.ok(
  explicitMathAllocations.length <= 45,
  `preallocated flight math budget exceeded: ${explicitMathAllocations.length}`,
);
assert.match(
  modelSource,
  /const measurement = group\.measurement/,
  "connected-component measurement vectors are not reused",
);
assert.match(
  nozzleSource,
  /#compiledVectors = new Map\([\s\S]*engine\.contract\.applicationPointPartM/,
  "compiled nozzle vectors are not preallocated",
);
assert.match(
  nozzleSource,
  /record\.allocationTick !== context\.clock\.tick/,
  "nozzle force no longer proves current-tick material allocation",
);
assert.doesNotMatch(
  source,
  /\bworld\.step\s*\(|stepIntegration|detachedVelocity|pendingPosition|flightRuntime|ComponentFlightRuntime/,
  "narrow flight owners regained integration, manual pose, or broad runtime ownership",
);

for (const removed of [
  "src/simulation/flight-runtime.js",
  "src/simulation/systems/flight-system.js",
  "src/application/multibody-lifecycle.js",
  "src/simulation/rigid-body-aerothermal-runtime.js",
  "src/simulation/control-resolver.js",
])
  await assert.rejects(
    fs.access(path.join(root, removed)),
    undefined,
    `${removed} was restored`,
  );

console.log(
  `flight/nozzle runtime budget passed (${explicitMathAllocations.length} preallocated math objects, zero in 120 Hz hot paths)`,
);
