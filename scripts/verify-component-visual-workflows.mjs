import { execFileSync } from "node:child_process";
import path from "node:path";
import { COMPONENT_VISUAL_WORKFLOW_MATRIX_V1 } from "./fixtures/component-visual-workflow-matrix.js";

const root = path.resolve(import.meta.dirname, "..");
const suites = [
  ...new Set(
    COMPONENT_VISUAL_WORKFLOW_MATRIX_V1.map(({ file }) =>
      path.basename(file, ".mjs"),
    ),
  ),
].sort();

execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "test:focused", "--", ...suites],
  { cwd: root, stdio: "inherit" },
);
console.log(
  `component visual workflows passed (${suites.length} executable suites)`,
);
