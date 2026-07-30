import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tracked = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  {
    cwd: root,
    encoding: "utf8",
  },
)
  .split("\0")
  .filter(Boolean);

const existingTracked = tracked.filter((file) =>
    fs.existsSync(path.join(root, file)),
  ),
  forbidden = [
    /^progress\.md$/,
    /^docs\/internal\//,
    /^\.release-private\//,
    /(^|\/)\.DS_Store$/,
    /(^|\/)(artifacts|coverage|dist|output|temp)\//,
    /(^|\/)(screenshots?|traces?|reports?)\//i,
    /\.(?:log|tmp|trace|heapsnapshot)$/i,
    /(^|\/)\.(?:idea|vscode)\//,
    /(^|\/)(?:phase[0-9]|legacy-removal|r[0-9])(?:[-_./]|$)/i,
  ],
  violations = existingTracked.filter((file) =>
    forbidden.some((pattern) => pattern.test(file)),
  );

assert.deepEqual(
  violations,
  [],
  `release snapshot contains private or generated paths:\n${violations.join("\n")}`,
);

const textFiles = existingTracked.filter(
    (file) => file !== "scripts/verify-release-snapshot.mjs",
  ),
  sensitiveContentRules = [
    ["macOS home-directory path", new RegExp(`/${"Users"}/`)],
    ["Linux home-directory path", new RegExp(`/${"home"}/[^/]+/`)],
    ["private location name", new RegExp(["Haar", "ava"].join(""), "i")],
    ["GitHub classic token", new RegExp(["ghp", "_[A-Za-z0-9]{20,}"].join(""))],
    [
      "GitHub fine-grained token",
      new RegExp(["github", "_pat_[A-Za-z0-9_]"].join("")),
    ],
    ["AWS access key", new RegExp(["AKIA", "[0-9A-Z]{16}"].join(""))],
    [
      "private key",
      new RegExp(["BEGIN ", "(?:RSA |OPENSSH |EC |PGP )?PRIVATE KEY"].join("")),
    ],
    [
      "superseded Simulacrum release version",
      /\b(?:Simulacrum(?: Core)?|Core|Version)\s+(?:v)?0\.(?!1(?:\.0)?\b)\d+(?:\.\d+)?\b/i,
    ],
  ],
  contentViolations = [];

for (const file of textFiles) {
  const bytes = fs.readFileSync(path.join(root, file));
  if (bytes.includes(0)) continue;
  const content = bytes.toString("utf8");
  for (const [label, pattern] of sensitiveContentRules)
    if (pattern.test(content)) contentViolations.push(`${file}: ${label}`);
}

assert.deepEqual(
  contentViolations,
  [],
  `release snapshot contains sensitive content:\n${contentViolations.join("\n")}`,
);

const rootPackage = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ),
  corePackage = JSON.parse(
    fs.readFileSync(path.join(root, "packages/core/package.json"), "utf8"),
  ),
  changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"),
  releaseHeadings = [...changelog.matchAll(/^## (.+)$/gm)].map(
    (match) => match[1],
  );

assert.equal(rootPackage.version, "0.1.0");
assert.equal(corePackage.version, "0.2.0");
assert.equal(rootPackage.engines?.node, ">=24.18 <25");
assert.equal(corePackage.engines?.node, ">=24.18 <25");
assert.deepEqual(releaseHeadings, ["Unreleased", "0.1.0 - 2026-07-22"]);
assert.equal(fs.existsSync(path.join(root, ".gitmodules")), false);

console.log(
  `release snapshot passed (${existingTracked.length} tracked files, app 0.1.0 / Core 0.2.0)`,
);
