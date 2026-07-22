import path from "node:path";
import { assert } from "./lib/assert.mjs";
import {
  inspectStrictCurrentContract,
  STRICT_CURRENT_CONTRACT_RULES,
} from "./strict-current-contract.mjs";

const root = path.resolve(import.meta.dirname, "..");
const { findings, invalidAllowlistEntries } =
  await inspectStrictCurrentContract(root);

assert.deepEqual(
  findings.map(({ id }) => id),
  Array.from(
    { length: 15 },
    (_, index) => `SC-${String(index + 1).padStart(2, "0")}`,
  ),
  "the strict guard must track every alternate-authority cluster",
);
assert.deepEqual(
  invalidAllowlistEntries,
  [],
  `remove stale compatibility allowlist entries:\n${invalidAllowlistEntries
    .map(({ id, file, reason }) => `${id} ${file}: ${reason}`)
    .join("\n")}`,
);
const unexpected = findings.flatMap(({ id, description, unexpected }) =>
  unexpected.map((match) => ({ id, description, ...match })),
);
assert.deepEqual(
  unexpected,
  [],
  `new compatibility paths require removal, not allowlisting:\n${unexpected
    .map(({ id, file, line, text }) => `${id} ${file}:${line} ${text}`)
    .join("\n")}`,
);

const activeEntries = STRICT_CURRENT_CONTRACT_RULES.reduce(
  (count, rule) => count + rule.allowedFiles.length,
  0,
);
console.log(
  `strict current-contract guard passed (${findings.length} clusters, ${activeEntries} allowlist entries)`,
);
