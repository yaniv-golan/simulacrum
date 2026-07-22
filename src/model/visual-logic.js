import { CONTROL_IR_VERSION, validateControlIR } from "./control-program-ir.js";
import {
  controllerBindingIndex,
  validateControllerBindingManifest,
} from "./controller-bindings.js";
import { finiteOr as numeric } from "./finite-or.js";

export const VISUAL_PROGRAM_VERSION = 1;

export const VISUAL_NODE_TYPES = Object.freeze({
  sensor: { label: "Sensor", inputs: 0 },
  constant: { label: "Constant", inputs: 0 },
  math: { label: "Math", inputs: 2 },
  compare: { label: "Compare", inputs: 2 },
  select: { label: "Select", inputs: 3 },
  clamp: { label: "Clamp", inputs: 1 },
  output: { label: "Actuator", inputs: 1 },
});

export const DEFAULT_VISUAL_PROGRAM = Object.freeze({
  version: VISUAL_PROGRAM_VERSION,
  name: "New controller",
  nodes: [],
  links: [],
});

function identifier(value) {
  return `n_${String(value).replace(/[^a-zA-Z0-9_$]/g, "_")}`;
}

function quote(value) {
  return JSON.stringify(String(value || ""));
}

export function normalizeVisualProgram(input) {
  const source = input && typeof input === "object" ? input : {},
    ids = new Set(),
    nodes = [];
  for (const [index, raw] of (source.nodes || []).slice(0, 64).entries()) {
    const type = VISUAL_NODE_TYPES[raw?.type] ? raw.type : "constant";
    let id = String(raw?.id || `${type}-${index + 1}`);
    while (ids.has(id)) id = `${id}-${index + 1}`;
    ids.add(id);
    nodes.push({
      ...structuredClone(raw || {}),
      id,
      type,
      x: numeric(raw?.x, 24 + (index % 4) * 210),
      y: numeric(raw?.y, 24 + Math.floor(index / 4) * 120),
    });
  }
  const links = (source.links || [])
    .slice(0, 128)
    .map((link) => ({
      from: String(link?.from || ""),
      to: String(link?.to || ""),
      input: Math.max(0, Math.floor(numeric(link?.input))),
    }))
    .filter(
      (link) => ids.has(link.from) && ids.has(link.to) && link.from !== link.to,
    );
  return {
    version: VISUAL_PROGRAM_VERSION,
    name: String(source.name || "Visual controller").slice(0, 48),
    nodes,
    links,
  };
}

export function validateVisualProgram(input, bindingManifest = null) {
  if (!input || typeof input !== "object")
    throw new TypeError("visual program must be an object");
  if (input.version !== VISUAL_PROGRAM_VERSION)
    throw new Error(`unsupported visual program version ${input.version}`);
  if (!Array.isArray(input.nodes) || !Array.isArray(input.links))
    throw new Error("visual program nodes and links must be arrays");
  for (const node of input.nodes)
    if (!VISUAL_NODE_TYPES[node?.type])
      throw new Error(`unknown visual node type ${String(node?.type)}`);
  const program = normalizeVisualProgram(input),
    byId = new Map(program.nodes.map((node) => [node.id, node])),
    incoming = new Map(program.nodes.map((node) => [node.id, []])),
    outgoing = new Map(program.nodes.map((node) => [node.id, []])),
    indegree = new Map(program.nodes.map((node) => [node.id, 0]));
  for (const link of program.links) {
    const target = byId.get(link.to),
      limit = VISUAL_NODE_TYPES[target.type].inputs;
    if (link.input >= limit)
      throw new Error(`${target.id} has no input ${link.input + 1}`);
    if (incoming.get(link.to).some((item) => item.input === link.input))
      throw new Error(
        `${target.id} input ${link.input + 1} is connected twice`,
      );
    incoming.get(link.to).push(link);
    outgoing.get(link.from).push(link.to);
    indegree.set(link.to, indegree.get(link.to) + 1);
  }
  const queue = program.nodes
      .filter((node) => indegree.get(node.id) === 0)
      .map((node) => node.id),
    order = [];
  while (queue.length) {
    const id = queue.shift();
    order.push(id);
    for (const target of outgoing.get(id)) {
      indegree.set(target, indegree.get(target) - 1);
      if (indegree.get(target) === 0) queue.push(target);
    }
  }
  if (order.length !== program.nodes.length)
    throw new Error("visual logic contains a feedback cycle");
  if (bindingManifest) {
    const bindings = validateControllerBindingManifest(bindingManifest);
    for (const node of program.nodes) {
      if (node.type === "sensor")
        controllerBindingIndex(bindings, node.bindingId, "input");
      if (node.type === "output")
        controllerBindingIndex(bindings, node.bindingId, "output");
    }
  }
  return { program, byId, incoming, order };
}

