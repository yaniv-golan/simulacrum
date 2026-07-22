import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeCapabilityDispatch } from "./lib/capability-dispatch-analyzer.mjs";
import {
  capabilityDispatchDigest,
  capabilityDispatchReport,
  REVIEWED_CAPABILITY_DISPATCH_BASELINE,
} from "./report-capability-dispatch.mjs";

const fixtureRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "simulacrum-capability-dispatch-"),
);
try {
  await fs.mkdir(path.join(fixtureRoot, "src/simulation"), { recursive: true });
  await fs.writeFile(
    path.join(fixtureRoot, "src/simulation/evasive.js"),
    [
      'const direct = (part) => part.type === "wheel";',
      'const member = (part) => ["wheel", "axle"].includes(part.type);',
      "const lookup = (part, adapters) => adapters[part.type];",
      'const switched = (part) => { switch (part.type) { case "spring": return 1; default: return 0; } };',
      'const alias = (part) => { const type = part.type; return type !== "motor"; };',
      "const destructured = (component, adapters) => { const { type: componentType } = component; return adapters.get(componentType); };",
      "export { direct, member, lookup, switched, alias, destructured };",
    ].join("\n"),
  );
  const fixture = await analyzeCapabilityDispatch({
    root: fixtureRoot,
    componentTypes: ["wheel", "axle", "spring", "motor"],
    sourceDirectories: ["src"],
  });
  assert.deepEqual(fixture.findings.map(({ kind }) => kind).sort(), [
    "equality",
    "equality",
    "lookup",
    "lookup",
    "membership",
    "switch",
  ]);
  assert.equal(fixture.unclassified.length, 6);
} finally {
  await fs.rm(fixtureRoot, { recursive: true, force: true });
}

const report = await capabilityDispatchReport();
assert.ok(report.findings.length > 0, "dispatch inventory must not be empty");
assert.deepEqual(
  report.unclassified,
  [],
  `unclassified dispatch sites: ${JSON.stringify(report.unclassified, null, 2)}`,
);
assert.equal(
  report.counts.REPLACE,
  0,
  "authoritative type-dispatch replacement debt must stay removed",
);
assert.equal(
  report.counts.DELETE,
  0,
  "reviewed deletion debt must stay removed",
);
assert.equal(
  capabilityDispatchDigest(report),
  REVIEWED_CAPABILITY_DISPATCH_BASELINE.sha256,
  "reviewed line-level dispatch inventory changed",
);
console.log(
  `capability dispatch inventory passed (${report.findings.length} sites: ${report.counts.KEEP} keep, ${report.counts.REPLACE} replace, ${report.counts.DELETE} delete, 0 unclassified)`,
);
