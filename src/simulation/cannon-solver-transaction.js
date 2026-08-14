import * as CANNON from "cannon-es";
import {
  DomainValidationError,
  scopedIdentity,
  stableStringify,
} from "../model/primitives.js";
import { sha256Hex } from "../model/sha256.js";
import {
  assignConstraintEvidenceRows,
  constraintReactionContributionCandidates,
  materializeConstraintReactionContribution,
} from "./constraint-reaction-wrench.js";
import { canonicalizeRegisteredHeightfieldTireContacts } from "./tire-contact.js";
import {
  clearRollingSupportRegistrations,
  rollingSupportRegistrationCount,
  rollingSupportRegistrations,
} from "./rolling-support-registration.js";

export const CANNON_SOLVER_TRANSACTION_ID =
  "simulacrum-owned-cannon-solver-transaction-v4-coupled-motor-envelopes";

const collideEvent = {
  type: CANNON.Body.COLLIDE_EVENT_NAME,
  body: null,
  contact: null,
};
const preStepEvent = { type: "preStep" };
const postStepEvent = { type: "postStep" };
const privateStateByTransaction = new WeakMap();

function clearSimulacrumEquationMetadata(equation) {
  for (const key of [
    "simulacrumEvidence",
    "simulacrumEvidenceRow",
    "simulacrumEvidenceSourceContactIds",
    "simulacrumTireEvidence",
    "surfaceMaterialKey",
    "surfaceShapeId",
    "surfaceFrictionCoefficient",
    "surfaceLawParticipant",
    "simulacrumFrictionCoefficient",
    "simulacrumFrictionCoefficientValid",
    "simulacrumRollingSupport",
  ])
    delete equation[key];
}

const CANONICAL_ROLLING_SUPPORT = Symbol("canonicalRollingSupport");

function resetVector(value) {
  value?.set?.(0, 0, 0);
}

function resetCanonicalContact(contact) {
  clearSimulacrumEquationMetadata(contact);
  contact[CANONICAL_ROLLING_SUPPORT] = false;
  contact.bi = null;
  contact.bj = null;
  contact.si = null;
  contact.sj = null;
  resetVector(contact.ri);
  resetVector(contact.rj);
  resetVector(contact.ni);
  resetVector(contact.jacobianElementA?.spatial);
  resetVector(contact.jacobianElementA?.rotational);
  resetVector(contact.jacobianElementB?.spatial);
  resetVector(contact.jacobianElementB?.rotational);
  contact.minForce = 0;
  contact.maxForce = 1e6;
  contact.a = 0;
  contact.b = 0;
  contact.eps = 0;
  contact.enabled = true;
  contact.multiplier = 0;
  contact.restitution = 0;
}

function copyCanonicalContact(contact, raw, candidate) {
  resetCanonicalContact(contact);
  contact[CANONICAL_ROLLING_SUPPORT] = true;
  contact.bi = raw.bi;
  contact.bj = raw.bj;
  contact.si = raw.si;
  contact.sj = raw.sj;
  const geometry = candidate.geometry,
    pointA = candidate.wheelIsA
      ? geometry.wheelOffsetWorld
      : geometry.supportOffsetWorld,
    pointB = candidate.wheelIsA
      ? geometry.supportOffsetWorld
      : geometry.wheelOffsetWorld;
  contact.ri.set(pointA.x, pointA.y, pointA.z);
  contact.rj.set(pointB.x, pointB.y, pointB.z);
  contact.ni.set(
    candidate.contactNormalWorld.x,
    candidate.contactNormalWorld.y,
    candidate.contactNormalWorld.z,
  );
  contact.minForce = raw.minForce;
  contact.maxForce = raw.maxForce;
  contact.a = raw.a;
  contact.b = raw.b;
  contact.eps = raw.eps;
  contact.enabled = raw.enabled;
  contact.multiplier = 0;
  contact.restitution = raw.restitution;
  return contact;
}

/** Advances one project-owned solve with optional evidence-only provenance. */
export function stepCannonSolverTransaction(
  transaction,
  dt,
  tick,
  { captureEvidence = false } = {},
) {
  const state = privateStateByTransaction.get(transaction);
  if (!state) throw new TypeError("Unknown Cannon solver transaction");
  state.pendingEvidenceTick = captureEvidence ? tick : null;
  try {
    return transaction.step(dt);
  } finally {
    state.pendingEvidenceTick = null;
  }
}

/** Returns detached evidence without extending the public transaction class. */
export function completedCannonSolverEvidence(transaction) {
  const state = privateStateByTransaction.get(transaction);
  if (!state?.evidenceCandidates) return Object.freeze([]);
  if (!state.evidenceContributions) {
    state.evidenceContributions = Object.freeze(
      completedCannonSolverEvidenceCandidates(transaction)
        .map((candidate) =>
          materializeConstraintReactionContribution(candidate),
        )
        .filter(Boolean),
    );
  }
  return state.evidenceContributions;
}

/** Returns lightweight solved-row descriptors for bounded evidence selection. */
export function completedCannonSolverEvidenceCandidates(transaction) {
  const state = privateStateByTransaction.get(transaction);
  if (!state?.evidenceCandidates) return Object.freeze([]);
  if (!state.evidenceRowCandidates) {
    annotateFrictionRows(transaction.world, state.evidenceTick);
    state.evidenceRowCandidates = Object.freeze(
      state.evidenceCandidates.flatMap((candidate) =>
        constraintReactionContributionCandidates(candidate, "A", {
          tick: state.evidenceTick,
        }),
      ),
    );
  }
  return state.evidenceRowCandidates;
}

export function cannonSolverTransactionResourceState(transaction) {
  const state = privateStateByTransaction.get(transaction);
  if (!state) throw new TypeError("Unknown Cannon solver transaction");
  return Object.freeze({
    canonicalContactPoolSize: state.canonicalContactPool.length,
    canonicalContactAllocations: state.canonicalContactAllocations,
    rollingSupportRegistrations: rollingSupportRegistrationCount(transaction),
  });
}

export function registerCannonCollisionExclusion(transaction, exclusion) {
  const state = privateStateByTransaction.get(transaction);
  if (!exclusion?.bodyA || !exclusion?.bodyB)
    throw new DomainValidationError(
      "INVALID_COLLISION_EXCLUSION",
      "Collision exclusions require two Cannon bodies",
    );
  state.collisionExclusions.add(exclusion);
}

export function unregisterCannonCollisionExclusion(transaction, exclusion) {
  privateStateByTransaction
    .get(transaction)
    .collisionExclusions.delete(exclusion);
}

export function cannonCollisionExclusionRegistered(transaction, exclusion) {
  return privateStateByTransaction
    .get(transaction)
    .collisionExclusions.has(exclusion);
}

function stableBodyKey(body) {
  const identity =
    body.userData?.partId ??
    body.userData?.externalBodyId ??
    body.userData?.stressKey ??
    body.id;
  return `${typeof identity}:${String(identity)}`;
}

function evidenceBodyKey(body, world) {
  if (body.userData?.partId != null)
    return {
      id: scopedIdentity("part", body.userData.partId, {
        typedStrings: true,
      }),
      validity: "measured",
    };
  if (body.userData?.externalBodyId != null)
    return {
      id: scopedIdentity("external-body", body.userData.externalBodyId, {
        typedStrings: true,
      }),
      validity: "measured",
    };
  return {
    id: `anonymous-body:${world.bodies.indexOf(body)}`,
    validity: "unavailable",
  };
}

function evidenceShapeKey(body, shape) {
  const explicit = shape?.userData?.shapeId;
  if (explicit != null)
    return {
      id: scopedIdentity("shape", explicit, { typedStrings: true }),
      validity: "measured",
    };
  const index = body.shapes.indexOf(shape);
  return {
    id: `body-shape:${Math.max(0, index)}`,
    validity: "derived",
  };
}

