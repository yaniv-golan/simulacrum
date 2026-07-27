import * as CANNON from "cannon-es";
import { DomainValidationError } from "../model/primitives.js";
import {
  assignConstraintEvidenceRows,
  constraintReactionContributions,
} from "./constraint-reaction-wrench.js";

export const CANNON_SOLVER_TRANSACTION_ID =
  "simulacrum-owned-cannon-solver-transaction-v1";

const collideEvent = {
  type: CANNON.Body.COLLIDE_EVENT_NAME,
  body: null,
  contact: null,
};
const preStepEvent = { type: "preStep" };
const postStepEvent = { type: "postStep" };
const privateStateByTransaction = new WeakMap();

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
  return (
    privateStateByTransaction.get(transaction)?.evidenceContributions ||
    Object.freeze([])
  );
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

function numberKey(value) {
  const number = Number(value || 0);
  return (Object.is(number, -0) ? 0 : number).toPrecision(17);
}

function vectorKey(value) {
  return [numberKey(value?.x), numberKey(value?.y), numberKey(value?.z)].join(
    ",",
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
    normal = swap ? contact.ni.scale(-1) : contact.ni,
    sortKey = [
      firstBody.id,
      firstShape.id,
      secondBody.id,
      secondShape.id,
      vectorKey(firstPoint),
      vectorKey(secondPoint),
      vectorKey(normal),
    ].join("|");
  return {
    contact,
    sortKey,
    bodyAId: firstBody.id,
    bodyBId: secondBody.id,
    shapeAId: firstShape.id,
    shapeBId: secondShape.id,
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
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey, "en"));
  for (const [ordinal, record] of records.entries()) {
    const contactId = `contact:${String(tick)}:${record.bodyAId}:${
        record.shapeAId
      }:${record.bodyBId}:${record.shapeBId}:${ordinal}`,
      evidence = Object.freeze({
        tick,
        contactId,
        collisionOrdinal: ordinal,
        bodyAId: record.bodyAId,
        bodyBId: record.bodyBId,
        shapeAId: record.shapeAId,
        shapeBId: record.shapeBId,
        validity: record.validity,
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

function sameBodyPair(left, right) {
  return (
    (left.bi === right.bi && left.bj === right.bj) ||
    (left.bi === right.bj && left.bj === right.bi)
  );
}

function sameContactAnchors(friction, contact) {
  const direct = friction.bi === contact.bi;
  return (
    vectorKey(friction.ri) === vectorKey(direct ? contact.ri : contact.rj) &&
    vectorKey(friction.rj) === vectorKey(direct ? contact.rj : contact.ri)
  );
}

function annotateFrictionRows(world, tick) {
  const records = world.frictionEquations
    .map((equation) => {
      const bodies = [
          evidenceBodyKey(equation.bi, world).id,
          evidenceBodyKey(equation.bj, world).id,
        ].sort((left, right) => left.localeCompare(right, "en")),
        sourceContactIds = world.contacts
          .filter(
            (contact) =>
              sameBodyPair(equation, contact) &&
              sameContactAnchors(equation, contact),
          )
          .map((contact) => contact.simulacrumEvidence?.contactId)
          .filter(Boolean)
          .sort((left, right) => left.localeCompare(right, "en")),
        sortKey = [
          ...bodies,
          vectorKey(equation.ri),
          vectorKey(equation.rj),
          vectorKey(equation.t),
        ].join("|");
      return { equation, sortKey, bodies, sourceContactIds };
    })
    .sort((left, right) => left.sortKey.localeCompare(right.sortKey, "en"));
  for (const [ordinal, record] of records.entries())
    record.equation.simulacrumEvidenceRow = Object.freeze({
      rowId: `friction:${String(tick)}:${record.bodies.join(":")}:${ordinal}`,
      rowKind: "contact-friction",
      localOrdinal: ordinal,
      source: "friction",
      constraintId: null,
      sourceConnectionIds: Object.freeze([]),
      sourceContactIds: Object.freeze(record.sourceContactIds),
    });
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
      excludedPairs: new Set(),
      ranks: new Map(),
      pendingEvidenceTick: null,
      evidenceContributions: Object.freeze([]),
    });
    this.oldContacts = [];
    this.frictionEquationPool = [];
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
    for (const contact of world.contacts) this.oldContacts.push(contact);
    world.contacts.length = 0;
    for (const equation of world.frictionEquations)
      this.frictionEquationPool.push(equation);
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
    if (captureEvidence) {
      annotateContactRows(world, tick);
      annotateFrictionRows(world, tick);
    }
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
      if (captureEvidence) {
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
    solver.solve(dt, world);
    privateState.evidenceContributions = captureEvidence
      ? Object.freeze(
          [...world.contacts, ...world.frictionEquations].flatMap((equation) =>
            constraintReactionContributions(
              {
                bodyA: equation.bi,
                bodyB: equation.bj,
                equations: [equation],
              },
              "A",
              { tick },
            ),
          ),
        )
      : Object.freeze([]);
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
