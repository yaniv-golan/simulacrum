// The milestone gate EXECUTES what it owns and propagates failure. It never
// prints an instruction and exits zero.
//
// Structural checks, bars and exit obligations are ALL CUMULATIVE: a later gate
// re-checks everything due at or before it. Obligations previously read only
// `[target]`, so an M1 gate passed with an unmet M0 obligation.
import { readFileSync } from "node:fs";
import { runStructuralChecks } from "./gate-structural.mjs";
import { evaluateBar } from "./bars.mjs";
import { CHECKS } from "./checks.mjs";
import { execFileSync } from "node:child_process";

function runCheckInSubprocess(checkId, timeoutMs) {
  execFileSync(
    process.execPath,
    ["--input-type=module", "-e",
     `import {CHECKS} from ${JSON.stringify(new URL("./checks.mjs", import.meta.url).href)};` +
     `await CHECKS[${JSON.stringify(checkId)}]();`],
    { timeout: timeoutMs, killSignal: "SIGKILL", stdio: "pipe" },
  );
}

const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);
const target = process.argv[2] ?? manifest.milestone;
const OBLIGATION_TIMEOUT_MS = 120_000;

if (!manifest.milestones.includes(target)) {
  console.error(`unknown milestone: ${target}`);
  process.exit(2);
}
if (target !== manifest.milestone) {
  console.error(`current milestone is ${manifest.milestone}; refusing to gate ${target}`);
  process.exit(1);
}

const order = manifest.milestones;
const cutoff = order.indexOf(target);
const dueAt = (m) => order.indexOf(m) <= cutoff;

console.log(`milestone ${target} (owned by scripts/manifest.json)\n`);
const { failed, ran } = await runStructuralChecks(target);

let redBars = 0;
let dueBarCount = 0;
for (const [id, bar] of Object.entries(manifest.bars)) {
  if (!dueAt(bar.dueAt)) {
    console.log(`--    bar:${id.padEnd(4)} deferred to ${bar.dueAt}`);
    continue;
  }
  dueBarCount += 1;
  const { state, why } = evaluateBar(id);
  if (state === "RED") redBars += 1;
  console.log(`${state.padEnd(5)} bar:${id.padEnd(4)} due ${bar.dueAt} -- ${why}`);
}

// Every obligation due at or before the target, not only this milestone's.
let unmet = 0;
let obligationCount = 0;
for (const milestone of order.filter(dueAt)) {
  const obligations = manifest.exitObligations?.[milestone];
  if (obligations === undefined) {
    unmet += 1;
    console.error(`UNREG  ${milestone} declares no exit obligations -- register them`);
    continue;
  }
  for (const ob of obligations) {
    obligationCount += 1;
    if (!ob.check) {
      unmet += 1;
      console.error(`UNMET  ${ob.id} (${milestone}) -- no check registered: ${ob.how}`);
      continue;
    }
    const fn = CHECKS[ob.check];
    if (typeof fn !== "function") {
      unmet += 1;
      console.error(`BADREF ${ob.id} (${milestone}) -- check "${ob.check}" is not in the registry`);
      continue;
    }
    try {
      // Deadlines are enforced EXTERNALLY, in a child process. Promise.race
      // shares an event loop with the check, so a synchronous loop simply
      // prevents the timer firing: an 80 ms blocking check passed a 10 ms
      // deadline. Only a separate process can be killed.
      await runCheckInSubprocess(ob.check, OBLIGATION_TIMEOUT_MS);
      console.log(`ok     ${ob.id} (${milestone})`);
    } catch (error) {
      unmet += 1;
      console.error(`FAIL   ${ob.id} (${milestone}): ${error.message}`);
    }
  }
}

if (failed > 0 || redBars > 0 || unmet > 0) {
  console.error(
    `\nREFUSED at ${target}: ${failed} of ${ran} structural check(s) not green; ` +
      `${redBars} of ${dueBarCount} due bar(s) red; ${unmet} of ${obligationCount} obligation(s) unmet.`,
  );
  process.exit(1);
}
console.log(`\n${target} gate green.`);
