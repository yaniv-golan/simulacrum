import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "acorn";
import * as walk from "acorn-walk";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { builtInMechanismSubassemblies } from "../src/model/built-in-mechanism-subassemblies.js";
import { TYPES } from "../src/model/component-catalog.js";
import { geometryDescriptorForPart } from "../src/model/geometry-descriptors.js";
import { validateConnectionFrameInvariant } from "../src/model/connection-frame-invariants.js";
import { portDefinition } from "../src/model/ports.js";
import { COMPONENT_GEOMETRY_CONSUMER_MATRIX_V1 } from "./fixtures/component-geometry-consumer-matrix.js";
import { COMPONENT_VISUAL_WORKFLOW_MATRIX_V1 } from "./fixtures/component-visual-workflow-matrix.js";

const root = path.resolve(import.meta.dirname, ".."),
  diagnostics = [],
  scanned = [];

function report(source, jsonPath, error) {
  diagnostics.push({
    source,
    jsonPath,
    ...(error && typeof error === "object"
      ? {
          code: error.code || "COMPONENT_GEOMETRY_CUTOVER_ERROR",
          message: error.message || String(error),
          details: error.details || null,
        }
      : {
          code: "COMPONENT_GEOMETRY_CUTOVER_ERROR",
          message: String(error),
          details: null,
        }),
  });
}

function scanAssembly(source, assembly) {
  scanned.push(source);
  const byId = new Map(assembly.parts.map((part) => [part.id, part])),
    geometryById = new Map();
  for (const [index, part] of assembly.parts.entries()) {
    try {
      geometryById.set(part.id, geometryDescriptorForPart(part));
    } catch (error) {
      report(source, `parts[${index}]`, error);
    }
  }
  for (const [index, connection] of assembly.connections.entries()) {
    if (!["mechanical", "mesh"].includes(connection.kind)) continue;
    const partA = byId.get(connection.a),
      partB = byId.get(connection.b);
    if (!partA || !partB) {
      report(source, `connections[${index}]`, {
        code: "DANGLING_CONNECTION",
        message: "Physical connection references a missing part",
      });
      continue;
    }
    try {
      const invariant = validateConnectionFrameInvariant({
        connection,
        partA,
        partB,
        portA: portDefinition(partA, connection.portA, TYPES),
        portB: portDefinition(partB, connection.portB, TYPES),
        geometryA: geometryById.get(partA.id),
        geometryB: geometryById.get(partB.id),
      });
      if (!invariant.ok)
        report(source, `connections[${index}]`, invariant.diagnostic);
    } catch (error) {
      report(source, `connections[${index}]`, error);
    }
  }
}

for (const kind of ["gearbox", "cart", "humanoid", "drone", "mission"])
  scanAssembly(`builtInDemo(${kind})`, builtInDemo(kind).blueprint);
for (const record of builtInMechanismSubassemblies())
  scanAssembly(
    `builtInMechanismSubassembly(${record.asset.name})`,
    record.asset,
  );

const fixtureFiles = [];
async function collectFixtureFiles(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFixtureFiles(absolute);
    else if (entry.name.endsWith(".json")) fixtureFiles.push(absolute);
  }
}
function scanFixtureValue(source, value, jsonPath = "$") {
  if (!value || typeof value !== "object") return;
  if (
    ["simulacrum-blueprint", "simulacrum-subassembly"].includes(value.format) &&
    Array.isArray(value.parts) &&
    Array.isArray(value.connections)
  )
    scanAssembly(`${source}${jsonPath}`, value);
  if (Array.isArray(value))
    value.forEach((entry, index) =>
      scanFixtureValue(source, entry, `${jsonPath}[${index}]`),
    );
  else
    for (const [key, entry] of Object.entries(value))
      scanFixtureValue(source, entry, `${jsonPath}.${key}`);
}
await collectFixtureFiles(path.join(root, "test/fixtures"));
for (const fixturePath of fixtureFiles.sort())
  scanFixtureValue(
    path.relative(root, fixturePath),
    JSON.parse(await fs.readFile(fixturePath, "utf8")),
  );

const forbiddenAliases = [
    ".boundsPartM",
    ".dimensions",
    ".renderDetailAnchors",
    ".collisionRegions",
    ".compiledMechanismBody",
    ".localFramePart",
  ],
  sourceRoots = ["src/application", "src/presentation", "src/simulation"],
  sourceFiles = [];
async function collectFiles(directory) {
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(absolute);
    else if (/\.(js|mjs)$/.test(entry.name)) sourceFiles.push(absolute);
  }
}
for (const directory of sourceRoots)
  await collectFiles(path.join(root, directory));
