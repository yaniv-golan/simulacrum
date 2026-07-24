import { selectVerificationChecks } from "./test-selection.mjs";

export const FOCUSED_FORBIDDEN_ENVIRONMENT = Object.freeze([
  "TEST_FILTER",
  "TEST_SHARD_INDEX",
  "TEST_SHARD_COUNT",
]);

/**
 * Resolve positional suite names for the safe focused command.
 * Empty selection, comma-packed arguments, inherited filtering, and sharding
 * are rejected so every explicitly requested suite is guaranteed to run.
 */
export function selectFocusedVerificationChecks(
  checks,
  args,
  env = process.env,
) {
  const conflict = FOCUSED_FORBIDDEN_ENVIRONMENT.find((name) =>
    Object.hasOwn(env, name),
  );
  if (conflict) throw new Error(`test:focused refuses inherited ${conflict}`);
  if (!args.length)
    throw new Error("test:focused requires at least one verification suite");
  const names = args.map((value) => String(value).trim());
  if (names.some((value) => !value))
    throw new Error("test:focused refuses empty verification suite names");
  if (names.some((value) => value.includes(",")))
    throw new Error(
      "test:focused accepts separate positional suite names, not comma-packed values",
    );
  return selectVerificationChecks(checks, names.join(","));
}
