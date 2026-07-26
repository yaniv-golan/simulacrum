import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { DRONE_TS_SOURCE } from "../src/application/content.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { sha256Hex } from "../src/model/sha256.js";
import { stableStringify } from "../src/model/primitives.js";

const contract = JSON.parse(
  await fs.readFile(
    new URL(
      "../test/fixtures/flight/electric-multirotor-qualification-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
assert.deepEqual(
  Object.keys(contract).sort(),
  [
    "blueprintFingerprint",
    "dynamometer",
    "failureReasons",
    "fixedStepS",
    "format",
    "identities",
    "mission",
    "samplingCadenceTicks",
    "timeoutMs",
    "tolerances",
    "version",
  ].sort(),
);
assert.equal(contract.format, "simulacrum-electric-multirotor-qualification");
assert.equal(contract.version, 1);
assert.equal(contract.fixedStepS, 1 / 120);
assert.equal(contract.dynamometer.maximumSpinupTicks, 600);
assert.equal(contract.dynamometer.qualifyingTicks, 36_000);
assert.equal(contract.mission.totalTicks, 43_200);
assert.equal(contract.mission.continuousAirborneTicks, 36_000);
assert.equal(contract.mission.minimumBatteryReserveRatioAtAirborneLimit, 0.15);
for (const [name, band] of Object.entries(contract.dynamometer.bands)) {
  assert.ok(Number.isFinite(band.minimum), `${name}.minimum`);
  assert.ok(Number.isFinite(band.maximum), `${name}.maximum`);
  assert.ok(band.minimum <= band.maximum, name);
}
for (const value of Object.values(contract.tolerances))
  assert.ok(Number.isFinite(value) && value > 0);
const blueprint = builtInDemo("drone", {
    droneTypescript: DRONE_TS_SOURCE,
  }).blueprint,
  fingerprint = `sim-sha256-${sha256Hex(stableStringify(blueprint))}`;
assert.equal(contract.blueprintFingerprint, fingerprint);
assert.equal(
  contract.identities.solverTransaction,
  "simulacrum-owned-cannon-solver-transaction-v2-motor-energy",
);
console.log("electric multirotor qualification contract passed");
