// Records a human assessment of a player bar against the current commit.
//   npm run assess -- F1 pass "watched A, 11 min to a moving cart, built a second"
// The record is invalidated by the next commit, on purpose: fun is a property of
// a build, not of a project.
import { writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";

const [id, verdict, ...rest] = process.argv.slice(2);
if (!id || !["pass", "fail"].includes(verdict)) {
  console.error('usage: npm run assess -- <barId> <pass|fail> "notes"');
  process.exit(2);
}
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const assessor = execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim();
mkdirSync(new URL("../assessments/", import.meta.url), { recursive: true });
const record = {
  bar: id,
  verdict,
  commit,
  assessor,
  date: new Date().toISOString().slice(0, 10),
  notes: rest.join(" "),
};
writeFileSync(
  new URL(`../assessments/${id}.json`, import.meta.url),
  `${JSON.stringify(record, null, 2)}\n`,
);
console.log(`recorded ${id} ${verdict} at ${commit.slice(0, 7)}`);
