// A bar is red until implemented. Human bars are satisfied only by an evidence
// record that passes a STRICT schema: a partial record used to print GREEN with
// "assessed undefined, participant undefined".
import { readFileSync, existsSync } from "node:fs";
import { appFingerprint, protocolHash } from "./build-fingerprint.mjs";

const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);

const REQUIRED_FIELDS = [
  "bar", "verdict", "app", "protocol", "servedBuild", "participant", "assessor", "date", "notes",
];

function validate(record, id) {
  for (const field of REQUIRED_FIELDS)
    if (typeof record[field] !== "string" || record[field].length === 0)
      return `evidence missing or empty field: ${field}`;
  if (record.bar !== id) return `evidence is for bar ${record.bar}, not ${id}`;
  if (!["pass", "fail"].includes(record.verdict)) return `bad verdict: ${record.verdict}`;
  return null;
}

export function evaluateBar(id) {
  const bar = manifest.bars[id];
  if (!bar) throw new Error(`unknown bar: ${id}`);
  if (!bar.human) return { id, state: "RED", why: "not implemented" };

  const path = new URL(`../assessments/${id}.json`, import.meta.url);
  if (!existsSync(path)) return { id, state: "RED", why: "no recorded assessment" };

  let record;
  try {
    record = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { id, state: "RED", why: `evidence unreadable: ${error.message}` };
  }

  const invalid = validate(record, id);
  if (invalid) return { id, state: "RED", why: invalid };

  const app = appFingerprint();
  if (record.app !== app)
    return { id, state: "RED", why: `evidence is for ${record.app}, current app is ${app}` };
  if (record.servedBuild !== record.app)
    return { id, state: "RED", why: "the served build the participant used does not match the evidence" };

  const proto = protocolHash(bar.contract);
  if (record.protocol !== proto)
    return { id, state: "RED", why: "the bar contract changed since this assessment" };

  return record.verdict === "pass"
    ? { id, state: "GREEN", why: `assessed ${record.date}, participant ${record.participant}` }
    : { id, state: "RED", why: `assessed FAIL ${record.date}: ${record.notes}` };
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
    const { state, why } = evaluateBar(id);
    if (state === "RED") red += 1;
    console.error(
      `${state.padEnd(5)} ${id.padEnd(4)} ${bar.human ? "[human]" : "       "} due ${bar.dueAt.padEnd(3)} -- ${why}`,
    );
    console.error(`            ${bar.contract}`);
  }
  console.error(`\n${red} of ${ids.length} bar(s) red.`);
  process.exit(red === 0 ? 0 : 1);
}
