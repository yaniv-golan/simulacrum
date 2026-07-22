import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const currentOutput = path.join(
  root,
  "artifacts",
  "release-performance-current.json",
);
const run = (script, args = []) =>
  execFileSync(
    process.execPath,
    [path.join(root, "scripts", script), ...args],
    {
      cwd: root,
      stdio: "inherit",
    },
  );

run("capture-release-performance.mjs", [`--output=${currentOutput}`]);
run("verify-performance-budget.mjs", [`--current=${currentOutput}`]);
