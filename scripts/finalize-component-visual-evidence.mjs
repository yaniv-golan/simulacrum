import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assert } from "./lib/assert.mjs";
import { sameWorkspaceIdentity } from "./lib/workspace-identity.mjs";

const outputDirectory = path.resolve(
    process.env.COMPONENT_VISUAL_CAPTURE_DIR ||
      "artifacts/component-visual-realism",
  ),
  bundleManifestPath = path.join(
    outputDirectory,
    "evidence-bundle-manifest.json",
  ),
  readJson = (relativePath) =>
    fs
      .readFile(path.join(outputDirectory, relativePath), "utf8")
      .then(JSON.parse),
  sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");

const [inventory, productIdentity, catalogIdentity, performance] =
  await Promise.all([
    readJson("component-inventory.json"),
    readJson("capture-identity.json"),
    readJson("catalog-turntable/capture-identity.json"),
    readJson("performance-budget.json"),
  ]);
const source = inventory.identity.source;
for (const [label, identity] of [
  ["browser product capture", productIdentity.source],
  ["catalog turntable", catalogIdentity.source],
  ["performance budget", performance.source],
])
  assert.ok(
    sameWorkspaceIdentity(source, identity),
    `${label} does not identify the final inventory working tree`,
  );
assert.equal(inventory.catalogTypeCount, 42);
assert.deepEqual(performance.errors, []);

const files = [];
async function collect(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collect(absolute);
    else if (absolute !== bundleManifestPath) files.push(absolute);
  }
}
await collect(outputDirectory);
const artifacts = await Promise.all(
  files.sort().map(async (absolute) => {
    const contents = await fs.readFile(absolute);
    return {
      file: path.relative(outputDirectory, absolute),
      bytes: contents.length,
      sha256: sha256(contents),
    };
  }),
);
for (const required of [
  "component-inventory.json",
  "performance-budget.json",
  "cart-laptop-day-overview.png",
  "cart-wide-day-spring-detail.png",
  "catalog-turntable/gear-pair-engagement-day.png",
])
  assert.ok(
    artifacts.some(({ file }) => file === required),
    `evidence bundle omitted ${required}`,
  );

const manifest = {
  schemaVersion: 1,
  evidenceContract: "component-visual-final-bundle-v1",
  source,
  artifactCount: artifacts.length,
  artifacts,
};
await fs.writeFile(
  bundleManifestPath,
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `component visual evidence finalized (${artifacts.length} source-consistent artifacts)`,
);
