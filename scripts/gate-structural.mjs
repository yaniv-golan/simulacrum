// ONE aggregate script on purpose. `npm run a b c` runs only `a` and passes the
// rest as arguments -- verified: scripts exiting 0, 17 and 23 combine to exit 0.
//
// Checks are OWNED BY A MILESTONE and may be async. Awaiting matters: a check
// that returned an unresolved promise previously printed green and exited 0.
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);

const TIMEOUT_MS = 60_000;

const implementations = {
  layers: null, // M0 deliverable
  "tick-order": null, // M1
  identity: null, // M2
};

async function withTimeout(name, fn) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
  });
  try {
    await Promise.race([Promise.resolve().then(fn), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function runStructuralChecks(target = manifest.milestone) {
  const order = manifest.milestones;
  const cutoff = order.indexOf(target);
  if (cutoff < 0) throw new Error(`unknown milestone: ${target}`);

  const due = manifest.checks.filter((check) => order.indexOf(check.dueAt) <= cutoff);
  let failed = 0;

  for (const check of due) {
    const run = implementations[check.id];
    if (!run) {
      failed += 1;
      console.error(`STUB  gate:${check.id} -- not written; due ${check.dueAt}`);
      continue;
    }
    try {
      await withTimeout(check.id, run);
      console.log(`ok    gate:${check.id}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL  gate:${check.id}: ${error.message}`);
    }
  }
  for (const check of manifest.checks.filter((c) => !due.includes(c)))
    console.log(`--    gate:${check.id} deferred to ${check.dueAt}`);

  return { failed, ran: due.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] ?? manifest.milestone;
  const { failed, ran } = await runStructuralChecks(target);
  if (failed > 0) {
    console.error(`\n${failed} of ${ran} structural check(s) not green at ${target}.`);
    process.exit(1);
  }
  console.log(`\nstructural gate green at ${target} (${ran} check(s)).`);
}
