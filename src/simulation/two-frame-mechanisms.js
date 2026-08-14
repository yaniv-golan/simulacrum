import * as CANNON from "cannon-es";
import { DomainValidationError } from "../model/primitives.js";

const EPSILON = 1e-12;
const CURRENT_IMPULSE_NS = Symbol("simulacrumCurrentImpulseNs");
const IMPULSE_TRACKER_INSTALLED = Symbol("simulacrumImpulseTrackerInstalled");

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));

function perpendicularBasis(axis) {
  const seed =
      Math.abs(axis.y) < 0.8
        ? new CANNON.Vec3(0, 1, 0)
        : new CANNON.Vec3(1, 0, 0),
    first = axis.cross(seed);
  first.normalize();
  const second = axis.cross(first);
  second.normalize();
  return [first, second];
}

function trackCurrentImpulse(equation) {
  equation[CURRENT_IMPULSE_NS] = 0;
  if (equation[IMPULSE_TRACKER_INSTALLED]) return;
  const addToWlambda = equation.addToWlambda;
  equation.addToWlambda = function addTrackedImpulse(deltaImpulseNs) {
    this[CURRENT_IMPULSE_NS] += deltaImpulseNs;
    addToWlambda.call(this, deltaImpulseNs);
  };
  equation[IMPULSE_TRACKER_INSTALLED] = true;
}

function interpolate(points, coordinate, coordinateKey, valueKey) {
  if (
    coordinate < points[0][coordinateKey] - EPSILON ||
    coordinate > points.at(-1)[coordinateKey] + EPSILON
  )
    throw new DomainValidationError(
      "MECHANISM_LAW_DOMAIN_EXCEEDED",
      `${coordinateKey} ${coordinate} is outside the authored constitutive-law domain`,
      {
        details: {
          coordinateKey,
          coordinate,
          lower: points[0][coordinateKey],
          upper: points.at(-1)[coordinateKey],
        },
      },
    );
  if (coordinate <= points[0][coordinateKey]) return points[0][valueKey];
  for (let index = 1; index < points.length; index++) {
    const right = points[index];
    if (coordinate > right[coordinateKey]) continue;
    const left = points[index - 1],
      fraction =
        (coordinate - left[coordinateKey]) /
        (right[coordinateKey] - left[coordinateKey]);
    return left[valueKey] + fraction * (right[valueKey] - left[valueKey]);
  }
  return points.at(-1)[valueKey];
}

function integratePiecewise(points, coordinate) {
  if (Math.abs(coordinate) <= EPSILON) return 0;
  const direction = Math.sign(coordinate),
    lower = Math.min(0, coordinate),
    upper = Math.max(0, coordinate);
  if (
    lower < points[0].displacementM - EPSILON ||
    upper > points.at(-1).displacementM + EPSILON
  )
    interpolate(points, coordinate, "displacementM", "forceN");
  const cuts = [lower, upper];
  for (const point of points)
    if (point.displacementM > lower && point.displacementM < upper)
      cuts.push(point.displacementM);
  cuts.sort((left, right) => left - right);
  let integral = 0;
  for (let index = 1; index < cuts.length; index++) {
    const left = cuts[index - 1],
      right = cuts[index],
      leftForce = interpolate(points, left, "displacementM", "forceN"),
      rightForce = interpolate(points, right, "displacementM", "forceN");
    integral += ((leftForce + rightForce) * (right - left)) / 2;
  }
  return integral * direction;
}

export function elasticResponse(law, displacementM) {
  if (law.kind === "linear-v1")
    return {
      forceN: law.stiffnessNPerM * displacementM,
      potentialJ: 0.5 * law.stiffnessNPerM * displacementM ** 2,
    };
  if (law.kind === "piecewise-force-v1")
    return {
      forceN: interpolate(law.points, displacementM, "displacementM", "forceN"),
      potentialJ: integratePiecewise(law.points, displacementM),
    };
  throw new DomainValidationError(
    "UNSUPPORTED_ELASTIC_LAW",
    `Unsupported elastic law ${String(law?.kind)}`,
  );
}

