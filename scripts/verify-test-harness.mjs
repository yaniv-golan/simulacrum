import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { assert } from "./lib/assert.mjs";
import { selectFocusedVerificationChecks } from "./lib/focused-test-selection.mjs";
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
import { runTestCoordinator } from "./lib/test-coordinator.mjs";
import { runVerificationSuite } from "./lib/verification-runner.mjs";
import {
  captureWorkspaceIdentity,
  sameWorkspaceIdentity,
} from "./lib/workspace-identity.mjs";
import {
  nodeSatisfiesComponentInspectionReleaseRange,
  validateComponentInspectionLiveWorkspace,
} from "./lib/component-inspection-live-workspace.mjs";
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
  "verify-five-demos.mjs",
  "verify-mechanism-sharing-proof.mjs",
  "verify-blueprint-roundtrip.mjs",
  "verify-blueprint-exchange.mjs",
  "verify-editor-tools.mjs",
  "verify-transform-gizmo-lifecycle-browser.mjs",
  "verify-failure-analysis.mjs",
  "verify-testing-playground-browser.mjs",
  "verify-ui-baseline-fixtures.mjs",
  "verify-component-authored-carriers-browser.mjs",
  "verify-keyboard-workflows.mjs",
  "verify-keyboard-authoring-journey.mjs",
  "verify-rover-drop.mjs",
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
assert.deepEqual(
  selectFocusedVerificationChecks(
    VERIFICATION_CHECKS,
    ["verify-core-model", "verify-test-harness.mjs", "verify-core-model"],
    {},
  ),
  ["verify-test-harness.mjs", "verify-core-model.mjs"],
);
assert.throws(
  () => selectFocusedVerificationChecks(VERIFICATION_CHECKS, [], {}),
  /requires at least one verification suite/,
);
assert.throws(
  () => selectFocusedVerificationChecks(VERIFICATION_CHECKS, [""], {}),
  /refuses empty verification suite names/,
);
assert.throws(
  () =>
    selectFocusedVerificationChecks(
      VERIFICATION_CHECKS,
      ["verify-core-model,verify-test-harness"],
      {},
    ),
  /not comma-packed values/,
);
assert.throws(
  () =>
    selectFocusedVerificationChecks(
      VERIFICATION_CHECKS,
      ["verify-core-model"],
      { TEST_FILTER: "" },
    ),
  /refuses inherited TEST_FILTER/,
);
for (const shardVariable of ["TEST_SHARD_INDEX", "TEST_SHARD_COUNT"])
  assert.throws(
    () =>
      selectFocusedVerificationChecks(
        VERIFICATION_CHECKS,
        ["verify-core-model"],
        { [shardVariable]: "" },
      ),
    new RegExp(`refuses inherited ${shardVariable}`),
  );
