import {
  fingerprintExperimentBlueprint,
  fingerprintRunConfigurationValue,
} from "../model/mechanism-artifact-identity.js";
import { deepFreeze, stableStringify } from "../model/primitives.js";
import { CONTACT_MATERIAL_PAIRS } from "../model/contact-material-pairs.js";
import { sha256Hex } from "../model/sha256.js";
import { CANNON_SOLVER_TRANSACTION_ID } from "../simulation/cannon-solver-transaction.js";

const encoder = new TextEncoder();

export function fingerprintTestSiteDefinition(testSite) {
  return `sim-sha256-${sha256Hex(
    `simulacrum-test-site-v1\0${stableStringify(testSite)}`,
  )}`;
}

export function fingerprintContactMaterialMap() {
  return `sim-sha256-${sha256Hex(
    stableStringify({
      model: "explicit-material-pair-v1",
      pairs: [...CONTACT_MATERIAL_PAIRS].sort((left, right) =>
        stableStringify(left.materials).localeCompare(
          stableStringify(right.materials),
        ),
      ),
    }),
  )}`;
}

export function fingerprintTestDeployment(deployment) {
  return `sim-sha256-${sha256Hex(stableStringify(deployment))}`;
}

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
  const { testSite, deployment, ...environmentState } = environment,
    topologyFingerprint = compiledTopologyFingerprint(compiled),
    blueprintFingerprint = fingerprintExperimentBlueprint(blueprint),
    testSiteFingerprint = fingerprintTestSiteDefinition(testSite),
    terrainFingerprint = `sim-sha256-${sha256Hex(
      stableStringify({
        seed: "earth-coordinate-terrain-v1",
        latitude: environmentState.latitude,
        longitude: environmentState.longitude,
        testSiteFingerprint,
      }),
    )}`,
    materialMapFingerprint = fingerprintContactMaterialMap(),
    deploymentFingerprint = fingerprintTestDeployment(deployment),
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
          ...environmentState,
          terrainFingerprint,
          testSiteFingerprint,
          deployment,
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
    testSiteFingerprint,
    materialMapFingerprint,
    deploymentFingerprint,
    deployment: structuredClone(deployment),
    environment: deepFreeze({
      seed: "earth-coordinate-terrain-v1",
      latitude: environmentState.latitude,
      longitude: environmentState.longitude,
      timeOfDay: environmentState.timeOfDay,
      windEnabled: environmentState.windEnabled,
    }),
  });
}
