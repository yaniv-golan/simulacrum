// Two identities, deliberately separate (a milestone bump must not invalidate a
// playtest, and a doc edit must not either, but a src edit must):
//
//   appFingerprint  -- what the participant actually played
//   protocolHash    -- the bar contract they were judged against
//
// Filenames come NUL-delimited: git quotes non-ASCII paths in its default
// output, and splitting that on newlines let `src/unicode-é.js` evade hashing
// entirely. Unreadable included inputs FAIL rather than hashing a placeholder.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Allowlist plus a conservative fallback: anything at the repo root that is not
// explicitly excluded counts, because a root-level config.json imported by
// src/main.js previously changed with no effect on the fingerprint.
const APP_PREFIXES = ["src/", "public/", "assets/", "styles/"];
const NON_APP_PREFIXES = ["docs/", "assessments/", "scripts/", ".github/", "test/"];
const APP_FILES = ["package.json", "package-lock.json", "index.html"];
const APP_PATTERNS = [/^vite\.config\.[cm]?[jt]s$/, /^tsconfig(\..+)?\.json$/];

function isAppInput(path) {
  if (path.endsWith(".md")) return false;
  // Conservative by default: EXCLUDE what is known not to be an app input, and
  // treat everything else as one. An allowlist missed config/runtime.json
  // imported by src/main.js; a root-only fallback missed it too. Unknown
  // directories must count, or the fingerprint certifies less than it claims.
  return !NON_APP_PREFIXES.some((p) => path.startsWith(p));
}

function listFiles() {
  return execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
    .split("\0")
    .filter(Boolean);
}

export function appFingerprint() {
  const inputs = listFiles().filter(isAppInput).sort();
  const hash = createHash("sha256");
  for (const path of inputs) {
    hash.update(path);
    hash.update("\0");
    let content;
    try {
      content = readFileSync(path);
    } catch (error) {
      // Fail closed: an input we cannot read is an input we cannot certify.
      throw new Error(`build input unreadable, refusing to fingerprint: ${path} (${error.code})`);
    }
    hash.update(content);
    hash.update("\0");
  }
  return `app-${hash.digest("hex").slice(0, 16)}`;
}

// Hashes the WHOLE protocol a participant was judged against, not just the
// one-line contract: the rubric, fixtures, required evidence and scoring rules
// live in assessments/protocol/<bar>.md. Editing the rubric must invalidate
// existing evidence -- hashing only the short contract string left a pass green
// after the instructions changed underneath it.
export function protocolHash(barId, barContract) {
  const hash = createHash("sha256").update(barId).update("\0").update(barContract).update("\0");
  // A missing protocol is not a protocol. Hashing a placeholder let evidence be
  // recorded and stay green with no written instructions at all.
  hash.update(
    readFileSync(new URL(`../assessments/protocol/${barId}.md`, import.meta.url)),
  );
  return `proto-${hash.digest("hex").slice(0, 12)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(appFingerprint());
