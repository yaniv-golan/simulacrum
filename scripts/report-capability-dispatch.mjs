import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TYPES } from "../src/model/component-catalog.js";
import { analyzeCapabilityDispatch } from "./lib/capability-dispatch-analyzer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REVIEWED_CAPABILITY_DISPATCH_BASELINE = Object.freeze({
  commit: "unreleased-component-inspection-s2-and-rover-egress-2026-07-25",
  sites: 229,
  sha256: "94da6bbd7d71627a4b6f9b30cdb9ff5ce3a15f8c186ef9119686e73d116c0845",
});

const POLICIES = Object.freeze([
  {
    pattern: /^(?:scripts|test|examples)\//,
    family: "verification-fixtures",
    disposition: "KEEP",
    owner: "verification",
    expiry: "permanent",
    reason:
      "Verification and example fixtures may name ordinary catalog types but cannot select production physics.",
  },
  {
    pattern: /^src\/model\/demo-blueprints\.js$/,
    family: "ordinary-built-in-fixtures",
    disposition: "KEEP",
    owner: "model/demo-blueprints",
    expiry: "permanent",
    reason:
      "Built-ins author ordinary strict component types; the identity is fixture data, not runtime dispatch.",
  },
  {
    pattern:
      /^src\/model\/(?:assembly-model|blueprint-decoder|blueprints|component-wire-contract|controller-bindings|ports|share-packages|subassemblies|workspaces)\.js$/,
    family: "strict-wire-and-model-boundary",
    disposition: "KEEP",
    owner: "model/wire-boundary",
    expiry: "permanent",
    reason:
      "Strict discriminated decoding, catalog config resolution, and typed asset summaries are model-boundary adapters.",
  },
  {
    pattern:
      /^src\/model\/(?:assembly-compiler|engineering-analysis|geometry-descriptors)\.js$/,
    family: "geometry-mass-and-compiler",
    disposition: "REPLACE",
    owner: "model/assembly-compiler",
    expiry: "forbidden",
    reason:
      "Authoritative geometry, mass, topology, and coordinate routing must consume canonical capability descriptors.",
  },
  {
    pattern: /^src\/model\/(?:failure-analysis|failure-event-extractors)\.js$/,
    family: "failure-read-model",
    disposition: "KEEP",
    owner: "model/failure-analysis",
    expiry: "permanent",
    reason:
      "Failure reports use the catalog only to resolve stable names and descriptions after authoritative failure state exists.",
  },
  {
    pattern:
      /^src\/model\/(?:challenge-binding-resolver|challenge-lab|physical-components)\.js$/,
    family: "challenge-and-capability-reading",
    disposition: "REPLACE",
    owner: "model/challenge-contracts",
    expiry: "forbidden",
    reason:
      "Challenge and machine capability decisions must consume compiled capabilities and stable telemetry outcomes.",
  },
  {
    pattern:
      /^src\/model\/(?:component-contracts|component-preflight|sensor-contracts|visual-logic)\.js$/,
    family: "declared-model-adapters",
    disposition: "KEEP",
    owner: "model/catalog-adapters",
    expiry: "permanent",
    reason:
      "These are bounded catalog-to-declared-contract or presentation-logic adapters, not simulation behavior.",
  },
  {
    pattern:
      /^src\/simulation\/(?:multibody-runtime|wheel-drive-topology)\.js$/,
    family: "rolling-contact-suspension-and-drivetrain",
    disposition: "REPLACE",
    owner: "simulation/mechanism-contact",
    expiry: "forbidden",
    reason:
      "Wheel, tire, suspension, steering, and drivetrain behavior must route through compiled descriptors and physical contact.",
  },
  {
    pattern:
      /^src\/simulation\/(?:actuator-contracts|articulated-assembly-controller|controller-sensors|power-network|run-assembly-graph|signal-network|systems\/command-routing-system)\.js$/,
    family: "actuation-networks-sensors-and-runtime-state",
    disposition: "REPLACE",
    owner: "simulation/capability-adapters",
    expiry: "forbidden",
    reason:
      "Runtime systems must consume declared actuator, network, sensor, energy, and state-owner descriptors rather than part names.",
  },
  {
    pattern:
      /^src\/application\/(?:direct-control-feature|workshop-(?:build|run)-composition)\.js$/,
    family: "implicit-vehicle-reconstruction",
    disposition: "DELETE",
    owner: "application/direct-controls",
    expiry: "forbidden",
    reason:
      "Vehicle reconstruction and cart-rig inference are replaced by ordinary compiled mechanisms and declared controls.",
  },
  {
    pattern:
      /^src\/application\/(?:assembly-capability-reader|editor-connection-feature)\.js$/,
    family: "authoring-and-capability-tools",
    disposition: "REPLACE",
    owner: "application/editor-mechanisms",
    expiry: "forbidden",
    reason:
      "Snapping, measurements, and capability summaries must use ports, frames, coordinates, descriptors, and telemetry.",
  },
  {
    pattern:
      /^src\/application\/(?:challenge-state-adapter|demo-challenge-feature)\.js$/,
    family: "challenge-application-routing",
    disposition: "REPLACE",
    owner: "application/challenges",
    expiry: "forbidden",
    reason:
      "Challenge state and success must bind to compiled topology and telemetry, not selected component names.",
  },
  {
    pattern:
      /^src\/application\/(?:assembly-editor-feature|assembly-transform-commands|assembly-workspace|blueprint-loading-feature|build-history-feature|build-history-snapshot|command-candidate-reader|component-authoring-commands|component-inspection-feature|component-inspection-observation-adapters|controller-binding-editor-adapter|controller-editor-feature|controller-lifecycle-feature|controller-sensor-capture|debug-read-model-feature|editor-inspector-actions|editor-keyboard-composition|editor-presentation-subsystem|editor-selection-feature|executable-trust-feature|flexible-line-debug-read-model|keyboard-shortcut-controller|pending-placement-command|remote-control-read-model|remote-control-state|simulation-lifecycle-feature|two-ended-component-authoring|workspace-persistence)\.js$/,
    family: "application-boundary-and-read-model",
    disposition: "KEEP",
    owner: "application/use-cases",
    expiry: "permanent",
    reason:
      "These sites select declared controllers, controls, history, strict boundaries, labels, or telemetry projection without selecting physics.",
  },
  {
    pattern:
      /^src\/presentation\/(?:component-mesh-factory|large-assembly-batcher)\.js$/,
    family: "visual-factory-and-batching",
    disposition: "KEEP",
    owner: "presentation/meshes",
    expiry: "permanent",
    reason:
      "Bounded visual factories and batching may select a renderer adapter after authoritative geometry is compiled.",
  },
  {
    pattern: /^src\/presentation\//,
    family: "presentation-and-text-read-model",
    disposition: "KEEP",
    owner: "presentation/read-models",
    expiry: "permanent",
    reason:
      "Presentation sites may choose labels, forms, visual adapters, and read-model fields but must not create authoritative physics.",
  },
]);

