// ONE aggregate script on purpose. `npm run a b c` runs only `a` and passes the
// rest as arguments -- verified: three scripts exiting 0, 17 and 23 combine to
// exit 0. Never split this into a multi-name npm invocation.
//
// A check that has not been written reports STUB and fails. It must never
// report ok: a green from a check that did not run is the exact defect this
// file's aggregation exists to prevent.
const checks = [
  { name: "layers", milestone: "M0", run: null },
  { name: "tick-order", milestone: "M1", run: null },
  { name: "identity", milestone: "M2", run: null },
];

let failed = 0;
for (const check of checks) {
  if (!check.run) {
    failed += 1;
    console.error(`STUB  gate:${check.name} -- not written; due ${check.milestone}`);
    continue;
  }
  try {
    check.run();
    console.log(`ok    gate:${check.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  gate:${check.name}: ${error.message}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} structural check(s) not green.`);
  process.exit(1);
}
console.log("\nstructural gate green.");
