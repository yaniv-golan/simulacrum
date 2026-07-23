import { componentElectricalSource } from "../model/component-contracts.js";
import { stableStringify } from "../model/primitives.js";
import { sha256Hex } from "../model/sha256.js";
import {
  fingerprintContactMaterialMap,
  fingerprintTestDeployment,
  fingerprintTestSiteDefinition,
} from "./mechanism-run-identity.js";

export const TEST_COURSE_PROOF_EXTENSION = "simulacrum.test-course";

const fingerprint = (namespace, value) =>
  `sim-sha256-${sha256Hex(`${namespace}\0${stableStringify(value)}`)}`;

function routeFor(testSite, routeId) {
  return testSite.routes.find(({ id }) => id === routeId) || null;
}

export function testCourseRecordId(routeId) {
  return `test-course:${routeId}`;
}

export function testCourseProofIdentity({
  testSite,
  routeId,
  deployment,
  testSiteFingerprint = fingerprintTestSiteDefinition(testSite),
  materialMapFingerprint = fingerprintContactMaterialMap(),
  deploymentFingerprint = fingerprintTestDeployment(deployment),
}) {
  const route = routeFor(testSite, routeId);
  if (!route) return null;
  const routeFingerprint = fingerprint(
      "simulacrum-test-course-route-v1",
      route,
    ),
    courseIdentityFingerprint = fingerprint("simulacrum-test-course-proof-v1", {
      testSiteFingerprint,
      materialMapFingerprint,
      routeFingerprint,
      deploymentFingerprint,
    });
  return Object.freeze({
    version: 1,
    routeId,
    testSiteFingerprint,
    materialMapFingerprint,
    routeFingerprint,
    deploymentFingerprint,
    courseIdentityFingerprint,
  });
}

export function testCourseReliability(
  records = [],
  routeId,
  courseIdentityFingerprint = null,
) {
  const attempts = records.filter((record) => {
      const proof = record.extensions?.[TEST_COURSE_PROOF_EXTENSION];
      return (
        record.id === testCourseRecordId(routeId) &&
        proof?.routeId === routeId &&
        (!courseIdentityFingerprint ||
          proof.courseIdentityFingerprint === courseIdentityFingerprint)
      );
    }),
    successes = attempts.filter(({ success }) => success),
    bestTimeS = Math.min(
      Infinity,
      ...successes.map(({ timeS }) => Number(timeS) || Infinity),
    );
  return Object.freeze({
    attempts: attempts.length,
    successes: successes.length,
    reliability: attempts.length ? successes.length / attempts.length : 0,
    bestScore: Math.max(
      0,
      ...successes.map(({ score }) => recordNumber(score)),
    ),
    bestTimeS: Number.isFinite(bestTimeS) ? bestTimeS : null,
  });
}

function recordNumber(value) {
  return Number.isFinite(value) ? value : 0;
}

function machineMetrics(machine) {
  const parts = machine?.parts || [],
    energyWh = parts
      .filter((part) => componentElectricalSource(part))
      .reduce(
        (sum, part) =>
          sum +
          recordNumber(
            part.energyJ == null
              ? (part.storedEnergyWh ?? part.config?.capacityWh)
              : part.energyJ / 3600,
          ),
        0,
      );
  return {
    partCount: parts.length,
    massKg: parts.reduce(
      (sum, part) => sum + recordNumber(part.mass ?? part.config?.mass),
      0,
    ),
    energyWh,
  };
}

function controllerPrograms(parts) {
  return parts
    .filter(({ type }) => type === "computer")
    .map((part) => ({
      partId: part.id,
      digest: part.programTrust?.digest || "",
    }))
    .sort((left, right) => left.partId - right.partId);
}

function terminalMetrics(telemetry, initial, current) {
  const structure = telemetry.systems?.structures || {};
  return {
    massKg: Math.max(0, current.massKg),
    partCount: Math.max(0, Math.round(current.partCount)),
    energyUsed: Math.max(0, initial.energyWh - current.energyWh),
    damage: Math.max(
      0,
      Math.round(
        recordNumber(structure.failedCount) +
          (structure.detachedPartIds?.length || 0),
      ),
    ),
    worstFatigue: Math.max(0, recordNumber(structure.worstFatigue)),
    apexM: Math.max(0, recordNumber(telemetry.systems?.flight?.apexM)),
    touchedWater: Boolean(
      telemetry.systems?.testCourse?.fluidId ||
      telemetry.systems?.mobility?.assemblies?.some(({ inWater }) => inWater),
    ),
    payloadSecured: false,
  };
}

