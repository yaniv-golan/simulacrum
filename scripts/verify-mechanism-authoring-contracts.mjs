import assert from "node:assert/strict";
import fs from "node:fs/promises";

const manifest = JSON.parse(
  await fs.readFile(
    new URL(
      "../test/fixtures/mechanism-physics/mechanism-contract-matrices.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

function exactIds(records, prefix, count, start = 1) {
  assert.deepEqual(
    records.map(({ id }) => id),
    Array.from({ length: count }, (_, index) => `${prefix}${index + start}`),
  );
  assert.equal(new Set(records.map(({ id }) => id)).size, records.length);
}

function nonempty(record, fields) {
  for (const field of fields) {
    const value = record[field];
    assert.ok(
      (Array.isArray(value) && value.length > 0) ||
        (typeof value === "string" && value.length > 0),
      `${record.id || record.kind}.${field} must be nonempty`,
    );
  }
}

assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.fixedStepS, 1 / 120);
assert.deepEqual(manifest.coordinateContract, {
  handedness: "right-handed",
  worldUp: "+Y",
  canonicalMechanicalAxis: "+Z",
  orientation: "unit-quaternion-local-to-parent",
  publicSamplePhase: "committed-tick-v1",
});

const expectedArtifacts = new Map([
  ["blueprint", ["simulacrum-blueprint", 1]],
  ["workspace", ["simulacrum-workspace", 1]],
  ["subassembly", ["simulacrum-subassembly", 1]],
  ["share-package", ["simulacrum-share-package", 1]],
  ["proof", ["simulacrum-proof", 1]],
  ["run-configuration", ["simulacrum-run-configuration", 1]],
  ["input-trace", ["simulacrum-input-trace", 1]],
  ["checkpoint", ["simulacrum-checkpoint", 1]],
  ["experiment", ["simulacrum-experiment", 1]],
  ["telemetry-playback", ["simulacrum-telemetry-playback", 1]],
]);
assert.equal(manifest.artifacts.length, expectedArtifacts.size);
for (const artifact of manifest.artifacts) {
  assert.deepEqual(
    [artifact.format, artifact.version],
    expectedArtifacts.get(artifact.kind),
    `wrong ${artifact.kind} wire identity`,
  );
}
assert.equal(
  manifest.artifacts.find(({ kind }) => kind === "telemetry-playback")
    .resumable,
  false,
);

exactIds(manifest.useCases, "U", 9);
for (const useCase of manifest.useCases) {
  nonempty(useCase, [
    "authoredData",
    "compiler",
    "runtimeConsumers",
    "telemetry",
    "persistenceShare",
    "challengeProof",
    "fixtures",
  ]);
}

exactIds(manifest.userTasks, "T", 14);
const commandIds = new Set();
for (const task of manifest.userTasks) {
  nonempty(task, [
    "commands",
    "pointerPath",
    "keyboardPath",
    "screenReaderPath",
    "textStateAssertions",
  ]);
  for (const command of task.commands) {
    assert.match(command, /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/);
    commandIds.add(command);
  }
}
assert.ok(commandIds.size >= 30, "user-task contract collapsed command scope");

exactIds(manifest.fixtures, "F", 17);
const fixtureIds = new Set(manifest.fixtures.map(({ id }) => id));
for (const fixture of manifest.fixtures)
  nonempty(fixture, [
    "environment",
    "inputs",
    "execution",
    "observations",
    "suite",
  ]);
for (const useCase of manifest.useCases)
  for (const fixture of useCase.fixtures)
    assert.ok(
      fixtureIds.has(fixture),
      `${useCase.id} names unknown ${fixture}`,
    );

assert.equal(manifest.contractGroups.length, 8);
for (const group of manifest.contractGroups)
  nonempty(group, ["promise", "owners", "tests", "exitGate"]);
for (const required of ["F1", "F4", "F11", "F15"])
  assert.ok(
    manifest.contractGroups
      .find(({ id }) => id === "solver-state")
      .tests.includes(required),
    `solver-state lost mandatory ${required}`,
  );

console.log(
  `mechanism contract matrices passed (${manifest.useCases.length} use cases, ${manifest.userTasks.length} user tasks, ${manifest.fixtures.length} fixtures, ${manifest.contractGroups.length} contract groups)`,
);