export function dampingForce(law, rateMPerS) {
  if (law.kind === "linear-v1") return law.dampingNsPerM * rateMPerS;
  if (law.kind === "piecewise-speed-v1") {
    const points = rateMPerS < 0 ? law.compressionPoints : law.reboundPoints;
    return (
      Math.sign(rateMPerS) *
      interpolate(points, Math.abs(rateMPerS), "speedMPerS", "forceN")
    );
  }
  throw new DomainValidationError(
    "UNSUPPORTED_DAMPING_LAW",
    `Unsupported damping law ${String(law?.kind)}`,
  );
}

export function springResponse(mechanism, coordinateM, rateMPerS) {
  const reference = mechanism.referenceLaw,
    referenceLengthM =
      reference.kind === "zero-force-length-v1"
        ? reference.freeLengthM
        : reference.referenceLengthM,
    displacementM = coordinateM - referenceLengthM,
    elastic = elasticResponse(mechanism.elasticLaw, displacementM),
    preloadN =
      reference.kind === "force-at-reference-v1"
        ? reference.forceAtReferenceN
        : 0,
    dampingN = dampingForce(mechanism.dampingLaw, rateMPerS);
  return {
    forceN: preloadN + elastic.forceN + dampingN,
    elasticForceN: preloadN + elastic.forceN,
    dampingForceN: dampingN,
    elasticPotentialJ: elastic.potentialJ + preloadN * displacementM,
    dampingPowerW: -dampingN * rateMPerS,
  };
}

export function damperResponse(mechanism, rateMPerS) {
  const dampingN = dampingForce(mechanism.dampingLaw, rateMPerS);
  return {
    forceN: dampingN,
    elasticForceN: 0,
    dampingForceN: dampingN,
    elasticPotentialJ: 0,
    dampingPowerW: -dampingN * rateMPerS,
  };
}

export function stopResponse(stop, side, coordinateM, rateMPerS) {
  if (!stop) return null;
  const penetrationM =
    side === "lower"
      ? stop.engageCoordinate - coordinateM
      : coordinateM - stop.engageCoordinate;
  if (penetrationM <= 0) return null;
  const elastic = elasticResponse(stop.elasticLaw, penetrationM),
    closingRateMPerS = side === "lower" ? -rateMPerS : rateMPerS,
    dampingN =
      closingRateMPerS > 0
        ? dampingForce(stop.dampingLaw, closingRateMPerS)
        : 0,
    direction = side === "lower" ? -1 : 1;
  return {
    forceN: direction * (elastic.forceN + dampingN),
    elasticPotentialJ: elastic.potentialJ,
    dampingPowerW: -dampingN * Math.max(0, closingRateMPerS),
  };
}

export function forceSpeedCapacity(envelope, speedMPerS) {
  const speed = Math.abs(speedMPerS),
    final = envelope.points.at(-1);
  if (speed >= final.absSpeedMPerS)
    return {
      extendN: speed === final.absSpeedMPerS ? final.maxExtendForceN : 0,
      retractN: speed === final.absSpeedMPerS ? final.maxRetractForceN : 0,
    };
  return {
    extendN: interpolate(
      envelope.points,
      speed,
      "absSpeedMPerS",
      "maxExtendForceN",
    ),
    retractN: interpolate(
      envelope.points,
      speed,
      "absSpeedMPerS",
      "maxRetractForceN",
    ),
  };
}

export function axialState(
  bodyA,
  bodyB,
  localAnchorA,
  localAnchorB,
  axisWorld = null,
  coordinateOffsetM = 0,
) {
  const pointA = bodyA.pointToWorldFrame(localAnchorA),
    pointB = bodyB.pointToWorldFrame(localAnchorB),
    separation = pointB.vsub(pointA),
    axis = axisWorld ? axisWorld.clone() : separation.clone();
  if (axis.lengthSquared() <= EPSILON)
    throw new DomainValidationError(
      "DEGENERATE_MECHANISM_AXIS",
      "Two-frame mechanism attachment points do not define a finite axis",
    );
  axis.normalize();
  const velocityA = new CANNON.Vec3(),
    velocityB = new CANNON.Vec3();
  bodyA.getVelocityAtWorldPoint(pointA, velocityA);
  bodyB.getVelocityAtWorldPoint(pointB, velocityB);
  return {
    pointA,
    pointB,
    axis,
    coordinateM:
      coordinateOffsetM +
      (axisWorld ? separation.dot(axis) : separation.length()),
    rateMPerS: velocityB.vsub(velocityA).dot(axis),
    transverseM: axisWorld
      ? separation.vsub(axis.scale(separation.dot(axis))).length()
      : 0,
  };
}

