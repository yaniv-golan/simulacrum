import { validateControllerBindingManifest } from "./controller-bindings.js";
import { COMMAND_SINK_SCALAR_LIMIT } from "./actuator-contracts.js";
import { requireInertPlainData } from "./plain-data-contract.js";

export { COMMAND_SINK_SCALAR_LIMIT };
export const POINT_CONTACT_WRENCH_HOST_ABI_VERSION =
  "point-contact-wrench-host-v1-canonical-allocator-v1";

const AXES = Object.freeze(["x", "y", "z"]),
  MAX_CONTROLLER_CONTACTS = 16,
  MAX_CONTROLLER_ITERATIONS = 256;

function exactRecord(value, fields, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join("\0") !== [...fields].sort().join("\0")
  )
    throw new TypeError(`${label} has an invalid field set`);
  return value;
}

function finite(value, label, { minimum, positive = false }) {
  if (!Number.isFinite(value) || value < minimum || (positive && value <= 0))
    throw new TypeError(`${label} must be a finite number in range`);
  return value;
}

function safeInteger(value, label, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new TypeError(
      `${label} must be a non-negative safe integer in range`,
    );
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:/-]{1,160}$/u.test(value))
    throw new TypeError(`${label} must be a canonical identifier`);
  return value;
}

function vector(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(Number.isFinite)
  )
    throw new TypeError(`${label} must be a finite three-vector`);
  return [...value];
}

function quaternion(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(Number.isFinite)
  )
    throw new TypeError(`${label} must be a finite quaternion`);
  const magnitude = Math.hypot(...value);
  if (Math.abs(magnitude - 1) > 2 ** -20)
    throw new TypeError(`${label} must be a unit quaternion`);
  return value.map((entry) => entry / magnitude);
}

function bindingId(value, label) {
  if (typeof value !== "string" || !value.trim())
    throw new TypeError(`${label} must be a non-empty binding ID`);
  return value;
}

function bindingVector(value, label) {
  if (!Array.isArray(value) || value.length !== 3)
    throw new TypeError(`${label} must contain three binding IDs`);
  return value.map((entry, index) => bindingId(entry, `${label}[${index}]`));
}

function requireInput(byId, id, reading, label) {
  const binding = byId.get(id);
  if (!binding || binding.direction !== "input")
    throw new Error(`${label} must name a declared input binding`);
  if (binding.reading !== reading)
    throw new Error(`${label} must read ${reading}`);
  return binding;
}

function commonEndpoint(bindings, label) {
  const [first] = bindings;
  if (
    bindings.some(
      (binding) =>
        binding.endpointPartId !== first.endpointPartId ||
        binding.endpointPortId !== first.endpointPortId,
    )
  )
    throw new Error(`${label} must come from one sensor endpoint`);
}

const CONTACT_POINT_READINGS = Object.freeze(
    AXES.map((axis) => `contact_resultant_point_world_${axis}_m`),
  ),
  CONTACT_NORMAL_READINGS = Object.freeze(
    AXES.map((axis) => `contact_resultant_normal_world_${axis}`),
  );

export const POINT_CONTACT_WRENCH_DIAGNOSTIC_OUTPUTS = Object.freeze([
  "authority-valid",
  "solver-converged",
  "accepted",
  "rejection-code",
  "force-residual-norm-n",
  "moment-residual-norm-nm",
  "saturated",
  "residual-clipped",
]);

export function pointContactWrenchControllerOutputCount(spec) {
  return (
    POINT_CONTACT_WRENCH_DIAGNOSTIC_OUTPUTS.length + spec.contacts.length * 3
  );
}

