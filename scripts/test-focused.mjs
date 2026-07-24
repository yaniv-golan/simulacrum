import path from "node:path";
import { selectFocusedVerificationChecks } from "./lib/focused-test-selection.mjs";
import { runTestCoordinator } from "./lib/test-coordinator.mjs";
import {
  VERIFICATION_CHECKS,
  VERIFICATION_TIMEOUT_MS,
} from "./test-registry.mjs";

const root = path.resolve(import.meta.dirname, ".."),
  args = process.argv.slice(2),
  selectedChecks = selectFocusedVerificationChecks(
    VERIFICATION_CHECKS,
    args,
    process.env,
  );

await runTestCoordinator({
  root,
  artifactsDir: path.join(root, "artifacts", "test-harness"),
  selectedChecks,
  requestedChecks: args,
  mode: "focused",
  suiteTimeoutMs: Number(process.env.TEST_SUITE_TIMEOUT_MS || 180_000),
  aggregateTimeoutMs: Number(
    process.env.TEST_AGGREGATE_TIMEOUT_MS || 45 * 60_000,
  ),
  timeoutOverrides: VERIFICATION_TIMEOUT_MS,
  skipLifecycleHooks: true,
});