function compareVector(left, right, leftScale = 1, rightScale = 1) {
  for (const component of ["x", "y", "z"]) {
    const delta =
      Number(left?.[component] || 0) * leftScale -
      Number(right?.[component] || 0) * rightScale;
    if (delta) return delta;
  }
  return 0;
}

const CONTACT_BASIS_TOLERANCE = 2 ** -20;

function finiteVectorComponents(value) {
  return ["x", "y", "z"].every((component) =>
    Number.isFinite(value?.[component]),
  );
}

function sameFiniteVector(left, right) {
  return (
    finiteVectorComponents(left) &&
    ["x", "y", "z"].every((component) => left[component] === right[component])
  );
}

function vectorDot(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function unitVector(value) {
  return (
    finiteVectorComponents(value) &&
    Math.abs(Math.hypot(value.x, value.y, value.z) - 1) <=
      CONTACT_BASIS_TOLERANCE
  );
}

function independentContactTangents(contact, rows) {
  return (
    unitVector(contact.ni) &&
    rows.every(
      (row) =>
        unitVector(row.t) &&
        Math.abs(vectorDot(row.t, contact.ni)) <= CONTACT_BASIS_TOLERANCE,
    ) &&
    Math.abs(vectorDot(rows[0].t, rows[1].t)) <= CONTACT_BASIS_TOLERANCE
  );
}

function contactRecordOrder(left, right) {
  return (
    String(left.rolling?.manifoldId || "ordinary-contact").localeCompare(
      String(right.rolling?.manifoldId || "ordinary-contact"),
      "en",
    ) ||
    left.bodyAId.localeCompare(right.bodyAId, "en") ||
    left.shapeAId.localeCompare(right.shapeAId, "en") ||
    left.bodyBId.localeCompare(right.bodyBId, "en") ||
    left.shapeBId.localeCompare(right.shapeBId, "en") ||
    compareVector(left.firstPoint, right.firstPoint) ||
    compareVector(left.secondPoint, right.secondPoint) ||
    compareVector(
      left.normal,
      right.normal,
      left.normalScale,
      right.normalScale,
    )
  );
}

function frictionRecordOrder(left, right) {
  return (
    left.bodies[0].localeCompare(right.bodies[0], "en") ||
    left.bodies[1].localeCompare(right.bodies[1], "en") ||
    compareVector(left.equation.ri, right.equation.ri) ||
    compareVector(left.equation.rj, right.equation.rj) ||
    compareVector(left.equation.t, right.equation.t)
  );
}

function canonicalContactRecord(contact, world) {
  const leftBody = evidenceBodyKey(contact.bi, world),
    rightBody = evidenceBodyKey(contact.bj, world),
    leftShape = evidenceShapeKey(contact.bi, contact.si),
    rightShape = evidenceShapeKey(contact.bj, contact.sj),
    swap =
      leftBody.id.localeCompare(rightBody.id, "en") > 0 ||
      (leftBody.id === rightBody.id &&
        leftShape.id.localeCompare(rightShape.id, "en") > 0),
    firstBody = swap ? rightBody : leftBody,
    secondBody = swap ? leftBody : rightBody,
    firstShape = swap ? rightShape : leftShape,
    secondShape = swap ? leftShape : rightShape,
    firstPoint = swap ? contact.rj : contact.ri,
    secondPoint = swap ? contact.ri : contact.rj,
    rolling = contact.simulacrumRollingSupport || null;
  return {
    contact,
    firstPoint,
    secondPoint,
    normal: contact.ni,
    normalScale: swap ? -1 : 1,
    bodyAId: firstBody.id,
    bodyBId: secondBody.id,
    shapeAId: firstShape.id,
    shapeBId: secondShape.id,
    rolling,
    validity: [firstBody, secondBody, firstShape, secondShape].some(
      (entry) => entry.validity === "unavailable",
    )
      ? "unavailable"
      : [firstShape, secondShape].some((entry) => entry.validity === "derived")
        ? "derived"
        : "measured",
  };
}

function annotateContactRows(world, tick) {
  const records = world.contacts
    .map((contact) => canonicalContactRecord(contact, world))
    .sort(contactRecordOrder);
  for (const [ordinal, record] of records.entries()) {
    const contactId = record.rolling
        ? `contact:${String(tick)}:${record.rolling.manifoldId}`
        : `contact:${String(tick)}:${record.bodyAId}:${record.shapeAId}:${record.bodyBId}:${record.shapeBId}:${ordinal}`,
      evidence = Object.freeze({
        tick,
        contactId,
        collisionOrdinal: ordinal,
        bodyAId: record.bodyAId,
        bodyBId: record.bodyBId,
        shapeAId: record.shapeAId,
        shapeBId: record.shapeBId,
        validity:
          record.rolling?.validity === "measured"
            ? record.validity
            : record.rolling?.validity || record.validity,
        ...(record.rolling
          ? {
              manifoldId: record.rolling.manifoldId,
              supportFeatureId: record.rolling.featureId,
            }
          : {}),
      });
    record.contact.simulacrumEvidence = evidence;
    record.contact.simulacrumEvidenceRow = Object.freeze({
      rowId: `${contactId}:normal`,
      rowKind: "contact-normal",
      localOrdinal: 0,
      source: "contact",
      constraintId: null,
      sourceConnectionIds: Object.freeze([]),
      sourceContactIds: Object.freeze([contactId]),
    });
  }
}

function annotateFrictionRows(world, tick) {
  let contactsByBodyPair = null;
  const resolveSourceContactIds = (equation) => {
    if (!contactsByBodyPair) {
      contactsByBodyPair = new Map();
      for (const contact of world.contacts) {
        const contactId = contact.simulacrumEvidence?.contactId;
        if (!contactId) continue;
        for (const [bodyA, bodyB, anchorA, anchorB] of [
          [contact.bi, contact.bj, contact.ri, contact.rj],
          [contact.bj, contact.bi, contact.rj, contact.ri],
        ]) {
          const byOtherBody = contactsByBodyPair.get(bodyA) || new Map(),
            records = byOtherBody.get(bodyB) || [];
          records.push({ contactId, anchorA, anchorB });
          byOtherBody.set(bodyB, records);
          contactsByBodyPair.set(bodyA, byOtherBody);
        }
      }
    }
    return [...(contactsByBodyPair.get(equation.bi)?.get(equation.bj) || [])]
      .filter(
        (contact) =>
          sameFiniteVector(equation.ri, contact.anchorA) &&
          sameFiniteVector(equation.rj, contact.anchorB),
      )
      .map((contact) => contact.contactId)
      .sort((left, right) => left.localeCompare(right, "en"));
  };
  const records = world.frictionEquations
    .map((equation) => {
      const bodies = [
        evidenceBodyKey(equation.bi, world).id,
        evidenceBodyKey(equation.bj, world).id,
      ].sort((left, right) => left.localeCompare(right, "en"));
      return { equation, bodies };
    })
    .sort(frictionRecordOrder);
  for (const [ordinal, record] of records.entries()) {
    record.equation.simulacrumEvidenceRow = Object.freeze({
      rowId: `friction:${String(tick)}:${record.bodies.join(":")}:${ordinal}`,
      rowKind: "contact-friction",
      localOrdinal: ordinal,
      source: "friction",
      constraintId: null,
      sourceConnectionIds: Object.freeze([]),
    });
    record.equation.simulacrumEvidenceSourceContactIds = () =>
      resolveSourceContactIds(record.equation);
  }
}

function resolveSurfaceLaw(body, otherBody, offset) {
  const resolver = body.userData?.contactMaterialAt;
  if (typeof resolver !== "function") return null;
  const point = new CANNON.Vec3();
  body.position.vadd(offset, point);
  return resolver(point.x, point.z, otherBody.material?.name || null);
}

function resolvedLawForEquation(equation) {
  const bodyALaw = resolveSurfaceLaw(equation.bi, equation.bj, equation.ri);
  if (bodyALaw) return { law: bodyALaw, participant: "bi" };
  const bodyBLaw = resolveSurfaceLaw(equation.bj, equation.bi, equation.rj);
  return bodyBLaw ? { law: bodyBLaw, participant: "bj" } : null;
}

function frictionEquationMatchesContact(equation, contact) {
  return (
    (equation.bi === contact.bi &&
      equation.bj === contact.bj &&
      sameFiniteVector(equation.ri, contact.ri) &&
      sameFiniteVector(equation.rj, contact.rj)) ||
    (equation.bi === contact.bj &&
      equation.bj === contact.bi &&
      sameFiniteVector(equation.ri, contact.rj) &&
      sameFiniteVector(equation.rj, contact.ri))
  );
}

function enforcedFrictionCoefficient(world, contact) {
  const rows = world.frictionEquations.filter((equation) =>
      frictionEquationMatchesContact(equation, contact),
    ),
    gravityMagnitude = (world.frictionGravity || world.gravity).length(),
    inverseMass = contact.bi.invMass + contact.bj.invMass;
  if (
    rows.length !== 2 ||
    !independentContactTangents(contact, rows) ||
    !Number.isFinite(gravityMagnitude) ||
    gravityMagnitude <= 0 ||
    !Number.isFinite(inverseMass) ||
    inverseMass <= 0 ||
    rows.some(
      (equation) =>
        equation.enabled !== true ||
        !Number.isFinite(equation.minForce) ||
        !Number.isFinite(equation.maxForce) ||
        equation.maxForce < 0 ||
        equation.minForce !== -equation.maxForce,
    ) ||
    rows[0].maxForce !== rows[1].maxForce
  )
    return null;
  const coefficient = (rows[0].maxForce * inverseMass) / gravityMagnitude;
  return Number.isFinite(coefficient) && coefficient >= 0 ? coefficient : null;
}

function annotateEnforcedContactFriction(world) {
  for (const contact of world.contacts) {
    const coefficient = enforcedFrictionCoefficient(world, contact);
    contact.simulacrumFrictionCoefficientValid = coefficient !== null;
    contact.simulacrumFrictionCoefficient = coefficient ?? 0;
  }
}

function applyResolvedSurfaceLaws(world, dt) {
  for (const contact of world.contacts) {
    const resolved = resolvedLawForEquation(contact);
    if (!resolved) continue;
    const { law, participant } = resolved;
    contact.surfaceMaterialKey = law.materialKey;
    contact.surfaceShapeId = law.shapeId;
    contact.surfaceFrictionCoefficient = law.friction;
    contact.surfaceLawParticipant = participant;
    contact.restitution = law.restitution;
    contact.setSpookParams(
      law.contactEquationStiffness,
      law.contactEquationRelaxation,
      dt,
    );
  }
  const gravityMagnitude = (world.frictionGravity || world.gravity).length();
  for (const equation of world.frictionEquations) {
    const resolved = resolvedLawForEquation(equation);
    if (!resolved) continue;
    const { law, participant } = resolved;
    const inverseMass = equation.bi.invMass + equation.bj.invMass,
      slipForce = inverseMass
        ? law.friction * gravityMagnitude * (1 / inverseMass)
        : 0;
    equation.surfaceMaterialKey = law.materialKey;
    equation.surfaceFrictionCoefficient = law.friction;
    equation.surfaceLawParticipant = participant;
    equation.minForce = -slipForce;
    equation.maxForce = slipForce;
    equation.setSpookParams(
      law.frictionEquationStiffness,
      law.frictionEquationRelaxation,
      dt,
    );
  }
  annotateEnforcedContactFriction(world);
}

function stableBodyRanks(state, bodies) {
  if (
    state.bodies.length !== bodies.length ||
    state.bodies.some((body, index) => body !== bodies[index])
  ) {
    state.bodies = [...bodies];
    state.ranks = new Map(
      [...bodies]
        .sort((left, right) =>
          stableBodyKey(left).localeCompare(stableBodyKey(right)),
        )
        .map((body, index) => [body, index]),
    );
  }
  return state.ranks;
}

function finiteNonNegative(value, path) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0)
    throw new DomainValidationError(
      "INVALID_MOTOR_ENERGY_BUDGET",
      `${path} must be a finite non-negative number`,
      { path: [path] },
    );
  return number;
}

