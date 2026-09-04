// The gate refuses when the checks IT OWNS are red. Bars above the current
// milestone are deliberately red and are never waited on.
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);
const target = process.argv[2] ?? manifest.milestone;

if (!manifest.milestones.includes(target)) {
  console.error(`unknown milestone: ${target}`);
  process.exit(2);
}
if (target !== manifest.milestone) {
  console.error(
    `current milestone is ${manifest.milestone}; refusing to gate ${target}`,
  );
  process.exit(1);
}

console.log(`milestone ${target} (owned by scripts/manifest.json)`);
console.log("gate:structural  -> run `npm run gate:structural`");
console.log(
  `bars: ${Object.keys(manifest.bars).join(", ")} -- all red until their milestone`,
);
console.log("\nM0 stop rule: structural gate green; all eight bars red-and-named.");
