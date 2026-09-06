// Records a human assessment.
//   npm run assess -- F1 pass designated-player app-1234567890abcdef "11 min to a moving cart"
//
// `servedBuild` is read off the RUNNING APPLICATION by the person who ran the
// session -- not inferred from the assessor's checkout, which allowed testing an
// old server and recording against new source.
//
// Sessions are APPEND-ONLY in assessments/sessions/. The latest session for a
// bar is authoritative, including a repeat assessment that fails.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { appFingerprint, protocolHash } from './build-fingerprint.mjs';

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));

const [id, verdict, participant, servedBuild, ...rest] = process.argv.slice(2);
const notes = rest.join(' ');

function fail(message) {
  console.error(message);
  process.exit(2);
}

// Validate the id against the manifest BEFORE it is used to build a path.
if (!id || !Object.hasOwn(manifest.bars, id)) fail(`unknown bar: ${id ?? '(none)'}`);
if (!manifest.bars[id].human) fail(`${id} is not a human-judged bar`);
if (!['pass', 'fail'].includes(verdict)) fail('verdict must be pass or fail');
if (!participant) fail('participant is required: who actually played');
if (!servedBuild) fail('servedBuild is required: the build id shown by the running application');
if (!notes) fail('notes are required: what happened');

const sessionsDir = new URL('../assessments/sessions/', import.meta.url);
// F1 is acceptance by the designated player. The alias is public; its mapping
// to the real participant stays private. Returning sessions are eligible.
if (id === 'F1') {
  const designated = manifest.bars.F1.participant;
  if (typeof designated !== 'string' || !designated.trim() || participant !== designated)
    fail("F1 requires the manifest's designated participant");
}

const app = appFingerprint();
const recordedAt = new Date().toISOString();
const record = {
  bar: id,
  verdict,
  app,
  protocol: protocolHash(id, manifest.bars[id].contract),
  recordedAt,
  servedBuild,
  participant,
  assessor: execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim(),
  date: recordedAt.slice(0, 10),
  notes,
};

mkdirSync(sessionsDir, { recursive: true });
const stamp = recordedAt.replace(/[:.]/g, '-');
writeFileSync(new URL(`${id}-${stamp}.json`, sessionsDir), `${JSON.stringify(record, null, 2)}\n`, {
  flag: 'wx',
});
writeFileSync(
  new URL(`../assessments/${id}.json`, import.meta.url),
  `${JSON.stringify(record, null, 2)}\n`,
);

if (servedBuild !== app)
  console.error(
    `WARNING: served build ${servedBuild} != current source ${app}. The bar will stay RED until they agree.`,
  );
console.log(`recorded ${id} ${verdict} for ${app} (participant: ${participant})`);
