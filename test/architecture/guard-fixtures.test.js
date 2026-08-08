import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeArchitecture } from "../../scripts/lib/architecture-analyzer.mjs";

const cases = [
  {
    name: "valid parsed graph",
    files: {
      "application/start.js":
        'import { value } from "../model/value.js"; export { value };',
      "model/value.js": "export const value = 1;",
    },
    expected: [],
  },
  {
    name: "valid narrow scripting model contract",
    files: {
      "scripting/runtime.js":
        'import { detachPlainData } from "../model/plain-data-contract.js"; export const detach = detachPlainData;',
      "model/plain-data-contract.js":
        "export const detachPlainData = (value) => value;",
    },
    expected: [],
  },
  {
    name: "valid narrow scripting identity contract",
    files: {
      "scripting/runtime.js":
        'import { compareCanonicalIds } from "../model/canonical-id-contract.js"; export const compare = compareCanonicalIds;',
      "model/canonical-id-contract.js":
        "export const compareCanonicalIds = (left, right) => String(left).localeCompare(String(right));",
    },
    expected: [],
  },
  {
    name: "broad scripting model surface",
    files: {
      "scripting/runtime.js":
        'import { detachPlainData } from "../model/primitives.js"; export const detach = detachPlainData;',
      "model/primitives.js": "export const detachPlainData = (value) => value;",
    },
    expected: ["SCRIPTING_MODEL_SURFACE"],
  },
  {
    name: "dynamic layer escape",
    files: {
      "presentation/view.js":
        'export const load = () => import("../simulation/engine.js");',
      "simulation/engine.js": "export const engine = true;",
    },
    expected: ["LAYER_DIRECTION"],
  },
  {
    name: "dynamic cycle",
    files: {
      "model/a.js": 'export { b } from "./b.js";',
      "model/b.js": 'export const b = import("./a.js");',
    },
    expected: ["MODULE_CYCLE"],
  },
  {
    name: "nonliteral dynamic import",
    files: {
      "application/start.js": "export const load = (target) => import(target);",
    },
    expected: ["NON_LITERAL_DYNAMIC_IMPORT"],
  },
  {
    name: "aliased computed DOM access",
    files: {
      "simulation/system.js":
        'const browserDocument = globalThis["document"]; const select = browserDocument.querySelector; export { select };',
    },
    expected: ["FORBIDDEN_PRESENTATION_API"],
  },
  {
    name: "aliased demo dispatch",
    files: {
      "simulation/system.js":
        "export function step(state) { const runtimeState = state; return runtimeState.demo; }",
    },
    expected: ["DEMO_PHYSICS_DISPATCH"],
  },
  {
    name: "computed browser storage bypass",
    files: {
      "model/store.js":
        'const cache = globalThis["localStorage"]; export const read = () => cache.getItem("x");',
    },
    expected: ["BROWSER_STORAGE_BYPASS"],
  },
  {
    name: "destructured demo dispatch",
    files: {
      "simulation/system.js":
        "export function step(state) { const { demo } = state; return demo; }",
    },
    expected: ["DEMO_PHYSICS_DISPATCH"],
  },
  {
    name: "destructured DOM call",
    files: {
      "model/value.js":
        "const { querySelector: select } = document; export const value = select('#value');",
    },
    expected: ["FORBIDDEN_PRESENTATION_API"],
  },
  {
    name: "destructured async scripting API",
    files: {
      "scripting/runtime.js":
        "const { setTimeout: defer } = globalThis; export const run = () => defer(() => {}, 0);",
    },
    expected: ["UNSAFE_SCRIPTING_API"],
  },
];

export async function verifyArchitectureGuardFixtures() {
  const temporaryRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "simulacrum-architecture-fixtures-"),
  );
  try {
    for (const fixture of cases) {
      const root = path.join(temporaryRoot, fixture.name.replaceAll(" ", "-")),
        sourceRoot = path.join(root, "src");
      for (const [relativePath, source] of Object.entries(fixture.files)) {
        const target = path.join(sourceRoot, relativePath);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, source);
      }
      const result = await analyzeArchitecture({ root, sourceRoot }),
        codes = new Set(result.violations.map((item) => item.code));
      for (const expected of fixture.expected)
        assert.ok(
          codes.has(expected),
          `${fixture.name} evaded ${expected}: ${JSON.stringify(result.violations)}`,
        );
      if (!fixture.expected.length)
        assert.deepEqual(result.violations, [], `${fixture.name} was rejected`);
    }
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
  return { cases: cases.length };
}
