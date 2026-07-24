import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { assert } from "./lib/assert.mjs";
import {
  selectVerificationChecks,
  shardVerificationChecks,
} from "./lib/test-selection.mjs";
import {
  assertTestServer,
  readServerMarker,
  startTestServer,
  terminateProcessTree,
} from "./lib/test-server.mjs";
import { runVerificationSuite } from "./lib/verification-runner.mjs";
import {
  NON_SUITE_VERIFICATION_FILES,
  VERIFICATION_CHECKS,
  VERIFICATION_TIMEOUT_MS,
} from "./test-registry.mjs";

const root = path.resolve(import.meta.dirname, "..");
const scriptsDir = path.join(root, "scripts");

assert.deepEqual(selectVerificationChecks(VERIFICATION_CHECKS, ""), [
  ...VERIFICATION_CHECKS,
]);
assert.deepEqual(Object.keys(VERIFICATION_TIMEOUT_MS), [
  "verify-blueprint-exchange.mjs",
  "verify-editor-tools.mjs",
  "verify-testing-playground-browser.mjs",
  "verify-ui-baseline-fixtures.mjs",
]);
assert.ok(
  Object.entries(VERIFICATION_TIMEOUT_MS).every(
    ([check, timeoutMs]) =>
      VERIFICATION_CHECKS.includes(check) &&
      Number.isSafeInteger(timeoutMs) &&
      timeoutMs > 0,
  ),
  "verification timeout exceptions must name registered, bounded suites",
);
assert.deepEqual(
  selectVerificationChecks(
    VERIFICATION_CHECKS,
    "verify-core-model, verify-test-harness.mjs,verify-core-model",
  ),
  ["verify-test-harness.mjs", "verify-core-model.mjs"],
);
assert.throws(
  () => selectVerificationChecks(VERIFICATION_CHECKS, "missing-suite"),
  /unknown verification suite: missing-suite\.mjs/,
);
assert.throws(
  () =>
    selectVerificationChecks(
      VERIFICATION_CHECKS,
      "verify-core-model,missing-a.mjs,missing-b",
    ),
  /unknown verification suites: missing-a\.mjs, missing-b\.mjs/,
);
assert.deepEqual(shardVerificationChecks(["a", "b", "c", "d", "e"], 0, 2), [
  "a",
  "c",
  "e",
]);
assert.deepEqual(shardVerificationChecks(["a", "b", "c", "d", "e"], "1", "2"), [
  "b",
  "d",
]);
assert.deepEqual(shardVerificationChecks(["a", "b"], null, null), ["a", "b"]);
assert.throws(
  () => shardVerificationChecks(["a"], 0, 0),
  /TEST_SHARD_COUNT must be a positive integer/,
);
assert.throws(
  () => shardVerificationChecks(["a"], 2, 2),
  /TEST_SHARD_INDEX must be an integer/,
);

const verificationFiles = (await fs.readdir(scriptsDir))
  .filter((file) => /^verify-.+\.mjs$/.test(file))
  .sort();
const classifiedVerificationFiles = [
  ...VERIFICATION_CHECKS,
  ...NON_SUITE_VERIFICATION_FILES,
].sort();
assert.deepEqual(
  classifiedVerificationFiles,
  verificationFiles,
  "every verify-*.mjs file must be registered as a suite or intentional non-suite",
);
assert.equal(
  new Set(classifiedVerificationFiles).size,
  classifiedVerificationFiles.length,
  "verification files cannot be classified more than once",
);

const parentUrl = process.env.TEST_BASE_URL;
const parentMarker = process.env.TEST_BUILD_MARKER;
await assertTestServer(parentUrl, parentMarker);
await assert.rejects(assertTestServer(null, null), /require TEST_BASE_URL/);
await terminateProcessTree(null);
await terminateProcessTree({ exitCode: 0, signalCode: null });
await terminateProcessTree({
  pid: 999_999_999,
  exitCode: null,
  signalCode: null,
});

const failingHttpServer = http.createServer((_request, response) => {
  response.statusCode = 503;
  response.end("unavailable");
});
await new Promise((resolve) =>
  failingHttpServer.listen(0, "127.0.0.1", resolve),
);
const failingAddress = failingHttpServer.address();
assert.ok(failingAddress && typeof failingAddress !== "string");
await assert.rejects(
  readServerMarker(`http://127.0.0.1:${failingAddress.port}/`),
  /failed with 503/,
);
await new Promise((resolve) => failingHttpServer.close(resolve));

