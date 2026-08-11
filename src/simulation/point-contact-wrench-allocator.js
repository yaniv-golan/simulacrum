import {
  issueInertPlainData,
  requireInertPlainData,
} from "../model/plain-data-contract.js";

const UNIT_TOLERANCE = 2 ** -20;
const NUMERIC_TOLERANCE = 2 ** -30;

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

function finite(value, label, { min, exclusiveMin = false }) {
  if (!Number.isFinite(value) || (exclusiveMin ? value <= min : value < min))
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

function unitVector(value, label) {
  const result = finiteVector(value, label),
    magnitude = Math.hypot(...result);
  if (Math.abs(magnitude - 1) > UNIT_TOLERANCE)
    throw new TypeError(`${label} must be a unit three-vector`);
  return result.map((entry) => entry / magnitude);
}

function unitQuaternion(value, label) {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(Number.isFinite)
  )
    throw new TypeError(`${label} must be a finite quaternion`);
  const magnitude = Math.hypot(...value);
  if (Math.abs(magnitude - 1) > UNIT_TOLERANCE)
    throw new TypeError(`${label} must be a unit quaternion`);
  return value.map((entry) => entry / magnitude);
}

function canonicalId(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:/-]{1,160}$/u.test(value))
    throw new TypeError(`${label} must be a canonical identifier`);
  return value;
}

const add = (left, right) => left.map((entry, index) => entry + right[index]);
const subtract = (left, right) =>
  left.map((entry, index) => entry - right[index]);
const scale = (value, scalar) => value.map((entry) => entry * scalar);
const dot = (left, right) =>
  left.reduce((sum, entry, index) => sum + entry * right[index], 0);
const norm = (value) => Math.hypot(...value);
const cross = (left, right) => [
  left[1] * right[2] - left[2] * right[1],
  left[2] * right[0] - left[0] * right[2],
  left[0] * right[1] - left[1] * right[0],
];
const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

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

