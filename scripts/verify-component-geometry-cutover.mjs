import fs from "node:fs/promises";
import path from "node:path";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import { builtInMechanismSubassemblies } from "../src/model/built-in-mechanism-subassemblies.js";
import { TYPES } from "../src/model/component-catalog.js";
import { geometryDescriptorForPart } from "../src/model/geometry-descriptors.js";
import { validateConnectionFrameInvariant } from "../src/model/connection-frame-invariants.js";
import { portDefinition } from "../src/model/ports.js";

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
