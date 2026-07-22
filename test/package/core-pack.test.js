import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createBrowserTest } from "../../scripts/lib/browser-test.mjs";

const root = path.resolve(import.meta.dirname, "../.."),
  artifactRoot = path.join(root, "artifacts", "core-pack-test"),
  packRoot = path.join(artifactRoot, "pack"),
  fixtureRoot = path.join(artifactRoot, "fixture"),
  browserRoot = path.join(fixtureRoot, "browser"),
  browserDist = path.join(artifactRoot, "browser-dist");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || root,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}

await fs.rm(artifactRoot, { recursive: true, force: true });
await fs.mkdir(packRoot, { recursive: true });

run(process.execPath, ["scripts/build-core-package.mjs"]);
run("npm", [
  "pack",
  "./packages/core",
  "--ignore-scripts",
  "--pack-destination",
  packRoot,
]);

const tarballName = (await fs.readdir(packRoot)).find((file) =>
    file.endsWith(".tgz"),
  ),
  tarball = path.join(packRoot, tarballName || "missing.tgz"),
  packedFiles = run("tar", ["-tzf", tarball]).trim().split("\n");
assert.ok(tarballName, "npm pack did not create a tarball");
assert.ok(packedFiles.includes("package/dist/index.js"));
assert.ok(packedFiles.includes("package/dist/index.d.ts"));
assert.ok(packedFiles.includes("package/dist/licenses/THIRD_PARTY_NOTICES.md"));
assert.ok(packedFiles.includes("package/dist/licenses/three-LICENSE"));
assert.ok(packedFiles.includes("package/dist/licenses/typescript-LICENSE.txt"));
assert.ok(packedFiles.includes("package/SEMVER.md"));
assert.equal(
  packedFiles.some((file) => file.includes("/src/")),
  false,
  "core pack leaked repository source instead of the reviewed artifact",
);

await fs.mkdir(browserRoot, { recursive: true });
await fs.writeFile(
  path.join(fixtureRoot, "package.json"),
  `${JSON.stringify(
    {
      name: "simulacrum-core-clean-install-fixture",
      private: true,
      type: "module",
    },
    null,
    2,
  )}\n`,
);
run(
  "npm",
  [
    "install",
    tarball,
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
  ],
  { cwd: fixtureRoot },
);

const sourcePackage = JSON.parse(
    await fs.readFile(
      path.join(root, "packages", "core", "package.json"),
      "utf8",
    ),
  ),
  installedPackage = JSON.parse(
    await fs.readFile(
      path.join(
        fixtureRoot,
        "node_modules",
        "@yaniv-golan",
        "simulacrum-core",
        "package.json",
      ),
      "utf8",
    ),
  );
assert.equal(installedPackage.name, "@yaniv-golan/simulacrum-core");
assert.equal(installedPackage.version, sourcePackage.version);
assert.equal(installedPackage.private, undefined);
assert.equal(installedPackage.exports["."].types, "./dist/index.d.ts");

await fs.writeFile(
  path.join(fixtureRoot, "node-smoke.mjs"),
  `import {
  AssemblyModel,
  SimulationSession,
  TelemetrySystem,
} from "@yaniv-golan/simulacrum-core";

const model = new AssemblyModel();
const session = new SimulationSession({ systems: [new TelemetrySystem()] });
session.start(model.snapshot());
session.stepFixed();
if (session.telemetry().tick !== 1) throw new Error("telemetry did not advance");
session.dispose();
console.log("clean Node import passed");
`,
);
assert.match(
  run(process.execPath, ["node-smoke.mjs"], { cwd: fixtureRoot }),
  /clean Node import passed/,
);

await fs.writeFile(
  path.join(fixtureRoot, "type-smoke.mts"),
  `import { AssemblyModel, SimulationSession } from "@yaniv-golan/simulacrum-core";
const model = new AssemblyModel();
const revision: number = model.revision;
const session = new SimulationSession();
const steps: number = session.stepFixed();
void revision;
void steps;
`,
);
await fs.writeFile(
  path.join(fixtureRoot, "tsconfig.json"),
  `${JSON.stringify(
    {
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        target: "ES2022",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
      },
      files: ["type-smoke.mts"],
    },
    null,
    2,
  )}\n`,
);
run(
  process.execPath,
  [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "."],
  { cwd: fixtureRoot },
);

await fs.writeFile(
  path.join(browserRoot, "index.html"),
  `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8"><title>Core browser smoke</title></head>
  <body>
    <output id="result">LOADING</output>
    <script type="module">
      import { AssemblyModel, standardAtmosphere } from "@yaniv-golan/simulacrum-core";
      const model = new AssemblyModel();
      const atmosphere = standardAtmosphere(0);
      document.querySelector("#result").textContent =
        model.snapshot().parts.length === 0 && atmosphere.density > 1
          ? "CORE_BROWSER_OK"
          : "CORE_BROWSER_FAILED";
    </script>
  </body>
</html>
`,
);
run(
  process.execPath,
  [
    path.join(root, "node_modules", "vite", "bin", "vite.js"),
    "build",
    browserRoot,
    "--base",
    "./",
    "--outDir",
    browserDist,
    "--emptyOutDir",
  ],
  { cwd: fixtureRoot },
);

const { browser, page, baseUrl } = await createBrowserTest();
try {
  const relativeBrowserPath = path
    .relative(root, path.join(browserDist, "index.html"))
    .split(path.sep)
    .join("/");
  await page.goto(`${baseUrl.replace(/\/$/, "")}/${relativeBrowserPath}`);
  await page.waitForFunction(
    () => document.querySelector("#result")?.textContent !== "LOADING",
  );
  assert.equal(await page.locator("#result").textContent(), "CORE_BROWSER_OK");
} finally {
  await browser.close();
}

console.log(
  "core package API baseline, tarball, declarations, clean Node install, and browser bundle passed",
);