function parseInput(input) {
  const source = requireInertPlainData(input, {
    code: "INVALID_POINT_CONTACT_ALLOCATOR_INPUT",
    message:
      "Point-contact allocation requires serialized JSON or an issued inert data root",
    path: ["pointContactAllocation"],
  });
  exactRecord(
    source,
    [
      "tick",
      "targetFrame",
      "targetWrenchFrame",
      "contacts",
      "acceptance",
      "solver",
    ],
    "point-contact allocation",
  );
  const tick = safeTick(source.tick, "allocation tick"),
    targetFrame = exactRecord(
      source.targetFrame,
      ["frameId", "positionWorldM", "quaternionWorldFromFrame"],
      "target frame",
    ),
    frameId = canonicalId(targetFrame.frameId, "target frame ID"),
    framePositionWorldM = finiteVector(
      targetFrame.positionWorldM,
      "target frame position",
    ),
    quaternionWorldFromFrame = unitQuaternion(
      targetFrame.quaternionWorldFromFrame,
      "target frame orientation",
    ),
    targetWrench = exactRecord(
      source.targetWrenchFrame,
      ["valid", "forceN", "momentNm"],
      "target wrench",
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
    forceResidualToleranceN = finite(
      acceptance.forceResidualToleranceN,
      "force residual tolerance",
      { min: 0 },
    ),
    momentResidualToleranceNm = finite(
      acceptance.momentResidualToleranceNm,
      "moment residual tolerance",
      { min: 0 },
    ),
    momentReferenceLengthM = finite(
      acceptance.momentReferenceLengthM,
      "moment reference length",
      { min: 0, exclusiveMin: true },
    ),
    solver = exactRecord(
      source.solver,
      ["maxIterations", "projectedGradientToleranceN"],
      "allocation solver",
    ),
    maxIterations = safeTick(solver.maxIterations, "solver iteration budget"),
    projectedGradientToleranceN = finite(
      solver.projectedGradientToleranceN,
      "projected-gradient tolerance",
      { min: 0 },
    );
  if (maxIterations < 1)
    throw new TypeError("solver iteration budget must be positive");
  if (maxIterations > 1_000_000)
    throw new TypeError("solver iteration budget is too large");
  if (!Array.isArray(source.contacts))
    throw new TypeError("point-contact allocation contacts must be an array");
  if (source.contacts.length > 64)
    throw new TypeError("point-contact allocation has too many contacts");
  if (typeof targetWrench.valid !== "boolean")
    throw new TypeError("target wrench validity must be boolean");

  const contacts = source.contacts.map((raw, index) => {
    const contact = exactRecord(
        raw,
        [
          "contactId",
          "tick",
          "geometryValid",
          "frictionValid",
          "limitValid",
          "pointWorldM",
          "normalWorld",
          "frictionCoefficient",
          "normalForceLimitN",
          "tangentialForceLimitN",
        ],
        `contact ${index}`,
      ),
      contactId = canonicalId(contact.contactId, `contact ${index} ID`),
      contactTick = safeTick(contact.tick, `contact ${contactId} tick`),
      pointWorldM = finiteVector(
        contact.pointWorldM,
        `contact ${contactId} point`,
      ),
      normalWorld = unitVector(
        contact.normalWorld,
        `contact ${contactId} normal`,
      ),
      frictionCoefficient = finite(
        contact.frictionCoefficient,
        `contact ${contactId} friction coefficient`,
        { min: 0 },
      ),
      normalForceLimitN = finite(
        contact.normalForceLimitN,
        `contact ${contactId} normal-force limit`,
        { min: 0 },
      ),
      tangentialForceLimitN = finite(
        contact.tangentialForceLimitN,
        `contact ${contactId} tangential-force limit`,
        { min: 0 },
      );
    for (const field of ["geometryValid", "frictionValid", "limitValid"])
      if (typeof contact[field] !== "boolean")
        throw new TypeError(`contact ${contactId} ${field} must be boolean`);
    return {
      contactId,
      tick: contactTick,
      authorityValid:
        contactTick === tick &&
        contact.geometryValid &&
        contact.frictionValid &&
        contact.limitValid,
      pointWorldM,
      normalWorld,
      pointFrameM: inverseRotate(
        subtract(pointWorldM, framePositionWorldM),
        quaternionWorldFromFrame,
      ),
      normalFrame: inverseRotate(normalWorld, quaternionWorldFromFrame),
      frictionCoefficient,
      normalForceLimitN,
      tangentialForceLimitN,
    };
  });
  for (let index = 1; index < contacts.length; index++)
    if (
      contacts.findIndex(
        (contact) => contact.contactId === contacts[index].contactId,
      ) !== index
    )
      throw new TypeError("point-contact allocation IDs must be unique");
  contacts.sort((left, right) => (left.contactId < right.contactId ? -1 : 1));

  return {
    tick,
    frameId,
    framePositionWorldM,
    quaternionWorldFromFrame,
    targetValid: targetWrench.valid === true,
    targetForceN,
    targetMomentNm,
    forceResidualToleranceN,
    momentResidualToleranceNm,
    momentReferenceLengthM,
    maxIterations,
    projectedGradientToleranceN,
    contacts,
  };
}

// Exact Euclidean projection onto one contact's convex authority set:
// 0 <= normal <= Nmax and |tangent| <= min(mu * normal, Tmax).
function projectContactForce(force, contact) {
  const normalComponent = dot(force, contact.normalFrame),
    tangent = subtract(force, scale(contact.normalFrame, normalComponent)),
    tangentMagnitude = norm(tangent),
    maximumNormal = contact.normalForceLimitN,
    maximumTangent = contact.tangentialForceLimitN,
    friction = contact.frictionCoefficient;
  if (friction === 0)
    return scale(contact.normalFrame, clamp(normalComponent, 0, maximumNormal));
  const candidates = [],
    addCandidate = (value, lower = 0, upper = maximumNormal) => {
      candidates.push(clamp(value, lower, upper));
    };
  addCandidate(0);
  addCandidate(maximumNormal);
  addCandidate(normalComponent);

  const coneUpper = Math.min(
    maximumNormal,
    Math.min(maximumTangent, tangentMagnitude) / friction,
  );
  const unconstrainedConeNormal =
    friction <= 1
      ? (normalComponent + friction * tangentMagnitude) / (1 + friction ** 2)
      : (normalComponent / friction ** 2 + tangentMagnitude / friction) /
        (1 + 1 / friction ** 2);
  addCandidate(unconstrainedConeNormal, 0, coneUpper);

  let best = null;
  for (const candidateNormal of candidates) {
    const frictionBound = Math.min(friction * candidateNormal, maximumTangent),
      candidateTangent = Math.min(
        tangentMagnitude,
        frictionBound,
        maximumTangent,
      ),
      objective =
        (candidateNormal - normalComponent) ** 2 +
        (candidateTangent - tangentMagnitude) ** 2;
    if (!best || objective < best.objective)
      best = { objective, normal: candidateNormal, tangent: candidateTangent };
  }
  const tangentDirection =
    tangentMagnitude > 0 ? scale(tangent, 1 / tangentMagnitude) : [0, 0, 0];
  return add(
    scale(contact.normalFrame, best.normal),
    scale(tangentDirection, best.tangent),
  );
}

function achievedWrench(contacts, forces) {
  let forceN = [0, 0, 0],
    momentNm = [0, 0, 0];
  for (let index = 0; index < contacts.length; index++) {
    forceN = add(forceN, forces[index]);
    momentNm = add(momentNm, cross(contacts[index].pointFrameM, forces[index]));
  }
  return { forceN, momentNm };
}

function allocate(parsed) {
  const authorityValid =
    parsed.targetValid &&
    parsed.contacts.every((contact) => contact.authorityValid);
  let forces = parsed.contacts.map(() => [0, 0, 0]),
    iterations = 0,
    solverConverged = authorityValid;

  if (authorityValid && parsed.contacts.length) {
    const equivalentTargetMomentN =
        norm(parsed.targetMomentNm) / parsed.momentReferenceLengthM,
      forceScaleN = Math.max(
        1,
        norm(parsed.targetForceN),
        equivalentTargetMomentN,
        ...parsed.contacts.flatMap((contact) => [
          contact.normalForceLimitN,
          contact.tangentialForceLimitN,
        ]),
      );
    const solverContacts = parsed.contacts.map((contact) => ({
        ...contact,
        pointFrameM: scale(
          contact.pointFrameM,
          1 / parsed.momentReferenceLengthM,
        ),
        normalForceLimitN: contact.normalForceLimitN / forceScaleN,
        tangentialForceLimitN: contact.tangentialForceLimitN / forceScaleN,
      })),
      targetForce = scale(parsed.targetForceN, 1 / forceScaleN),
      targetMoment = scale(
        scale(parsed.targetMomentNm, 1 / parsed.momentReferenceLengthM),
        1 / forceScaleN,
      ),
      lipschitzBound = solverContacts.reduce(
        (sum, contact) =>
          sum + 3 + 2 * dot(contact.pointFrameM, contact.pointFrameM),
        0,
      ),
      step = 1 / lipschitzBound;
    const derivedSolverValues = [
      forceScaleN,
      ...targetForce,
      ...targetMoment,
      lipschitzBound,
      step,
      ...solverContacts.flatMap((contact) => [
        ...contact.pointFrameM,
        contact.normalForceLimitN,
        contact.tangentialForceLimitN,
      ]),
    ];
    if (!derivedSolverValues.every(Number.isFinite))
      throw new RangeError(
        "point-contact allocation exceeds finite numerical range",
      );
    forces = solverContacts.map(() => [0, 0, 0]);
    solverConverged = false;
    for (let iteration = 1; iteration <= parsed.maxIterations; iteration++) {
      const achieved = achievedWrench(solverContacts, forces),
        forceResidual = subtract(achieved.forceN, targetForce),
        momentResidual = subtract(achieved.momentNm, targetMoment),
        nextForces = forces.map((force, index) => {
          const gradient = add(
            forceResidual,
            cross(momentResidual, solverContacts[index].pointFrameM),
          );
          return projectContactForce(
            subtract(force, scale(gradient, step)),
            solverContacts[index],
          );
        }),
        updateNorm = Math.hypot(
          ...nextForces.flatMap((force, index) =>
            subtract(force, forces[index]),
          ),
        );
      forces = nextForces;
      iterations = iteration;
      if (
        (updateNorm / step) * forceScaleN <=
        parsed.projectedGradientToleranceN
      ) {
        solverConverged = true;
        break;
      }
    }
    forces = forces.map((force) => scale(force, forceScaleN));
  }

  const achieved = achievedWrench(parsed.contacts, forces),
    forceResidualN = subtract(parsed.targetForceN, achieved.forceN),
    momentResidualNm = subtract(parsed.targetMomentNm, achieved.momentNm),
    forceResidualNormN = norm(forceResidualN),
    momentResidualNormNm = norm(momentResidualNm),
    accepted =
      authorityValid &&
      solverConverged &&
      forceResidualNormN <= parsed.forceResidualToleranceN &&
      momentResidualNormNm <= parsed.momentResidualToleranceNm,
    allocations = parsed.contacts.map((contact, index) => {
      const forceFrameN = forces[index],
        normalForceN = dot(forceFrameN, contact.normalFrame),
        tangentForceFrameN = subtract(
          forceFrameN,
          scale(contact.normalFrame, normalForceN),
        ),
        tangentialForceN = norm(tangentForceFrameN),
        frictionLimitN = contact.frictionCoefficient * normalForceN,
        scaleN = Math.max(
          1,
          contact.normalForceLimitN,
          contact.tangentialForceLimitN,
          norm(forceFrameN),
        ),
        toleranceN = NUMERIC_TOLERANCE * scaleN,
        normalSaturated =
          normalForceN > toleranceN &&
          Math.abs(normalForceN - contact.normalForceLimitN) <= toleranceN,
        frictionSaturated =
          tangentialForceN > toleranceN &&
          Math.abs(tangentialForceN - frictionLimitN) <= toleranceN,
        tangentialLimitSaturated =
          tangentialForceN > toleranceN &&
          Math.abs(tangentialForceN - contact.tangentialForceLimitN) <=
            toleranceN;
      return {
        contactId: contact.contactId,
        tick: contact.tick,
        pointFrameM: contact.pointFrameM,
        normalFrame: contact.normalFrame,
        forceFrameN,
        forceWorldN: rotate(forceFrameN, parsed.quaternionWorldFromFrame),
        normalForceN,
        tangentialForceN,
        frictionLimitN,
        normalForceLimitN: contact.normalForceLimitN,
        tangentialForceLimitN: contact.tangentialForceLimitN,
        frictionCoefficient: contact.frictionCoefficient,
        normalSaturated,
        frictionSaturated,
        tangentialLimitSaturated,
        saturated:
          normalSaturated || frictionSaturated || tangentialLimitSaturated,
      };
    });
  if (
    ![
      ...achieved.forceN,
      ...achieved.momentNm,
      ...forceResidualN,
      ...momentResidualNm,
      forceResidualNormN,
      momentResidualNormNm,
      ...allocations.flatMap((allocation) => [
        ...allocation.forceFrameN,
        ...allocation.forceWorldN,
        allocation.normalForceN,
        allocation.tangentialForceN,
        allocation.frictionLimitN,
      ]),
    ].every(Number.isFinite)
  )
    throw new RangeError(
      "point-contact allocation result exceeds finite numerical range",
    );
  return issueInertPlainData({
    version: 1,
    tick: parsed.tick,
    targetFrameId: parsed.frameId,
    authorityValid,
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
    targetWrenchFrame: {
      forceN: parsed.targetForceN,
      momentNm: parsed.targetMomentNm,
    },
    achievedWrenchFrame: achieved,
    residualWrenchFrame: {
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
    saturated: allocations.some((allocation) => allocation.saturated),
    allocations,
  });
}

// Allocates bounded point forces for a target wrench without adding support,
// balance, gait, or sequence semantics. Inputs must be inert authority data.
export function allocatePointContactWrench(input) {
  return allocate(parseInput(input));
}
