// ONE aggregate script on purpose. `npm run a b c` runs only `a` and passes the
// rest as arguments -- verified: three scripts exiting 0, 17 and 23 combine to
// exit 0. Never split this into a multi-name npm invocation.
//
// A check that has not been written reports STUB and fails. It must never
// report ok: a green from a check that did not run is the defect this file's
// aggregation exists to prevent.
//
// Checks are OWNED BY A MILESTONE. Only those due at or before the target
// milestone run, so a gate never waits on a check above its own row.
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);

const implementations = {
  layers: null, // M0 deliverable
  "tick-order": null, // M1
  identity: null, // M2
};

export function runStructuralChecks(target = manifest.milestone) {
  const order = manifest.milestones;
  const cutoff = order.indexOf(target);
  if (cutoff < 0) throw new Error(`unknown milestone: ${target}`);

  const due = manifest.checks.filter(
    (check) => order.indexOf(check.dueAt) <= cutoff,
  );
  const deferred = manifest.checks.length - due.length;
  let failed = 0;

  for (const check of due) {
    const run = implementations[check.id];
    if (!run) {
      failed += 1;
      console.error(`STUB  gate:${check.id} -- not written; due ${check.dueAt}`);
      continue;
    }
    try {
      run();
      console.log(`ok    gate:${check.id}`);
    } catch (error) {
      failed += 1;
      console.error(`FAIL  gate:${check.id}: ${error.message}`);
    }
  }

  for (const check of manifest.checks.filter((c) => !due.includes(c))) {
    console.log(`--    gate:${check.id} deferred to ${check.dueAt}`);
  }

  return { failed, ran: due.length, deferred };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2] ?? manifest.milestone;
  const { failed, ran } = runStructuralChecks(target);
  if (failed > 0) {
    console.error(`\n${failed} of ${ran} structural check(s) not green at ${target}.`);
    process.exit(1);
  }
  console.log(`\nstructural gate green at ${target} (${ran} check(s)).`);
}