assert.throws(
  () =>
    selectFocusedVerificationChecks(
      VERIFICATION_CHECKS,
      ["missing-focused-suite"],
      {},
    ),
  /unknown verification suite: missing-focused-suite\.mjs/,
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
const predevSentinel = path.join(alternateRoot, "predev-ran.txt");
await fs.writeFile(
  path.join(alternateRoot, "package.json"),
  JSON.stringify({
    scripts: {
      predev: "node predev.mjs",
      dev: path.join(root, "node_modules", ".bin", "vite"),
      preview: `${path.join(root, "node_modules", ".bin", "vite")} preview`,
    },
  }),
);
await fs.writeFile(
  path.join(alternateRoot, "predev.mjs"),
  `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(predevSentinel)}, "ran");\n`,
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
assert.equal(await fs.readFile(predevSentinel, "utf8"), "ran");
await fs.rm(predevSentinel);
const focusedAlternate = await startTestServer({
  root: alternateRoot,
  viteConfigPath: path.join(root, "vite.config.js"),
  skipLifecycleHooks: true,
});
try {
  assert.match(
    await (await fetch(focusedAlternate.baseUrl)).text(),
    /alternate checkout marker/,
  );
  await assert.rejects(
    fs.access(predevSentinel),
    /ENOENT/,
    "focused test server executed predev",
  );
} finally {
  await focusedAlternate.stop();
}
for (const reason of [
  new Error("startup abort error"),
  "plain startup abort",
]) {
  const startupAbort = new AbortController();
  startupAbort.abort(reason);
  await assert.rejects(
    startTestServer({
      root: alternateRoot,
      viteConfigPath: path.join(root, "vite.config.js"),
      skipLifecycleHooks: true,
      signal: startupAbort.signal,
    }),
    reason instanceof Error
      ? /startup abort error/
      : /test server startup aborted/,
  );
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
const resistantFixture = path.join(
  root,
  "artifacts",
  "test-harness",
  "resists-sigterm.mjs",
);
await fs.writeFile(
  resistantFixture,
  "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);\n",
);
const resistantStartedAt = performance.now();
await assert.rejects(
  runVerificationSuite({
    file: resistantFixture,
    root,
    server: { baseUrl: parentUrl, marker: parentMarker },
    artifactsDir: path.dirname(resistantFixture),
    timeoutMs: 100,
    terminationGraceMs: 50,
  }),
  /timed out after 100 ms/,
  "a SIGTERM-resistant suite escaped SIGKILL escalation",
);
assert.ok(
  performance.now() - resistantStartedAt < 2_000,
  "SIGTERM-resistant suite termination was not bounded",
);

const abortedFixture = path.join(
  root,
  "artifacts",
  "test-harness",
  "aborted-suite.mjs",
);
await fs.writeFile(abortedFixture, "setInterval(() => {}, 1000);\n");
const suiteAbort = new AbortController(),
  expectedAbort = new Error("expected aggregate cancellation");
setTimeout(() => suiteAbort.abort(expectedAbort), 50);
await assert.rejects(
  runVerificationSuite({
    file: abortedFixture,
    root,
    server: { baseUrl: parentUrl, marker: parentMarker },
    artifactsDir: path.dirname(abortedFixture),
    timeoutMs: 5_000,
    terminationGraceMs: 50,
    signal: suiteAbort.signal,
  }),
  /expected aggregate cancellation/,
);
const alreadyAborted = new AbortController();
alreadyAborted.abort(new Error("aborted before spawn"));
await assert.rejects(
  runVerificationSuite({
    file: abortedFixture,
    root,
    server: { baseUrl: parentUrl, marker: parentMarker },
    artifactsDir: path.dirname(abortedFixture),
    timeoutMs: 5_000,
    signal: alreadyAborted.signal,
  }),
  /aborted before spawn/,
);
const nonErrorAbort = new AbortController();
nonErrorAbort.abort("plain abort reason");
await assert.rejects(
  runVerificationSuite({
    file: abortedFixture,
    root,
    server: { baseUrl: parentUrl, marker: parentMarker },
    artifactsDir: path.dirname(abortedFixture),
    timeoutMs: 5_000,
    signal: nonErrorAbort.signal,
  }),
  /verification suite aborted/,
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

const workspaceIdentity = await captureWorkspaceIdentity(root);
assert.equal(workspaceIdentity.head.length, 40);
assert.equal(workspaceIdentity.workspaceSha256.length, 64);
assert.equal(sameWorkspaceIdentity(workspaceIdentity, workspaceIdentity), true);
assert.equal(
  sameWorkspaceIdentity(workspaceIdentity, {
    ...workspaceIdentity,
    workspaceSha256: "0".repeat(64),
  }),
  false,
);
assert.equal(sameWorkspaceIdentity(null, workspaceIdentity), false);
assert.equal(
  sameWorkspaceIdentity(workspaceIdentity, {
    ...workspaceIdentity,
    head: "0".repeat(40),
  }),
  false,
);

const cleanCandidate = "1".repeat(40),
  liveGit =
    (overrides = {}) =>
    (args) => {
      const key = args.join(" ");
      return (
        overrides[key] ??
        {
          "rev-parse HEAD": cleanCandidate,
          "status --porcelain=v1 --untracked-files=all": "",
          "worktree list --porcelain": "worktree /fixture/worktree\n",
        }[key]
      );
    },
  liveOptions = {
    profile: "foundation",
    candidate: cleanCandidate,
    root: "/fixture/worktree",
    nodeVersion: "v24.18.0",
    realpath: (value) => value,
  };
assert.equal(nodeSatisfiesComponentInspectionReleaseRange("v24.18.0"), true);
assert.equal(nodeSatisfiesComponentInspectionReleaseRange("v25.0.0"), false);
assert.equal(
  validateComponentInspectionLiveWorkspace({
    ...liveOptions,
    git: liveGit(),
  }).authoritative,
  true,
);
assert.equal(
  validateComponentInspectionLiveWorkspace({
    ...liveOptions,
    profile: "routes",
    git: liveGit(),
  }).authoritative,
  true,
);
assert.throws(
  () =>
    validateComponentInspectionLiveWorkspace({
      ...liveOptions,
      profile: "observation",
      git: liveGit(),
    }),
  /foundation\|routes/,
);
assert.throws(
  () =>
    validateComponentInspectionLiveWorkspace({
      ...liveOptions,
      candidate: "short",
      git: liveGit(),
    }),
  /40-hex commit/,
);
assert.throws(
  () =>
    validateComponentInspectionLiveWorkspace({
      ...liveOptions,
      git: liveGit({ "rev-parse HEAD": "2".repeat(40) }),
    }),
  /does not match/,
);
assert.throws(
  () =>
    validateComponentInspectionLiveWorkspace({
      ...liveOptions,
      git: liveGit({
        "status --porcelain=v1 --untracked-files=all": " M source.js",
      }),
    }),
  /clean worktree/,
);
assert.throws(
  () =>
    validateComponentInspectionLiveWorkspace({
      ...liveOptions,
      git: liveGit({ "worktree list --porcelain": "worktree /elsewhere\n" }),
    }),
  /registered Git worktree/,
);
assert.throws(
  () =>
    validateComponentInspectionLiveWorkspace({
      ...liveOptions,
      nodeVersion: "v25.2.1",
      git: liveGit(),
    }),
  /Node >=24\.18 <25/,
);
assert.deepEqual(
  validateComponentInspectionLiveWorkspace({
    ...liveOptions,
    candidate: null,
    allowDirty: true,
    nodeVersion: "v25.2.1",
    git: liveGit({
      "rev-parse HEAD": "2".repeat(40),
      "status --porcelain=v1 --untracked-files=all": " M source.js",
    }),
  }),
  {
    authoritative: false,
    candidate: null,
    head: "2".repeat(40),
  },
);

const coordinatorArtifacts = await fs.mkdtemp(
    path.join(os.tmpdir(), "simulacrum-test-coordinator-"),
  ),
  syntheticIdentity = Object.freeze({
    head: "1".repeat(40),
    dirty: false,
    workspaceSha256: "2".repeat(64),
    excludes: Object.freeze([]),
  }),
  coordinatorEvents = [];
const syntheticStartServer = async (options) => {
    coordinatorEvents.push({ event: "start", options });
    return {
      baseUrl: "http://127.0.0.1:1/",
      marker: "synthetic",
      async stop() {
        coordinatorEvents.push({ event: "stop" });
      },
    };
  },
  syntheticCaptureIdentity = async () => syntheticIdentity;
const passedCoordinator = await runTestCoordinator({
  root,
  artifactsDir: coordinatorArtifacts,
  selectedChecks: ["alpha.mjs", "beta.mjs"],
  requestedChecks: ["beta", "alpha"],
  mode: "focused",
  selection: {
    environment: {
      TEST_FILTER: "alpha,beta",
      UI_FIXTURE_FILTER: "f4-rover-operate",
    },
  },
  suiteTimeoutMs: 100,
  aggregateTimeoutMs: 2_000,
  skipLifecycleHooks: true,
  dependencies: {
    startServer: syntheticStartServer,
    captureIdentity: syntheticCaptureIdentity,
    runSuite: async ({ file }) => ({
      suite: path.basename(file, ".mjs"),
      status: "passed",
      elapsedMs: file.includes("beta") ? 2 : 1,
    }),
  },
});
assert.equal(passedCoordinator.report.status, "passed");
assert.equal(passedCoordinator.report.workspace.changedDuringRun, false);
assert.deepEqual(passedCoordinator.report.selection, {
  environment: {
    TEST_FILTER: "alpha,beta",
    UI_FIXTURE_FILTER: "f4-rover-operate",
  },
});
assert.deepEqual(
  passedCoordinator.report.slowestCompletedSuites.map(({ suite }) => suite),
  ["beta", "alpha"],
);
assert.equal(
  coordinatorEvents[0].options.skipLifecycleHooks,
  true,
  "focused coordinator did not scope lifecycle suppression to its server",
);
assert.equal(coordinatorEvents.at(-1).event, "stop");
assert.deepEqual(
  JSON.parse(
    await fs.readFile(
      path.join(coordinatorArtifacts, "timing-latest.json"),
      "utf8",
    ),
  ).selectedChecks,
  ["alpha.mjs", "beta.mjs"],
);

let failedTimingReport = null;
const expectedSuiteFailure = new Error("synthetic suite failure");
expectedSuiteFailure.verificationTiming = {
  suite: "fails",
  status: "failed",
  elapsedMs: 3,
};
await assert.rejects(
  runTestCoordinator({
    root,
    artifactsDir: coordinatorArtifacts,
    selectedChecks: ["fails.mjs"],
    aggregateTimeoutMs: 2_000,
    dependencies: {
      startServer: syntheticStartServer,
      captureIdentity: syntheticCaptureIdentity,
      runSuite: async () => {
        throw expectedSuiteFailure;
      },
      writeReport: async (report) => {
        failedTimingReport = structuredClone(report);
        return "/synthetic/failure-timing.json";
      },
    },
  }),
  /synthetic suite failure/,
);
assert.equal(failedTimingReport.status, "failed");
assert.equal(failedTimingReport.failure.suite, "fails");
assert.equal(failedTimingReport.suites[0].elapsedMs, 3);

let aggregateTimingReport = null;
await assert.rejects(
  runTestCoordinator({
    root,
    artifactsDir: coordinatorArtifacts,
    selectedChecks: ["aggregate.mjs"],
    aggregateTimeoutMs: 25,
    dependencies: {
      startServer: syntheticStartServer,
      captureIdentity: syntheticCaptureIdentity,
      runSuite: ({ signal }) =>
        new Promise((_, reject) => {
          const abort = () => {
            const error = signal.reason;
            error.verificationTiming = {
              suite: "aggregate",
              status: "aborted",
              elapsedMs: 25,
            };
            reject(error);
          };
          if (signal.aborted) abort();
          else signal.addEventListener("abort", abort, { once: true });
        }),
      writeReport: async (report) => {
        aggregateTimingReport = structuredClone(report);
        return "/synthetic/aggregate-timing.json";
      },
    },
  }),
  /test run exceeded 25 ms/,
);
assert.equal(aggregateTimingReport.status, "timed-out");
assert.equal(aggregateTimingReport.suites[0].status, "aborted");

let startupTimingReport = null;
await assert.rejects(
  runTestCoordinator({
    root,
    artifactsDir: coordinatorArtifacts,
    selectedChecks: ["never-started.mjs"],
    aggregateTimeoutMs: 2_000,
    dependencies: {
      captureIdentity: syntheticCaptureIdentity,
      startServer: async () => {
        throw new Error("synthetic startup failure");
      },
      writeReport: async (report) => {
        startupTimingReport = structuredClone(report);
        return "/synthetic/startup-timing.json";
      },
    },
  }),
  /synthetic startup failure/,
);
assert.equal(startupTimingReport.failure.phase, "startup");

let cleanupTimingReport = null;
await assert.rejects(
  runTestCoordinator({
    root,
    artifactsDir: coordinatorArtifacts,
    selectedChecks: [],
    aggregateTimeoutMs: 2_000,
    dependencies: {
      captureIdentity: syntheticCaptureIdentity,
      startServer: async () => ({
        async stop() {
          throw new Error("synthetic cleanup failure");
        },
      }),
      writeReport: async (report) => {
        cleanupTimingReport = structuredClone(report);
        return "/synthetic/cleanup-timing.json";
      },
    },
  }),
  /synthetic cleanup failure/,
);
assert.equal(cleanupTimingReport.failure.phase, "cleanup");

let identityCaptureCount = 0,
  identityFailureReport = null;
await assert.rejects(
  runTestCoordinator({
    root,
    artifactsDir: coordinatorArtifacts,
    selectedChecks: [],
    aggregateTimeoutMs: 2_000,
    dependencies: {
      startServer: syntheticStartServer,
      captureIdentity: async () => {
        identityCaptureCount++;
        if (identityCaptureCount > 1)
          throw new Error("synthetic ending identity failure");
        return syntheticIdentity;
      },
      writeReport: async (report) => {
        identityFailureReport = structuredClone(report);
        return "/synthetic/identity-timing.json";
      },
    },
  }),
  /synthetic ending identity failure/,
);
assert.equal(identityFailureReport.failure.phase, "workspace-identity");

const primaryBeforeReportFailure = new Error("primary before report failure");
await assert.rejects(
  runTestCoordinator({
    root,
    artifactsDir: coordinatorArtifacts,
    selectedChecks: ["primary.mjs"],
    aggregateTimeoutMs: 2_000,
    dependencies: {
      startServer: syntheticStartServer,
      captureIdentity: syntheticCaptureIdentity,
      runSuite: async () => {
        throw primaryBeforeReportFailure;
      },
      writeReport: async () => {
        throw new Error("secondary report failure");
      },
    },
  }),
  /primary before report failure/,
  "timing report failure replaced the primary suite failure",
);
await assert.rejects(
  runTestCoordinator({
    root,
    artifactsDir: coordinatorArtifacts,
    selectedChecks: [],
    aggregateTimeoutMs: 2_000,
    dependencies: {
      startServer: syntheticStartServer,
      captureIdentity: syntheticCaptureIdentity,
      writeReport: async () => {
        throw new Error("successful run report failure");
      },
    },
  }),
  /successful run report failure/,
);

await fs.rm(coordinatorArtifacts, { recursive: true, force: true });

console.log(
  "isolated test harness passed (ephemeral port, marker rejection, forced timeout)",
);