export function applyAxialForce(bodyA, bodyB, state, signedTensionN) {
  if (!Number.isFinite(signedTensionN))
    throw new DomainValidationError(
      "NONFINITE_MECHANISM_FORCE",
      "Mechanism force must remain finite",
    );
  const force = state.axis.scale(signedTensionN),
    offsetA = state.pointA.vsub(bodyA.position),
    offsetB = state.pointB.vsub(bodyB.position);
  bodyA.applyForce(force, offsetA);
  bodyB.applyForce(force.negate(), offsetB);
}

/**
 * Five-row prismatic joint: two transverse point rows and three rotational
 * rows. The two unilateral travel-limit rows join the same Cannon solve but
 * are not part of the five equality rows.
 */
export class PrismaticConstraint extends CANNON.Constraint {
  constructor(bodyA, bodyB, options) {
    super(bodyA, bodyB, options);
    // Cannon's equation limits are impulses despite their `maxForce` field
    // name. The adapter must supply an N*s / N*m*s ceiling, never an SI rate.
    const maximumConstraintImpulse = options.maximumConstraintImpulse,
      axisWorld = options.axisWorld.clone();
    axisWorld.normalize();
    this.localAnchorA = options.localAnchorA.clone();
    this.localAnchorB = options.localAnchorB.clone();
    this.localAxisA = bodyA.vectorToLocalFrame(axisWorld);
    this.localAxisB = bodyB.vectorToLocalFrame(axisWorld);
    this.coordinateOffsetM = options.coordinateOffsetM;
    this.limits = [...options.limits];
    this.referenceRelativeOrientation = bodyA.quaternion
      .conjugate(new CANNON.Quaternion())
      .mult(bodyB.quaternion, new CANNON.Quaternion());
    const [firstWorld, secondWorld] = perpendicularBasis(axisWorld);
    this.localTransverseA = [
      bodyA.vectorToLocalFrame(firstWorld),
      bodyA.vectorToLocalFrame(secondWorld),
    ];
    this.transverseEquations = [
      new CANNON.ContactEquation(bodyA, bodyB, maximumConstraintImpulse),
      new CANNON.ContactEquation(bodyA, bodyB, maximumConstraintImpulse),
    ];
    for (const equation of this.transverseEquations) {
      equation.minForce = -maximumConstraintImpulse;
      equation.maxForce = maximumConstraintImpulse;
      trackCurrentImpulse(equation);
    }
    this.xA = bodyA.vectorToLocalFrame(CANNON.Vec3.UNIT_X);
    this.xB = bodyB.vectorToLocalFrame(CANNON.Vec3.UNIT_X);
    this.yA = bodyA.vectorToLocalFrame(CANNON.Vec3.UNIT_Y);
    this.yB = bodyB.vectorToLocalFrame(CANNON.Vec3.UNIT_Y);
    this.zA = bodyA.vectorToLocalFrame(CANNON.Vec3.UNIT_Z);
    this.zB = bodyB.vectorToLocalFrame(CANNON.Vec3.UNIT_Z);
    this.rotationalEquations = [
      new CANNON.RotationalEquation(bodyA, bodyB, {
        maxForce: maximumConstraintImpulse,
      }),
      new CANNON.RotationalEquation(bodyA, bodyB, {
        maxForce: maximumConstraintImpulse,
      }),
      new CANNON.RotationalEquation(bodyA, bodyB, {
        maxForce: maximumConstraintImpulse,
      }),
    ];
    this.lowerLimitEquation = new CANNON.ContactEquation(
      bodyA,
      bodyB,
      maximumConstraintImpulse,
    );
    this.upperLimitEquation = new CANNON.ContactEquation(
      bodyA,
      bodyB,
      maximumConstraintImpulse,
    );
    this.holdEquation = new CANNON.FrictionEquation(bodyA, bodyB, 0);
    this.holdEquation.enabled = false;
    this.guideFrictionLaw = options.guideFrictionLaw || null;
    this.fixedDt = options.fixedDt;
    this.guideFrictionEquation = this.guideFrictionLaw
      ? new CANNON.FrictionEquation(bodyA, bodyB, 0)
      : null;
    if (this.guideFrictionEquation) {
      const capacityImpulseNs = () => {
        const normalImpulseNs = Math.hypot(
            ...this.transverseEquations.map(
              (equation) => equation[CURRENT_IMPULSE_NS] || 0,
            ),
          ),
          pointA = bodyA.pointToWorldFrame(this.localAnchorA),
          pointB = bodyB.pointToWorldFrame(this.localAnchorB),
          velocityA = new CANNON.Vec3(),
          velocityB = new CANNON.Vec3();
        bodyA.getVelocityAtWorldPoint(pointA, velocityA);
        bodyB.getVelocityAtWorldPoint(pointB, velocityB);
        const rateMPerS = velocityB.vsub(velocityA).dot(this.axisWorld()),
          coefficient =
            Math.abs(rateMPerS) <= this.guideFrictionLaw.reengageSpeedMPerS
              ? this.guideFrictionLaw.staticCoefficient
              : this.guideFrictionLaw.dynamicCoefficient,
          normalLoadN = normalImpulseNs / this.fixedDt,
          capacityN =
            coefficient *
              (normalLoadN + this.guideFrictionLaw.preloadNormalForceN) +
            this.guideFrictionLaw.sealDragN +
            this.guideFrictionLaw.viscousNsPerM * Math.abs(rateMPerS);
        return Math.max(0, capacityN) * this.fixedDt;
      };
      Object.defineProperties(this.guideFrictionEquation, {
        minForce: {
          configurable: true,
          get: () => -capacityImpulseNs(),
        },
        maxForce: {
          configurable: true,
          get: capacityImpulseNs,
        },
      });
    }
    this.equalityEquations = [
      ...this.transverseEquations,
      ...this.rotationalEquations,
    ];
    this.equations.push(
      ...this.equalityEquations,
      ...(this.guideFrictionEquation ? [this.guideFrictionEquation] : []),
      this.lowerLimitEquation,
      this.upperLimitEquation,
      this.holdEquation,
    );
    this.collideConnected = false;
  }

