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

const APP_PREFIXES = ["src/", "public/", "assets/", "styles/"];
const APP_FILES = ["package.json", "package-lock.json", "index.html"];
const APP_PATTERNS = [/^vite\.config\.[cm]?[jt]s$/, /^tsconfig(\..+)?\.json$/];

function isAppInput(path) {
  if (path.endsWith(".md")) return false;
  return (
    APP_PREFIXES.some((p) => path.startsWith(p)) ||
    APP_FILES.includes(path) ||
    APP_PATTERNS.some((re) => re.test(path))
  );
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

export function protocolHash(barContract) {
  return `proto-${createHash("sha256").update(barContract).digest("hex").slice(0, 12)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) console.log(appFingerprint());
