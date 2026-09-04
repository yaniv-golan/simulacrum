// The milestone gate EXECUTES the checks it owns and propagates their failure.
// It never prints an instruction to run something else and then exits zero:
// that is a false green, and it is the defect this project's own notes warn
// about most often.
//
// Bars above the current milestone are deliberately red and are never waited on.
import { readFileSync } from "node:fs";
import { runStructuralChecks } from "./gate-structural.mjs";

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

console.log(`milestone ${target} (owned by scripts/manifest.json)\n`);
const { failed, ran } = runStructuralChecks(target);

console.log(
  `\nbars: ${Object.keys(manifest.bars).join(", ")} -- red until their milestone, never gated here`,
);

if (failed > 0) {
  console.error(
    `\nREFUSED: ${failed} of ${ran} structural check(s) not green at ${target}.`,
  );
  process.exit(1);
}
console.log(`\n${target} gate green.`);
