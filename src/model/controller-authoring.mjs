export const CONTROLLER_LIMITS = Object.freeze({ count: 8 });
export const CONTROLLER_INPUT_PORTS = Object.freeze(
  Array.from({ length: 16 }, (_, i) => 'input' + (i + 1)),
);
export const CONTROLLER_OUTPUT_PORTS = Object.freeze(
  Array.from({ length: 8 }, (_, i) => 'out' + (i + 1)),
);
import { immutableCopy } from './observation.mjs';
export const RULE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['input', 'operator', 'threshold', 'output', 'duty', 'otherwise'],
  properties: {
    input: { type: 'string', pattern: '^input([1-9]|1[0-6])$' },
    status: { enum: ['ok', 'no-return', 'initializing'] },
    operator: { enum: ['<', '<=', '>', '>=', '===', '!=='] },
    threshold: { type: 'number', minimum: -1e6, maximum: 1e6 },
    output: { type: 'string', pattern: '^out[1-8]$' },
    duty: { type: 'number', minimum: -1, maximum: 1 },
    otherwise: { type: 'number', minimum: -1, maximum: 1 },
  },
};
export const CONTROLLER_AUTHORING_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['version', 'mode', 'source', 'rules', 'savedCode'],
  properties: {
    version: { const: 1 },
    mode: { enum: ['rules', 'code'] },
    source: { type: 'string', pattern: '^[\\s\\S]{0,16384}$' },
    rules: { type: 'array', maxItems: 8, items: RULE_SCHEMA },
    savedCode: {
      type: 'array',
      maxItems: 16,
      items: { type: 'string', pattern: '^[\\s\\S]{0,16384}$' },
    },
  },
};
export function generateRuleSource(rules) {
  if (!Array.isArray(rules) || rules.length > 8) throw Error('At most eight rules are supported.');
  const outputs = new Set(),
    lines = ['function tick() {'],
    mappings = [];
  for (const [index, r] of rules.entries()) {
    if (
      !/^input([1-9]|1[0-6])$/.test(r.input) ||
      !/^out[1-8]$/.test(r.output) ||
      !['<', '<=', '>', '>=', '===', '!=='].includes(r.operator) ||
      (r.status !== undefined && !['ok', 'no-return', 'initializing'].includes(r.status)) ||
      ![r.threshold, r.duty, r.otherwise].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e6) ||
      Math.abs(r.duty) > 1 ||
      Math.abs(r.otherwise) > 1 ||
      outputs.has(r.output)
    )
      throw Error('Invalid rule.');
    outputs.add(r.output);
    const start = lines.join('\n').length + 1;
    const condition =
      r.status === undefined
        ? `read(${JSON.stringify(r.input)}) ${r.operator} ${r.threshold}`
        : `status(${JSON.stringify(r.input)}) === ${{ ok: 0, 'no-return': 2, initializing: 3 }[r.status]}`;
    const guard = r.status === undefined ? `valid(${JSON.stringify(r.input)})` : `1`;
    const conditionPrefix = `    if (`;
    const block = [
      `  if (${guard}) {`,
      conditionPrefix + condition + `) {`,
      `      mark(${index * 2});`,
      `      write(${JSON.stringify(r.output)}, ${r.duty});`,
      `    } else {`,
      `      mark(${index * 2 + 1});`,
      `      write(${JSON.stringify(r.output)}, ${r.otherwise});`,
      `    }`,
      `  }`,
    ];
    const thresholdStart =
      start +
      block[0].length +
      1 +
      conditionPrefix.length +
      `read(${JSON.stringify(r.input)}) ${r.operator} `.length;
    mappings.push({
      block: [start, start + block.join('\n').length],
      ...(r.status === undefined
        ? { threshold: [thresholdStart, thresholdStart + String(r.threshold).length] }
        : {}),
    });
    lines.push(...block);
  }
  return { source: lines.concat('}').join('\n'), rules: mappings };
}
export const generateRules = (rules) => generateRuleSource(rules).source;
export function admitControllerAuthoring(input) {
  const p = immutableCopy(input);
  if (
    Object.keys(p).sort().join() !== 'mode,rules,savedCode,source,version' ||
    p.version !== 1 ||
    !['rules', 'code'].includes(p.mode) ||
    typeof p.source !== 'string' ||
    p.source.length > 16384 ||
    !Array.isArray(p.savedCode) ||
    p.savedCode.length > 16 ||
    !p.savedCode.every((s) => typeof s === 'string' && s.length <= 16384)
  )
    throw Error('Invalid controller draft.');
  const generated = generateRules(p.rules);
  if (p.mode === 'rules' && p.source !== generated) throw Error('Rules and code differ.');
  return p;
}
export const emptyControllerProgram = () =>
  immutableCopy({ version: 1, mode: 'rules', source: generateRules([]), rules: [], savedCode: [] });
/** Draft transitions are pure. Viewing does nothing; only a real edit leaves Rules mode. */
export function editControllerDraft(draft, action) {
  const next = structuredClone(draft);
  if (action.type === 'code' && action.source !== draft.source) {
    next.mode = 'code';
    next.source = action.source;
  } else if (action.type === 'rules') {
    if (draft.mode !== 'rules')
      throw Error(
        'Rules are disabled because the code was edited. Restore rules to use them again.',
      );
    next.rules = action.rules;
    next.source = generateRules(action.rules);
  } else if (action.type === 'restore-rules') {
    if (draft.mode === 'code') {
      if (draft.savedCode.length >= 16)
        throw Error('Export a saved code version before restoring rules.');
      next.savedCode.push(draft.source);
    }
    next.mode = 'rules';
    next.source = generateRules(next.rules);
  }
  if (next.source.length > 16384) throw Error('Program is too large.');
  return admitControllerAuthoring(next);
}
