// Records a human assessment of a player bar against the PLAYER-FACING BUILD.
//   npm run assess -- F1 pass alex "11 min to a moving cart, then built a second"
//
// Keyed on a build fingerprint, not a commit: editing src/ invalidates the
// record, while committing the record itself -- or editing a doc -- does not.
// Evidence is committed under assessments/ and travels with the repo.
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildFingerprint } from "./build-fingerprint.mjs";

const [id, verdict, participant, ...rest] = process.argv.slice(2);
if (!id || !["pass", "fail"].includes(verdict) || !participant) {
  console.error(
    'usage: npm run assess -- <barId> <pass|fail> <participant> "notes"\n' +
      "participant identifies WHO played -- F1 measures first-launch experience and\n" +
      "needs someone who has not seen this build before.",
  );
  process.exit(2);
}

// F1 is a first-launch bar: the same person cannot supply novice evidence twice.
if (id === "F1" && existsSync(new URL("../assessments/", import.meta.url))) {
  const priorParticipants = readdirSync(new URL("../assessments/", import.meta.url))
    .filter((f) => f.startsWith("F1"))
    .map((f) => JSON.parse(readFileSync(new URL(`../assessments/${f}`, import.meta.url), "utf8")))
    .map((r) => r.participant);
  if (priorParticipants.includes(participant)) {
    console.error(
      `F1 is a first-launch bar and ${participant} has already assessed it. Use a new participant.`,
    );
    process.exit(2);
  }
}

const build = buildFingerprint();
const assessor = execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim();
mkdirSync(new URL("../assessments/", import.meta.url), { recursive: true });
const record = {
  bar: id,
  verdict,
  build,
  participant,
  assessor,
  date: new Date().toISOString().slice(0, 10),
  notes: rest.join(" "),
};
writeFileSync(
  new URL(`../assessments/${id}.json`, import.meta.url),
  `${JSON.stringify(record, null, 2)}\n`,
);
console.log(`recorded ${id} ${verdict} for ${build} (participant: ${participant})`);
