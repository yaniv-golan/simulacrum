import { COMMAND_SINK_SCALAR_LIMIT } from "../model/actuator-contracts.js";
import { canonicalId, compareCanonicalIds } from "../model/primitives.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../model/plain-data-contract.js";
import { deriveAxialBodyWrenchObservation } from "./axial-body-wrench-runtime.js";

const NUMERIC_TOLERANCE = 2 ** -30;
const MAX_ACTUATORS = 32;
const MAX_ITERATIONS = 1_000_000;

function exactRecord(value, fields, label) {
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")
  )
    throw new TypeError(`${label} has an invalid field set`);
  return value;
}

/**
 * @param {number} value
 * @param {string} label
 */
function finite(value, label) {
  if (!Number.isFinite(value))
    throw new TypeError(`${label} must be a finite number in range`);
  return value;
}

function finiteAtLeast(value, label, minimum, { exclusive = false } = {}) {
  finite(value, label);
  if (exclusive ? value <= minimum : value < minimum)
    throw new TypeError(`${label} must be a finite number in range`);
  return value;
}

function safeTick(value, label) {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${label} must be a non-negative safe integer`);
  return value;
}

function finiteVector(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(Number.isFinite)
  )
    throw new TypeError(`${label} must be a finite three-vector`);
  return [...value];
}

const subtract = (left, right) =>
  left.map((entry, index) => entry - right[index]);
const dot = (left, right) =>
  left.reduce((sum, entry, index) => sum + entry * right[index], 0);
const norm = (value) => Math.hypot(...value);
const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

function parseActuator(raw, index) {
  const actuator = exactRecord(
      raw,
      ["actuatorPartId", "minimumForceN", "maximumForceN"],
      `actuator ${index}`,
    ),
    actuatorPartId = canonicalId(actuator.actuatorPartId, {
      path: ["axialBodyWrenchAllocation", "actuators", index, "actuatorPartId"],
    }),
    minimumForceN = finite(
      actuator.minimumForceN,
      `actuator ${String(actuatorPartId)} minimum force`,
    ),
    maximumForceN = finite(
      actuator.maximumForceN,
      `actuator ${String(actuatorPartId)} maximum force`,
    );
  // Containing zero already implies minimumForceN <= maximumForceN.
  if (minimumForceN > 0 || maximumForceN < 0)
    throw new TypeError(
      `actuator ${String(actuatorPartId)} effort bounds must be ordered and contain fail-safe zero`,
    );
  if (
    minimumForceN < -COMMAND_SINK_SCALAR_LIMIT ||
    maximumForceN > COMMAND_SINK_SCALAR_LIMIT
  )
    throw new TypeError(
      `actuator ${String(actuatorPartId)} effort bounds exceed the ordinary scalar command envelope`,
    );
  return { actuatorPartId, minimumForceN, maximumForceN };
}

/** Parses only target and numerical policy; live geometry remains runtime-owned. */
function parseAxialBodyWrenchAllocationRequest(input) {
  const source = requireInertPlainData(input, {
    code: "INVALID_AXIAL_BODY_WRENCH_ALLOCATION_INPUT",
    message:
      "Axial body-wrench allocation requires serialized JSON or an issued inert data root",
    path: ["axialBodyWrenchAllocation"],
  });
  exactRecord(
    source,
    [
      "version",
      "observationTick",
      "targetPartId",
      "targetWrenchPart",
      "actuators",
      "acceptance",
      "solver",
    ],
    "axial body-wrench allocation",
  );
  if (source.version !== 1)
    throw new TypeError("axial body-wrench allocation version must be 1");
  const observationTick = safeTick(
      source.observationTick,
      "allocation observation tick",
    ),
    targetPartId = canonicalId(source.targetPartId, {
      path: ["axialBodyWrenchAllocation", "targetPartId"],
    }),
    targetWrench = exactRecord(
      source.targetWrenchPart,
      ["forceN", "momentNm"],
      "target body wrench",
    ),
    targetForceN = finiteVector(targetWrench.forceN, "target force"),
    targetMomentNm = finiteVector(targetWrench.momentNm, "target moment"),
    acceptance = exactRecord(
      source.acceptance,
      [
        "forceResidualToleranceN",
        "momentResidualToleranceNm",
        "momentReferenceLengthM",
      ],
      "allocation acceptance",
    ),
    forceResidualToleranceN = finiteAtLeast(
      acceptance.forceResidualToleranceN,
      "force residual tolerance",
      0,
    ),
    momentResidualToleranceNm = finiteAtLeast(
      acceptance.momentResidualToleranceNm,
      "moment residual tolerance",
      0,
    ),
    momentReferenceLengthM = finiteAtLeast(
      acceptance.momentReferenceLengthM,
      "moment reference length",
      0,
      { exclusive: true },
    ),
    solver = exactRecord(
      source.solver,
      ["maxIterations", "projectedGradientToleranceN"],
      "allocation solver",
    ),
    maxIterations = safeTick(solver.maxIterations, "solver iteration budget"),
    projectedGradientToleranceN = finiteAtLeast(
      solver.projectedGradientToleranceN,
      "projected-gradient tolerance",
      0,
    );
  if (maxIterations < 1 || maxIterations > MAX_ITERATIONS)
    throw new TypeError("solver iteration budget is out of range");
  if (
    !Array.isArray(source.actuators) ||
    source.actuators.length < 1 ||
    source.actuators.length > MAX_ACTUATORS
  )
    throw new TypeError(
      `axial body-wrench allocation requires 1-${MAX_ACTUATORS} actuators`,
    );
  const actuators = source.actuators.map(parseActuator);
  for (let index = 1; index < actuators.length; index++)
    if (
      actuators.findIndex(
        (candidate) =>
          candidate.actuatorPartId === actuators[index].actuatorPartId,
      ) !== index
    )
      throw new TypeError("axial body-wrench actuator IDs must be unique");
  actuators.sort((left, right) =>
    compareCanonicalIds(left.actuatorPartId, right.actuatorPartId),
  );
  return Object.freeze({
    observationTick,
    targetPartId,
    targetForceN,
    targetMomentNm,
    forceResidualToleranceN,
    momentResidualToleranceNm,
    momentReferenceLengthM,
    maxIterations,
    projectedGradientToleranceN,
    actuators: Object.freeze(actuators.map(Object.freeze)),
  });
}

function achievedWrench(columns, efforts) {
  const forceN = [0, 0, 0],
    momentNm = [0, 0, 0];
  for (let index = 0; index < columns.length; index++)
    for (let axis = 0; axis < 3; axis++) {
      forceN[axis] += columns[index].forcePerNewtonPart[axis] * efforts[index];
      momentNm[axis] +=
        columns[index].momentPerNewtonPart[axis] * efforts[index];
    }
  return { forceN, momentNm };
}

/**
 * Solves against a basis already derived by MultibodyRuntime. This is an
 * internal simulation helper, not a public controller or Core authority.
 */
function allocateAxialBodyWrenchFromRuntimeObservation(parsed, rawObservation) {
  const observation = rawObservation,
    authorityValid = observation.valid;
  let candidateEfforts = parsed.actuators.map(() => 0),
    iterations = 0,
    solverConverged = false;

  if (authorityValid) {
    const equivalentTargetMomentN =
        norm(parsed.targetMomentNm) / parsed.momentReferenceLengthM,
      forceScaleN = Math.max(
        1,
        norm(parsed.targetForceN),
        equivalentTargetMomentN,
        ...parsed.actuators.flatMap((actuator) => [
          Math.abs(actuator.minimumForceN),
          Math.abs(actuator.maximumForceN),
        ]),
      ),
      columns = observation.columns.map((column) => [
        ...column.forcePerNewtonPart,
        ...column.momentPerNewtonPart.map(
          (entry) => entry / parsed.momentReferenceLengthM,
        ),
      ]),
      target = [
        ...parsed.targetForceN,
        ...parsed.targetMomentNm.map(
          (entry) => entry / parsed.momentReferenceLengthM,
        ),
      ].map((entry) => entry / forceScaleN),
      bounds = parsed.actuators.map((actuator) => ({
        minimum: actuator.minimumForceN / forceScaleN,
        maximum: actuator.maximumForceN / forceScaleN,
      })),
      lipschitzBound = columns.reduce(
        (sum, column) => sum + dot(column, column),
        0,
      ),
      step = 1 / lipschitzBound;
    if (
      ![
        forceScaleN,
        ...target,
        ...columns.flat(),
        ...bounds.flatMap((bound) => [bound.minimum, bound.maximum]),
        lipschitzBound,
        step,
      ].every(Number.isFinite)
    )
      throw new RangeError(
        "axial body-wrench allocation exceeds finite numerical range",
      );
    let efforts = bounds.map((bound) => clamp(0, bound.minimum, bound.maximum));
    for (let iteration = 1; iteration <= parsed.maxIterations; iteration++) {
      const achieved = Array(6).fill(0);
      for (let columnIndex = 0; columnIndex < columns.length; columnIndex++)
        for (const [row, coefficient] of columns[columnIndex].entries())
          achieved[row] += coefficient * efforts[columnIndex];
      const residual = subtract(achieved, target),
        next = efforts.map((effort, index) =>
          clamp(
            effort - step * dot(columns[index], residual),
            bounds[index].minimum,
            bounds[index].maximum,
          ),
        ),
        updateNorm = norm(subtract(next, efforts));
      efforts = next;
      iterations = iteration;
      if (
        (updateNorm / step) * forceScaleN <=
        parsed.projectedGradientToleranceN
      ) {
        solverConverged = true;
        break;
      }
    }
    candidateEfforts = efforts.map((effort, index) =>
      clamp(
        effort * forceScaleN,
        parsed.actuators[index].minimumForceN,
        parsed.actuators[index].maximumForceN,
      ),
    );
  }

  const achieved = achievedWrench(observation.columns, candidateEfforts),
    forceResidualN = subtract(parsed.targetForceN, achieved.forceN),
    momentResidualNm = subtract(parsed.targetMomentNm, achieved.momentNm),
    forceResidualNormN = norm(forceResidualN),
    momentResidualNormNm = norm(momentResidualNm),
    accepted =
      authorityValid &&
      solverConverged &&
      forceResidualNormN <= parsed.forceResidualToleranceN &&
      momentResidualNormNm <= parsed.momentResidualToleranceNm,
    candidate = parsed.actuators.map((actuator, index) => {
      const forceN = candidateEfforts[index],
        scaleN = Math.max(
          1,
          Math.abs(actuator.minimumForceN),
          Math.abs(actuator.maximumForceN),
          Math.abs(forceN),
        ),
        toleranceN = NUMERIC_TOLERANCE * scaleN,
        atMinimum = Math.abs(forceN - actuator.minimumForceN) <= toleranceN,
        atMaximum = Math.abs(forceN - actuator.maximumForceN) <= toleranceN;
      return {
        actuatorPartId: actuator.actuatorPartId,
        forceN,
        minimumForceN: actuator.minimumForceN,
        maximumForceN: actuator.maximumForceN,
        atMinimum,
        atMaximum,
        saturated: atMinimum || atMaximum,
      };
    }),
    effortDemands = candidate.map((entry) => ({
      actuatorPartId: entry.actuatorPartId,
      forceN: accepted ? entry.forceN : 0,
    }));
  return issueInertPlainData({
    version: 1,
    observationTick: parsed.observationTick,
    targetPartId: parsed.targetPartId,
    authorityValid,
    authorityReason: observation.reason,
    solverConverged,
    accepted,
    reason: !authorityValid
      ? "invalid-authority-v1"
      : !solverConverged
        ? "solver-budget-exhausted-v1"
        : !accepted
          ? "residual-tolerance-exceeded-v1"
          : "accepted-v1",
    iterations,
    targetFrameWorld: observation.targetFrameWorld,
    targetWrenchPart: {
      forceN: parsed.targetForceN,
      momentNm: parsed.targetMomentNm,
    },
    achievedWrenchPart: achieved,
    residualWrenchPart: {
      forceN: forceResidualN,
      momentNm: momentResidualNm,
      forceNormN: forceResidualNormN,
      momentNormNm: momentResidualNormNm,
    },
    acceptance: {
      forceResidualToleranceN: parsed.forceResidualToleranceN,
      momentResidualToleranceNm: parsed.momentResidualToleranceNm,
      momentReferenceLengthM: parsed.momentReferenceLengthM,
    },
    saturated: candidate.some((entry) => entry.saturated),
    basis: observation.columns,
    candidateEfforts: candidate,
    effortDemands,
  });
}

/**
 * The only demand-producing entrypoint. Callers supply a target request and a
 * genuine live runtime; the runtime-owned observation never crosses an input
 * boundary and cannot be replaced with caller-authored geometry.
 */
export function allocateAxialBodyWrench(runtime, input) {
  const parsed = parseAxialBodyWrenchAllocationRequest(input),
    observation = deriveAxialBodyWrenchObservation(runtime, parsed);
  return allocateAxialBodyWrenchFromRuntimeObservation(parsed, observation);
}
