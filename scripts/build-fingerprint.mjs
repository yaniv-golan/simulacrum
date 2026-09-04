// Identifies the PLAYER-FACING BUILD, not the commit.
//
// `git rev-parse HEAD` was wrong in both directions: uncommitted source edits
// left a recorded assessment green, and committing the assessment file itself
// advanced HEAD and invalidated the evidence it had just preserved.
//
// Hashing the build inputs fixes both. Editing src/ changes the fingerprint;
// committing an assessment or editing a doc does not.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const INPUT_PREFIXES = ["src/", "scripts/", "assets/"];
const INPUT_FILES = ["package.json", "package-lock.json", "index.html", "vite.config.js"];
const EXCLUDE_PREFIXES = ["assessments/", "docs/"];

function isBuildInput(path) {
  if (EXCLUDE_PREFIXES.some((p) => path.startsWith(p))) return false;
  if (path.endsWith(".md")) return false;
  return INPUT_PREFIXES.some((p) => path.startsWith(p)) || INPUT_FILES.includes(path);
}

export function buildFingerprint() {
  const listed = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean)
    .filter(isBuildInput)
    .sort();

  const hash = createHash("sha256");
  for (const path of listed) {
    hash.update(path);
    hash.update("\0");
    try {
      hash.update(readFileSync(path));
    } catch {
      hash.update("<unreadable>");
    }
    hash.update("\0");
  }
  return `build-${hash.digest("hex").slice(0, 16)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(buildFingerprint());
