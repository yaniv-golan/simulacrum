import * as CANNON from "cannon-es";
import {
  DomainValidationError,
  immutableClone,
  stableStringify,
} from "../model/primitives.js";
import { sha256Hex } from "../model/sha256.js";

export const CANNON_SOLVER_TRANSACTION_ID =
  "simulacrum-owned-cannon-solver-transaction-v2-motor-energy";

const collideEvent = {
  type: CANNON.Body.COLLIDE_EVENT_NAME,
  body: null,
  contact: null,
};
const preStepEvent = { type: "preStep" };
const postStepEvent = { type: "postStep" };
const privateStateByTransaction = new WeakMap();

function stableBodyKey(body) {
  const identity =
    body.userData?.partId ??
    body.userData?.externalBodyId ??
    body.userData?.stressKey ??
    body.id;
  return `${typeof identity}:${String(identity)}`;
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
function solveEnergyBudgetedRows(solver, h, world, registrations) {
  if (!(solver instanceof CANNON.GSSolver))
    throw new DomainValidationError(
      "UNSUPPORTED_ENERGY_BUDGET_SOLVER",
      "Energy-budgeted motor rows require the pinned Cannon GSSolver",
    );
  const equations = solver.equations,
    bodies = world.bodies,
    equationIndex = new Map(
      equations.map((equation, index) => [equation, index]),
    ),
    rows = new Array(equations.length).fill(null);
  for (const [equation, registration] of registrations) {
    const index = equationIndex.get(equation);
    if (index == null)
      throw new DomainValidationError(
        "MOTOR_ENERGY_EQUATION_MISSING",
        `Registered motor equation for part ${String(registration.partId)} is not in the solve`,
      );
    rows[index] = {
      ...registration,
      equationIndex: index,
      signedWorkJ: 0,
      preGeneralizedSpeedRadS: 0,
      finalGeneralizedSpeedRadS: 0,
      generalizedInverseMass: 0,
      acceptedImpulseNms: 0,
      saturated: false,
    };
  }
  if (equations.length)
    for (const body of bodies) body.updateSolveMassProperties();
  const lambda = new Array(equations.length).fill(0),
    inverseC = new Array(equations.length),
    rightHandSide = new Array(equations.length);
  for (let index = 0; index < equations.length; index++) {
    const equation = equations[index];
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
  for (const row of rows) {
    if (!row) continue;
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
    records: rows.filter(Boolean).map((row) => ({
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
      excludedPairs: new Set(),
      ranks: new Map(),
      activeTick: null,
      motorRegistrations: new Map(),
      pendingMotorRecords: null,
    });
    this.oldContacts = [];
    this.frictionEquationPool = [];
  }

  beginSession() {
    const state = privateStateByTransaction.get(this);
    state.activeTick = null;
    state.motorRegistrations.clear();
    state.pendingMotorRecords = null;
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
      dynamic = CANNON.Body.DYNAMIC;
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
      for (const equation of constraint.equations) solver.addEquation(equation);
    }
    const motorRegistrations = privateState.motorRegistrations,
      motorSolve = motorRegistrations.size
        ? solveEnergyBudgetedRows(solver, dt, world, motorRegistrations)
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