for (const file of sourceFiles) {
  const text = await fs.readFile(file, "utf8");
  for (const alias of forbiddenAliases)
    if (text.includes(alias))
      report(path.relative(root, file), "source", {
        code: "LEGACY_GEOMETRY_AUTHORITY_REFERENCE",
        message: `Downstream source still references ${alias}`,
      });
  if (
    file.includes(`${path.sep}application${path.sep}`) &&
    /geometryDescriptorForType|componentMesh\(\s*["']/.test(text)
  )
    report(path.relative(root, file), "source", {
      code: "TYPE_ONLY_AUTHORED_PRESENTATION",
      message:
        "Authored application presentation used a type-only preview helper",
    });
}

const requiredConsumerLayers = Object.freeze([
  "model",
  "compiler",
  "analysis",
  "runtime",
  "presentation",
  "editor",
  "core",
  "docs",
  "tests",
]);
function executableTokenPresent(contents, token) {
  const tree = parse(contents, {
    ecmaVersion: "latest",
    sourceType: "module",
  });
  let found = false;
  walk.full(tree, (node) => {
    if (
      (node.type === "Identifier" && node.name === token) ||
      (node.type === "Literal" && node.value === token) ||
      (node.type === "Property" &&
        !node.computed &&
        node.key?.name === token) ||
      (node.type === "MemberExpression" &&
        !node.computed &&
        node.property?.name === token)
    )
      found = true;
  });
  for (const statement of tree.body) {
    if (
      [
        "ImportDeclaration",
        "ExportNamedDeclaration",
        "ExportAllDeclaration",
      ].includes(statement.type) &&
      statement.source?.value?.endsWith(token)
    )
      found = true;
    for (const specifier of statement.specifiers || [])
      if (
        specifier.local?.name === token ||
        specifier.exported?.name === token ||
        specifier.imported?.name === token
      )
        found = true;
  }
  return found;
}

for (const field of ["bounds", "appearance", "deformation"]) {
  const entries = COMPONENT_GEOMETRY_CONSUMER_MATRIX_V1.filter(
    (entry) => entry.field === field,
  );
  if (entries.length === 0)
    report("component consumer matrix", field, {
      code: "MISSING_CONSUMER_FIELD",
      message: `No consumers are frozen for ${field}`,
    });
  for (const entry of entries) {
    const absolute = path.join(root, entry.file);
    let contents;
    try {
      contents = await fs.readFile(absolute, "utf8");
    } catch (error) {
      report(entry.file, entry.field, error);
      continue;
    }
    const isDocumentation = entry.file.endsWith(".md");
    if (
      isDocumentation
        ? !contents.includes(entry.token)
        : !executableTokenPresent(contents, entry.token)
    )
      report(entry.file, entry.field, {
        code: "STALE_CONSUMER_MATRIX_ENTRY",
        message: `Expected executable consumer ${JSON.stringify(entry.token)} is absent`,
      });
  }
}
const coveredLayers = new Set(
  COMPONENT_GEOMETRY_CONSUMER_MATRIX_V1.map((entry) => entry.layer),
);
for (const layer of requiredConsumerLayers)
  if (!coveredLayers.has(layer))
    report("component consumer matrix", layer, {
      code: "MISSING_CONSUMER_LAYER",
      message: `No changed-field consumer is frozen for ${layer}`,
    });

for (const entry of COMPONENT_VISUAL_WORKFLOW_MATRIX_V1) {
  const contents = await fs.readFile(path.join(root, entry.file), "utf8");
  const tree = parse(contents, { ecmaVersion: "latest", sourceType: "module" });
  let executableAssertion = false;
  walk.ancestor(tree, {
    CallExpression(node, ancestors) {
      if (
        node.callee.type !== "Identifier" ||
        node.callee.name !== "assertCanonicalVisualProductState" ||
        ancestors.some((ancestor) =>
          [
            "ArrowFunctionExpression",
            "FunctionDeclaration",
            "FunctionExpression",
          ].includes(ancestor.type),
        )
      )
        return;
      const callSource = contents.slice(node.start, node.end);
      if (callSource.includes(entry.assertionLabel)) executableAssertion = true;
    },
  });
  if (!executableAssertion)
    report(entry.file, entry.operation, {
      code: "MISSING_VISUAL_WORKFLOW_ASSERTION",
      message: `Workflow has no top-level executable canonical assertion for ${JSON.stringify(entry.assertionLabel)}`,
    });
}

const output = {
  schemaVersion: 1,
  scannedSources: scanned.sort(),
  diagnosticCount: diagnostics.length,
  diagnostics,
};
if (process.argv.includes("--json"))
  console.log(JSON.stringify(output, null, 2));
else if (diagnostics.length)
  throw new Error(
    `component geometry cutover found ${diagnostics.length} diagnostics:\n${diagnostics
      .map(
        ({ source, jsonPath, code, message }) =>
          `${source} ${jsonPath} ${code}: ${message}`,
      )
      .join("\n")}`,
  );
else
  console.log(
    `component geometry cutover passed (${scanned.length} assemblies, zero diagnostics)`,
  );