export function validatePointContactWrenchOutputBindingIds(
  spec,
  outputBindingIds,
  bindingManifest,
) {
  const manifest = validateControllerBindingManifest(bindingManifest),
    byId = new Map(manifest.map((binding) => [binding.id, binding]));
  if (
    !Array.isArray(outputBindingIds) ||
    outputBindingIds.length !== pointContactWrenchControllerOutputCount(spec) ||
    outputBindingIds.some(
      (bindingId) => typeof bindingId !== "string" || !bindingId.trim(),
    ) ||
    new Set(outputBindingIds).size !== outputBindingIds.length
  )
    throw new Error("point-contact wrench output bindings are invalid");
  for (const bindingId of outputBindingIds) {
    const binding = byId.get(bindingId);
    if (!binding || binding.direction !== "output")
      throw new Error(`unknown output binding ${bindingId}`);
    if (binding.channel !== "command")
      throw new Error(
        `point-contact wrench output ${bindingId} must use the command relay channel`,
      );
  }
  return Object.freeze([...outputBindingIds]);
}

function finiteResultVector(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every(Number.isFinite)
  )
    throw new TypeError(`${label} must be a finite three-vector`);
  return value;
}

function sameVector(actual, expected) {
  return actual.every((value, index) => Object.is(value, expected[index]));
}

function near(left, right) {
  return (
    Math.abs(left - right) <=
    2 ** -35 * Math.max(1, Math.abs(left), Math.abs(right))
  );
}

function nearVector(actual, expected) {
  return actual.every((value, index) => near(value, expected[index]));
}

function rotate(value, quaternion) {
  const [x, y, z] = value,
    [qx, qy, qz, qw] = quaternion,
    tx = 2 * (qy * z - qz * y),
    ty = 2 * (qz * x - qx * z),
    tz = 2 * (qx * y - qy * x);
  return [
    x + qw * tx + (qy * tz - qz * ty),
    y + qw * ty + (qz * tx - qx * tz),
    z + qw * tz + (qx * ty - qy * tx),
  ];
}

