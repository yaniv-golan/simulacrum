import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Capture the committed revision plus every tracked and untracked workspace change. */
export async function captureWorkspaceIdentity(root, excludes = []) {
  const hash = crypto.createHash("sha256"),
    pathspecExcludes = excludes.map((value) => `:(exclude)${value}`),
    diff = git(root, [
      "diff",
      "--binary",
      "HEAD",
      "--",
      ".",
      ...pathspecExcludes,
    ]),
    status = git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
      .split("\0")
      .filter(Boolean)
      .filter((value) => !excludes.includes(value))
      .sort();
  hash.update(diff);
  for (const relativePath of untracked) {
    hash.update(`\0${relativePath}\0`);
    hash.update(await fs.readFile(path.join(root, relativePath)));
  }
  return Object.freeze({
    head: git(root, ["rev-parse", "HEAD"]).trim(),
    dirty: Boolean(status.trim()),
    workspaceSha256: hash.digest("hex"),
    excludes: Object.freeze([...excludes]),
  });
}

export function sameWorkspaceIdentity(left, right) {
  return Boolean(
    left &&
    right &&
    left.head === right.head &&
    left.workspaceSha256 === right.workspaceSha256,
  );
}
