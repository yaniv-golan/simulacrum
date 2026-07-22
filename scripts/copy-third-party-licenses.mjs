import fs from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, ".."),
  target = process.argv[2],
  configurations = Object.freeze({
    app: Object.freeze({
      output: path.join(root, "dist", "licenses"),
      packages: Object.freeze([
        ["@fontsource-variable/dm-sans", "LICENSE"],
        ["@fontsource-variable/space-grotesk", "LICENSE"],
        ["cannon-es", "LICENSE"],
        ["commander", "LICENSE"],
        ["three", "LICENSE"],
        ["topojson-client", "LICENSE"],
        ["typescript", "LICENSE.txt"],
        ["wabt", "LICENSE"],
        ["world-atlas", "LICENSE"],
      ]),
    }),
    core: Object.freeze({
      output: path.join(root, "packages", "core", "dist", "licenses"),
      packages: Object.freeze([
        ["cannon-es", "LICENSE"],
        ["three", "LICENSE"],
        ["typescript", "LICENSE.txt"],
        ["wabt", "LICENSE"],
      ]),
    }),
  }),
  configuration = configurations[target];

if (!configuration)
  throw new Error("license target must be either 'app' or 'core'");

await fs.rm(configuration.output, { recursive: true, force: true });
await fs.mkdir(configuration.output, { recursive: true });
await fs.copyFile(
  path.join(root, "THIRD_PARTY_NOTICES.md"),
  path.join(configuration.output, "THIRD_PARTY_NOTICES.md"),
);

for (const [packageName, licenseName] of configuration.packages) {
  const packageRoot = path.join(
      root,
      "node_modules",
      ...packageName.split("/"),
    ),
    source = path.join(packageRoot, licenseName),
    destination = path.join(
      configuration.output,
      `${packageName.replaceAll("/", "-").replace(/^@/, "")}-${licenseName}`,
    );
  await fs.copyFile(source, destination);
}

console.log(
  `${target} third-party licenses copied (${configuration.packages.length} packages)`,
);