export function compileVisualProgram(input, bindingManifest) {
  const bindings = validateControllerBindingManifest(bindingManifest),
    { program, byId, incoming, order } = validateVisualProgram(input, bindings),
    lines = [
      "function tick(api: { read(name: string): number; write(name: string, value: number): void }, dt: number): void {",
      "  void dt;",
    ],
    irStatements = [],
    irLocals = order
      .map((id) => byId.get(id))
      .filter((node) => node.type !== "output")
      .map((node) => identifier(node.id)),
    valueFor = (nodeId, input) => {
      const link = incoming
        .get(nodeId)
        .find((candidate) => candidate.input === input);
      return link ? identifier(link.from) : "0";
    },
    irValueFor = (nodeId, input) => {
      const link = incoming
        .get(nodeId)
        .find((candidate) => candidate.input === input);
      return link
        ? { kind: "local", name: identifier(link.from) }
        : { kind: "number", value: 0 };
    };
  for (const id of order) {
    const node = byId.get(id),
      name = identifier(id);
    if (node.type === "sensor") {
      lines.push(`  const ${name} = api.read(${quote(node.bindingId)});`);
      irStatements.push({
        kind: "set-local",
        name,
        value: { kind: "read", bindingId: String(node.bindingId) },
      });
    } else if (node.type === "constant") {
      lines.push(`  const ${name} = ${numeric(node.value)};`);
      irStatements.push({
        kind: "set-local",
        name,
        value: { kind: "number", value: numeric(node.value) },
      });
    } else if (node.type === "math") {
      const operator =
          { add: "+", sub: "-", mul: "*", div: "/" }[node.op] || "+",
        left = valueFor(id, 0),
        right = valueFor(id, 1),
        expression =
          operator === "/"
            ? `${left} / (Math.abs(${right}) < 1e-9 ? 1e-9 : ${right})`
            : `${left} ${operator} ${right}`;
      lines.push(`  const ${name} = ${expression};`);
      const irOperator =
          { add: "add", sub: "subtract", mul: "multiply", div: "divide" }[
            node.op
          ] || "add",
        irLeft = irValueFor(id, 0),
        irRight = irValueFor(id, 1),
        guardedRight =
          irOperator === "divide"
            ? {
                kind: "conditional",
                condition: {
                  kind: "binary",
                  operator: "lt",
                  left: {
                    kind: "builtin",
                    name: "abs",
                    arguments: [irRight],
                  },
                  right: { kind: "number", value: 1e-9 },
                },
                whenTrue: { kind: "number", value: 1e-9 },
                whenFalse: irRight,
              }
            : irRight;
      irStatements.push({
        kind: "set-local",
        name,
        value: {
          kind: "binary",
          operator: irOperator,
          left: irLeft,
          right: guardedRight,
        },
      });
    } else if (node.type === "compare") {
      const operator =
        { lt: "<", lte: "<=", gt: ">", gte: ">=", eq: "===" }[node.op] || ">";
      lines.push(
        `  const ${name} = ${valueFor(id, 0)} ${operator} ${valueFor(id, 1)} ? 1 : 0;`,
      );
      irStatements.push({
        kind: "set-local",
        name,
        value: {
          kind: "binary",
          operator:
            { lt: "lt", lte: "lte", gt: "gt", gte: "gte", eq: "equal" }[
              node.op
            ] || "gt",
          left: irValueFor(id, 0),
          right: irValueFor(id, 1),
        },
      });
    } else if (node.type === "select") {
      lines.push(
        `  const ${name} = ${valueFor(id, 0)} > 0.5 ? ${valueFor(id, 1)} : ${valueFor(id, 2)};`,
      );
      irStatements.push({
        kind: "set-local",
        name,
        value: {
          kind: "conditional",
          condition: {
            kind: "binary",
            operator: "gt",
            left: irValueFor(id, 0),
            right: { kind: "number", value: 0.5 },
          },
          whenTrue: irValueFor(id, 1),
          whenFalse: irValueFor(id, 2),
        },
      });
    } else if (node.type === "clamp") {
      lines.push(
        `  const ${name} = Math.max(${numeric(node.min, -1)}, Math.min(${numeric(node.max, 1)}, ${valueFor(id, 0)}));`,
      );
      irStatements.push({
        kind: "set-local",
        name,
        value: {
          kind: "builtin",
          name: "max",
          arguments: [
            { kind: "number", value: numeric(node.min, -1) },
            {
              kind: "builtin",
              name: "min",
              arguments: [
                { kind: "number", value: numeric(node.max, 1) },
                irValueFor(id, 0),
              ],
            },
          ],
        },
      });
    } else if (node.type === "output") {
      lines.push(`  api.write(${quote(node.bindingId)}, ${valueFor(id, 0)});`);
      irStatements.push({
        kind: "write",
        bindingId: String(node.bindingId),
        value: irValueFor(id, 0),
      });
      continue;
    }
  }
  lines.push("}");
  const ir = validateControlIR({
    version: CONTROL_IR_VERSION,
    bindingManifest: bindings,
    globals: [],
    functions: [
      {
        name: "tick",
        parameters: ["dt"],
        locals: irLocals,
        returnsValue: false,
        body: irStatements,
      },
    ],
    entry: "tick",
  });
  return { program, source: lines.join("\n"), ir };
}
