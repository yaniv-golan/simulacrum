// Prints `ruleId | rule | enforcedBy` from the manifest, which is the only
// authored copy. A rule with no check prints UNENFORCED.
import { readFileSync } from "node:fs";

const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);
if (manifest.rules.length === 0) {
  console.log("no rules declared yet -- add them to scripts/manifest.json");
  process.exit(0);
}
for (const rule of manifest.rules) {
  const enforced = rule.enforcedBy?.length
    ? rule.enforcedBy.join(", ")
    : "UNENFORCED";
  console.log(`${rule.id} | ${rule.rule} | ${enforced}`);
}
