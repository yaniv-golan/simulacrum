// A bar is red until implemented. Human bars are satisfied only by an evidence
// record that passes a STRICT schema: a partial record used to print GREEN with
// "assessed undefined, participant undefined".
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { appFingerprint, protocolHash } from './build-fingerprint.mjs';

const manifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));

const REQUIRED_FIELDS = [
  'bar',
  'verdict',
  'app',
  'protocol',
  'servedBuild',
  'participant',
  'assessor',
  'date',
  'notes',
  'recordedAt',
];

function validate(record, id) {
  for (const field of REQUIRED_FIELDS)
    if (typeof record[field] !== 'string' || record[field].length === 0)
      return `evidence missing or empty field: ${field}`;
  if (record.bar !== id) return `evidence is for bar ${record.bar}, not ${id}`;
  if (!['pass', 'fail'].includes(record.verdict)) return `bad verdict: ${record.verdict}`;
  const timestamp = Date.parse(record.recordedAt);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== record.recordedAt)
    return `recordedAt must be a canonical UTC timestamp: ${record.recordedAt}`;
  if (record.date !== record.recordedAt.slice(0, 10)) return 'date must match recordedAt';
  return null;
}

export async function evaluateBar(id, context) {
  const bar = manifest.bars[id];
  if (!bar) throw new Error(`unknown bar: ${id}`);
  if (!bar.human) {
    if (!bar.check) return { id, state: 'RED', why: 'not implemented' };
    try {
      if (context) {
        const { executeCheck } = await import('./checks.mjs');
        await executeCheck(bar.check, context);
      } else {
        const { runModuleCheck } = await import('./run-check.mjs');
        const { checkDeadline } = await import('./checks.mjs');
        await runModuleCheck(
          new URL('./check-entry.mjs', import.meta.url).pathname,
          'check',
          [bar.check],
          { timeoutMs: checkDeadline(bar.check) },
        );
      }
      return { id, state: 'GREEN', why: `executed ${bar.check}` };
    } catch (error) {
      return { id, state: 'RED', why: `check failed: ${error.message}` };
    }
  }

  // The APPEND-ONLY SESSION LOG is authoritative, not assessments/<id>.json.
  // Restoring an older index file resurrected a superseded pass while the newer
  // failure sat in the log; the index is now a convenience view only.
  const sessionsDir = new URL('../assessments/sessions/', import.meta.url);
  if (!existsSync(sessionsDir)) return { id, state: 'RED', why: 'no recorded assessment' };

  let record;
  try {
    const log = readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(new URL(f, sessionsDir), 'utf8')));
    const all = log.filter((r) => r?.bar === id);
    if (all.length === 0) return { id, state: 'RED', why: 'no recorded assessment' };

    // Validate BEFORE ordering. Sorting first let a record with
    // recordedAt "zz-invalid-timestamp" sort last and mask a newer failure.
    const invalidRecord = all.find((r) => validate(r, id) !== null);
    if (invalidRecord)
      return { id, state: 'RED', why: `invalid session record: ${validate(invalidRecord, id)}` };

    const timed = all.map((r) => ({ r, t: Date.parse(r.recordedAt) }));
    const unparsable = timed.find((x) => Number.isNaN(x.t));
    if (unparsable)
      return { id, state: 'RED', why: `unparsable recordedAt: ${unparsable.r.recordedAt}` };

    if (new Set(timed.map((x) => x.t)).size !== timed.length)
      return { id, state: 'RED', why: 'ambiguous recordedAt: sessions have identical timestamps' };
    timed.sort((a, b) => a.t - b.t);
    record = timed.at(-1).r; // most recent valid session wins
    if (id === 'F1') {
      const designated = bar.participant;
      if (typeof designated !== 'string' || !designated.trim() || record.participant !== designated)
        return { id, state: 'RED', why: "F1 requires the manifest's designated participant" };
    }
  } catch (error) {
    return { id, state: 'RED', why: `session log unreadable: ${error.message}` };
  }

  const app = appFingerprint();
  if (record.app !== app)
    return { id, state: 'RED', why: `evidence is for ${record.app}, current app is ${app}` };
  if (record.servedBuild !== record.app)
    return {
      id,
      state: 'RED',
      why: 'the served build the participant used does not match the evidence',
    };

  let proto;
  try {
    proto = protocolHash(id, bar.contract);
  } catch {
    return { id, state: 'RED', why: `no assessment protocol at assessments/protocol/${id}.md` };
  }
  if (record.protocol !== proto)
    return { id, state: 'RED', why: 'the bar contract changed since this assessment' };

  return record.verdict === 'pass'
    ? { id, state: 'GREEN', why: `assessed ${record.date}, participant ${record.participant}` }
    : { id, state: 'RED', why: `assessed FAIL ${record.date}: ${record.notes}` };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const requested = process.argv[2];
  if (requested && !manifest.bars[requested]) {
    console.error(`unknown bar: ${requested}`);
    process.exit(2);
  }
  const ids = requested ? [requested] : Object.keys(manifest.bars);
  let red = 0;
  for (const id of ids) {
    const bar = manifest.bars[id];
    const { state, why } = await evaluateBar(id);
    if (state === 'RED') red += 1;
    console.error(
      `${state.padEnd(5)} ${id.padEnd(4)} ${bar.human ? '[human]' : '       '} due ${bar.dueAt.padEnd(3)} -- ${why}`,
    );
    console.error(`            ${bar.contract}`);
  }
  console.error(`\n${red} of ${ids.length} bar(s) red.`);
  process.exit(red === 0 ? 0 : 1);
}
