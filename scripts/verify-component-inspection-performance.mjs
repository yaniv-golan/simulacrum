import fs from "node:fs/promises";
import path from "node:path";
import { assert } from "./lib/assert.mjs";
import {
  captureWorkspaceIdentity,
  sameWorkspaceIdentity,
} from "./lib/workspace-identity.mjs";
import { nodeSatisfiesComponentInspectionReleaseRange } from "./lib/component-inspection-live-workspace.mjs";

const root = path.resolve(import.meta.dirname, ".."),
  valueArgument = (name) =>
    process.argv
      .find((value) => value.startsWith(`--${name}=`))
      ?.slice(name.length + 3),
  profile = valueArgument("profile"),
  artifactPath = path.resolve(
    root,
    valueArgument("artifact") ||
      `artifacts/component-inspection-performance-${profile || "foundation"}-current.json`,
  ),
  baselinePath = path.resolve(
    root,
    valueArgument("baseline") ||
      `scripts/baselines/component-inspection-${profile || "foundation"}-release-0.1.0.json`,
  ),
  releaseMode = process.argv.includes("--release");

if (!["foundation", "routes"].includes(profile))
  throw new Error(
    "Component inspection verifier requires --profile=foundation|routes",
  );
const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8")),
  baseline = JSON.parse(await fs.readFile(baselinePath, "utf8")),
  currentIdentity = await captureWorkspaceIdentity(root, ["node_modules"]);

assert.equal(artifact.schemaVersion, 1);
assert.equal(artifact.profile, profile);
assert.equal(artifact.release, baseline.release);
assert.equal(baseline.schemaVersion, 1);
assert.equal(baseline.profile, profile);
assert.deepEqual(artifact.errors, []);
assert.ok(
  sameWorkspaceIdentity(artifact.source, currentIdentity),
  "source changed after performance capture",
);
assert.ok(
  sameWorkspaceIdentity(artifact.measurementHarness, currentIdentity),
  "measurement harness changed after performance capture",
);
assert.equal(artifact.environment.viewport.width, 1600);
assert.equal(artifact.environment.viewport.height, 900);
assert.equal(artifact.environment.viewport.deviceScaleFactor, 1);
assert.equal(artifact.environment.warmupRuns, baseline.measurement.warmupRuns);
assert.ok(
  Number.isInteger(artifact.environment.measuredRuns) &&
    artifact.environment.measuredRuns >=
      baseline.measurement.minimumMeasuredRuns &&
    artifact.environment.measuredRuns % 2 === 1,
  "measured runs must be an odd release-contract sample count",
);
for (const series of [
  "rebuildMs",
  "selectionProjectionMs",
  ...(profile === "routes" ? ["routeMaterializationMs"] : []),
])
  assert.equal(
    artifact.raw[series].length,
    artifact.environment.measuredRuns,
    `${series} sample count does not match its environment`,
  );
for (const [fixture, expected] of Object.entries(baseline.fixtures))
  assert.deepEqual(artifact.fixtures[fixture], expected);
for (const [metric, limit] of Object.entries(baseline.budgets)) {
  const value = artifact.summary[metric];
  assert.ok(Number.isFinite(value), `${metric} is not finite`);
  assert.ok(value <= limit, `${metric} exceeded ${value} > ${limit}`);
}
if (releaseMode) {
  assert.equal(
    artifact.authoritative,
    true,
    "release-baseline verification rejects non-authoritative captures",
  );
  assert.ok(
    nodeSatisfiesComponentInspectionReleaseRange(artifact.environment.node),
    `release capture requires Node ${baseline.measurement.nodeRange}; received ${artifact.environment.node}`,
  );
}
console.log(
  JSON.stringify(
    {
      profile,
      authoritative: artifact.authoritative,
      summary: artifact.summary,
    },
    null,
    2,
  ),
);
