import { deepFreeze, DomainValidationError } from "../model/primitives.js";
import { failureEvidencePolicyFingerprint } from "../model/failure-evidence-identity.js";

const DEFAULTS = Object.freeze({
  version: 1,
  exactRetentionTicks: 480,
  contextRetentionTicks: 1440,
  contextStrideTicks: 4,
  topRowsPerConnection: 8,
  maxRowsPerExactFrame: 32,
  maxRowsOnTriggerTick: 4096,
  nearFailureUtilization: 0.8,
  stallCommandAbsMin: 0.5,
  stallPowerFloorW: 1,
  stallShaftProgressMinRad: 0.03,
  stallDwellTicks: 120,
  contactInvariantLoadFloorN: 1,
});

function boundedInteger(value, field, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new DomainValidationError(
      "INVALID_FAILURE_EVIDENCE_POLICY",
      `${field} must be an integer between ${minimum} and ${maximum}`,
      { path: [field] },
    );
  return value;
}

function finiteRange(value, field, minimum, maximum = Infinity) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum)
    throw new DomainValidationError(
      "INVALID_FAILURE_EVIDENCE_POLICY",
      `${field} must be between ${minimum} and ${maximum}`,
      { path: [field] },
    );
  return number;
}

export function createFailureEvidencePolicy(overrides = {}) {
  const value = { ...DEFAULTS, ...structuredClone(overrides) },
    policy = {
      version: 1,
      exactRetentionTicks: boundedInteger(
        value.exactRetentionTicks,
        "exactRetentionTicks",
        1,
        480,
      ),
      contextRetentionTicks: boundedInteger(
        value.contextRetentionTicks,
        "contextRetentionTicks",
        1,
        1440,
      ),
      contextStrideTicks: boundedInteger(
        value.contextStrideTicks,
        "contextStrideTicks",
        1,
        120,
      ),
      topRowsPerConnection: boundedInteger(
        value.topRowsPerConnection,
        "topRowsPerConnection",
        1,
        64,
      ),
      maxRowsPerExactFrame: boundedInteger(
        value.maxRowsPerExactFrame,
        "maxRowsPerExactFrame",
        1,
        1024,
      ),
      maxRowsOnTriggerTick: boundedInteger(
        value.maxRowsOnTriggerTick,
        "maxRowsOnTriggerTick",
        1,
        4096,
      ),
      nearFailureUtilization: finiteRange(
        value.nearFailureUtilization,
        "nearFailureUtilization",
        0,
        1,
      ),
      stallCommandAbsMin: finiteRange(
        value.stallCommandAbsMin,
        "stallCommandAbsMin",
        0,
        1,
      ),
      stallPowerFloorW: finiteRange(
        value.stallPowerFloorW,
        "stallPowerFloorW",
        0,
      ),
      stallShaftProgressMinRad: finiteRange(
        value.stallShaftProgressMinRad,
        "stallShaftProgressMinRad",
        0,
      ),
      stallDwellTicks: boundedInteger(
        value.stallDwellTicks,
        "stallDwellTicks",
        2,
        100_000,
      ),
      contactInvariantLoadFloorN: finiteRange(
        value.contactInvariantLoadFloorN,
        "contactInvariantLoadFloorN",
        0,
      ),
    };
  if (policy.contextRetentionTicks < policy.exactRetentionTicks)
    throw new DomainValidationError(
      "INVALID_FAILURE_EVIDENCE_POLICY",
      "contextRetentionTicks must cover at least the exact retention",
      { path: ["contextRetentionTicks"] },
    );
  if (policy.maxRowsPerExactFrame < policy.topRowsPerConnection)
    throw new DomainValidationError(
      "INVALID_FAILURE_EVIDENCE_POLICY",
      "maxRowsPerExactFrame must cover topRowsPerConnection",
      { path: ["maxRowsPerExactFrame"] },
    );
  if (Math.ceil(policy.contextRetentionTicks / policy.contextStrideTicks) > 360)
    throw new DomainValidationError(
      "INVALID_FAILURE_EVIDENCE_POLICY",
      "context retention and stride may retain at most 360 context frames",
      { path: ["contextStrideTicks"] },
    );
  return deepFreeze(policy);
}

export { failureEvidencePolicyFingerprint };

export const DEFAULT_FAILURE_EVIDENCE_POLICY = createFailureEvidencePolicy();
