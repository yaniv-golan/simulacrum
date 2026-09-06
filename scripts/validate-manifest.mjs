import { readFileSync } from 'node:fs';
export function validateManifest(m) {
  const unique = (values, what) => {
    if (new Set(values).size !== values.length) throw new Error(`duplicate ${what}`);
  };
  if (!Number.isInteger(m.contractVersion) || m.contractVersion < 1) throw new Error('contract version required');
  if (!Array.isArray(m.milestones) || !m.milestones.length) throw new Error('milestones required');
  unique(m.milestones, 'milestone');
  const milestone = x => { if (!m.milestones.includes(x)) throw new Error(`unknown milestone: ${x}`); };
  milestone(m.milestone);
  if (!m.rules?.length) throw new Error('rules required');
  unique(m.rules.map(x => x.id), 'rule');
  unique(m.checks.map(x => x.id), 'check');
  const rules = new Set(m.rules.map(x => x.id));
  const bars = new Set(Object.keys(m.bars));
  for (const [id,b] of Object.entries(m.bars)) {
    milestone(b.dueAt);
    if (id === 'F1' && (typeof b.participant !== 'string' || !b.participant.trim()))
      throw new Error('F1 designated participant required');
    if (typeof b.human !== 'boolean' || !b.contract?.trim()) throw new Error(`invalid bar ${id}`);
  }
  const own = x => {
    if (!(rules.has(x.ruleId) || bars.has(x.barId))) throw new Error(`missing or unknown owner: ${x.id}`);
  };
  for (const x of m.checks) { milestone(x.dueAt); own(x); }
  const obligations = [];
  for (const key of m.milestones) {
    if (!Array.isArray(m.exitObligations[key])) throw new Error(`missing obligations: ${key}`);
    for (const x of m.exitObligations[key]) { own(x); obligations.push(x.id); }
  }
  unique(obligations, 'obligation');
  for (const key of Object.keys(m.exitObligations)) milestone(key);
  return m;
}
export function readManifest() {
  return validateManifest(JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url))));
}