const isolated = await startTestServer({ root });
try {
  assert.notEqual(
    isolated.baseUrl,
    parentUrl,
    "an independent run reused the active test port",
  );
  await assertTestServer(isolated.baseUrl, isolated.marker);
  await assert.rejects(
    assertTestServer(isolated.baseUrl, `${isolated.marker}-stale`),
    /refusing mismatched test server/,
  );
} finally {
  await isolated.stop();
}
await isolated.stop();

const alternateRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "simulacrum-alternate-root-"),
);
await fs.writeFile(
  path.join(alternateRoot, "package.json"),
  JSON.stringify({
    scripts: {
      dev: path.join(root, "node_modules", ".bin", "vite"),
      preview: `${path.join(root, "node_modules", ".bin", "vite")} preview`,
    },
  }),
);
await fs.writeFile(
  path.join(alternateRoot, "index.html"),
  "<!doctype html><title>alternate checkout marker</title>",
);
const alternate = await startTestServer({
  root: alternateRoot,
  viteConfigPath: path.join(root, "vite.config.js"),
});
try {
  assert.match(
    await (await fetch(alternate.baseUrl)).text(),
    /alternate checkout marker/,
  );
} finally {
  await alternate.stop();
}
await fs.mkdir(path.join(alternateRoot, "dist"));
await fs.writeFile(
  path.join(alternateRoot, "dist", "index.html"),
  "<!doctype html><title>alternate preview marker</title>",
);
const preview = await startTestServer({
  root: alternateRoot,
  viteConfigPath: path.join(root, "vite.config.js"),
  mode: "preview",
});
try {
  assert.match(
    await (await fetch(preview.baseUrl)).text(),
    /alternate preview marker/,
  );
} finally {
  await preview.stop();
  await fs.rm(alternateRoot, { recursive: true, force: true });
}

const timeoutFixture = path.join(
  root,
  "artifacts",
  "test-harness",
  "never-finishes.mjs",
);
await fs.mkdir(path.dirname(timeoutFixture), { recursive: true });
await fs.writeFile(timeoutFixture, "setInterval(() => {}, 1000);\n");
await assert.rejects(
  runVerificationSuite({
    file: timeoutFixture,
    root,
    server: { baseUrl: parentUrl, marker: parentMarker },
    artifactsDir: path.dirname(timeoutFixture),
    timeoutMs: 100,
  }),
  /timed out after 100 ms/,
  "a hung verification suite escaped its deadline",
);

const failedFixture = path.join(root, "artifacts", "test-harness", "fails.mjs");
await fs.writeFile(
  failedFixture,
  "console.error('expected failure'); process.exit(7);\n",
);
await assert.rejects(
  runVerificationSuite({
    file: failedFixture,
    root,
    server: { baseUrl: parentUrl, marker: parentMarker },
    artifactsDir: path.dirname(failedFixture),
    timeoutMs: 5_000,
  }),
  /failed with 7/,
);
const signaledFixture = path.join(
  root,
  "artifacts",
  "test-harness",
  "signals.mjs",
);
await fs.writeFile(signaledFixture, "process.kill(process.pid, 'SIGTERM');\n");
await assert.rejects(
  runVerificationSuite({
    file: signaledFixture,
    root,
    server: { baseUrl: parentUrl, marker: parentMarker },
    artifactsDir: path.dirname(signaledFixture),
    timeoutMs: 5_000,
  }),
  /failed with SIGTERM/,
);

await assert.rejects(
  startTestServer({ root: "", startupTimeoutMs: 10 }),
  /absolute root/,
);
const invalidRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "simulacrum-invalid-root-"),
);
await assert.rejects(
  startTestServer({ root: invalidRoot, startupTimeoutMs: 1_000 }),
  /Vite exited before becoming ready|did not expose/,
);
await fs.rm(invalidRoot, { recursive: true, force: true });
const lingeringRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "simulacrum-lingering-root-"),
);
await fs.writeFile(
  path.join(lingeringRoot, "package.json"),
  JSON.stringify({ scripts: { dev: "node linger.mjs" } }),
);
await fs.writeFile(
  path.join(lingeringRoot, "linger.mjs"),
  "setInterval(() => {}, 1000);\n",
);
await assert.rejects(
  startTestServer({ root: lingeringRoot, startupTimeoutMs: 250 }),
  /did not expose/,
);
await fs.rm(lingeringRoot, { recursive: true, force: true });

console.log(
  "isolated test harness passed (ephemeral port, marker rejection, forced timeout)",
);
