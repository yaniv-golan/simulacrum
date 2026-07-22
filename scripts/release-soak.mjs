import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { startTestServer } from "./lib/test-server.mjs";
import { runVerificationSuite } from "./lib/verification-runner.mjs";

const root = path.resolve(import.meta.dirname, ".."),
  artifactsDir = path.join(root, "artifacts", "test-harness"),
  durationMs = Number(process.env.SIMULACRUM_SOAK_DURATION_MS || 30 * 60_000),
  timeoutMs = durationMs + 15 * 60_000;
await fs.mkdir(artifactsDir, { recursive: true });
const npm = process.platform === "win32" ? "npm.cmd" : "npm",
  build = spawnSync(npm, ["run", "build"], {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
  });
if (build.error) throw build.error;
if (build.status !== 0)
  throw new Error(
    `production build failed before release soak (${build.status})`,
  );
const server = await startTestServer({ root, artifactsDir, mode: "preview" });
try {
  await runVerificationSuite({
    file: "scripts/verify-release-soak.mjs",
    root,
    server,
    artifactsDir,
    timeoutMs,
  });
  console.log(
    `release soak passed (${Math.round(durationMs / 60_000)} requested minutes)`,
  );
} finally {
  await server.stop();
}
