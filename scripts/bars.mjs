// Every bar is red until implemented. Bars carry a dueAt milestone and, for the
// player bars, a `human: true` flag: those are satisfied by a recorded
// assessment tied to a PLAYER-FACING BUILD FINGERPRINT -- not a commit, which
// left uncommitted source edits green and invalidated evidence the moment the
// evidence itself was committed.
import { readFileSync, existsSync } from "node:fs";
import { buildFingerprint } from "./build-fingerprint.mjs";

const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);

function assessmentFor(id) {
  const path = new URL(`../assessments/${id}.json`, import.meta.url);
  if (!existsSync(path)) return null;
  const record = JSON.parse(readFileSync(path, "utf8"));
  return record.build === buildFingerprint() ? record : { ...record, stale: true };
}

export function evaluateBar(id) {
  const bar = manifest.bars[id];
  if (!bar) throw new Error(`unknown bar: ${id}`);
  if (bar.human) {
    const record = assessmentFor(id);
    if (!record) return { id, state: "RED", why: "no recorded assessment" };
    if (record.stale)
      return {
        id,
        state: "RED",
        why: `assessment is for ${record.build}, current build is ${buildFingerprint()}`,
      };
    return record.verdict === "pass"
      ? {
          id,
          state: "GREEN",
          why: `assessed ${record.date}, participant ${record.participant}`,
        }
      : { id, state: "RED", why: `assessed FAIL ${record.date}: ${record.notes ?? ""}` };
  }
  return { id, state: "RED", why: "not implemented" };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const requested = process.argv[2];
  const ids = requested ? [requested] : Object.keys(manifest.bars);
  if (requested && !manifest.bars[requested]) {
    console.error(`unknown bar: ${requested}`);
    process.exit(2);
  }
  let red = 0;
  for (const id of ids) {
    const bar = manifest.bars[id];
    const { state, why } = evaluateBar(id);
    if (state === "RED") red += 1;
    const kind = bar.human ? "[human]" : "       ";
    console.error(`${state.padEnd(5)} ${id.padEnd(4)} ${kind} due ${bar.dueAt.padEnd(3)} -- ${why}`);
    console.error(`            ${bar.contract}`);
  }
  console.error(`\n${red} of ${ids.length} bar(s) red.`);
  process.exit(red === 0 ? 0 : 1);
}
