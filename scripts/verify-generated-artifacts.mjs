import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile),
  root = path.resolve(import.meta.dirname, ".."),
  generator = path.join(root, "scripts", "generate-wire-validators.mjs"),
  outputDirectory = path.join(root, "src", "model", "generated"),
  outputs = [
    "portable-machine-wire-validators.js",
    "share-wire-validators.js",
    "mechanism-artifact-wire-validators.js",
  ].map((file) => path.join(outputDirectory, file));

await run(process.execPath, [generator, "--check"], { cwd: root });
const before = await Promise.all(
  outputs.map((output) => fs.stat(output, { bigint: true })),
);

// Production builds run generation while the browser regression server is
// watching the source tree. A content-identical generation must not touch the
// file and trigger a mid-suite Vite reload.
await run(process.execPath, [generator], { cwd: root });
const after = await Promise.all(
  outputs.map((output) => fs.stat(output, { bigint: true })),
);

for (const [index, output] of outputs.entries())
  assert.equal(
    after[index].mtimeNs,
    before[index].mtimeNs,
    `${path.basename(output)} must not be rewritten when current`,
  );
console.log("generated artifacts are current and write-idempotent");
