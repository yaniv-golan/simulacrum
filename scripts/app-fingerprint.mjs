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
import { buildModuleGraph } from "./module-graph.mjs";

// Unknown directories count conservatively; dependencies of included inputs
// also count even when their directory is normally documentation or tooling.
const NON_APP_PREFIXES = ["docs/", "assessments/", "scripts/", ".github/", "test/"];

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
  const initial = listFiles().filter(isAppInput);
  const graph = buildModuleGraph(process.cwd(), { entrypoints: initial });
  if (graph.errors.length)
    throw new Error(`build dependency graph invalid, refusing to fingerprint: ${graph.errors.join("; ")}`);
  const inputs = [...new Set([...initial, ...graph.nodes.keys()])].sort();
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
