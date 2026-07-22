import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const MARKER_PATH = "__simulacrum_test_marker";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      /* c8 ignore next 5 -- TCP port listeners cannot return pipe addresses. */
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("ephemeral test server did not receive a TCP port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

export async function terminateProcessTree(child, signal = "SIGTERM") {
  if (!child || child.exitCode != null || child.signalCode != null) return;
  /* c8 ignore next 7 -- exercised by the Windows CI lane when introduced. */
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
    });
    await new Promise((resolve) => killer.once("exit", resolve));
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      /** @type {NodeJS.ErrnoException} */ (error).code !== "ESRCH"
    )
      throw error;
  }
}

export async function readServerMarker(baseUrl) {
  const response = await fetch(new URL(MARKER_PATH, baseUrl), {
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(`test marker request failed with ${response.status}`);
  const payload = await response.json();
  return payload.marker;
}

async function waitForMarker(baseUrl, marker, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode != null)
      throw new Error(`Vite exited before becoming ready (${child.exitCode})`);
    try {
      if ((await readServerMarker(baseUrl)) === marker) return;
      /* c8 ignore next -- marker mismatch is asserted at the public boundary. */
      lastError = new Error("test server returned a different build marker");
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Vite did not expose this checkout's marker: ${lastError}`);
}

/**
 * @param {{root: string, artifactsDir?: string, startupTimeoutMs?: number, viteConfigPath?: string, mode?: "development" | "preview"}} options
 */
export async function startTestServer({
  root,
  artifactsDir = path.join(root, "artifacts", "test-harness"),
  startupTimeoutMs = 60_000,
  viteConfigPath,
  mode = "development",
}) {
  if (!root) throw new TypeError("startTestServer requires an absolute root");
  const port = await freePort();
  const marker = crypto.randomUUID();
  const baseUrl = `http://127.0.0.1:${port}/`;
  const log = [];
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    [
      "run",
      mode === "preview" ? "preview" : "dev",
      "--",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--strictPort",
      ...(viteConfigPath ? ["--config", viteConfigPath] : []),
    ],
    {
      cwd: root,
      detached: process.platform !== "win32",
      env: {
        ...process.env,
        SIMULACRUM_TEST_MARKER: marker,
        SIMULACRUM_TEST_ROOT: root,
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk) => log.push(String(chunk)));
  child.stderr.on("data", (chunk) => log.push(String(chunk)));

  let stopped = false;
  async function stop() {
    if (stopped) return;
    stopped = true;
    await terminateProcessTree(child);
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (child.exitCode == null) await terminateProcessTree(child, "SIGKILL");
    await fs.mkdir(artifactsDir, { recursive: true });
    await fs.writeFile(path.join(artifactsDir, "vite.log"), log.join(""));
  }

  try {
    await waitForMarker(baseUrl, marker, child, startupTimeoutMs);
  } catch (error) {
    await stop();
    throw error;
  }
  return { baseUrl, marker, child, stop, log };
}

export async function assertTestServer(baseUrl, expectedMarker) {
  if (!baseUrl || !expectedMarker)
    throw new Error(
      "browser suites require TEST_BASE_URL and TEST_BUILD_MARKER from the isolated runner",
    );
  const actual = await readServerMarker(baseUrl);
  if (actual !== expectedMarker)
    throw new Error(
      `refusing mismatched test server: expected ${expectedMarker}, received ${actual}`,
    );
}
