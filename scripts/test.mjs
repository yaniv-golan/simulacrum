import fs from "node:fs/promises";
import path from "node:path";
import { startTestServer } from "./lib/test-server.mjs";
import { selectVerificationChecks } from "./lib/test-selection.mjs";
import { runVerificationSuite } from "./lib/verification-runner.mjs";
import {
  VERIFICATION_CHECKS,
  VERIFICATION_TIMEOUT_MS,
} from "./test-registry.mjs";

const root = path.resolve(import.meta.dirname, "..");
const artifactsDir = path.join(root, "artifacts", "test-harness");
const selectedChecks = selectVerificationChecks(
  VERIFICATION_CHECKS,
  process.env.TEST_FILTER,
);

const suiteTimeoutMs = Number(process.env.TEST_SUITE_TIMEOUT_MS || 180_000);
const aggregateTimeoutMs = Number(
  process.env.TEST_AGGREGATE_TIMEOUT_MS || 45 * 60_000,
);

await fs.mkdir(artifactsDir, { recursive: true });
const server = await startTestServer({ root, artifactsDir });
const aggregate = setTimeout(async () => {
  await server.stop();
  console.error(`test run exceeded ${aggregateTimeoutMs} ms`);
  process.exit(1);
}, aggregateTimeoutMs);

try {
  for (const check of selectedChecks)
    await runVerificationSuite({
      file: path.join("scripts", check),
      root,
      server,
      artifactsDir,
      timeoutMs: Math.max(suiteTimeoutMs, VERIFICATION_TIMEOUT_MS[check] || 0),
    });
  console.log(`all ${selectedChecks.length} verification suites passed`);
} finally {
  clearTimeout(aggregate);
  await server.stop();
}
