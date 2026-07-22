import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { terminateProcessTree } from "./test-server.mjs";

/**
 * Run one verification script with bounded lifetime and durable output.
 * @param {{file: string, root: string, server: {baseUrl: string, marker: string}, artifactsDir: string, timeoutMs: number}} options
 */
export async function runVerificationSuite({
  file,
  root,
  server,
  artifactsDir,
  timeoutMs,
}) {
  const output = [];
  const child = spawn(process.execPath, [path.resolve(root, file)], {
    cwd: root,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      TEST_BASE_URL: server.baseUrl,
      TEST_BUILD_MARKER: server.marker,
      TEST_SUITE_NAME: path.basename(file, ".mjs"),
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

  let timedOut = false;
  const timeout = setTimeout(async () => {
    timedOut = true;
    await terminateProcessTree(child);
  }, timeoutMs);
  try {
    const result = await new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    await fs.mkdir(artifactsDir, { recursive: true });
    await fs.writeFile(
      path.join(artifactsDir, `${path.basename(file, ".mjs")}.log`),
      output.join(""),
    );
    if (timedOut) throw new Error(`${file} timed out after ${timeoutMs} ms`);
    if (result.code !== 0)
      throw new Error(
        `${file} failed with ${result.code ?? result.signal ?? "unknown"}`,
      );
  } finally {
    clearTimeout(timeout);
    await terminateProcessTree(child);
  }
}
