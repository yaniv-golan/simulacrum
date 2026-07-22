import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { assert } from "./lib/assert.mjs";

const root = path.resolve(import.meta.dirname, "..");
execFileSync(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["run", "build"],
  {
    cwd: root,
    stdio: "inherit",
  },
);

const baseline = JSON.parse(
    await fs.readFile(
      path.join(root, "scripts/baselines/release-0.1.0.json"),
      "utf8",
    ),
  ),
  manifest = JSON.parse(
    await fs.readFile(path.join(root, "dist/.vite/manifest.json"), "utf8"),
  ),
  entry = manifest["index.html"],
  dynamicEntries = entry.dynamicImports.map((key) => manifest[key]),
  typescript = dynamicEntries.find(
    (item) => item.name === "typescript-compiler",
  ),
  wabt = dynamicEntries.find((item) => item.name === "wabt-runtime");

assert.ok(entry?.isEntry, "production manifest lost its application entry");
assert.ok(typescript?.isDynamicEntry, "TypeScript compiler is no longer lazy");
assert.ok(wabt?.isDynamicEntry, "WABT runtime is no longer lazy");
assert.ok(
  !(wabt.imports || []).some(
    (key) => manifest[key]?.name === "typescript-compiler",
  ),
  "WAT compilation unexpectedly downloads the TypeScript compiler",
);

const bytes = async (file) =>
    (await fs.stat(path.join(root, "dist", file))).size,
  mainBytes = await bytes(entry.file),
  typescriptBytes = await bytes(typescript.file),
  wabtBytes = await bytes(wabt.file),
  budget = baseline.budgets.bundles;

assert.ok(
  mainBytes <= budget.mainBytes,
  `eager main bundle exceeded its ${budget.mainBytes}-byte budget (${mainBytes})`,
);
assert.ok(
  typescriptBytes <= budget.typescriptCompilerBytes,
  `lazy TypeScript compiler exceeded its ${budget.typescriptCompilerBytes}-byte budget (${typescriptBytes})`,
);
assert.ok(
  wabtBytes <= budget.wabtRuntimeBytes,
  `lazy WABT runtime exceeded its ${budget.wabtRuntimeBytes}-byte budget (${wabtBytes})`,
);

console.log(
  JSON.stringify({
    release: baseline.release,
    mainBytes,
    typescriptBytes,
    wabtBytes,
  }),
);
