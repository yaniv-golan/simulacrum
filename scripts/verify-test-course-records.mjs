import { assert } from "./lib/assert.mjs";
import { WORKSHOP_TEST_SITE } from "../src/application/testing-playground-content.js";
import {
  createTestCourseRecordFeature,
  TEST_COURSE_PROOF_EXTENSION,
  testCourseProofIdentity,
  testCourseReliability,
} from "../src/application/test-course-records.js";
import { builtInDemo } from "../src/model/demo-blueprints.js";
import {
  fingerprintAsset,
  verificationForAsset,
} from "../src/model/share-packages.js";
import { validateProofWire } from "../src/model/generated/share-wire-validators.js";

const blueprint = structuredClone(builtInDemo("cart").blueprint),
  rootPartId = blueprint.parts[0].id,
  assetFingerprint = await fingerprintAsset("blueprint", blueprint),
  deployment = {
    schemaVersion: "testing-playground-deployment-v1",
    siteId: WORKSHOP_TEST_SITE.id,
    padId: "surface-lanes",
    pose: { positionM: [43, -0.6, -85], headingRad: Math.PI / 2 },
    partTransforms: blueprint.parts.map(({ id, pos, orientation }) => ({
      id,
      pos,
      orientation,
    })),
  },
  proofIdentity = testCourseProofIdentity({
    testSite: WORKSHOP_TEST_SITE,
    routeId: "hill-and-home",
    deployment,
  }),
  runIdentity = {
    blueprintFingerprint: assetFingerprint,
    runConfigurationFingerprint: `sim-sha256-${"1".repeat(64)}`,
    testSiteFingerprint: proofIdentity.testSiteFingerprint,
    materialMapFingerprint: proofIdentity.materialMapFingerprint,
    deploymentFingerprint: proofIdentity.deploymentFingerprint,
    deployment,
    environment: {
      seed: "earth-coordinate-terrain-v1",
      latitude: 32.1953977,
      longitude: 34.9007962,
      timeOfDay: 14,
      windEnabled: true,
    },
  },
  controllerParts = blueprint.parts.map((part) => ({
    ...part,
    ...(part.type === "computer"
      ? { programTrust: { digest: "a".repeat(64) } }
      : {}),
  })),
  state = {
    testDeployment: deployment,
    challengeRecords: [],
    challengeBest: {},
    simulationPaused: false,
  },
  writes = [],
  feature = createTestCourseRecordFeature({
    state,
    storage: {
      writeJson: (key, value) =>
        writes.push({ key, value: structuredClone(value) }),
    },
    keys: { challengeRecords: "records", challengeBest: "best" },
    testSite: WORKSHOP_TEST_SITE,
    getRunIdentity: () => runIdentity,
    getMachine: () => ({ parts: blueprint.parts, connections: [] }),
    getParts: () => controllerParts,
    notify: () => {},
  });

const telemetry = (status) => ({
  time: 12.5,
  systems: {
    structures: {
      failedCount: 0,
      detachedPartIds: [],
      worstFatigue: 0.08,
    },
    testCourse: {
      routeId: "hill-and-home",
      status,
      passedGateIds: ["terrain-entry", "hill-20-summit", "terrain-home"],
      failureReason: null,
      fluidId: null,
      binding: {
        componentId: `component:${rootPartId}`,
        partIds: blueprint.parts.map(({ id }) => id),
        rootPartId,
      },
    },
  },
});

feature.begin();
const record = feature.ingest(telemetry("complete"));
assert.equal(record.success, true);
assert.equal(record.verificationEligible, true);
assert.equal(state.simulationPaused, true);
assert.equal(
  record.extensions[TEST_COURSE_PROOF_EXTENSION].courseIdentityFingerprint,
  proofIdentity.courseIdentityFingerprint,
);
assert.equal(writes.length, 2);
assert.deepEqual(
  testCourseReliability(state.challengeRecords, "hill-and-home"),
  {
    attempts: 1,
    successes: 1,
    reliability: 1,
    bestScore: 8000,
    bestTimeS: 12.5,
  },
);

const portable = verificationForAsset(
  state.challengeRecords,
  assetFingerprint,
  blueprint,
);
const proofCandidate = {
  proofVersion: 1,
  challengeVersion: record.challengeVersion,
  challengeId: record.id,
  assetFingerprint,
  score: record.score,
  solution: record.solution,
  recordedAt: record.recordedAt,
  binding: record.binding,
  terminal: record.terminal,
  environment: record.environment,
  controllerPrograms: record.controllerPrograms,
  extensions: record.extensions,
};
assert.ok(
  validateProofWire(proofCandidate),
  JSON.stringify(validateProofWire.errors),
);
assert.equal(portable.length, 1);
assert.deepEqual(
  portable[0].extensions[TEST_COURSE_PROOF_EXTENSION],
  record.extensions[TEST_COURSE_PROOF_EXTENSION],
);

feature.begin();
feature.abort(telemetry("running"));
const reliability = feature.view("hill-and-home").reliability;
assert.equal(reliability.attempts, 2);
assert.equal(reliability.successes, 1);
assert.equal(reliability.reliability, 0.5);

const movedDeployment = structuredClone(deployment);
movedDeployment.partTransforms[0].pos[0] += 0.25;
assert.notEqual(
  testCourseProofIdentity({
    testSite: WORKSHOP_TEST_SITE,
    routeId: "hill-and-home",
    deployment: movedDeployment,
  }).courseIdentityFingerprint,
  proofIdentity.courseIdentityFingerprint,
);
const routeChanged = structuredClone(WORKSHOP_TEST_SITE);
routeChanged.routes.find(({ id }) => id === "hill-and-home").label += " v2";
assert.notEqual(
  testCourseProofIdentity({
    testSite: routeChanged,
    routeId: "hill-and-home",
    deployment,
  }).courseIdentityFingerprint,
  proofIdentity.courseIdentityFingerprint,
);

console.log(
  "test-course records preserve retry reliability and proof identity",
);