  axisWorld(result = new CANNON.Vec3()) {
    this.bodyA.vectorToWorldFrame(this.localAxisA, result);
    result.normalize();
    return result;
  }

  /** @param {CANNON.Equation} equation */
  rowOrder(equation) {
    if (equation === this.transverseEquations[0]) return 10;
    if (equation === this.transverseEquations[1]) return 11;
    if (equation === this.rotationalEquations[0]) return 20;
    if (equation === this.rotationalEquations[1]) return 21;
    if (equation === this.rotationalEquations[2]) return 22;
    if (equation === this.guideFrictionEquation) return 25;
    if (equation === this.lowerLimitEquation) return 30;
    if (equation === this.upperLimitEquation) return 31;
    if (equation === this.holdEquation) return 40;
    return 100;
  }

  update() {
    const bodyA = this.bodyA,
      bodyB = this.bodyB,
      axis = this.axisWorld(),
      ri = bodyA.quaternion.vmult(this.localAnchorA),
      rj = bodyB.quaternion.vmult(this.localAnchorB);
    this.equations.sort(
      (left, right) => this.rowOrder(left) - this.rowOrder(right),
    );
    for (const equation of this.transverseEquations)
      trackCurrentImpulse(equation);
    for (let index = 0; index < 2; index++) {
      const equation = this.transverseEquations[index];
      bodyA.vectorToWorldFrame(this.localTransverseA[index], equation.ni);
      equation.ni.normalize();
      equation.ri.copy(ri);
      equation.rj.copy(rj);
    }
    const [r1, r2, r3] = this.rotationalEquations;
    bodyA.vectorToWorldFrame(this.xA, r1.axisA);
    bodyB.vectorToWorldFrame(this.yB, r1.axisB);
    bodyA.vectorToWorldFrame(this.yA, r2.axisA);
    bodyB.vectorToWorldFrame(this.zB, r2.axisB);
    bodyA.vectorToWorldFrame(this.zA, r3.axisA);
    bodyB.vectorToWorldFrame(this.xB, r3.axisB);

    const lowerRaw = this.limits[0] - this.coordinateOffsetM,
      upperRaw = this.limits[1] - this.coordinateOffsetM,
      localLowerShift = this.localAxisB.scale(lowerRaw),
      localUpperShift = this.localAxisB.scale(upperRaw);
    this.lowerLimitEquation.ni.copy(axis);
    this.lowerLimitEquation.ri.copy(ri);
    bodyB.quaternion.vmult(
      this.localAnchorB.vsub(localLowerShift),
      this.lowerLimitEquation.rj,
    );
    axis.negate(this.upperLimitEquation.ni);
    this.upperLimitEquation.ri.copy(ri);
    bodyB.quaternion.vmult(
      this.localAnchorB.vsub(localUpperShift),
      this.upperLimitEquation.rj,
    );
    this.holdEquation.t.copy(this.axisWorld());
    this.holdEquation.ri.copy(ri);
    this.holdEquation.rj.copy(rj);
    if (this.guideFrictionEquation) {
      this.guideFrictionEquation.t.copy(this.axisWorld());
      this.guideFrictionEquation.ri.copy(ri);
      this.guideFrictionEquation.rj.copy(rj);
    }
  }

