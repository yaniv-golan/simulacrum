import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { terminateProcessTree } from "./test-server.mjs";

const elapsed = (startedAt) =>
  Math.round((performance.now() - startedAt) * 10) / 10;

function waitForExit(child, timeoutMs) {
  if (!child || child.exitCode != null || child.signalCode != null)
    return Promise.resolve(true);
  return Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    new Promise((resolve) => setTimeout(() => resolve(false), timeoutMs)),
  ]);
}

async function stopVerificationProcess(child, graceMs) {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  await terminateProcessTree(child, "SIGTERM");
  if (await waitForExit(child, graceMs)) return;
  await terminateProcessTree(child, "SIGKILL");
  if (!(await waitForExit(child, graceMs)))
    throw new Error(`verification process ${child.pid} survived SIGKILL`);
}

function attachTiming(error, timing) {
  if (error && typeof error === "object") error.verificationTiming = timing;
  return error;
}

/**
 * Run one verification script with bounded lifetime and durable output.
 * @param {{file: string, root: string, server: {baseUrl: string, marker: string}, artifactsDir: string, runId?:string|null, timeoutMs: number, signal?:AbortSignal, terminationGraceMs?:number}} options
 */
export async function runVerificationSuite({
  file,
  root,
  server,
  artifactsDir,
  runId = null,
  timeoutMs,
  signal,
  terminationGraceMs = 1_000,
}) {
  const startedAt = performance.now(),
    suite = path.basename(file, ".mjs"),
    output = [],
    latestLogPath = path.join(artifactsDir, `${suite}.log`),
    outputLogPath = runId
      ? path.join(artifactsDir, `${suite}-${runId}.log`)
      : latestLogPath;
  if (signal?.aborted) {
    const timing = Object.freeze({
      suite,
      status: "aborted",
      elapsedMs: elapsed(startedAt),
    });
    throw attachTiming(
      signal.reason instanceof Error
        ? signal.reason
        : new Error("verification suite aborted"),
      timing,
    );
  }
  const child = spawn(process.execPath, [path.resolve(root, file)], {
    cwd: root,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      TEST_BASE_URL: server.baseUrl,
      TEST_BUILD_MARKER: server.marker,
      TEST_SUITE_NAME: suite,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const consume = (chunk) => {
    const value = String(chunk);
    output.push(value);
    process.stdout.write(value);
  };
  child.stdout.on("data", consume);
  child.stderr.on("data", consume);

  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, exitSignal) =>
      resolve({ type: "exit", code, signal: exitSignal }),
    );
  });
  let timeoutId, abortHandler;
  const timedOut = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({ type: "timeout" }), timeoutMs);
    }),
    aborted = signal
      ? new Promise((resolve) => {
          abortHandler = () =>
            resolve({ type: "abort", reason: signal.reason });
          signal.addEventListener("abort", abortHandler, { once: true });
        })
      : new Promise(() => {});
  let failure = null,
    status;
  try {
    const result = await Promise.race([exited, timedOut, aborted]);
    if (result.type === "timeout") {
      status = "timed-out";
      await stopVerificationProcess(child, terminationGraceMs);
      failure = new Error(`${file} timed out after ${timeoutMs} ms`);
    } else if (result.type === "abort") {
      status = "aborted";
      await stopVerificationProcess(child, terminationGraceMs);
      failure =
        result.reason instanceof Error
          ? result.reason
          : new Error("verification suite aborted");
    } else if (result.code !== 0) {
      status = "failed";
      failure = new Error(
        `${file} failed with ${result.code ?? result.signal ?? "unknown"}`,
      );
    } else status = "passed";
  } catch (error) {
    status = "failed";
    failure = error;
  } finally {
    clearTimeout(timeoutId);
    if (abortHandler) signal.removeEventListener("abort", abortHandler);
    try {
      await stopVerificationProcess(child, terminationGraceMs);
    } catch (error) {
      status = "termination-failed";
      failure ||= error;
    }
    await fs.mkdir(artifactsDir, { recursive: true });
    const completeOutput = output.join("");
    await fs.writeFile(outputLogPath, completeOutput);
    if (outputLogPath !== latestLogPath)
      await fs.writeFile(latestLogPath, completeOutput);
  }
  const timing = Object.freeze({
    suite,
    status,
    elapsedMs: elapsed(startedAt),
    outputLogPath,
  });
  if (failure) throw attachTiming(failure, timing);
  return timing;
}
