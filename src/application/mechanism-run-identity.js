import {
  fingerprintExperimentBlueprint,
  fingerprintRunConfigurationValue,
} from "../model/mechanism-artifact-identity.js";
import { deepFreeze, stableStringify } from "../model/primitives.js";
import { sha256Hex } from "../model/sha256.js";
import { CANNON_SOLVER_TRANSACTION_ID } from "../simulation/cannon-solver-transaction.js";

const encoder = new TextEncoder();

function identity(id, version, value) {
  const bytes = stableStringify(value);
  return {
    id,
    version,
    byteLength: encoder.encode(bytes).byteLength,
    sha256: sha256Hex(bytes),
  };
}

export function compiledTopologyFingerprint(compiled) {
  return `sim-sha256-${sha256Hex(
    stableStringify({
      sourceRevision: compiled.sourceRevision,
      bodies: compiled.bodies.map(({ id }) => id).sort(),
      constraints: compiled.constraints.map(({ id }) => id).sort(),
      contactRegions: compiled.contactRegions.map(({ id }) => id).sort(),
    }),
  )}`;
}

/** Creates the in-memory identity later validated at the portable export boundary. */
export function createWorkshopRunConfiguration({
  blueprint,
  compiled,
  environment,
}) {
  const topologyFingerprint = compiledTopologyFingerprint(compiled),
    blueprintFingerprint = fingerprintExperimentBlueprint(blueprint),
    terrainFingerprint = `sim-sha256-${sha256Hex(
      stableStringify({
        seed: "earth-coordinate-terrain-v1",
        latitude: environment.latitude,
        longitude: environment.longitude,
      }),
    )}`,
    materialMapFingerprint = `sim-sha256-${sha256Hex(
      stableStringify({ model: "explicit-material-pair-v1" }),
    )}`,
    configuration = deepFreeze({
      format: "simulacrum-run-configuration",
      version: 1,
      fixedStepS: 1 / 120,
      determinismTier: "same-build-bit-exact",
      seed: "workshop-session-v1",
      durationTicks: 1_000_000_000,
      identities: {
        build: identity("simulacrum/private-build", "0.1.0", {
          blueprintFingerprint,
        }),
        engine: identity("cannon-es", "0.20.0", { engine: "cannon-es" }),
        transaction: identity(
          CANNON_SOLVER_TRANSACTION_ID,
          "1",
          CANNON_SOLVER_TRANSACTION_ID,
        ),
        solverProfile: identity("solver/profile", "1", {
          fixedDt: 1 / 120,
          iterations: 18,
          tolerance: 1e-8,
        }),
        catalog: identity("component/catalog", "4", blueprint.parts),
        materials: identity("material/pairs", "1", materialMapFingerprint),
        environment: identity("earth/environment", "1", {
          ...environment,
          terrainFingerprint,
        }),
      },
      budgets: {
        maxBodies: 100_000,
        maxConstraints: 1_000_000,
        maxContactCandidates: 1_000_000,
        maxStepMs: 8,
        maxMemoryBytes: 1_000_000_000,
      },
      environment: {
        gravityMPerS2: [0, -9.80665, 0],
        terrainFingerprint,
        materialMapFingerprint,
      },
    });
  return Object.freeze({
    configuration,
    runConfigurationFingerprint:
      fingerprintRunConfigurationValue(configuration),
    blueprintFingerprint,
    compiledTopologyFingerprint: topologyFingerprint,
  });
}