function recordDigest(records) {
  return `motor-energy-sha256-${sha256Hex(stableStringify(records))}`;
}

/**
 * Attributes one row's work along the simultaneous-impulse path from the
 * pre-solve to post-solve generalized velocity. Scaling every solved impulse
 * from zero to its final value makes that velocity path linear, partitions all
 * cross terms exactly, and sums over rows to the system kinetic-energy change.
 */
export function impulseWorkAttribution(
  initialGeneralizedSpeed,
  finalGeneralizedSpeed,
  acceptedImpulse,
) {
  const impulseMagnitude = Math.abs(acceptedImpulse),
    direction = Math.sign(acceptedImpulse),
    initialDirectionalSpeed = direction * initialGeneralizedSpeed,
    finalDirectionalSpeed = direction * finalGeneralizedSpeed,
    speedDelta = finalDirectionalSpeed - initialDirectionalSpeed,
    positiveMechanicalWorkJ = speedDelta
      ? (impulseMagnitude *
          (Math.max(0, finalDirectionalSpeed) ** 2 -
            Math.max(0, initialDirectionalSpeed) ** 2)) /
        (2 * speedDelta)
      : impulseMagnitude * Math.max(0, initialDirectionalSpeed),
    absorbedMechanicalWorkJ = speedDelta
      ? (impulseMagnitude *
          (Math.max(0, -initialDirectionalSpeed) ** 2 -
            Math.max(0, -finalDirectionalSpeed) ** 2)) /
        (2 * speedDelta)
      : impulseMagnitude * Math.max(0, -initialDirectionalSpeed);
  return {
    signedWorkJ: positiveMechanicalWorkJ - absorbedMechanicalWorkJ,
    positiveMechanicalWorkJ,
    absorbedMechanicalWorkJ,
  };
}

function impulseAtPositiveWorkLimit(
  initialGeneralizedSpeed,
  coupledFinalSpeed,
  inverseMass,
  requestedImpulse,
  positiveEnergyJ,
) {
  const direction = Math.sign(requestedImpulse),
    requestedMagnitude = Math.abs(requestedImpulse),
    workAtMagnitude = (magnitude) =>
      impulseWorkAttribution(
        initialGeneralizedSpeed,
        coupledFinalSpeed + direction * magnitude * inverseMass,
        direction * magnitude,
      ).positiveMechanicalWorkJ;
  let lower = 0,
    upper = requestedMagnitude;
  for (let iteration = 0; iteration < 64; iteration++) {
    const middle = (lower + upper) / 2;
    if (workAtMagnitude(middle) <= positiveEnergyJ) lower = middle;
    else upper = middle;
  }
  return direction * lower;
}

const motorEnergyToleranceJ = (budgetJ) => Math.max(1e-9, budgetJ * 1e-10);
const motorImpulseToleranceNs = (impulseNs) =>
  Math.max(1e-12, Math.abs(impulseNs) * 1e-10);
// The work attribution traverses several coupled dot products. Reserve a
// generic forward-error margin so a hard energy ceiling remains one-sided
// after later rows in the same Gauss-Seidel pass perturb generalized speed.
const coupledWorkRoundoffScale = 32 * Math.sqrt(Number.EPSILON);