function classify(finding) {
  const policy = POLICIES.find(({ pattern }) => pattern.test(finding.file));
  if (!policy) return null;
  return {
    family: policy.family,
    disposition: policy.disposition,
    owner: policy.owner,
    expiry: policy.expiry,
    reason: policy.reason,
  };
}

export async function capabilityDispatchReport() {
  return analyzeCapabilityDispatch({
    root,
    componentTypes: Object.keys(TYPES),
    classify,
  });
}

export function capabilityDispatchDigest(report) {
  const rows = report.findings.map(
    ({
      file,
      line,
      column,
      kind,
      expression,
      family,
      disposition,
      owner,
      expiry,
    }) => ({
      file,
      line,
      column,
      kind,
      expression,
      family,
      disposition,
      owner,
      expiry,
    }),
  );
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

function renderSummary(report) {
  const digest = capabilityDispatchDigest(report);
  return [
    `Capability dispatch inventory: ${report.findings.length} sites across ${new Set(report.findings.map(({ file }) => file)).size} files`,
    `KEEP ${report.counts.KEEP} · REPLACE ${report.counts.REPLACE} · DELETE ${report.counts.DELETE} · UNCLASSIFIED ${report.counts.UNCLASSIFIED}`,
    `SHA-256 ${digest} · reviewed at ${REVIEWED_CAPABILITY_DISPATCH_BASELINE.commit}`,
  ];
}

function renderText(report) {
  const lines = renderSummary(report);
  for (const finding of report.findings)
    lines.push(
      `${finding.disposition}\t${finding.family}\t${finding.file}:${finding.line}:${finding.column}\t${finding.kind}\t${finding.expression}`,
    );
  return `${lines.join("\n")}\n`;
}

const invokedDirectly = process.argv[1]
  ? path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
  : false;
if (invokedDirectly) {
  const report = await capabilityDispatchReport();
  const check = process.argv.includes("--check");
  if (process.argv.includes("--json"))
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  else if (check) process.stdout.write(`${renderSummary(report).join("\n")}\n`);
  else process.stdout.write(renderText(report));
  if (check) {
    const digest = capabilityDispatchDigest(report);
    if (report.unclassified.length) process.exitCode = 1;
    if (
      report.findings.length !== REVIEWED_CAPABILITY_DISPATCH_BASELINE.sites ||
      digest !== REVIEWED_CAPABILITY_DISPATCH_BASELINE.sha256
    ) {
      process.stderr.write(
        `Capability dispatch inventory changed: expected ${REVIEWED_CAPABILITY_DISPATCH_BASELINE.sites} sites / ${REVIEWED_CAPABILITY_DISPATCH_BASELINE.sha256}, received ${report.findings.length} / ${digest}. Review every changed line and update the classified baseline deliberately.\n`,
      );
      process.exitCode = 1;
    }
  }
}
