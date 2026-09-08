import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export function validateInvariantCoverage(
  manifest,
  { root = process.cwd(), read = (path) => readFileSync(resolve(root, path), 'utf8') } = {},
) {
  const fail = (detail) => {
    throw Error(`invalid invariant coverage: ${detail}`);
  };
  if (!Array.isArray(manifest.invariants) || !manifest.invariants.length)
    fail('invariants required');
  const ids = new Set();
  const checks = new Map(
    [
      ...manifest.checks,
      ...Object.values(manifest.exitObligations).flat(),
      ...(manifest.browserChecks ?? []),
    ].map((x) => [x.id, x]),
  );
  const pointer = (p, prefix) => {
    if (
      !p ||
      typeof p.path !== 'string' ||
      !p.path.startsWith(prefix) ||
      p.path.split('/').some((x) => x === '..') ||
      typeof p.anchor !== 'string' ||
      !p.anchor.trim()
    )
      fail('invalid pointer');
    let source;
    try {
      source = read(p.path);
    } catch {
      fail(`missing ${p.path}`);
    }
    if (!source.includes(p.anchor)) fail(`missing anchor ${p.path}: ${p.anchor}`);
  };
  for (const x of manifest.invariants) {
    if (!x || typeof x.id !== 'string' || !/^[a-z][a-z0-9-]+$/.test(x.id) || ids.has(x.id))
      fail('invalid or duplicate id');
    ids.add(x.id);
    if (!manifest.rules.some((r) => r.id === x.ruleId)) fail(`unknown rule ${x.id}`);
    if (!manifest.milestones.includes(x.dueAt)) fail(`unknown milestone ${x.id}`);
    if (typeof x.guarantee !== 'string' || !x.guarantee.trim()) fail(`missing guarantee ${x.id}`);
    if (!Array.isArray(x.owners) || !x.owners.length) fail(`missing owner ${x.id}`);
    x.owners.forEach((p) => pointer(p, p?.path?.startsWith('scripts/') ? 'scripts/' : 'src/'));
    for (const kind of ['positive', 'negative']) {
      if (!Array.isArray(x.controls?.[kind]) || !x.controls[kind].length)
        fail(`missing ${kind} control ${x.id}`);
      x.controls[kind].forEach((p) => pointer(p, 'test/'));
    }
    if (!Array.isArray(x.checks) || !x.checks.length) fail(`missing check ownership ${x.id}`);
    for (const id of x.checks)
      if (!checks.has(id) || checks.get(id).ruleId !== x.ruleId)
        fail(`unknown or incompatible check ${id}`);
    for (const id of x.checks) {
      const check = checks.get(id);
      if (
        check.dueAt &&
        manifest.milestones.indexOf(check.dueAt) > manifest.milestones.indexOf(x.dueAt)
      )
        fail(`future check ${id} cannot own ${x.id}`);
    }
    if (!Array.isArray(x.qualificationBars)) fail(`qualification bars required ${x.id}`);
    for (const id of x.qualificationBars)
      if (!manifest.bars[id]) fail(`unknown qualification bar ${id}`);
  }
  return manifest.invariants;
}
export function explainInvariant(manifest, id) {
  const x = manifest.invariants.find((x) => x.id === id);
  if (!x) throw Error(`unknown invariant: ${id}`);
  return {
    ...x,
    enforcement: 'REGISTERED_CHECKS_NOT_EXECUTION_EVIDENCE',
    mechanisms: x.checks.map((id) =>
      [
        ...manifest.checks,
        ...Object.values(manifest.exitObligations).flat(),
        ...(manifest.browserChecks ?? []),
      ].find((check) => check.id === id),
    ),
    evidence:
      'Control pointers describe executable expectations; run checks on the current source for results.',
    qualification: x.qualificationBars.map((id) => ({
      id,
      ...manifest.bars[id],
      status:
        manifest.milestones.indexOf(manifest.bars[id].dueAt) >
        manifest.milestones.indexOf(manifest.milestone)
          ? 'DEFERRED'
          : manifest.bars[id].human
            ? 'HUMAN_EVIDENCE_REQUIRED'
            : 'REQUIRES_GATE_RESULT',
    })),
  };
}
