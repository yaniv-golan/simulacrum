import * as CANNON from "cannon-es";
import {
  DomainValidationError,
  immutableClone,
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
  "simulacrum-owned-cannon-solver-transaction-v3-rolling-support";

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
      id: `part:${String(body.userData.partId)}`,
      validity: "measured",
    };
  if (body.userData?.externalBodyId != null)
    return {
      id: String(body.userData.externalBodyId),
      validity: "measured",
    };
  return {
    id: `anonymous-body:${world.bodies.indexOf(body)}`,
    validity: "unavailable",
  };
}

function evidenceShapeKey(body, shape) {
  const explicit = shape?.userData?.shapeId;
  if (explicit != null) return { id: String(explicit), validity: "measured" };
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

function sameVector(left, right) {
  return compareVector(left, right) === 0;
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
          sameVector(equation.ri, contact.anchorA) &&
          sameVector(equation.rj, contact.anchorB),
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
  return (
    resolveSurfaceLaw(equation.bi, equation.bj, equation.ri) ||
    resolveSurfaceLaw(equation.bj, equation.bi, equation.rj)
  );
}

function applyResolvedSurfaceLaws(world, dt) {
  for (const contact of world.contacts) {
    const law = resolvedLawForEquation(contact);
    if (!law) continue;
    contact.surfaceMaterialKey = law.materialKey;
    contact.surfaceShapeId = law.shapeId;
    contact.restitution = law.restitution;
    contact.setSpookParams(
      law.contactEquationStiffness,
      law.contactEquationRelaxation,
      dt,
    );
  }
  const gravityMagnitude = (world.frictionGravity || world.gravity).length();
  for (const equation of world.frictionEquations) {
    const law = resolvedLawForEquation(equation);
    if (!law) continue;
    const inverseMass = equation.bi.invMass + equation.bj.invMass,
      slipForce = inverseMass
        ? law.friction * gravityMagnitude * (1 / inverseMass)
        : 0;
    equation.surfaceMaterialKey = law.materialKey;
    equation.minForce = -slipForce;
    equation.maxForce = slipForce;
    equation.setSpookParams(
      law.frictionEquationStiffness,
      law.frictionEquationRelaxation,
      dt,
    );
  }
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

function energyForIncrement(speed, inverseMass, impulse) {
  return speed * impulse + 0.5 * inverseMass * impulse * impulse;
}

function impulseAtEnergyLimit(speed, inverseMass, requestedImpulse, energyJ) {
  if (!(inverseMass > 0) || !(energyJ >= 0)) return 0;
  const discriminant = Math.max(0, speed * speed + 2 * inverseMass * energyJ),
    root = Math.sqrt(discriminant),
    candidates = [(-speed - root) / inverseMass, (-speed + root) / inverseMass],
    lower = Math.min(0, requestedImpulse) - 1e-12,
    upper = Math.max(0, requestedImpulse) + 1e-12,
    admissible = candidates.filter(
      (candidate) => candidate >= lower && candidate <= upper,
    );
  if (!admissible.length) return 0;
  return admissible.reduce((selected, candidate) =>
    Math.abs(candidate) > Math.abs(selected) ? candidate : selected,
  );
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
    motorRows = scratch.motorRows;
  rows.length = equations.length;
  rows.fill(null);
  motorRows.length = 0;
  for (let index = 0; index < equations.length; index++) {
    const equation = equations[index],
      registration = registrations.get(equation);
    if (!registration) continue;
    const row = {
      ...registration,
      equationIndex: index,
      signedWorkJ: 0,
      preGeneralizedSpeedRadS: 0,
      finalGeneralizedSpeedRadS: 0,
      generalizedInverseMass: 0,
      acceptedImpulseNms: 0,
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
  const toleranceSquared = solver.tolerance * solver.tolerance;
  let iterations = 0,
    finalResidual = 0;
  for (; iterations < solver.iterations; iterations++) {
    let deltaTotal = 0;
    for (let index = 0; index < equations.length; index++) {
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
      if (row && deltaImpulse) {
        const generalizedSpeed =
            row.preGeneralizedSpeedRadS + equation.computeGWlambda(),
          generalizedInverseMass = row.generalizedInverseMass,
          proposedEnergyJ = energyForIncrement(
            generalizedSpeed,
            generalizedInverseMass,
            deltaImpulse,
          ),
          remainingPositiveJ = Math.max(
            0,
            row.mechanicalBudgetJ - row.signedWorkJ,
          );
        if (proposedEnergyJ > remainingPositiveJ + 1e-12) {
          deltaImpulse = impulseAtEnergyLimit(
            generalizedSpeed,
            generalizedInverseMass,
            deltaImpulse,
            remainingPositiveJ,
          );
          row.saturated = true;
        }
        row.signedWorkJ += energyForIncrement(
          generalizedSpeed,
          generalizedInverseMass,
          deltaImpulse,
        );
      }
      lambda[index] += deltaImpulse;
      deltaTotal += Math.abs(deltaImpulse);
      equation.addToWlambda(deltaImpulse);
    }
    finalResidual = deltaTotal;
    if (deltaTotal * deltaTotal < toleranceSquared) break;
  }
  for (const row of motorRows) {
    const equation = equations[row.equationIndex];
    row.acceptedImpulseNms = lambda[row.equationIndex];
    row.finalGeneralizedSpeedRadS =
      row.preGeneralizedSpeedRadS + equation.computeGWlambda();
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
    records: motorRows.map((row) => ({
      tick: row.tick,
      partId: row.partId,
      constraintId: row.constraintId,
      mode: row.mode,
      electricalEfficiency: row.electricalEfficiency,
      allocatedBusW: row.allocatedBusW,
      mechanicalBudgetJ: row.mechanicalBudgetJ,
      torqueImpulseLimitNms: row.torqueImpulseLimitNms,
      acceptedImpulseNms: row.acceptedImpulseNms,
      signedWorkJ: row.signedWorkJ,
      positiveMechanicalWorkJ: Math.max(0, row.signedWorkJ),
      absorbedMechanicalWorkJ: Math.max(0, -row.signedWorkJ),
      unusedMechanicalBudgetJ: Math.max(
        0,
        row.mechanicalBudgetJ - Math.max(0, row.signedWorkJ),
      ),
      preGeneralizedSpeedRadS: row.preGeneralizedSpeedRadS,
      finalGeneralizedSpeedRadS: row.finalGeneralizedSpeedRadS,
      generalizedInverseMass: row.generalizedInverseMass,
      saturated: row.saturated,
      iterations,
      residual: finalResidual,
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
      torqueImpulseLimitNms: finiteNonNegative(
        torqueImpulseLimitNms,
        "torqueImpulseLimitNms",
      ),
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
    return immutableClone(pending);
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
    world.time += dt;
  }
}
