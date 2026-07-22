import fs from "node:fs/promises";
import path from "node:path";
import { assert } from "./lib/assert.mjs";

const root = path.resolve(import.meta.dirname, "..");
const argument = (name, fallback) =>
  path.resolve(
    root,
    process.argv
      .find((value) => value.startsWith(`--${name}=`))
      ?.slice(name.length + 3) || fallback,
  );
const budgetPath = argument("budget", "scripts/baselines/release-0.1.0.json");
const currentPath = argument(
  "current",
  "artifacts/release-performance-current.json",
);
const budget = JSON.parse(await fs.readFile(budgetPath, "utf8"));
const current = JSON.parse(await fs.readFile(currentPath, "utf8"));

assert.equal(budget.schemaVersion, 1, "performance budget schema changed");
assert.equal(budget.release, "0.1.0", "performance budget release changed");
assert.equal(current.schemaVersion, 1, "measurement schema changed");
assert.equal(
  current.environment.viewport.width,
  budget.measurement.viewport.width,
);
assert.equal(
  current.environment.viewport.height,
  budget.measurement.viewport.height,
);
assert.equal(current.environment.warmupRuns, budget.measurement.warmupRuns);
assert.ok(
  Number.isInteger(current.environment.measuredRuns) &&
    current.environment.measuredRuns >=
      budget.measurement.minimumMeasuredRuns &&
    current.environment.measuredRuns % 2 === 1,
  "measured-run count must be an odd integer within the release contract",
);
for (const series of [
  "startupMs",
  "frameMsByRun",
  "fixedStep1000Ms",
  "drawCallsPerMeasuredRun",
])
  assert.equal(
    current.raw[series].length,
    current.environment.measuredRuns,
    `${series} sample count does not match its environment`,
  );
assert.equal(current.raw.cycles.length, budget.measurement.cycleCount);
assert.deepEqual(current.errors, [], "measurement recorded browser failures");

const metrics = [
  "startupMedianMs",
  "frameMedianMs",
  "fixedStep1000MedianMs",
  "drawCallsPerMeasuredRunMedian",
  "heapSlopeBytesPerCycle",
  "bufferSlopePerCycle",
  "programSlopePerCycle",
  "textureSlopePerCycle",
  "workerSlopePerCycle",
  "blobUrlSlopePerCycle",
];
for (const metric of metrics) {
  const value = current.summary[metric];
  const limit = budget.budgets[metric];
  assert.ok(Number.isFinite(value), `${metric} is not finite`);
  assert.ok(
    value <= limit,
    `${metric} exceeded its release budget: ${value} > ${limit}`,
  );
}

console.log(
  JSON.stringify(
    { release: budget.release, summary: current.summary },
    null,
    2,
  ),
);
