import fs from "node:fs";

export function nodeSatisfiesComponentInspectionReleaseRange(version) {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-|$)/.exec(version);
  return Boolean(match && Number(match[1]) === 24 && Number(match[2]) >= 18);
}

/** Validate the live wrapper without mutating or preparing its worktree. */
export function validateComponentInspectionLiveWorkspace({
  profile,
  candidate,
  allowDirty = false,
  root,
  nodeVersion = process.version,
  git,
  realpath = fs.realpathSync,
}) {
  if (profile !== "foundation")
    throw new Error("S1 live verification requires --profile=foundation");
  if (!allowDirty && !/^[0-9a-f]{40}$/.test(candidate || ""))
    throw new Error("Live verification requires --candidate=<40-hex commit>");

  const head = git(["rev-parse", "HEAD"]);
  if (!allowDirty && head !== candidate)
    throw new Error("Candidate does not match the current HEAD");
  if (!allowDirty && git(["status", "--porcelain=v1", "--untracked-files=all"]))
    throw new Error("Live verification requires a clean worktree");

  const current = realpath(root),
    registered = git(["worktree", "list", "--porcelain"])
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => realpath(line.slice("worktree ".length)))
      .includes(current);
  if (!registered)
    throw new Error("Current path is not a registered Git worktree");
  if (!allowDirty && !nodeSatisfiesComponentInspectionReleaseRange(nodeVersion))
    throw new Error(
      `Authoritative verification requires Node >=24.18 <25; received ${nodeVersion}`,
    );

  return Object.freeze({
    authoritative: !allowDirty,
    candidate: allowDirty ? null : candidate,
    head,
  });
}
