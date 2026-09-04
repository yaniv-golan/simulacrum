// The milestone gate EXECUTES the checks it owns and propagates their failure.
// It never prints an instruction to run something else and then exits zero:
// that is a false green, and it is the defect this project's own notes warn
// about most often.
//
// Bars above the current milestone are deliberately red and are never waited on.
import { readFileSync } from "node:fs";
import { runStructuralChecks } from "./gate-structural.mjs";
import { evaluateBar } from "./bars.mjs";

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

// Bars due at or before the target are GATED. A milestone gate that ignores its
// own bars can declare locomotion complete without running locomotion.
const order = manifest.milestones;
const cutoff = order.indexOf(target);
const dueBars = Object.entries(manifest.bars).filter(
  ([, bar]) => order.indexOf(bar.dueAt) <= cutoff,
);

let redBars = 0;
for (const [id, bar] of dueBars) {
  const { state, why } = evaluateBar(id);
  if (state === "RED") redBars += 1;
  console.log(`${state.padEnd(5)} bar:${id.padEnd(4)} due ${bar.dueAt} -- ${why}`);
}
for (const [id, bar] of Object.entries(manifest.bars)) {
  if (!dueBars.some(([dueId]) => dueId === id))
    console.log(`--    bar:${id.padEnd(4)} deferred to ${bar.dueAt}`);
}

if (failed > 0 || redBars > 0) {
  console.error(
    `\nREFUSED at ${target}: ${failed} of ${ran} structural check(s) not green; ` +
      `${redBars} of ${dueBars.length} due bar(s) red.`,
  );
  process.exit(1);
}
console.log(`\n${target} gate green.`);
