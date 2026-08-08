import path from "node:path";
import { runTestCoordinator } from "./lib/test-coordinator.mjs";
import {
  selectVerificationChecks,
  shardVerificationChecks,
} from "./lib/test-selection.mjs";
import {
  VERIFICATION_CHECKS,
  VERIFICATION_TIMEOUT_MS,
} from "./test-registry.mjs";

const root = path.resolve(import.meta.dirname, "..");
const selectionEnvironment = Object.fromEntries(
  [
    "TEST_FILTER",
    "TEST_SHARD_INDEX",
    "TEST_SHARD_COUNT",
    "UI_FIXTURE_FILTER",
    "COMPONENT_VISUAL_LAYOUT_FILTER",
    "COMPONENT_VISUAL_DEMO_FILTER",
  ].map((name) => [name, process.env[name] ?? null]),
);
const selectedChecks = shardVerificationChecks(
  selectVerificationChecks(VERIFICATION_CHECKS, process.env.TEST_FILTER),
  process.env.TEST_SHARD_INDEX,
  process.env.TEST_SHARD_COUNT,
);

await runTestCoordinator({
  root,
  artifactsDir: path.join(root, "artifacts", "test-harness"),
  selectedChecks,
  requestedChecks: process.env.TEST_FILTER
    ? process.env.TEST_FILTER.split(",")
    : VERIFICATION_CHECKS,
  mode: process.env.TEST_FILTER ? "filtered" : "full",
  selection: { environment: selectionEnvironment },
  suiteTimeoutMs: Number(process.env.TEST_SUITE_TIMEOUT_MS || 180_000),
  aggregateTimeoutMs: Number(
    process.env.TEST_AGGREGATE_TIMEOUT_MS || 120 * 60_000,
  ),
  timeoutOverrides: VERIFICATION_TIMEOUT_MS,
});
