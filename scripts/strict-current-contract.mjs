import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_ROOTS = Object.freeze(["src", "packages/core/src"]);

// Match counts make the file allowlist occurrence-exact: adding another
// unsupported branch to an already-allowed file fails just as adding one to a
// new file does.
const ALTERNATE_PATH_MATCH_COUNTS = Object.freeze({
  "SC-01": {},
  "SC-02": {},
  "SC-03": {},
  "SC-04": {},
  "SC-05": {},
  "SC-06": {},
  "SC-07": {},
  "SC-08": {},
  "SC-09": {},
  "SC-10": {},
  "SC-11": {},
  "SC-12": {},
  "SC-13": {},
  "SC-14": {},
  "SC-15": {},
});

/**
 * Negative contract rules for alternate authorities and inferred wire fields.
 * The allowlists remain empty; any match bypasses the current strict model,
 * storage, controller, or simulation contract.
 */
export const STRICT_CURRENT_CONTRACT_RULES = Object.freeze([
  {
    id: "SC-01",
    description: "version-defaulting and catalog-profile normalization",
    pattern:
      /CATALOG_PROFILES|catalogProfileForWireVersion|catalogProfile|version\s*\|\|\s*1|version\s*\?\?\s*1/g,
    allowedFiles: [],
  },
  {
    id: "SC-02",
    description: "connection endpoint inference and wire compatibility",
    pattern:
      /DEFAULT_PORT|dynamicPortPolicy|__wireCompatibility|allowMissingPorts|infer(?:red|ence)?(?:Endpoint|Port)|scorePortPair|function portFor\(|connection\.kind === portDefinition/g,
    allowedFiles: [],
  },
  {
    id: "SC-03",
    description: "automatic remote-control rebinding",
    pattern:
      /repairRemoteControlProfiles|remoteBindingDiagnostics|MIGRATED UNBOUND/g,
    allowedFiles: [],
  },
  {
    id: "SC-04",
    description: "non-compiled mechanism and portless wheel fallbacks",
    pattern: /alternatePoseOwner|body-owning fallback|allowNoPort|no-port/g,
    allowedFiles: [],
  },
  {
    id: "SC-05",
    description: "telemetry consumers falling back to editor/live state",
    pattern:
      /fallbackMachine|fallbackPositions|telemetryParts\(snapshot,\s*fallback|telemetryConnections\(snapshot,\s*fallback|physicalComponents\([^\n]+machine|motionSpeed|launchState|recorder\.ingest\(\s*[^,\n]+\s*,|setMotionSpeed|setLaunchState/g,
    allowedFiles: [],
  },
  {
    id: "SC-06",
    description: "unknown executable provenance aliases",
    pattern: /UNKNOWN_PROVENANCE_ALIAS|unknown-provenance-alias/g,
    allowedFiles: [],
  },
  {
    id: "SC-07",
    description: "machine-level controller program fields",
    pattern:
      /migratedProgram|machine scriptSource|wire\.script(?:ControllerId|Language|Sources|Source)|metadata\.script(?:ControllerId|Language|Sources)|script(?:ControllerId|Language|Sources):\s*state\.script/g,
    allowedFiles: [],
  },
  {
    id: "SC-08",
    description: "raw portable assets wrapped as share packages",
    pattern:
      /input\.format === ["']simulacrum-blueprint["']|input\.format === SUBASSEMBLY_FORMAT/g,
    allowedFiles: [],
  },
  {
    id: "SC-09",
    description: "alternate Blueprint Exchange catalog and tombstones",
    pattern:
      /alternateBlueprints|shareTombstones|#migrateCatalog|exportAlternate|importAlternate|origin:\s*["']alternate["']/g,
    allowedFiles: [],
  },
  {
    id: "SC-10",
    description: "alternate flat storage and compatibility mirrors",
    pattern:
      /#alternateSnapshot|mode:\s*["']alternate["']|Compatibility mirror|mirrorErrors/g,
    allowedFiles: [],
  },
  {
    id: "SC-11",
    description: "alternate one-part simulacrum.parts library",
    pattern: /simulacrum\.parts|customParts|item\?\.base/g,
    allowedFiles: [],
  },
  {
    id: "SC-12",
    description: "challenge proof version fallback",
    pattern: /proofVersion\s*(?:\|\||\?\?)|proofVersion\s*===/g,
    allowedFiles: [],
  },
  {
    id: "SC-13",
    description: "top-level editor and UI state proxies",
    pattern:
      /EDITOR_FIELDS|Object\.defineProperty\(state,\s*["']workspaceFocus["']/g,
    allowedFiles: [],
  },
  {
    id: "SC-14",
    description: "simulation-layer assembly compiler re-export",
    path: "src/simulation/assembly-compiler.js",
    allowedFiles: [],
  },
  {
    id: "SC-15",
    description: "WAT-era global controller-runtime names",
    pattern: /wasmRunning|wasmCommands/g,
    allowedFiles: [],
  },
]);

async function sourceFiles(root) {
  const files = [];
  async function visit(relativeDirectory) {
    const directory = path.join(root, relativeDirectory);
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries) {
      const relative = path.posix.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) await visit(relative);
      else if (/\.(?:js|mjs|json)$/.test(entry.name)) files.push(relative);
    }
  }
  for (const directory of SOURCE_ROOTS) await visit(directory);
  return files.sort();
}

/** @param {string} root */
export async function inspectStrictCurrentContract(root) {
  const files = await sourceFiles(root);
  const contents = new Map(
    await Promise.all(
      files.map(async (file) => [
        file,
        await fs.readFile(path.join(root, file), "utf8"),
      ]),
    ),
  );
  const findings = [];
  const invalidAllowlistEntries = [];

  for (const rule of STRICT_CURRENT_CONTRACT_RULES) {
    const matches = [];
    if (rule.path) {
      try {
        await fs.access(path.join(root, rule.path));
        matches.push({ file: rule.path, line: 1, text: rule.path });
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    } else {
      for (const [file, source] of contents) {
        const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
        for (const match of source.matchAll(pattern)) {
          const line = source.slice(0, match.index).split("\n").length;
          matches.push({ file, line, text: match[0] });
        }
      }
    }
    const matchedFiles = new Set(matches.map(({ file }) => file));
    const expectedCounts = ALTERNATE_PATH_MATCH_COUNTS[rule.id] || {};
    if (
      JSON.stringify(Object.keys(expectedCounts).sort()) !==
      JSON.stringify([...rule.allowedFiles].sort())
    )
      invalidAllowlistEntries.push({
        id: rule.id,
        file: "<inventory>",
        reason: "allowlist files and exact-count inventory disagree",
      });
    for (const allowedFile of rule.allowedFiles) {
      const actualCount = matches.filter(
        ({ file }) => file === allowedFile,
      ).length;
      if (
        !matchedFiles.has(allowedFile) ||
        actualCount !== expectedCounts[allowedFile]
      )
        invalidAllowlistEntries.push({
          id: rule.id,
          file: allowedFile,
          reason: `expected ${expectedCounts[allowedFile]} alternate-path matches, found ${actualCount}`,
        });
    }
    const allowed = new Set(rule.allowedFiles);
    findings.push({
      ...rule,
      matches,
      unexpected: matches.filter(({ file }) => !allowed.has(file)),
    });
  }

  return { findings, invalidAllowlistEntries };
}