export function couplingEnergyReserveAfterViolation(
  budgetJ,
  currentReserveJ,
  positiveWorkJ,
  previousPositiveWorkJ,
) {
  const hasPreviousCoupledWork = previousPositiveWorkJ != null,
    couplingWorkVariationJ = hasPreviousCoupledWork
      ? Math.abs(positiveWorkJ - previousPositiveWorkJ)
      : 0,
    correctionJ = Math.max(
      coupledWorkRoundoffScale * Math.max(1, budgetJ),
      hasPreviousCoupledWork
        ? couplingWorkVariationJ +
            Math.max(0, positiveWorkJ - budgetJ) +
            motorEnergyToleranceJ(budgetJ)
        : 0,
    );
  return Math.min(budgetJ, currentReserveJ + correctionJ);
}

function refreshMotorEnvelopeState(equations, motorRows, lambda, dt) {
  let valid = true;
  for (const row of motorRows) {
    const equation = equations[row.equationIndex],
      acceptedImpulse = lambda[row.equationIndex],
      finalSpeed = row.preGeneralizedSpeedRadS + equation.computeGWlambda(),
      coupledFinalSpeed =
        finalSpeed - row.generalizedInverseMass * acceptedImpulse;
    let admissibleImpulse = acceptedImpulse;
    if (row.forceSpeedEnvelope) {
      const forceSpeedLimit = forceSpeedLimitedImpulse(
          row.requestedImpulseNs,
          coupledFinalSpeed,
          row.generalizedInverseMass,
          dt,
          row.forceSpeedEnvelope,
          1,
        ),
        thermalLimit = forceSpeedLimitedImpulse(
          row.requestedImpulseNs,
          coupledFinalSpeed,
          row.generalizedInverseMass,
          dt,
          row.forceSpeedEnvelope,
          row.thermalAvailability,
        );
      row.forceSpeedLimitedImpulseNs = forceSpeedLimit;
      row.thermalLimitedImpulseNs = thermalLimit;
      row.forceSpeedSaturated =
        Math.abs(forceSpeedLimit - row.requestedImpulseNs) > 1e-12;
      row.thermalSaturated = Math.abs(thermalLimit - forceSpeedLimit) > 1e-12;
      admissibleImpulse = thermalLimit;
    }
    const work = impulseWorkAttribution(
        row.preGeneralizedSpeedRadS,
        finalSpeed,
        acceptedImpulse,
      ),
      oppositeDirection =
        acceptedImpulse !== 0 &&
        Math.sign(acceptedImpulse) !== Math.sign(admissibleImpulse),
      impulseExceeded =
        Math.abs(acceptedImpulse) >
        Math.abs(admissibleImpulse) +
          motorImpulseToleranceNs(admissibleImpulse),
      energyExceeded =
        work.positiveMechanicalWorkJ >
        row.mechanicalBudgetJ + motorEnergyToleranceJ(row.mechanicalBudgetJ),
      previousPositiveWorkJ = row.lastCoupledPositiveWorkJ;
    row.lastCoupledPositiveWorkJ = work.positiveMechanicalWorkJ;
    if (energyExceeded)
      row.couplingEnergyReserveJ = couplingEnergyReserveAfterViolation(
        row.mechanicalBudgetJ,
        row.couplingEnergyReserveJ,
        work.positiveMechanicalWorkJ,
        previousPositiveWorkJ,
      );
    row.finalEnvelopeViolation =
      oppositeDirection || impulseExceeded || energyExceeded
        ? {
            partId: row.partId,
            constraintId: row.constraintId,
            acceptedImpulse,
            admissibleImpulse,
            positiveMechanicalWorkJ: work.positiveMechanicalWorkJ,
            mechanicalBudgetJ: row.mechanicalBudgetJ,
            oppositeDirection,
            impulseExceeded,
            energyExceeded,
          }
        : null;
    if (row.finalEnvelopeViolation) valid = false;
  }
  return valid;
}

export function coupledSolveCanAccept({
  motorEnvelopesValid,
  ordinaryRowsConverged,
  authoredIterationBudgetComplete,
}) {
  return Boolean(
    motorEnvelopesValid &&
    (ordinaryRowsConverged || authoredIterationBudgetComplete),
  );
}

export function fillCoupledSolveOrder(rows, target = []) {
  target.length = 0;
  for (let index = 0; index < rows.length; index++)
    if (rows[index]) target.push(index);
  for (let index = 0; index < rows.length; index++)
    if (!rows[index]) target.push(index);
  return target;
}

export function forceCapacityAtSpeed(points, speedMPerS, positiveDirection) {
  const absoluteSpeed = Math.abs(speedMPerS),
    field = positiveDirection ? "maxExtendForceN" : "maxRetractForceN";
  if (absoluteSpeed <= points[0].absSpeedMPerS) return points[0][field];
  for (let index = 1; index < points.length; index++) {
    const lower = points[index - 1],
      upper = points[index];
    if (absoluteSpeed > upper.absSpeedMPerS) continue;
    const span = upper.absSpeedMPerS - lower.absSpeedMPerS,
      ratio = span > 0 ? (absoluteSpeed - lower.absSpeedMPerS) / span : 1;
    return lower[field] + (upper[field] - lower[field]) * ratio;
  }
  return 0;
}

/**
 * Solves the authored force-speed inequality against this row's predicted
 * post-impulse speed. The bound is implicit: a large impulse cannot claim the
 * rest-speed force capacity while accelerating through the no-load speed in
 * the same fixed tick.
 */
export function forceSpeedLimitedImpulse(
  requestedImpulseNs,
  baseSpeedMPerS,
  inverseMass,
  dt,
  points,
  thermalAvailability,
) {
  if (!requestedImpulseNs || !(inverseMass > 0)) return 0;
  const direction = Math.sign(requestedImpulseNs),
    requestedMagnitude = Math.abs(requestedImpulseNs),
    admissible = (magnitude) => {
      const finalSpeed = baseSpeedMPerS + direction * magnitude * inverseMass,
        capacityImpulse =
          forceCapacityAtSpeed(points, finalSpeed, direction > 0) *
          thermalAvailability *
          dt;
      return magnitude <= capacityImpulse + 1e-12;
    };
  if (admissible(requestedMagnitude)) return requestedImpulseNs;
  let lower = 0,
    upper = requestedMagnitude;
  for (let iteration = 0; iteration < 64; iteration++) {
    const middle = (lower + upper) / 2;
    if (admissible(middle)) lower = middle;
    else upper = middle;
  }
  return direction * lower;
}

/**
 * Mirrors cannon-es GSSolver while adding an exact positive-work ceiling only
 * to explicitly registered motor equations. Worlds without registered rows use
 * the pinned solver directly and never enter this path.
 */
