import fs from "node:fs/promises";
import path from "node:path";
import { assert } from "./lib/assert.mjs";
import {
  analyzeArchitecture,
  formatArchitectureViolation,
} from "./lib/architecture-analyzer.mjs";

const root = path.resolve(import.meta.dirname, ".."),
  result = await analyzeArchitecture({ root });

assert.equal(
  result.violations.length,
  0,
  `parsed module graph violations:\n${result.violations
    .map(formatArchitectureViolation)
    .join("\n")}`,
);

const coordinator = await fs.readFile(
    path.join(root, "src", "application", "simulacrum-app.js"),
    "utf8",
  ),
  coordinatorLines = coordinator.trim().split(/\r?\n/).length,
  edgeCount = [...result.graph.values()].reduce(
    (total, dependencies) => total + dependencies.length,
    0,
  );
assert.ok(
  coordinatorLines < 300,
  `application coordinator grew to ${coordinatorLines} lines`,
);

console.log(
  `module graph passed (${result.files.length} modules, ${edgeCount} parsed static/dynamic edges, no cycles, coordinator ${coordinatorLines} lines)`,
);
