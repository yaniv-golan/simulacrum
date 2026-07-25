import { execFileSync } from "node:child_process";
import path from "node:path";
import { validateComponentInspectionLiveWorkspace } from "./lib/component-inspection-live-workspace.mjs";

const root = path.resolve(import.meta.dirname, ".."),
  valueArgument = (name) =>
    process.argv
      .find((value) => value.startsWith(`--${name}=`))
      ?.slice(name.length + 3),
  profile = valueArgument("profile"),
  candidate = valueArgument("candidate"),
  allowDirty = process.argv.includes("--allow-dirty"),
  output = path.join(
    root,
    "artifacts",
    `component-inspection-performance-${profile}-current.json`,
  ),
  git = (args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

const workspace = validateComponentInspectionLiveWorkspace({
  profile,
  candidate,
  allowDirty,
  root,
  git,
});

const run = (script, args) =>
  execFileSync(
    process.execPath,
    [path.join(root, "scripts", script), ...args],
    {
      cwd: root,
      stdio: "inherit",
    },
  );
const captureArguments = [`--profile=${profile}`, `--output=${output}`];
if (workspace.authoritative)
  captureArguments.push(`--candidate=${workspace.candidate}`);
else captureArguments.push("--allow-dirty");
run("capture-component-inspection-performance.mjs", captureArguments);
const verifyArguments = [`--profile=${profile}`, `--artifact=${output}`];
if (workspace.authoritative) verifyArguments.push("--release");
run("verify-component-inspection-performance.mjs", verifyArguments);