function solveEnergyBudgetedRows(solver, h, world, registrations, scratch) {
  if (!(solver instanceof CANNON.GSSolver))
    throw new DomainValidationError(
      "UNSUPPORTED_ENERGY_BUDGET_SOLVER",
      "Energy-budgeted motor rows require the pinned Cannon GSSolver",
    );
  const equations = solver.equations,
    bodies = world.bodies,
    rows = scratch.rows,
    motorRows = scratch.motorRows,
    solveOrder = scratch.solveOrder;
  rows.length = equations.length;
  rows.fill(null);
  motorRows.length = 0;
  solveOrder.length = 0;
  for (let index = 0; index < equations.length; index++) {
    const equation = equations[index],
      registration = registrations.get(equation);
    if (!registration) continue;
    const row = {
      ...registration,
      equationIndex: index,
      signedWorkJ: 0,
      positiveMechanicalWorkJ: 0,
      absorbedMechanicalWorkJ: 0,
      preGeneralizedSpeedRadS: 0,
      finalGeneralizedSpeedRadS: 0,
      generalizedInverseMass: 0,
      acceptedImpulseNms: 0,
      forceSpeedLimitedImpulseNs: registration.requestedImpulseNs ?? null,
      thermalLimitedImpulseNs: registration.requestedImpulseNs ?? null,
      forceSpeedSaturated: false,
      thermalSaturated: false,
      energySaturated: false,
      couplingEnergyReserveJ: 0,
      lastCoupledPositiveWorkJ: null,
      saturated: false,
    };
    rows[index] = row;
    motorRows.push(row);
  }
  if (motorRows.length !== registrations.size)
    for (const [equation, registration] of registrations)
      if (!equations.includes(equation))
        throw new DomainValidationError(
          "MOTOR_ENERGY_EQUATION_MISSING",
          `Registered motor equation for part ${String(registration.partId)} is not in the solve`,
        );
  // Motor rows are evaluated first inside every complete Gauss-Seidel pass.
  // Every ordinary row therefore observes every motor correction in that pass;
  // final envelope auditing then catches ordinary-row changes that make a motor
  // inadmissible. This makes the physical result independent of where a
  // constraint happened to append its equations to Cannon's flat list.
  fillCoupledSolveOrder(rows, solveOrder);
  if (equations.length)
    for (const body of bodies) body.updateSolveMassProperties();
  const lambda = scratch.lambda,
    inverseC = scratch.inverseC,
    rightHandSide = scratch.rightHandSide;
  lambda.length = equations.length;
  inverseC.length = equations.length;
  rightHandSide.length = equations.length;
  for (let index = 0; index < equations.length; index++) {
    const equation = equations[index];
    lambda[index] = 0;
    // cannon-es' runtime solver calls computeB(h); its bundled base-class
    // declaration still exposes the obsolete three-argument signature.
    rightHandSide[index] = /** @type {any} */ (equation).computeB(h);
    inverseC[index] = 1 / equation.computeC();
    const row = rows[index];
    if (row) {
      row.preGeneralizedSpeedRadS = equation.computeGW();
      row.generalizedInverseMass = equation.computeGiMGt();
    }
  }
  for (const body of bodies) {
    body.vlambda.set(0, 0, 0);
    body.wlambda.set(0, 0, 0);
  }
  const toleranceSquared = solver.tolerance * solver.tolerance,
    requiredFullPasses = Math.max(2, solver.iterations),
    maximumCoupledIterations = Math.max(
      requiredFullPasses,
      solver.iterations * 4,
    );
  let iterations = 0,
    finalResidual = 0,
    finalMotorEnvelopesValid = false,
    finalMotorResidual = 0,
    finalLargestDelta = null,
    finalOrdinaryRowsConverged = false,
    finalAuthoredIterationBudgetComplete = false,
    accepted = false;
  for (; iterations < maximumCoupledIterations; iterations++) {
    let deltaTotal = 0,
      motorDeltaTotal = 0,
      largestDelta = null;
    for (const index of solveOrder) {
      const equation = equations[index],
        previousImpulse = lambda[index];
      let deltaImpulse =
        inverseC[index] *
        (rightHandSide[index] -
          equation.computeGWlambda() -
          equation.eps * previousImpulse);
      if (previousImpulse + deltaImpulse < equation.minForce)
        deltaImpulse = equation.minForce - previousImpulse;
      else if (previousImpulse + deltaImpulse > equation.maxForce)
        deltaImpulse = equation.maxForce - previousImpulse;
      const row = rows[index];
      if (row) {
        let generalizedSpeed =
          row.preGeneralizedSpeedRadS + equation.computeGWlambda();
        if (row.forceSpeedEnvelope) {
          const baseSpeed =
              generalizedSpeed - row.generalizedInverseMass * previousImpulse,
            thermalLimitedImpulseNs = forceSpeedLimitedImpulse(
              row.requestedImpulseNs,
              baseSpeed,
              row.generalizedInverseMass,
              h,
              row.forceSpeedEnvelope,
              row.thermalAvailability,
            );
          deltaImpulse = thermalLimitedImpulseNs - previousImpulse;
          generalizedSpeed =
            row.preGeneralizedSpeedRadS + equation.computeGWlambda();
        }
        const generalizedInverseMass = row.generalizedInverseMass,
          coupledFinalSpeed =
            generalizedSpeed - generalizedInverseMass * previousImpulse,
          proposedImpulse = previousImpulse + deltaImpulse,
          proposedFinalSpeed =
            coupledFinalSpeed + generalizedInverseMass * proposedImpulse,
          availableMechanicalBudgetJ = Math.max(
            0,
            row.mechanicalBudgetJ - row.couplingEnergyReserveJ,
          ),
          proposedPositiveWorkJ = impulseWorkAttribution(
            row.preGeneralizedSpeedRadS,
            proposedFinalSpeed,
            proposedImpulse,
          ).positiveMechanicalWorkJ;
        if (proposedPositiveWorkJ > availableMechanicalBudgetJ + 1e-12) {
          const limitedImpulse = impulseAtPositiveWorkLimit(
            row.preGeneralizedSpeedRadS,
            coupledFinalSpeed,
            generalizedInverseMass,
            proposedImpulse,
            availableMechanicalBudgetJ,
          );
          deltaImpulse = limitedImpulse - previousImpulse;
          row.saturated = true;
          row.energySaturated = true;
        }
      }
      lambda[index] += deltaImpulse;
      deltaTotal += Math.abs(deltaImpulse);
      if (row) motorDeltaTotal += Math.abs(deltaImpulse);
      if (!largestDelta || Math.abs(deltaImpulse) > largestDelta.magnitude)
        largestDelta = {
          equationIndex: index,
          magnitude: Math.abs(deltaImpulse),
          motor: Boolean(row),
        };
      equation.addToWlambda(deltaImpulse);
    }
    finalResidual = deltaTotal;
    finalMotorResidual = motorDeltaTotal;
    finalLargestDelta = largestDelta;
    const motorEnvelopesValid = refreshMotorEnvelopeState(
      equations,
      motorRows,
      lambda,
      h,
    );
    finalMotorEnvelopesValid = motorEnvelopesValid;
    const ordinaryRowsConverged = deltaTotal * deltaTotal < toleranceSquared,
      authoredIterationBudgetComplete = iterations + 1 >= requiredFullPasses;
    finalOrdinaryRowsConverged = ordinaryRowsConverged;
    finalAuthoredIterationBudgetComplete = authoredIterationBudgetComplete;
    if (
      coupledSolveCanAccept({
        motorEnvelopesValid,
        ordinaryRowsConverged,
        authoredIterationBudgetComplete,
      })
    ) {
      accepted = true;
      break;
    }
  }
  if (!accepted)
    throw new DomainValidationError(
      "COUPLED_MOTOR_ENVELOPE_DID_NOT_CONVERGE",
      "Motor rows did not settle while every ordinary constraint row was being re-solved",
      {
        details: {
          iterations,
          maximumIterations: maximumCoupledIterations,
          residual: finalResidual,
          tolerance: solver.tolerance,
          motorEnvelopesValid: finalMotorEnvelopesValid,
          motorResidual: finalMotorResidual,
          ordinaryRowsConverged: finalOrdinaryRowsConverged,
          authoredIterationBudgetComplete: finalAuthoredIterationBudgetComplete,
          motorViolations: motorRows
            .map((row) => row.finalEnvelopeViolation)
            .filter(Boolean),
          largestDelta: finalLargestDelta,
        },
      },
    );
  for (const row of motorRows) {
    const equation = equations[row.equationIndex];
    row.acceptedImpulseNms = lambda[row.equationIndex];
    row.finalGeneralizedSpeedRadS =
      row.preGeneralizedSpeedRadS + equation.computeGWlambda();
    const work = impulseWorkAttribution(
      row.preGeneralizedSpeedRadS,
      row.finalGeneralizedSpeedRadS,
      row.acceptedImpulseNms,
    );
    row.signedWorkJ = work.signedWorkJ;
    row.positiveMechanicalWorkJ = work.positiveMechanicalWorkJ;
    row.absorbedMechanicalWorkJ = work.absorbedMechanicalWorkJ;
  }
  for (const body of bodies) {
    body.vlambda.vmul(body.linearFactor, body.vlambda);
    body.velocity.vadd(body.vlambda, body.velocity);
    body.wlambda.vmul(body.angularFactor, body.wlambda);
    body.angularVelocity.vadd(body.wlambda, body.angularVelocity);
  }
  const inverseDt = 1 / h;
  for (let index = equations.length - 1; index >= 0; index--)
    equations[index].multiplier = lambda[index] * inverseDt;
  return {
    iterations,
    residual: finalResidual,
    ordinaryRowsConverged: finalOrdinaryRowsConverged,
    authoredIterationBudgetComplete: finalAuthoredIterationBudgetComplete,
    records: motorRows.map((row) => ({
      tick: row.tick,
      partId: row.partId,
      constraintId: row.constraintId,
      mode: row.mode,
      electricalEfficiency: row.electricalEfficiency,
      allocatedBusW: row.allocatedBusW,
      mechanicalBudgetJ: row.mechanicalBudgetJ,
      ...(row.forceSpeedEnvelope
        ? { idleElectricalW: row.idleElectricalW }
        : { torqueImpulseLimitNms: row.torqueImpulseLimitNms }),
      acceptedImpulseNms: row.acceptedImpulseNms,
      ...(row.forceSpeedEnvelope
        ? {
            requestedImpulseNs: row.requestedImpulseNs,
            forceSpeedLimitedImpulseNs: row.forceSpeedLimitedImpulseNs,
            thermalLimitedImpulseNs: row.thermalLimitedImpulseNs,
            acceptedImpulseNs: row.acceptedImpulseNms,
            forceSpeedSaturated: row.forceSpeedSaturated,
            thermalSaturated: row.thermalSaturated,
            energySaturated: row.energySaturated,
          }
        : {}),
      signedWorkJ: row.signedWorkJ,
      positiveMechanicalWorkJ: row.positiveMechanicalWorkJ,
      absorbedMechanicalWorkJ: row.absorbedMechanicalWorkJ,
      unusedMechanicalBudgetJ: Math.max(
        0,
        row.mechanicalBudgetJ - row.positiveMechanicalWorkJ,
      ),
      couplingEnergyReserveJ: row.couplingEnergyReserveJ,
      preGeneralizedSpeedRadS: row.preGeneralizedSpeedRadS,
      finalGeneralizedSpeedRadS: row.finalGeneralizedSpeedRadS,
      generalizedInverseMass: row.generalizedInverseMass,
      saturated:
        row.saturated || row.forceSpeedSaturated || row.thermalSaturated,
      iterations,
      residual: finalResidual,
      ordinaryRowsConverged: finalOrdinaryRowsConverged,
      authoredIterationBudgetComplete: finalAuthoredIterationBudgetComplete,
    })),
  };
}