  project() {
    const bodyA = this.bodyA,
      bodyB = this.bodyB;
    // The mass-weighted translation and complementary angular weights each
    // satisfy their bilateral coordinates in one projection. Reapplying the
    // same correction over-constrains contact transients and creates artificial
    // attachment loads at terrain discontinuities.
    {
      const axis = this.axisWorld(),
        pointA = bodyA.pointToWorldFrame(this.localAnchorA),
        pointB = bodyB.pointToWorldFrame(this.localAnchorB),
        separation = pointB.vsub(pointA),
        transverse = separation.vsub(axis.scale(separation.dot(axis))),
        inverseMass = bodyA.invMass + bodyB.invMass;
      if (inverseMass > EPSILON) {
        bodyA.position.addScaledVector(
          bodyA.invMass / inverseMass,
          transverse,
          bodyA.position,
        );
        bodyB.position.addScaledVector(
          -bodyB.invMass / inverseMass,
          transverse,
          bodyB.position,
        );
      }

      const originalA = bodyA.quaternion.clone(),
        originalB = bodyB.quaternion.clone(),
        inverseReference = this.referenceRelativeOrientation.conjugate(
          new CANNON.Quaternion(),
        ),
        targetA = originalB.mult(inverseReference, new CANNON.Quaternion()),
        targetB = originalA.mult(
          this.referenceRelativeOrientation,
          new CANNON.Quaternion(),
        ),
        angularWeightA = bodyA.invInertia.length(),
        angularWeightB = bodyB.invInertia.length(),
        angularWeight = angularWeightA + angularWeightB;
      if (angularWeight > EPSILON) {
        originalA.slerp(
          targetA,
          angularWeightA / angularWeight,
          bodyA.quaternion,
        );
        originalB.slerp(
          targetB,
          angularWeightB / angularWeight,
          bodyB.quaternion,
        );
        bodyA.quaternion.normalize();
        bodyB.quaternion.normalize();
        bodyA.updateInertiaWorld(true);
        bodyB.updateInertiaWorld(true);
      }
    }
    bodyA.aabbNeedsUpdate = true;
    bodyB.aabbNeedsUpdate = true;
    const state = axialState(
        bodyA,
        bodyB,
        this.localAnchorA,
        this.localAnchorB,
        this.axisWorld(),
        this.coordinateOffsetM,
      ),
      boundedCoordinateM = clamp(
        state.coordinateM,
        this.limits[0],
        this.limits[1],
      );
    if (boundedCoordinateM !== state.coordinateM)
      this.projectCoordinate(boundedCoordinateM);
  }

  projectCoordinate(targetCoordinateM) {
    const bodyA = this.bodyA,
      bodyB = this.bodyB,
      state = axialState(
        bodyA,
        bodyB,
        this.localAnchorA,
        this.localAnchorB,
        this.axisWorld(),
        this.coordinateOffsetM,
      ),
      errorM = state.coordinateM - targetCoordinateM,
      inverseMass = bodyA.invMass + bodyB.invMass;
    if (inverseMass <= EPSILON || Math.abs(errorM) <= EPSILON) return;
    const correction = state.axis.scale(errorM);
    bodyA.position.addScaledVector(
      bodyA.invMass / inverseMass,
      correction,
      bodyA.position,
    );
    bodyB.position.addScaledVector(
      -bodyB.invMass / inverseMass,
      correction,
      bodyB.position,
    );
    bodyA.aabbNeedsUpdate = true;
    bodyB.aabbNeedsUpdate = true;
  }
}

