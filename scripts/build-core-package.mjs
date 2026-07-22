import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, ".."),
  packageRoot = path.join(root, "packages", "core"),
  local = process.argv.includes("--local");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}`);
}

function removeGenerated(directory) {
  fs.rmSync(path.join(packageRoot, directory), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

removeGenerated(".api-types");
removeGenerated("dist");
fs.mkdirSync(path.join(packageRoot, "etc"), { recursive: true });
fs.mkdirSync(path.join(packageRoot, "temp"), { recursive: true });

run("npx", ["tsc", "-p", "packages/core/tsconfig.build.json"]);
run("npx", ["vite", "build", "--config", "packages/core/vite.config.js"]);
run(process.execPath, ["scripts/copy-third-party-licenses.mjs", "core"]);
run("npx", [
  "api-extractor",
  "run",
  "--config",
  "packages/core/api-extractor.json",
  ...(local ? ["--local"] : []),
]);

for (const required of ["dist/index.js", "dist/index.d.ts"]) {
  if (!fs.existsSync(path.join(packageRoot, required)))
    throw new Error(`core package build did not create ${required}`);
}

console.log(
  `core package ${local ? "local API baseline" : "API compatibility"} build passed`,
);