/**
 * Project-owned fixed-step transaction over public cannon-es primitives.
 *
 * The ordering mirrors the pinned engine's MIT-licensed integration sequence,
 * but ownership lives here so project constraints can join the same equation
 * set as ordinary contacts. There is no second solve and no call to World.step
 * or World.internalStep.
 */
export class CannonSolverTransaction {
  constructor(world) {
    for (const seam of [
      "broadphase",
      "narrowphase",
      "solver",
      "collisionMatrix",
      "collisionMatrixPrevious",
      "bodyOverlapKeeper",
      "shapeOverlapKeeper",
    ])
      if (!world?.[seam])
        throw new DomainValidationError(
          "INVALID_CANNON_TRANSACTION_SEAM",
          `Cannon solver transaction requires world.${seam}`,
          { path: ["world", seam] },
        );
    this.world = world;
    this.bodyPairsA = [];
    this.bodyPairsB = [];
    privateStateByTransaction.set(this, {
      bodyPairRecords: [],
      bodies: [],
      collisionExclusions: new Set(),
      excludedPairs: new Set(),
      ranks: new Map(),
      activeTick: null,
      motorRegistrations: new Map(),
      pendingMotorRecords: null,
      pendingEvidenceTick: null,
      evidenceTick: null,
      evidenceCandidates: null,
      evidenceRowCandidates: null,
      evidenceContributions: null,
      motorSolverScratch: {
        inverseC: [],
        lambda: [],
        motorRows: [],
        rightHandSide: [],
        rows: [],
        solveOrder: [],
      },
      canonicalContactPool: [],
      canonicalContactAllocations: 0,
    });
    this.oldContacts = [];
    this.frictionEquationPool = [];
  }

  beginSession() {
    const state = privateStateByTransaction.get(this);
    state.activeTick = null;
    state.motorRegistrations.clear();
    state.pendingMotorRecords = null;
    state.pendingEvidenceTick = null;
    state.evidenceTick = null;
    state.evidenceCandidates = null;
    state.evidenceRowCandidates = null;
    state.evidenceContributions = null;
    for (const values of Object.values(state.motorSolverScratch))
      values.length = 0;
  }

  beginTick(tick) {
    const state = privateStateByTransaction.get(this);
    if (state.pendingMotorRecords)
      throw new DomainValidationError(
        "MOTOR_ENERGY_SETTLEMENT_PENDING",
        `Motor energy for tick ${state.pendingMotorRecords.tick} must settle before the next solve`,
      );
    if (state.activeTick != null && state.activeTick !== tick)
      throw new DomainValidationError(
        "MOTOR_ENERGY_TICK_MISMATCH",
        "Registered motor energy budgets do not match the integration tick",
      );
    state.activeTick = tick;
  }