/** Persists local and portable-proof-ready Test Reserve attempts. */
export function createTestCourseRecordFeature({
  state,
  storage,
  keys,
  testSite,
  getRunIdentity,
  getMachine,
  getParts,
  notify,
}) {
  let initialMetrics = null,
    recorded = false;

  function identity(routeId, deployment = state.testDeployment) {
    return testCourseProofIdentity({ testSite, routeId, deployment });
  }

  function begin() {
    initialMetrics = machineMetrics(getMachine());
    recorded = false;
  }

  function commit(telemetry, course, { aborted = false } = {}) {
    if (recorded || !course?.routeId) return null;
    const runIdentity = getRunIdentity();
    if (!runIdentity) return null;
    recorded = true;
    const success = !aborted && course.status === "complete",
      route = routeFor(testSite, course.routeId),
      currentMetrics = machineMetrics(getMachine()),
      programs = controllerPrograms(getParts()),
      binding = course.binding
        ? {
            kind: "component",
            policyVersion: 1,
            rootPartId: course.binding.rootPartId,
            initialComponentId: course.binding.componentId,
          }
        : null,
      proofIdentity = testCourseProofIdentity({
        testSite,
        routeId: course.routeId,
        deployment: runIdentity.deployment,
        testSiteFingerprint: runIdentity.testSiteFingerprint,
        materialMapFingerprint: runIdentity.materialMapFingerprint,
        deploymentFingerprint: runIdentity.deploymentFingerprint,
      }),
      timeS = Math.max(0, recordNumber(telemetry.time)),
      score = success ? Math.round(100_000 / Math.max(1, timeS)) : 0,
      programEvidenceComplete = programs.every(({ digest }) =>
        /^[0-9a-f]{64}$/.test(digest),
      ),
      extension = {
        ...proofIdentity,
        runConfigurationFingerprint: runIdentity.runConfigurationFingerprint,
        deployment: runIdentity.deployment
          ? {
              siteId: runIdentity.deployment.siteId,
              padId: runIdentity.deployment.padId,
              pose: structuredClone(runIdentity.deployment.pose),
              partTransformsFingerprint: fingerprint(
                "simulacrum-test-course-part-transforms-v1",
                runIdentity.deployment.partTransforms,
              ),
            }
          : null,
        terminalReason: aborted
          ? "aborted"
          : course.failureReason || course.status,
      },
      record = {
        proofVersion: 1,
        challengeVersion: 1,
        id: testCourseRecordId(course.routeId),
        success,
        score,
        solution: course.binding
          ? `physical-component:${course.binding.partIds.join("+")}`
          : "UNRESOLVED",
        timeS,
        massKg: currentMetrics.massKg,
        energyUsed: Math.max(
          0,
          (initialMetrics || currentMetrics).energyWh - currentMetrics.energyWh,
        ),
        damage: terminalMetrics(
          telemetry,
          initialMetrics || currentMetrics,
          currentMetrics,
        ).damage,
        recordedAt: new Date().toISOString(),
        assetFingerprint: runIdentity.blueprintFingerprint,
        verificationEligible: Boolean(
          success &&
          binding &&
          runIdentity.deployment?.pose &&
          programEvidenceComplete,
        ),
        environment: structuredClone(runIdentity.environment),
        controllerPrograms: programs,
        binding,
        terminal: {
          criteria: [
            {
              id: "ordered-gates",
              met: course.passedGateIds?.length === route?.gateIds.length,
              current: `${course.passedGateIds?.length || 0} passed`,
              target: `${route?.gateIds.length || 0} ordered gates`,
            },
            {
              id: "controlled-finish",
              met: success,
              current: success ? "complete" : extension.terminalReason,
              target: `≤ ${route?.finish.maxSpeedMps || 0} m/s for ${route?.finish.holdS || 0} s`,
            },
            ...(course.requirements || []).map((requirement) => ({
              id: `${requirement.kind}:${requirement.id}`.slice(0, 64),
              met: Boolean(requirement.met),
              current: requirement.met ? "observed" : "missing",
              target: String(requirement.id).slice(0, 96),
            })),
          ],
          metrics: terminalMetrics(
            telemetry,
            initialMetrics || currentMetrics,
            currentMetrics,
          ),
        },
        extensions: { [TEST_COURSE_PROOF_EXTENSION]: extension },
      };
    state.challengeRecords.push(record);
    state.challengeRecords = state.challengeRecords.slice(-100);
    storage.writeJson(keys.challengeRecords, state.challengeRecords);
    if (success) {
      state.challengeBest[record.id] = Math.max(
        state.challengeBest[record.id] || 0,
        score,
      );
      storage.writeJson(keys.challengeBest, state.challengeBest);
      state.simulationPaused = true;
      notify(`${route.label} proven · ${timeS.toFixed(2)} s`);
    } else if (!aborted) notify(`${route.label} invalid · inspect the route`);
    return record;
  }

  function ingest(telemetry) {
    const course = telemetry?.systems?.testCourse;
    if (!course || !["complete", "failed"].includes(course.status)) return null;
    return commit(telemetry, course);
  }

  function abort(telemetry) {
    const course = telemetry?.systems?.testCourse;
    if (!course || recorded) return null;
    return commit(telemetry, course, { aborted: true });
  }

  function view(routeId) {
    const proofIdentity = identity(routeId),
      reliability = testCourseReliability(
        state.challengeRecords,
        routeId,
        proofIdentity?.courseIdentityFingerprint,
      );
    return Object.freeze({ proofIdentity, reliability });
  }

  return Object.freeze({ abort, begin, identity, ingest, view });
}