function inverseRotate(value, quaternion) {
  return rotate(value, [
    -quaternion[0],
    -quaternion[1],
    -quaternion[2],
    quaternion[3],
  ]);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

export function assertPointContactCommandForceInRange(accepted, forceWorldN) {
  if (
    accepted === true &&
    Math.hypot(...forceWorldN) > COMMAND_SINK_SCALAR_LIMIT
  )
    throw new TypeError(
      "point-contact controller host force exceeds the command-sink scalar limit",
    );
}

export function validatePointContactWrenchControllerResult(
  input,
  spec,
  request,
) {
  const result = exactRecord(
      requireInertPlainData(input, {
        code: "INVALID_POINT_CONTACT_CONTROLLER_RESULT",
        message: "Point-contact controller host returned untrusted result data",
        path: ["pointContactControllerResult"],
      }),
      [
        "version",
        "tick",
        "targetFrameId",
        "authorityValid",
        "solverConverged",
        "accepted",
        "reason",
        "iterations",
        "targetWrenchFrame",
        "achievedWrenchFrame",
        "residualWrenchFrame",
        "acceptance",
        "saturated",
        "allocations",
      ],
      "point-contact controller host result",
    ),
    targetWrenchFrame = exactRecord(
      result.targetWrenchFrame,
      ["forceN", "momentNm"],
      "result target wrench",
    ),
    achievedWrenchFrame = exactRecord(
      result.achievedWrenchFrame,
      ["forceN", "momentNm"],
      "result achieved wrench",
    ),
    residualWrenchFrame = exactRecord(
      result.residualWrenchFrame,
      ["forceN", "momentNm", "forceNormN", "momentNormNm"],
      "result residual wrench",
    ),
    acceptance = exactRecord(
      result.acceptance,
      [
        "forceResidualToleranceN",
        "momentResidualToleranceNm",
        "momentReferenceLengthM",
      ],
      "result acceptance",
    ),
    targetForceN = finiteResultVector(
      targetWrenchFrame.forceN,
      "result target force",
    ),
    targetMomentNm = finiteResultVector(
      targetWrenchFrame.momentNm,
      "result target moment",
    ),
    achievedForceN = finiteResultVector(
      achievedWrenchFrame.forceN,
      "result achieved force",
    ),
    achievedMomentNm = finiteResultVector(
      achievedWrenchFrame.momentNm,
      "result achieved moment",
    ),
    residualForceN = finiteResultVector(
      residualWrenchFrame.forceN,
      "result residual force",
    ),
    residualMomentNm = finiteResultVector(
      residualWrenchFrame.momentNm,
      "result residual moment",
    ),
    expectedAchievedForceN = [0, 0, 0],
    expectedAchievedMomentNm = [0, 0, 0],
    expectedAuthority =
      request.targetWrenchFrame.valid === true &&
      request.contacts.every(
        (contact) =>
          contact.tick === request.tick &&
          contact.geometryValid === true &&
          contact.frictionValid === true &&
          contact.limitValid === true,
      ),
    residualAccepted =
      residualWrenchFrame.forceNormN <=
        spec.acceptance.forceResidualToleranceN &&
      residualWrenchFrame.momentNormNm <=
        spec.acceptance.momentResidualToleranceNm,
    expectedAccepted =
      expectedAuthority && result.solverConverged === true && residualAccepted,
    expectedReason = !expectedAuthority
      ? "invalid-authority-v1"
      : result.solverConverged !== true
        ? "solver-budget-exhausted-v1"
        : !expectedAccepted
          ? "residual-tolerance-exceeded-v1"
          : "accepted-v1";
  if (
    result.version !== 1 ||
    result.tick !== request.tick ||
    result.targetFrameId !== spec.targetFrame.frameId ||
    typeof result.authorityValid !== "boolean" ||
    result.authorityValid !== expectedAuthority ||
    typeof result.solverConverged !== "boolean" ||
    (!expectedAuthority && result.solverConverged) ||
    typeof result.accepted !== "boolean" ||
    result.accepted !== expectedAccepted ||
    result.reason !== expectedReason ||
    !Number.isSafeInteger(result.iterations) ||
    result.iterations < 0 ||
    result.iterations > spec.solver.maxIterations ||
    typeof result.saturated !== "boolean" ||
    !Number.isFinite(residualWrenchFrame.forceNormN) ||
    residualWrenchFrame.forceNormN < 0 ||
    !Number.isFinite(residualWrenchFrame.momentNormNm) ||
    residualWrenchFrame.momentNormNm < 0 ||
    !near(residualWrenchFrame.forceNormN, Math.hypot(...residualForceN)) ||
    !near(residualWrenchFrame.momentNormNm, Math.hypot(...residualMomentNm)) ||
    !sameVector(targetForceN, request.targetWrenchFrame.forceN) ||
    !sameVector(targetMomentNm, request.targetWrenchFrame.momentNm) ||
    !sameVector(
      residualForceN,
      targetForceN.map((value, index) => value - achievedForceN[index]),
    ) ||
    !sameVector(
      residualMomentNm,
      targetMomentNm.map((value, index) => value - achievedMomentNm[index]),
    ) ||
    acceptance.forceResidualToleranceN !==
      spec.acceptance.forceResidualToleranceN ||
    acceptance.momentResidualToleranceNm !==
      spec.acceptance.momentResidualToleranceNm ||
    acceptance.momentReferenceLengthM !==
      spec.acceptance.momentReferenceLengthM ||
    !Array.isArray(result.allocations) ||
    result.allocations.length !== spec.contacts.length
  )
    throw new TypeError("point-contact controller host result is inconsistent");
  for (const [index, allocationInput] of result.allocations.entries()) {
    const allocation = exactRecord(
        allocationInput,
        [
          "contactId",
          "tick",
          "pointFrameM",
          "normalFrame",
          "forceFrameN",
          "forceWorldN",
          "normalForceN",
          "tangentialForceN",
          "frictionLimitN",
          "normalForceLimitN",
          "tangentialForceLimitN",
          "frictionCoefficient",
          "normalSaturated",
          "frictionSaturated",
          "tangentialLimitSaturated",
          "saturated",
        ],
        `allocation ${index}`,
      ),
      expectedContact = spec.contacts[index],
      requestContact = request.contacts[index],
      pointFrameM = finiteResultVector(
        allocation.pointFrameM,
        `allocation ${index} point`,
      ),
      normalFrame = finiteResultVector(
        allocation.normalFrame,
        `allocation ${index} normal`,
      ),
      forceFrameN = finiteResultVector(
        allocation.forceFrameN,
        `allocation ${index} frame force`,
      ),
      forceWorldN = finiteResultVector(
        allocation.forceWorldN,
        `allocation ${index} world force`,
      ),
      expectedPointFrameM = inverseRotate(
        requestContact.pointWorldM.map(
          (value, axis) => value - spec.targetFrame.positionWorldM[axis],
        ),
        spec.targetFrame.quaternionWorldFromFrame,
      ),
      expectedNormalFrame = inverseRotate(
        requestContact.normalWorld.map(
          (value) => value / Math.hypot(...requestContact.normalWorld),
        ),
        spec.targetFrame.quaternionWorldFromFrame,
      ),
      expectedForceFrameN = inverseRotate(
        forceWorldN,
        spec.targetFrame.quaternionWorldFromFrame,
      ),
      expectedNormalForceN = dot(forceFrameN, normalFrame),
      tangentFrameN = forceFrameN.map(
        (value, axis) => value - normalFrame[axis] * expectedNormalForceN,
      ),
      expectedTangentialForceN = Math.hypot(...tangentFrameN),
      expectedFrictionLimitN =
        requestContact.frictionCoefficient * expectedNormalForceN,
      scaleN = Math.max(
        1,
        requestContact.normalForceLimitN,
        requestContact.tangentialForceLimitN,
        Math.hypot(...forceFrameN),
      ),
      toleranceN = 2 ** -30 * scaleN,
      expectedNormalSaturated =
        expectedNormalForceN > toleranceN &&
        Math.abs(expectedNormalForceN - requestContact.normalForceLimitN) <=
          toleranceN,
      expectedFrictionSaturated =
        expectedTangentialForceN > toleranceN &&
        Math.abs(expectedTangentialForceN - expectedFrictionLimitN) <=
          toleranceN,
      expectedTangentialLimitSaturated =
        expectedTangentialForceN > toleranceN &&
        Math.abs(
          expectedTangentialForceN - requestContact.tangentialForceLimitN,
        ) <= toleranceN;
    assertPointContactCommandForceInRange(result.accepted, forceWorldN);
    if (
      allocation.contactId !== expectedContact.contactId ||
      allocation.contactId !== requestContact.contactId ||
      allocation.tick !== request.tick ||
      !nearVector(pointFrameM, expectedPointFrameM) ||
      !nearVector(normalFrame, expectedNormalFrame) ||
      !near(Math.hypot(...normalFrame), 1) ||
      !nearVector(forceFrameN, expectedForceFrameN) ||
      ![
        allocation.normalForceN,
        allocation.tangentialForceN,
        allocation.frictionLimitN,
        allocation.normalForceLimitN,
        allocation.tangentialForceLimitN,
        allocation.frictionCoefficient,
      ].every((value) => Number.isFinite(value) && value >= 0) ||
      allocation.normalForceLimitN !== requestContact.normalForceLimitN ||
      allocation.tangentialForceLimitN !==
        requestContact.tangentialForceLimitN ||
      allocation.frictionCoefficient !== requestContact.frictionCoefficient ||
      !near(allocation.normalForceN, expectedNormalForceN) ||
      !near(allocation.tangentialForceN, expectedTangentialForceN) ||
      !near(allocation.frictionLimitN, expectedFrictionLimitN) ||
      expectedNormalForceN < -toleranceN ||
      expectedNormalForceN > requestContact.normalForceLimitN + toleranceN ||
      expectedTangentialForceN >
        Math.min(expectedFrictionLimitN, requestContact.tangentialForceLimitN) +
          toleranceN ||
      ![
        allocation.normalSaturated,
        allocation.frictionSaturated,
        allocation.tangentialLimitSaturated,
        allocation.saturated,
      ].every((value) => typeof value === "boolean") ||
      allocation.normalSaturated !== expectedNormalSaturated ||
      allocation.frictionSaturated !== expectedFrictionSaturated ||
      allocation.tangentialLimitSaturated !==
        expectedTangentialLimitSaturated ||
      allocation.saturated !==
        (allocation.normalSaturated ||
          allocation.frictionSaturated ||
          allocation.tangentialLimitSaturated)
    )
      throw new TypeError(
        "point-contact controller host allocation is inconsistent",
      );
    const momentNm = cross(pointFrameM, forceFrameN);
    for (let axis = 0; axis < 3; axis++) {
      expectedAchievedForceN[axis] += forceFrameN[axis];
      expectedAchievedMomentNm[axis] += momentNm[axis];
    }
  }
  if (
    !nearVector(achievedForceN, expectedAchievedForceN) ||
    !nearVector(achievedMomentNm, expectedAchievedMomentNm) ||
    result.saturated !==
      result.allocations.some((allocation) => allocation.saturated)
  )
    throw new TypeError(
      "point-contact controller host saturation is inconsistent",
    );
  return result;
}

/**
 * Validates the declarative, scalar-binding boundary for one canonical
 * point-contact allocation owned by a restricted controller.
 */
export function validatePointContactWrenchControllerSpec(
  input,
  bindingManifest,
) {
  const source = exactRecord(
      input,
      [
        "version",
        "targetFrame",
        "targetWrenchBindings",
        "contacts",
        "acceptance",
        "solver",
      ],
      "point-contact controller specification",
    ),
    manifest = validateControllerBindingManifest(bindingManifest),
    byId = new Map(manifest.map((binding) => [binding.id, binding]));
  if (source.version !== 1)
    throw new TypeError(
      "point-contact controller specification version must be 1",
    );

  const rawFrame = exactRecord(
      source.targetFrame,
      ["frameId", "positionWorldM", "quaternionWorldFromFrame"],
      "target frame",
    ),
    rawTarget = exactRecord(
      source.targetWrenchBindings,
      ["forceN", "momentNm"],
      "target wrench bindings",
    ),
    targetForceBindings = bindingVector(
      rawTarget.forceN,
      "target force bindings",
    ),
    targetMomentBindings = bindingVector(
      rawTarget.momentNm,
      "target moment bindings",
    );
  for (const [index, id] of targetForceBindings.entries())
    requireInput(byId, id, "command", `target force binding ${AXES[index]}`);
  for (const [index, id] of targetMomentBindings.entries())
    requireInput(byId, id, "command", `target moment binding ${AXES[index]}`);

  if (!Array.isArray(source.contacts) || source.contacts.length === 0)
    throw new TypeError("point-contact controller contacts must be non-empty");
  if (source.contacts.length > MAX_CONTROLLER_CONTACTS)
    throw new TypeError("point-contact controller has too many contacts");
  const ids = new Set(),
    contacts = source.contacts.map((rawContact, index) => {
      const contact = exactRecord(
          rawContact,
          [
            "contactId",
            "pointWorldBindings",
            "normalWorldBindings",
            "frictionCoefficientBinding",
            "normalForceLimitN",
            "tangentialForceLimitN",
          ],
          `contact ${index}`,
        ),
        contactId = identifier(contact.contactId, `contact ${index} ID`),
        pointWorldBindings = bindingVector(
          contact.pointWorldBindings,
          `contact ${contactId} point bindings`,
        ),
        normalWorldBindings = bindingVector(
          contact.normalWorldBindings,
          `contact ${contactId} normal bindings`,
        ),
        frictionCoefficientBinding = bindingId(
          contact.frictionCoefficientBinding,
          `contact ${contactId} friction binding`,
        ),
        endpointBindings = [
          ...pointWorldBindings.map((id, axis) =>
            requireInput(
              byId,
              id,
              CONTACT_POINT_READINGS[axis],
              `contact ${contactId} point binding ${AXES[axis]}`,
            ),
          ),
          ...normalWorldBindings.map((id, axis) =>
            requireInput(
              byId,
              id,
              CONTACT_NORMAL_READINGS[axis],
              `contact ${contactId} normal binding ${AXES[axis]}`,
            ),
          ),
          requireInput(
            byId,
            frictionCoefficientBinding,
            "contact_min_friction_coefficient",
            `contact ${contactId} friction binding`,
          ),
        ];
      if (ids.has(contactId))
        throw new Error(`duplicate point-contact controller ID ${contactId}`);
      ids.add(contactId);
      commonEndpoint(endpointBindings, `contact ${contactId} evidence`);
      const normalForceLimitN = finite(
          contact.normalForceLimitN,
          `contact ${contactId} normal-force limit`,
          { minimum: 0 },
        ),
        tangentialForceLimitN = finite(
          contact.tangentialForceLimitN,
          `contact ${contactId} tangential-force limit`,
          { minimum: 0 },
        );
      if (
        Math.hypot(normalForceLimitN, tangentialForceLimitN) >
        COMMAND_SINK_SCALAR_LIMIT
      )
        throw new TypeError(
          `contact ${contactId} force envelope exceeds the command-sink scalar limit`,
        );
      return {
        contactId,
        pointWorldBindings,
        normalWorldBindings,
        frictionCoefficientBinding,
        normalForceLimitN,
        tangentialForceLimitN,
      };
    });

  const rawAcceptance = exactRecord(
      source.acceptance,
      [
        "forceResidualToleranceN",
        "momentResidualToleranceNm",
        "momentReferenceLengthM",
      ],
      "allocation acceptance",
    ),
    rawSolver = exactRecord(
      source.solver,
      ["maxIterations", "projectedGradientToleranceN"],
      "allocation solver",
    ),
    result = {
      version: 1,
      targetFrame: {
        frameId: identifier(rawFrame.frameId, "target frame ID"),
        positionWorldM: vector(
          rawFrame.positionWorldM,
          "target frame position",
        ),
        quaternionWorldFromFrame: quaternion(
          rawFrame.quaternionWorldFromFrame,
          "target frame orientation",
        ),
      },
      targetWrenchBindings: {
        forceN: targetForceBindings,
        momentNm: targetMomentBindings,
      },
      contacts: contacts.sort((left, right) =>
        left.contactId.localeCompare(right.contactId, "en"),
      ),
      acceptance: {
        forceResidualToleranceN: finite(
          rawAcceptance.forceResidualToleranceN,
          "force residual tolerance",
          { minimum: 0 },
        ),
        momentResidualToleranceNm: finite(
          rawAcceptance.momentResidualToleranceNm,
          "moment residual tolerance",
          { minimum: 0 },
        ),
        momentReferenceLengthM: finite(
          rawAcceptance.momentReferenceLengthM,
          "moment reference length",
          { minimum: 0, positive: true },
        ),
      },
      solver: {
        maxIterations: safeInteger(
          rawSolver.maxIterations,
          "controller solver iteration budget",
          MAX_CONTROLLER_ITERATIONS,
        ),
        projectedGradientToleranceN: finite(
          rawSolver.projectedGradientToleranceN,
          "projected-gradient tolerance",
          { minimum: 0 },
        ),
      },
    };
  if (result.solver.maxIterations === 0)
    throw new TypeError("controller solver iteration budget must be positive");
  return Object.freeze(structuredClone(result));
}