/** Two unilateral rows that enforce the authored scalar length interval. */
export class AxialLimitConstraint extends CANNON.Constraint {
  constructor(bodyA, bodyB, options) {
    super(bodyA, bodyB, options);
    this.localAnchorA = options.localAnchorA.clone();
    this.localAnchorB = options.localAnchorB.clone();
    this.limits = [...options.limits];
    this.lastAxisWorld = options.axisWorld.clone();
    this.lastAxisWorld.normalize();
    this.lowerLimitEquation = new CANNON.ContactEquation(
      bodyA,
      bodyB,
      options.maximumConstraintImpulse,
    );
    this.upperLimitEquation = new CANNON.ContactEquation(
      bodyA,
      bodyB,
      options.maximumConstraintImpulse,
    );
    this.equations.push(this.lowerLimitEquation, this.upperLimitEquation);
    this.holdEquation = options.holdingClutch
      ? new CANNON.FrictionEquation(bodyA, bodyB, 0)
      : null;
    if (this.holdEquation) {
      this.holdEquation.enabled = false;
      this.equations.push(this.holdEquation);
    }
    // Absolute effort is a solved equal-and-opposite impulse. Keeping it in the
    // owned equation set lets the solver meter work against the electrical
    // budget instead of injecting an unobserved external force.
    this.effortEquation = options.absoluteEffort
      ? new CANNON.FrictionEquation(bodyA, bodyB, 0)
      : null;
    if (this.effortEquation) {
      this.effortEquation.enabled = false;
      this.equations.push(this.effortEquation);
    }
    this.collideConnected = false;
  }

  axisWorld(result = new CANNON.Vec3()) {
    return result.copy(this.lastAxisWorld);
  }

  update() {
    const bodyA = this.bodyA,
      bodyB = this.bodyB,
      ri = bodyA.quaternion.vmult(this.localAnchorA),
      rj = bodyB.quaternion.vmult(this.localAnchorB),
      pointA = bodyA.position.vadd(ri),
      pointB = bodyB.position.vadd(rj),
      axis = pointB.vsub(pointA);
    if (axis.lengthSquared() > EPSILON) {
      axis.normalize();
      this.lastAxisWorld.copy(axis);
    } else axis.copy(this.lastAxisWorld);
    const localAxisB = bodyB.vectorToLocalFrame(axis),
      lowerShift = localAxisB.scale(this.limits[0]),
      upperShift = localAxisB.scale(this.limits[1]);
    this.lowerLimitEquation.ni.copy(axis);
    this.lowerLimitEquation.ri.copy(ri);
    bodyB.quaternion.vmult(
      this.localAnchorB.vsub(lowerShift),
      this.lowerLimitEquation.rj,
    );
    axis.negate(this.upperLimitEquation.ni);
    this.upperLimitEquation.ri.copy(ri);
    bodyB.quaternion.vmult(
      this.localAnchorB.vsub(upperShift),
      this.upperLimitEquation.rj,
    );
    if (this.holdEquation) {
      this.holdEquation.t.copy(this.lastAxisWorld);
      this.holdEquation.ri.copy(ri);
      this.holdEquation.rj.copy(rj);
    }
    if (this.effortEquation) {
      this.effortEquation.t.copy(this.lastAxisWorld);
      this.effortEquation.ri.copy(ri);
      this.effortEquation.rj.copy(rj);
    }
  }

  projectCoordinate(targetCoordinateM) {
    const bodyA = this.bodyA,
      bodyB = this.bodyB,
      state = axialState(bodyA, bodyB, this.localAnchorA, this.localAnchorB),
      errorM = state.coordinateM - targetCoordinateM,
      inverseMass = bodyA.invMass + bodyB.invMass;
    if (inverseMass <= EPSILON || Math.abs(errorM) <= EPSILON) return;
    const correction = state.axis.scale(errorM);
    bodyA.position.addScaledVector(
      bodyA.invMass / inverseMass,
      correction,
      bodyA.position,
    );
    bodyB.position.addScaledVector(
      -bodyB.invMass / inverseMass,
      correction,
      bodyB.position,
    );
    bodyA.aabbNeedsUpdate = true;
    bodyB.aabbNeedsUpdate = true;
  }
}

export const mechanismClamp = clamp;