  #releaseCanonicalContact(contact) {
    const state = privateStateByTransaction.get(this);
    resetCanonicalContact(contact);
    state.canonicalContactPool.push(contact);
  }

  #acquireCanonicalContact(raw, candidate) {
    const state = privateStateByTransaction.get(this),
      pooled = state.canonicalContactPool.pop(),
      contact = pooled || new CANNON.ContactEquation(raw.bi, raw.bj);
    if (!pooled) state.canonicalContactAllocations++;
    return copyCanonicalContact(contact, raw, candidate);
  }

  dispose() {
    const state = privateStateByTransaction.get(this);
    for (const contact of this.world.contacts)
      if (contact[CANONICAL_ROLLING_SUPPORT]) resetCanonicalContact(contact);
    this.world.contacts.length = 0;
    this.world.frictionEquations.length = 0;
    this.oldContacts.length = 0;
    this.frictionEquationPool.length = 0;
    state.canonicalContactPool.length = 0;
    state.canonicalContactAllocations = 0;
    state.motorRegistrations.clear();
    state.collisionExclusions.clear();
    state.pendingMotorRecords = null;
    state.evidenceTick = null;
    state.evidenceCandidates = null;
    state.evidenceRowCandidates = null;
    state.evidenceContributions = null;
    for (const values of Object.values(state.motorSolverScratch))
      values.length = 0;
    clearRollingSupportRegistrations(this);
  }

  registerMotorEnergyBudget({
    tick,
    equation,
    partId,
    constraintId,
    mode,
    allocatedBusW,
    mechanicalBudgetJ,
    electricalEfficiency,
    torqueImpulseLimitNms,
    requestedImpulseNs = null,
    forceSpeedEnvelope = null,
    thermalAvailability = 1,
    idleElectricalW = 0,
  }) {
    const state = privateStateByTransaction.get(this);
    if (!equation || typeof equation.computeGiMGt !== "function")
      throw new DomainValidationError(
        "INVALID_MOTOR_ENERGY_EQUATION",
        "Motor energy registration requires a Cannon equation",
      );
    if (state.pendingMotorRecords)
      throw new DomainValidationError(
        "MOTOR_ENERGY_SETTLEMENT_PENDING",
        "Cannot register a motor budget before the prior tick settles",
      );
    if (state.activeTick != null && state.activeTick !== tick)
      throw new DomainValidationError(
        "MOTOR_ENERGY_TICK_MISMATCH",
        "All motor budgets in one solve must use the same tick",
      );
    if (state.motorRegistrations.has(equation))
      throw new DomainValidationError(
        "DUPLICATE_MOTOR_ENERGY_EQUATION",
        "A motor equation may be registered only once per tick",
      );
    state.activeTick = tick;
    const axialEffort = requestedImpulseNs !== null;
    if (
      axialEffort &&
      (!Number.isFinite(requestedImpulseNs) ||
        !Number.isFinite(thermalAvailability) ||
        thermalAvailability < 0 ||
        thermalAvailability > 1 ||
        !Array.isArray(forceSpeedEnvelope) ||
        forceSpeedEnvelope.length < 2 ||
        forceSpeedEnvelope.some(
          (point, index) =>
            !Number.isFinite(point?.absSpeedMPerS) ||
            point.absSpeedMPerS < 0 ||
            (index > 0 &&
              point.absSpeedMPerS <=
                forceSpeedEnvelope[index - 1].absSpeedMPerS) ||
            !Number.isFinite(point?.maxExtendForceN) ||
            point.maxExtendForceN < 0 ||
            !Number.isFinite(point?.maxRetractForceN) ||
            point.maxRetractForceN < 0,
        ))
    )
      throw new DomainValidationError(
        "INVALID_MOTOR_ENERGY_BUDGET",
        "Axial effort registration requires an ordered finite force-speed envelope",
      );
    state.motorRegistrations.set(equation, {
      tick,
      equation,
      partId,
      constraintId,
      mode: String(mode || "motoring"),
      allocatedBusW: finiteNonNegative(allocatedBusW, "allocatedBusW"),
      mechanicalBudgetJ: finiteNonNegative(
        mechanicalBudgetJ,
        "mechanicalBudgetJ",
      ),
      electricalEfficiency: Math.max(
        0.01,
        Math.min(1, Number(electricalEfficiency) || 0),
      ),
      ...(axialEffort
        ? {
            requestedImpulseNs: Number(requestedImpulseNs),
            forceSpeedEnvelope: forceSpeedEnvelope.map((point) => ({
              absSpeedMPerS: Number(point.absSpeedMPerS),
              maxExtendForceN: Number(point.maxExtendForceN),
              maxRetractForceN: Number(point.maxRetractForceN),
            })),
            thermalAvailability: finiteNonNegative(
              thermalAvailability,
              "thermalAvailability",
            ),
            idleElectricalW: finiteNonNegative(
              idleElectricalW,
              "idleElectricalW",
            ),
          }
        : {
            torqueImpulseLimitNms: finiteNonNegative(
              torqueImpulseLimitNms,
              "torqueImpulseLimitNms",
            ),
          }),
    });
  }

  motorEnergyRecordsForTick(tick) {
    const pending = privateStateByTransaction.get(this).pendingMotorRecords;
    if (!pending) return null;
    if (pending.tick !== tick)
      throw new DomainValidationError(
        "MOTOR_ENERGY_RECORD_TICK_MISMATCH",
        `Pending motor records belong to tick ${pending.tick}, not ${tick}`,
      );
    // The transaction constructs this envelope from primitive-only records and
    // freezes every record, the array, and the envelope before publication.
    // Returning that immutable owner-issued value avoids a structured clone on
    // every integration tick without exposing mutable solver state.
    return pending;
  }

  acknowledgeMotorEnergySettlement({ tick, recordDigest: digest }) {
    const state = privateStateByTransaction.get(this),
      pending = state.pendingMotorRecords;
    if (!pending || pending.tick !== tick || pending.recordDigest !== digest)
      throw new DomainValidationError(
        "INVALID_MOTOR_ENERGY_SETTLEMENT_ACKNOWLEDGEMENT",
        "Motor settlement acknowledgement must match the complete pending record set",
      );
    state.pendingMotorRecords = null;
  }

  assertMotorEnergySettled() {
    const pending = privateStateByTransaction.get(this).pendingMotorRecords;
    if (pending)
      throw new DomainValidationError(
        "MOTOR_ENERGY_SETTLEMENT_PENDING",
        `Motor energy for tick ${pending.tick} is not settled`,
      );
  }

  step(dt) {
    const world = this.world,
      bodies = world.bodies,
      constraints = world.constraints,
      solver = world.solver,
      dynamic = CANNON.Body.DYNAMIC,
      evidenceTick = privateStateByTransaction.get(this).pendingEvidenceTick,
      captureEvidence = evidenceTick != null,
      tick = evidenceTick ?? this.world.stepnumber + 1;
    world.dt = dt;

    for (const body of bodies)
      if (body.type === dynamic) {
        body.force.x += body.mass * world.gravity.x;
        body.force.y += body.mass * world.gravity.y;
        body.force.z += body.mass * world.gravity.z;
      }

    for (const subsystem of world.subsystems) subsystem.update();
    const pairsA = this.bodyPairsA,
      pairsB = this.bodyPairsB;
    pairsA.length = 0;
    pairsB.length = 0;
    world.broadphase.collisionPairs(world, pairsA, pairsB);
    const privateState = privateStateByTransaction.get(this),
      bodyPairRecords = privateState.bodyPairRecords,
      bodyRanks = stableBodyRanks(privateState, bodies),
      compareBodies = (left, right) =>
        bodyRanks.get(left) - bodyRanks.get(right);
    if (
      pairsA.some(
        (body, index) =>
          body.userData?.broadphaseCandidateFilter ||
          pairsB[index].userData?.broadphaseCandidateFilter,
      )
    ) {
      let writeIndex = 0;
      for (let readIndex = 0; readIndex < pairsA.length; readIndex++) {
        const bodyA = pairsA[readIndex],
          bodyB = pairsB[readIndex];
        if (
          bodyA.userData?.broadphaseCandidateFilter?.(bodyB) === false ||
          bodyB.userData?.broadphaseCandidateFilter?.(bodyA) === false
        )
          continue;
        pairsA[writeIndex] = bodyA;
        pairsB[writeIndex] = bodyB;
        writeIndex++;
      }
      pairsA.length = writeIndex;
      pairsB.length = writeIndex;
    }
    for (let index = 0; index < pairsA.length; index++) {
      let bodyA = pairsA[index],
        bodyB = pairsB[index];
      if (compareBodies(bodyA, bodyB) > 0) [bodyA, bodyB] = [bodyB, bodyA];
      const record =
        bodyPairRecords[index] ||
        (bodyPairRecords[index] = { a: null, b: null });
      record.a = bodyA;
      record.b = bodyB;
    }
    bodyPairRecords.length = pairsA.length;
    bodyPairRecords.sort(
      (left, right) =>
        compareBodies(left.a, right.a) || compareBodies(left.b, right.b),
    );
    for (let index = 0; index < bodyPairRecords.length; index++) {
      pairsA[index] = bodyPairRecords[index].a;
      pairsB[index] = bodyPairRecords[index].b;
    }
    const excludedPairs = privateState.excludedPairs;
    excludedPairs.clear();
    for (const constraint of constraints) {
      if (constraint.collideConnected) continue;
      const rankA = bodyRanks.get(constraint.bodyA),
        rankB = bodyRanks.get(constraint.bodyB);
      if (rankA == null || rankB == null) continue;
      excludedPairs.add(
        rankA < rankB
          ? rankA * bodies.length + rankB
          : rankB * bodies.length + rankA,
      );
    }
    for (const { bodyA, bodyB } of privateState.collisionExclusions) {
      const rankA = bodyRanks.get(bodyA),
        rankB = bodyRanks.get(bodyB);
      if (rankA == null || rankB == null) continue;
      excludedPairs.add(
        rankA < rankB
          ? rankA * bodies.length + rankB
          : rankB * bodies.length + rankA,
      );
    }
    if (excludedPairs.size) {
      let writeIndex = 0;
      for (let readIndex = 0; readIndex < pairsA.length; readIndex++) {
        const bodyA = pairsA[readIndex],
          bodyB = pairsB[readIndex],
          rankA = bodyRanks.get(bodyA),
          rankB = bodyRanks.get(bodyB),
          key =
            rankA < rankB
              ? rankA * bodies.length + rankB
              : rankB * bodies.length + rankA;
        if (excludedPairs.has(key)) continue;
        pairsA[writeIndex] = bodyA;
        pairsB[writeIndex] = bodyB;
        writeIndex++;
      }
      pairsA.length = writeIndex;
      pairsB.length = writeIndex;
    }
    world.collisionMatrixTick();
    for (const contact of world.contacts)
      if (contact[CANONICAL_ROLLING_SUPPORT])
        this.#releaseCanonicalContact(contact);
      else {
        clearSimulacrumEquationMetadata(contact);
        this.oldContacts.push(contact);
      }
    world.contacts.length = 0;
    for (const equation of world.frictionEquations) {
      clearSimulacrumEquationMetadata(equation);
      this.frictionEquationPool.push(equation);
    }
    world.frictionEquations.length = 0;
    world.narrowphase.getContacts(
      pairsA,
      pairsB,
      world,
      world.contacts,
      this.oldContacts,
      world.frictionEquations,
      this.frictionEquationPool,
    );
    canonicalizeRegisteredHeightfieldTireContacts({
      world,
      registrations: rollingSupportRegistrations(this),
      acquireCanonical: (contact, candidate) =>
        this.#acquireCanonicalContact(contact, candidate),
      recycleContact: (contact) => {
        clearSimulacrumEquationMetadata(contact);
        this.oldContacts.push(contact);
      },
      recycleFriction: (equation) => {
        clearSimulacrumEquationMetadata(equation);
        this.frictionEquationPool.push(equation);
      },
    });
    if (captureEvidence) annotateContactRows(world, tick);
    applyResolvedSurfaceLaws(world, dt);
    for (const equation of world.frictionEquations)
      solver.addEquation(equation);
    for (const contact of world.contacts) {
      const bodyA = contact.bi,
        bodyB = contact.bj;
      if (
        !contact.surfaceMaterialKey &&
        bodyA.material?.restitution >= 0 &&
        bodyB.material?.restitution >= 0
      )
        contact.restitution =
          bodyA.material.restitution * bodyB.material.restitution;
      solver.addEquation(contact);

      if (
        bodyA.allowSleep &&
        bodyA.type === dynamic &&
        bodyA.sleepState === CANNON.Body.SLEEPING &&
        bodyB.sleepState === CANNON.Body.AWAKE &&
        bodyB.type !== CANNON.Body.STATIC &&
        bodyB.velocity.lengthSquared() +
          bodyB.angularVelocity.lengthSquared() >=
          bodyB.sleepSpeedLimit ** 2 * 2
      )
        bodyA.wakeUpAfterNarrowphase = true;
      if (
        bodyB.allowSleep &&
        bodyB.type === dynamic &&
        bodyB.sleepState === CANNON.Body.SLEEPING &&
        bodyA.sleepState === CANNON.Body.AWAKE &&
        bodyA.type !== CANNON.Body.STATIC &&
        bodyA.velocity.lengthSquared() +
          bodyA.angularVelocity.lengthSquared() >=
          bodyA.sleepSpeedLimit ** 2 * 2
      )
        bodyB.wakeUpAfterNarrowphase = true;

      world.collisionMatrix.set(bodyA, bodyB, true);
      if (!world.collisionMatrixPrevious.get(bodyA, bodyB)) {
        collideEvent.body = bodyB;
        collideEvent.contact = contact;
        bodyA.dispatchEvent(collideEvent);
        collideEvent.body = bodyA;
        bodyB.dispatchEvent(collideEvent);
      }
      world.bodyOverlapKeeper.set(bodyA.id, bodyB.id);
      world.shapeOverlapKeeper.set(contact.si.id, contact.sj.id);
    }
    collideEvent.body = null;
    collideEvent.contact = null;
    world.emitContactEvents();

    for (const body of bodies)
      if (body.wakeUpAfterNarrowphase) {
        body.wakeUp();
        body.wakeUpAfterNarrowphase = false;
      }
    for (const constraint of constraints) {
      constraint.update();
      if (
        captureEvidence &&
        constraint.equations.some((equation) =>
          String(equation.simulacrumEvidenceRowKind || "").startsWith("tire-"),
        )
      ) {
        const metadata = constraint.simulacrumEvidence || {},
          constraintIndex = constraints.indexOf(constraint);
        assignConstraintEvidenceRows(constraint, {
          constraintId:
            metadata.constraintId ?? `unowned-constraint:${constraintIndex}`,
          sourceConnectionIds: metadata.sourceConnectionIds || [],
          tick,
          source: metadata.source || "constraint",
        });
      }
      for (const equation of constraint.equations) solver.addEquation(equation);
    }
    const motorRegistrations = privateState.motorRegistrations,
      motorSolve = motorRegistrations.size
        ? solveEnergyBudgetedRows(
            solver,
            dt,
            world,
            motorRegistrations,
            privateState.motorSolverScratch,
          )
        : null;
    if (!motorSolve) solver.solve(dt, world);
    if (motorSolve) {
      const records = motorSolve.records
          .sort((left, right) =>
            `${typeof left.partId}:${String(left.partId)}`.localeCompare(
              `${typeof right.partId}:${String(right.partId)}`,
              "en",
            ),
          )
          .map((record) => Object.freeze(record)),
        digest = recordDigest(records);
      privateState.pendingMotorRecords = Object.freeze({
        tick: privateState.activeTick,
        recordDigest: digest,
        records: Object.freeze(records),
      });
    }
    motorRegistrations.clear();
    privateState.activeTick = null;
    privateState.evidenceTick = captureEvidence ? tick : null;
    privateState.evidenceCandidates = captureEvidence
      ? [...world.contacts, ...world.frictionEquations].map((equation) => ({
          bodyA: equation.bi,
          bodyB: equation.bj,
          equations: [equation],
        }))
      : null;
    privateState.evidenceRowCandidates = null;
    privateState.evidenceContributions = null;
    solver.removeAllEquations();
    for (const body of bodies)
      if (body.type & dynamic) {
        body.velocity.scale(
          Math.pow(1 - body.linearDamping, dt),
          body.velocity,
        );
        body.angularVelocity.scale(
          Math.pow(1 - body.angularDamping, dt),
          body.angularVelocity,
        );
      }

    world.dispatchEvent(preStepEvent);
    const normalizeQuaternion =
      world.stepnumber % (world.quatNormalizeSkip + 1) === 0;
    for (const body of bodies)
      body.integrate(dt, normalizeQuaternion, world.quatNormalizeFast);
    world.clearForces();
    world.broadphase.dirty = true;
    world.stepnumber++;
    world.dispatchEvent(postStepEvent);

    let hasActiveBodies = true;
    if (world.allowSleep) {
      hasActiveBodies = false;
      for (const body of bodies) {
        body.sleepTick(world.time);
        if (body.sleepState !== CANNON.Body.SLEEPING) hasActiveBodies = true;
      }
    }
    world.hasActiveBodies = hasActiveBodies;
    // Committed simulation time is an exact projection of the integer step
    // owner. Repeated floating addition would create a second, drifting clock.
    world.time = world.stepnumber * dt;
  }
}
