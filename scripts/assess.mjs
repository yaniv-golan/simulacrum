// Records a human assessment.
//   npm run assess -- F1 pass alex app-1234567890abcdef "11 min to a moving cart"
//
// `servedBuild` is read off the RUNNING APPLICATION by the person who ran the
// session -- not inferred from the assessor's checkout, which allowed testing an
// old server and recording against new source.
//
// Sessions are APPEND-ONLY in assessments/sessions/. F1's novice rule reads that
// log: overwriting a single F1.json let alex -> blair -> alex be accepted.
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { appFingerprint, protocolHash } from "./build-fingerprint.mjs";

const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);

const [id, verdict, participant, servedBuild, ...rest] = process.argv.slice(2);
const notes = rest.join(" ");

function fail(message) {
  console.error(message);
  process.exit(2);
}

// Validate the id against the manifest BEFORE it is used to build a path.
if (!id || !Object.hasOwn(manifest.bars, id)) fail(`unknown bar: ${id ?? "(none)"}`);
if (!manifest.bars[id].human) fail(`${id} is not a human-judged bar`);
if (!["pass", "fail"].includes(verdict)) fail("verdict must be pass or fail");
if (!participant) fail("participant is required: who actually played");
if (!servedBuild) fail("servedBuild is required: the build id shown by the running application");
if (!notes) fail("notes are required: what happened");

const sessionsDir = new URL("../assessments/sessions/", import.meta.url);
function sessions() {
  if (!existsSync(sessionsDir)) return [];
  return readdirSync(sessionsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(new URL(f, sessionsDir), "utf8")));
}

// F1 measures FIRST-launch experience: a participant cannot be novice twice.
if (id === "F1" && sessions().some((s) => s.bar === "F1" && s.participant === participant))
  fail(`F1 is a first-launch bar and ${participant} has assessed it before. Use a new participant.`);

const app = appFingerprint();
const record = {
  bar: id,
  verdict,
  app,
  protocol: protocolHash(id, manifest.bars[id].contract),
  recordedAt: new Date().toISOString(),
  servedBuild,
  participant,
  assessor: execFileSync("git", ["config", "user.name"], { encoding: "utf8" }).trim(),
  date: new Date().toISOString().slice(0, 10),
  notes,
};

mkdirSync(sessionsDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
writeFileSync(new URL(`${id}-${stamp}.json`, sessionsDir), `${JSON.stringify(record, null, 2)}\n`);
writeFileSync(
  new URL(`../assessments/${id}.json`, import.meta.url),
  `${JSON.stringify(record, null, 2)}\n`,
);

if (servedBuild !== app)
  console.error(
    `WARNING: served build ${servedBuild} != current source ${app}. The bar will stay RED until they agree.`,
  );
console.log(`recorded ${id} ${verdict} for ${app} (participant: ${participant})`);
