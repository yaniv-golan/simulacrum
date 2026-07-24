import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runVerificationSuite } from "./verification-runner.mjs";
import { startTestServer } from "./test-server.mjs";
import {
  captureWorkspaceIdentity,
  sameWorkspaceIdentity,
} from "./workspace-identity.mjs";

const roundedElapsed = (startedAt) =>
  Math.round((performance.now() - startedAt) * 10) / 10;

function npmVersion() {
  const fromAgent = /(?:^|\s)npm\/([^\s]+)/.exec(
    process.env.npm_config_user_agent || "",
  )?.[1];
  try {
    return execFileSync(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["--version"],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return fromAgent || "unknown";
  }
}

function failureRecord(error, phase, suite = null) {
  return Object.freeze({
    phase,
    suite,
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
  });
}

function throwIfAborted(signal) {
  if (!signal.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new Error("verification run aborted");
}

async function atomicWriteJson(file, value) {
  const temporary = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(temporary, file);
}

export async function writeTestTimingReport(report, artifactsDir) {
  await fs.mkdir(artifactsDir, { recursive: true });
  const stamp = report.startedAt.replaceAll(":", "-").replaceAll(".", "-"),
    uniquePath = path.join(
      artifactsDir,
      `timing-${stamp}-${report.runId}.json`,
    );
  await atomicWriteJson(uniquePath, report);
  await atomicWriteJson(path.join(artifactsDir, "timing-latest.json"), report);
  return uniquePath;
}

/**
 * Coordinate one serial verification run and always attempt a durable timing
 * report for handled startup, suite, aggregate-timeout, and cleanup failures.
 */
export async function runTestCoordinator({
  root,
  artifactsDir,
  selectedChecks,
  requestedChecks = selectedChecks,
  mode = "full",
  suiteTimeoutMs = 180_000,
  aggregateTimeoutMs = 45 * 60_000,
  timeoutOverrides = {},
  skipLifecycleHooks = false,
  dependencies = {},
}) {
  const startServer = dependencies.startServer || startTestServer,
    runSuite = dependencies.runSuite || runVerificationSuite,
    captureIdentity = dependencies.captureIdentity || captureWorkspaceIdentity,
    writeReport = dependencies.writeReport || writeTestTimingReport,
    runStartedAt = performance.now(),
    abortController = new AbortController(),
    report = {
      schema: "simulacrum-test-timing-v1",
      runId: crypto.randomUUID(),
      mode,
      startedAt: new Date().toISOString(),
      endedAt: null,
      status: "running",
      requestedChecks: [...requestedChecks],
      selectedChecks: [...selectedChecks],
      toolchain: {
        node: process.version,
        npm: npmVersion(),
        platform: process.platform,
        release: os.release(),
        architecture: process.arch,
        logicalCpuCount: os.cpus().length,
      },
      workspace: { start: null, end: null, changedDuringRun: null },
      server: { startupMs: null, cleanupMs: null },
      suites: [],
      slowestCompletedSuites: [],
      failure: null,
      totalElapsedMs: null,
    };
  let server = null,
    primaryError = null,
    cleanupError = null,
    reportError = null,
    reportPath = null,
    activeSuite = null,
    failedSuite = null;
  const aggregateError = new Error(
    `test run exceeded ${aggregateTimeoutMs} ms`,
  );
  aggregateError.name = "AggregateTimeoutError";
  const aggregateTimer = setTimeout(
    () => abortController.abort(aggregateError),
    aggregateTimeoutMs,
  );

  try {
    report.workspace.start = await captureIdentity(root);
    throwIfAborted(abortController.signal);
    const serverStartedAt = performance.now();
    server = await startServer({
      root,
      artifactsDir,
      skipLifecycleHooks,
      signal: abortController.signal,
    });
    report.server.startupMs = roundedElapsed(serverStartedAt);
    for (const check of selectedChecks) {
      throwIfAborted(abortController.signal);
      activeSuite = {
        suite: check.replace(/\.mjs$/, ""),
        status: "running",
        elapsedMs: null,
      };
      report.suites.push(activeSuite);
      try {
        Object.assign(
          activeSuite,
          await runSuite({
            file: path.join("scripts", check),
            root,
            server,
            artifactsDir,
            timeoutMs: Math.max(suiteTimeoutMs, timeoutOverrides[check] || 0),
            signal: abortController.signal,
          }),
        );
      } catch (error) {
        Object.assign(
          activeSuite,
          error?.verificationTiming || { status: "failed" },
        );
        failedSuite = activeSuite.suite;
        throw error;
      } finally {
        activeSuite = null;
      }
    }
    report.status = "passed";
  } catch (error) {
    primaryError = error;
    report.status =
      error?.name === "AggregateTimeoutError" ? "timed-out" : "failed";
    report.failure = failureRecord(
      error,
      server ? "suite" : "startup",
      failedSuite || activeSuite?.suite,
    );
  } finally {
    clearTimeout(aggregateTimer);
    if (server) {
      const cleanupStartedAt = performance.now();
      try {
        await server.stop();
      } catch (error) {
        cleanupError = error;
        report.status = "failed";
        report.failure ||= failureRecord(error, "cleanup");
      }
      report.server.cleanupMs = roundedElapsed(cleanupStartedAt);
    }
    try {
      report.workspace.end = await captureIdentity(root);
      report.workspace.changedDuringRun = !sameWorkspaceIdentity(
        report.workspace.start,
        report.workspace.end,
      );
    } catch (error) {
      cleanupError ||= error;
      report.status = "failed";
      report.failure ||= failureRecord(error, "workspace-identity");
    }
    report.endedAt = new Date().toISOString();
    report.totalElapsedMs = roundedElapsed(runStartedAt);
    report.slowestCompletedSuites = report.suites
      .filter((suite) => Number.isFinite(suite.elapsedMs))
      .sort((left, right) => right.elapsedMs - left.elapsedMs)
      .slice(0, Math.min(5, report.suites.length))
      .map(({ suite, status, elapsedMs }) => ({ suite, status, elapsedMs }));
    try {
      reportPath = await writeReport(report, artifactsDir);
      console.log(`test timing report: ${reportPath}`);
    } catch (error) {
      reportError = error;
      console.error(`failed to write test timing report: ${error}`);
    }
  }
  const failure = primaryError || cleanupError || reportError;
  if (failure) {
    if (reportPath && failure && typeof failure === "object")
      failure.testTimingReportPath = reportPath;
    throw failure;
  }
  console.log(`all ${selectedChecks.length} verification suites passed`);
  return Object.freeze({ report: Object.freeze(report), reportPath });
}
