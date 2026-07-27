import * as CANNON from "cannon-es";
import { contactMaterialPair } from "../model/contact-material-pairs.js";
import { DomainValidationError } from "../model/primitives.js";
import { standardAtmosphere } from "./environment/atmosphere.js";
import {
  createPneumaticState,
  pneumaticChamberVolume,
  pneumaticRollingLoss,
  pneumaticSupportResponse,
} from "./pneumatic-gas.js";

const EPSILON = 1e-9;
const NORMAL_IMPULSE_NS = Symbol("simulacrumNormalImpulseNs");
const NORMAL_TRACKER_INSTALLED = Symbol("simulacrumNormalTrackerInstalled");
const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));

function contactMaterialKey(contact, body) {
  if (
    contact.surfaceMaterialKey &&
    typeof body.userData?.contactMaterialAt === "function"
  )
    return contact.surfaceMaterialKey;
  const shape = [contact.si, contact.sj].find((candidate) =>
    body.shapes.includes(candidate),
  );
  return shape?.userData?.materialKey || body.userData?.materialKey || null;
}

function authoredSemanticRegions(descriptor) {
  const regions = Array.isArray(descriptor.semanticRegions)
    ? descriptor.semanticRegions
    : [];
  const byRole = new Map(regions.map((region) => [region.contactRole, region]));
  for (const role of ["tire-envelope", "sidewall", "rim"])
    if (!byRole.has(role))
      throw new DomainValidationError(
        "MISSING_CONTACT_SEMANTIC_REGION",
        `Rolling contact ${descriptor.id} requires an authored ${role} region`,
        {
          path: ["contactRegions", descriptor.id, "semanticRegions"],
          details: { role },
        },
      );
  return byRole;
}

function worldPoint(body, offset) {
  const point = new CANNON.Vec3();
  body.position.vadd(offset, point);
  return point;
}

function pointVelocity(body, point) {
  const velocity = new CANNON.Vec3();
  body.getVelocityAtWorldPoint(point, velocity);
  return velocity;
}

function partWorldFrame(body) {
  const massFrame = body.userData?.massFrame;
  if (!massFrame)
    throw new Error("Tire body is missing its compiled part mass frame");
  const partToPrincipal = massFrame.principalToPart.conjugate(
      new CANNON.Quaternion(),
    ),
    quaternion = body.quaternion.mult(partToPrincipal, new CANNON.Quaternion()),
    position = body.position.vsub(quaternion.vmult(massFrame.comPart));
  return { position, quaternion };
}

function partVectorToWorld(body, value) {
  return partWorldFrame(body).quaternion.vmult(value);
}

function worldPointToPart(body, point) {
  const frame = partWorldFrame(body),
    inverse = frame.quaternion.conjugate(new CANNON.Quaternion());
  return inverse.vmult(point.vsub(frame.position));
}

function contactGap(contact) {
  const pointA = worldPoint(contact.bi, contact.ri),
    pointB = worldPoint(contact.bj, contact.rj);
  return contact.ni.dot(pointB.vsub(pointA));
}

/** Removes only the clipped point's nonphysical rolling-tangent lever arm. */
function limitHeightfieldAxleMoment(contact, wheel, axle, maximumShiftM) {
  const wheelIsA = contact.bi === wheel,
    supportBody = wheelIsA ? contact.bj : contact.bi;
  if (!supportBody.shapes.some((shape) => shape instanceof CANNON.Heightfield))
    return null;
  const wheelOffset = wheelIsA ? contact.ri : contact.rj,
    supportOffset = wheelIsA ? contact.rj : contact.ri,
    rawPointWorld = worldPoint(wheel, wheelOffset),
    supportNormal = contact.ni.scale(wheelIsA ? -1 : 1),
    radialNormal = supportNormal.clone();
  radialNormal.vsub(axle.scale(supportNormal.dot(axle)), radialNormal);
  if (radialNormal.lengthSquared() <= EPSILON) return null;
  radialNormal.normalize();
  const correctedOffset = radialNormal.scale(wheelOffset.dot(radialNormal));
  correctedOffset.vadd(axle.scale(wheelOffset.dot(axle)), correctedOffset);
  const shift = correctedOffset.vsub(wheelOffset),
    requiredShiftM = shift.length();
  if (requiredShiftM > maximumShiftM)
    shift.scale(maximumShiftM / requiredShiftM, shift);
  wheelOffset.vadd(shift, wheelOffset);
  supportOffset.vadd(shift, supportOffset);
  const correctedPointWorld = worldPoint(wheel, wheelOffset);
  return Object.freeze({
    tirePartId: wheel.userData?.partId ?? null,
    rawPointWorldM: Object.freeze({
      x: rawPointWorld.x,
      y: rawPointWorld.y,
      z: rawPointWorld.z,
    }),
    correctedPointWorldM: Object.freeze({
      x: correctedPointWorld.x,
      y: correctedPointWorld.y,
      z: correctedPointWorld.z,
    }),
    correctionWorldM: Object.freeze({
      x: shift.x,
      y: shift.y,
      z: shift.z,
    }),
    requiredCorrectionM: requiredShiftM,
    appliedCorrectionM: shift.length(),
    geometricToleranceM: maximumShiftM,
    withinGeometricTolerance: requiredShiftM <= maximumShiftM + EPSILON,
    validity: "measured",
  });
}

function disableGenericFriction(world, wheel, other) {
  const triangulatedSupport = other.shapes.some(
    (shape) => shape instanceof CANNON.Heightfield,
  );
  for (const equation of world.frictionEquations || [])
    if (
      (equation.bi === wheel && equation.bj === other) ||
      (equation.bi === other && equation.bj === wheel)
    ) {
      // The solver transaction queues contact friction before constraint
      // updates run. `enabled = false` alone is therefore too late for the
      // current step. A heightfield can queue several rows for one tire, so
      // zero those already-queued bounds before the authored brush rows are
      // added. Solid obstacle contacts retain their validated curb response.
      equation.enabled = false;
      if (triangulatedSupport) {
        equation.minForce = 0;
        equation.maxForce = 0;
      }
    }
}

function interpolateCreep(law, normalLoadN) {
  const points = law.creepMatrixByLoad;
  let lower = points[0],
    upper = points.at(-1);
  for (let index = 1; index < points.length; index++)
    if (normalLoadN <= points[index].normalLoadN) {
      lower = points[index - 1];
      upper = points[index];
      break;
    }
  const span = upper.normalLoadN - lower.normalLoadN,
    ratio = span ? clamp((normalLoadN - lower.normalLoadN) / span, 0, 1) : 0,
    interpolate = (field) =>
      lower[field] + (upper[field] - lower[field]) * ratio;
  return {
    kLongNsPerM: interpolate("kLongNsPerM"),
    kLatNsPerM: interpolate("kLatNsPerM"),
    kCrossNsPerM: interpolate("kCrossNsPerM"),
  };
}

function effectiveInverseMass(bodyA, bodyB, pointA, pointB, axis) {
  const term = (body, point) => {
    if (!body.invMass) return 0;
    const radius = point.vsub(body.position),
      angular = radius.cross(axis),
      inertiaAngular = new CANNON.Vec3();
    body.invInertiaWorld.vmult(angular, inertiaAngular);
    return body.invMass + angular.dot(inertiaAngular);
  };
  return term(bodyA, pointA) + term(bodyB, pointB);
}

function trackCurrentNormalImpulse(contact) {
  contact[NORMAL_IMPULSE_NS] = 0;
  if (contact[NORMAL_TRACKER_INSTALLED]) return;
  const addToWlambda = contact.addToWlambda;
  contact.addToWlambda = function addTrackedNormalImpulse(deltaImpulseNs) {
    this[NORMAL_IMPULSE_NS] += deltaImpulseNs;
    addToWlambda.call(this, deltaImpulseNs);
  };
  contact[NORMAL_TRACKER_INSTALLED] = true;
}

function coupledBrushEquations(
  bodyA,
  bodyB,
  pointA,
  pointB,
  longitudinal,
  lateral,
  desiredLongitudinalForceN,
  desiredLateralForceN,
  pair,
  normalContact,
  dt,
) {
  const targetForce = (component) => {
      const normalLoadN = Math.max(
          0,
          Number(normalContact[NORMAL_IMPULSE_NS] || 0) / dt,
        ),
        longCapacityN = Math.max(
          EPSILON,
          pair.longitudinalFrictionCoefficient * normalLoadN,
        ),
        latCapacityN = Math.max(
          EPSILON,
          pair.lateralFrictionCoefficient * normalLoadN,
        ),
        utilization = Math.hypot(
          desiredLongitudinalForceN / longCapacityN,
          desiredLateralForceN / latCapacityN,
        ),
        scale = utilization > 1 ? 1 / utilization : 1;
      return (
        (component === "longitudinal"
          ? desiredLongitudinalForceN
          : desiredLateralForceN) * scale
      );
    },
    equationFor = (tangent, component) => {
      const equation = new CANNON.FrictionEquation(bodyA, bodyB, 1);
      equation.ri.copy(pointA.vsub(bodyA.position));
      equation.rj.copy(pointB.vsub(bodyB.position));
      equation.t.copy(tangent);
      const evidenceEquation = /** @type {any} */ (equation);
      evidenceEquation.simulacrumEvidenceRowKind = `tire-${component}`;
      evidenceEquation.simulacrumEvidenceSource = "tire-force";
      evidenceEquation.simulacrumSourceContactIds = Object.freeze(
        normalContact.simulacrumEvidence?.contactId
          ? [normalContact.simulacrumEvidence.contactId]
          : [],
      );
      // Cannon's GS bounds are accumulated impulses despite their force-like
      // property names. Dynamic equal bounds project both brush rows onto the
      // ellipse using the normal impulse accumulated earlier in this same GS
      // iterate. This avoids predicted or prior-step load lag.
      Object.defineProperties(equation, {
        minForce: {
          configurable: true,
          get: () => -targetForce(component) * dt,
        },
        maxForce: {
          configurable: true,
          get: () => -targetForce(component) * dt,
        },
      });
      return equation;
    };
  return {
    longitudinalEquation: equationFor(longitudinal, "longitudinal"),
    lateralEquation: equationFor(lateral, "lateral"),
  };
}

function passiveBrushForces({
  slipLongMPerS,
  slipLatMPerS,
  creep,
  pair,
  normalLoadN,
  effectiveLongInverseMass,
  effectiveLatInverseMass,
  dt,
}) {
  let longitudinalForceN = -(
      creep.kLongNsPerM * slipLongMPerS +
      creep.kCrossNsPerM * slipLatMPerS
    ),
    lateralForceN = -(
      creep.kCrossNsPerM * slipLongMPerS +
      creep.kLatNsPerM * slipLatMPerS
    );
  longitudinalForceN = clamp(
    longitudinalForceN,
    -Math.abs(slipLongMPerS) / Math.max(EPSILON, effectiveLongInverseMass * dt),
    Math.abs(slipLongMPerS) / Math.max(EPSILON, effectiveLongInverseMass * dt),
  );
  lateralForceN = clamp(
    lateralForceN,
    -Math.abs(slipLatMPerS) / Math.max(EPSILON, effectiveLatInverseMass * dt),
    Math.abs(slipLatMPerS) / Math.max(EPSILON, effectiveLatInverseMass * dt),
  );
  const longCapacityN = Math.max(
      EPSILON,
      pair.longitudinalFrictionCoefficient * normalLoadN,
    ),
    latCapacityN = Math.max(
      EPSILON,
      pair.lateralFrictionCoefficient * normalLoadN,
    ),
    utilization = Math.hypot(
      longitudinalForceN / longCapacityN,
      lateralForceN / latCapacityN,
    );
  if (utilization > 1) {
    longitudinalForceN /= utilization;
    lateralForceN /= utilization;
  }
  if (Object.is(longitudinalForceN, -0)) longitudinalForceN = 0;
  if (Object.is(lateralForceN, -0)) lateralForceN = 0;
  const powerW =
    longitudinalForceN * slipLongMPerS + lateralForceN * slipLatMPerS;
  if (powerW > EPSILON)
    throw new Error("Tire brush law produced positive contact work");
  return {
    longitudinalForceN,
    lateralForceN,
    frictionEllipseUtilization: Math.min(1, utilization),
    dissipatedPowerW: Math.max(0, -powerW),
  };
}

function radialContactResponse({
  normalModel,
  pneumaticChamber = null,
  pneumaticState = null,
  ambientPressurePa = 101_325,
  deflectionM,
  normalRateMPerS,
  manifoldShare,
  dt,
}) {
  const boundedDeflectionM = Math.min(
      deflectionM,
      normalModel.maximumDeflectionM,
    ),
    carcassDampingNsPerM =
      normalRateMPerS <= 0
        ? normalModel.compressionDampingNsPerM
        : normalModel.reboundDampingNsPerM,
    atRim = deflectionM > normalModel.maximumDeflectionM,
    totalDampingNsPerM =
      carcassDampingNsPerM + (atRim ? normalModel.rimContactDampingNsPerM : 0),
    pneumatic =
      pneumaticChamber && pneumaticState
        ? pneumaticSupportResponse({
            chamber: pneumaticChamber,
            state: pneumaticState,
            ambientPressurePa,
            deflectionM: boundedDeflectionM,
          })
        : null,
    foundationLoadN = Math.max(
      0,
      (normalModel.kRadialNPerM * boundedDeflectionM -
        carcassDampingNsPerM * normalRateMPerS +
        (pneumatic?.loadN || 0)) *
        manifoldShare,
    ),
    rimLoadN = Math.max(
      0,
      (normalModel.rimContactStiffnessNPerM *
        Math.max(0, deflectionM - normalModel.maximumDeflectionM) -
        (atRim ? normalModel.rimContactDampingNsPerM : 0) * normalRateMPerS) *
        manifoldShare,
    ),
    relaxation = clamp(
      totalDampingNsPerM /
        Math.max(
          EPSILON,
          (normalModel.kRadialNPerM +
            (pneumatic?.tangentStiffnessNPerM || 0) +
            (atRim ? normalModel.rimContactStiffnessNPerM : 0)) *
            dt,
        ),
      1,
      30,
    );
  return {
    atRim,
    boundedDeflectionM,
    foundationLoadN,
    rimLoadN,
    normalLoadN: foundationLoadN + rimLoadN,
    relaxation,
    ...(pneumatic ? { pneumatic } : {}),
  };
}

export function surfaceFoundationResponse({
  normalModel,
  pneumaticChamber = null,
  pneumaticState = null,
  ambientPressurePa = 101_325,
  pair,
  deflectionM,
  normalRateMPerS,
  manifoldShare,
  dt,
}) {
  const pneumatic =
      pneumaticChamber && pneumaticState
        ? pneumaticSupportResponse({
            chamber: pneumaticChamber,
            state: pneumaticState,
            ambientPressurePa,
            deflectionM,
          })
        : null,
    tireStiffness =
      normalModel.kRadialNPerM + (pneumatic?.tangentStiffnessNPerM || 0),
    groundStiffness = pair.foundationStiffnessNPerM;
  if (!groundStiffness)
    return {
      ...radialContactResponse({
        normalModel,
        pneumaticChamber,
        pneumaticState,
        ambientPressurePa,
        deflectionM,
        normalRateMPerS,
        manifoldShare,
        dt,
      }),
      surfaceSinkageM: 0,
      contactStiffnessNPerM: tireStiffness,
    };
  const groundShare = tireStiffness / (tireStiffness + groundStiffness),
    surfaceSinkageM = Math.min(
      pair.maximumSinkageM,
      Math.max(0, deflectionM) * groundShare,
    ),
    tireDeflectionM = Math.max(0, deflectionM - surfaceSinkageM),
    tireRateMPerS = normalRateMPerS * (1 - groundShare),
    groundAtLimit = surfaceSinkageM >= pair.maximumSinkageM - EPSILON;
  return {
    ...radialContactResponse({
      normalModel,
      pneumaticChamber,
      pneumaticState,
      ambientPressurePa,
      deflectionM: tireDeflectionM,
      normalRateMPerS: tireRateMPerS,
      manifoldShare,
      dt,
    }),
    surfaceSinkageM,
    contactStiffnessNPerM: groundAtLimit
      ? tireStiffness
      : (tireStiffness * groundStiffness) / (tireStiffness + groundStiffness),
  };
}

/**
 * Adds tire tangential rows to Cannon's current contact island. The rows are
 * created during Constraint.update(), after narrowphase and before the single
 * world solve, so this is not a second force/integration pass.
 */
export class TireContactConstraint extends CANNON.Constraint {
  constructor(world, wheelBody, supportBody, descriptor, fixedDt) {
    super(wheelBody, supportBody, {
      collideConnected: true,
      wakeUpBodies: false,
    });
    this.world = world;
    this.wheelBody = wheelBody;
    this.descriptor = descriptor;
    this.semanticRegions = authoredSemanticRegions(descriptor);
    this.fixedDt = fixedDt;
    const referenceTemperatureK =
      descriptor.tireConstitutiveLaw.thermalModel.referenceTemperatureK;
    const chamber = descriptor.tireConstitutiveLaw.pneumaticChamber,
      ambientPressurePa = standardAtmosphere(
        Math.max(0, wheelBody.position.y),
      ).pressure,
      pneumaticState = chamber
        ? createPneumaticState({
            absolutePressurePa:
              ambientPressurePa + chamber.initialColdGaugePressurePa,
            temperatureK: chamber.initialGasTemperatureK,
            volumeM3: chamber.referenceInternalVolumeM3,
          })
        : null;
    this.state = {
      touching: false,
      normalLoadN: 0,
      longitudinalForceN: 0,
      lateralForceN: 0,
      slipLongMPerS: 0,
      slipLatMPerS: 0,
      carcassDeflectionM: 0,
      carcassDeflectionRateMPerS: 0,
      rimLoadN: 0,
      rollingResistanceTorqueNm: 0,
      rollingHysteresisEnergyPerCycleJ: 0,
      effectiveRollingResistanceCoefficient: 0,
      surfaceSinkageM: 0,
      surfaceRollingResistanceMultiplier: 1,
      dissipatedEnergyJ: 0,
      temperatureK: referenceTemperatureK,
      pneumaticGasState: pneumaticState,
      ambientPressurePa: pneumaticState ? ambientPressurePa : null,
      absolutePressurePa: pneumaticState
        ? ambientPressurePa + chamber.initialColdGaugePressurePa
        : null,
      gaugePressurePa: pneumaticState
        ? chamber.initialColdGaugePressurePa
        : null,
      gasTemperatureK:
        pneumaticState?.temperatureK || chamber?.initialGasTemperatureK || null,
      chamberVolumeM3: pneumaticState?.volumeM3 || null,
      frictionEllipseUtilization: 0,
      manifoldPointCount: 0,
      contactRoles: Object.freeze([]),
      contactRegionKeys: Object.freeze([]),
      contactMaterialKeys: Object.freeze([]),
      supportMaterialKeys: Object.freeze([]),
      supportMaterialLaws: Object.freeze([]),
    };
    this.solvedContactRows = [];
  }

  setPneumaticGasState(state, carcassHeatJ = 0, ambientPressurePa = null) {
    if (!this.descriptor.tireConstitutiveLaw.pneumaticChamber) return;
    const thermal = this.descriptor.tireConstitutiveLaw.thermalModel;
    this.state = {
      ...this.state,
      pneumaticGasState: {
        massKg: state.massKg,
        internalEnergyJ: state.internalEnergyJ,
        volumeM3: state.volumeM3,
      },
      ambientPressurePa:
        Number.isFinite(ambientPressurePa) && ambientPressurePa > 0
          ? ambientPressurePa
          : this.state.ambientPressurePa,
      temperatureK:
        this.state.temperatureK +
        Number(carcassHeatJ || 0) / thermal.thermalMassJPerK,
    };
  }

  update() {
    this.equations.length = 0;
    this.solvedContactRows = [];
    const wheel = this.wheelBody,
      descriptor = this.descriptor,
      law = descriptor.tireConstitutiveLaw,
      contacts = (this.world.contacts || []).filter(
        (contact) => contact.bi === wheel || contact.bj === wheel,
      ),
      next = {
        ...this.state,
        touching: contacts.length > 0,
        normalLoadN: 0,
        longitudinalForceN: 0,
        lateralForceN: 0,
        slipLongMPerS: 0,
        slipLatMPerS: 0,
        carcassDeflectionM: 0,
        carcassDeflectionRateMPerS: 0,
        rimLoadN: 0,
        rollingResistanceTorqueNm: 0,
        rollingHysteresisEnergyPerCycleJ: 0,
        effectiveRollingResistanceCoefficient: 0,
        surfaceSinkageM: 0,
        surfaceRollingResistanceMultiplier: 1,
        frictionEllipseUtilization: 0,
        manifoldPointCount: contacts.length,
        contactRoles: Object.freeze([]),
        contactRegionKeys: Object.freeze([]),
        contactMaterialKeys: Object.freeze([]),
        supportMaterialKeys: Object.freeze([]),
        supportMaterialLaws: Object.freeze([]),
      };
    if (!contacts.length) {
      const chamber = law.pneumaticChamber;
      if (chamber && next.pneumaticGasState) {
        const volumeM3 = pneumaticChamberVolume(chamber, 0),
          ambientPressurePa =
            next.ambientPressurePa ||
            standardAtmosphere(Math.max(0, wheel.position.y)).pressure,
          pneumatic = pneumaticSupportResponse({
            chamber,
            state: next.pneumaticGasState,
            ambientPressurePa,
            deflectionM: 0,
          });
        next.pneumaticGasState = {
          ...next.pneumaticGasState,
          volumeM3,
        };
        next.absolutePressurePa = pneumatic.absolutePressurePa;
        next.gaugePressurePa = pneumatic.gaugePressurePa;
        next.gasTemperatureK = pneumatic.temperatureK;
        next.chamberVolumeM3 = volumeM3;
      }
      this.state = next;
      return;
    }
    const axle = partVectorToWorld(
      wheel,
      new CANNON.Vec3(...descriptor.localAxleAxis),
    );
    axle.normalize();
    const maximumDeflectionM = law.normalModel.maximumDeflectionM,
      // Chord geometry bounds the longitudinal reach of a circular contact
      // patch compressed by the authored maximum radial deflection.
      maximumContactPatchHalfLengthM = Math.sqrt(
        Math.max(
          0,
          2 * descriptor.radiusM * maximumDeflectionM - maximumDeflectionM ** 2,
        ),
      ),
      contactRoles = new Set(),
      contactRegionKeys = new Set(),
      contactMaterialKeys = new Set(),
      supportMaterialLaws = new Map(),
      tractionContacts = [];
    for (const contact of contacts) {
      const tireEvidence = limitHeightfieldAxleMoment(
        contact,
        wheel,
        axle,
        maximumContactPatchHalfLengthM,
      );
      if (tireEvidence) contact.simulacrumTireEvidence = tireEvidence;
      const wheelIsA = contact.bi === wheel,
        other = wheelIsA ? contact.bj : contact.bi,
        wheelPoint = worldPoint(wheel, wheelIsA ? contact.ri : contact.rj),
        otherPoint = worldPoint(other, wheelIsA ? contact.rj : contact.ri),
        normal = contact.ni.scale(wheelIsA ? -1 : 1),
        longitudinal = axle.cross(normal),
        otherMaterialKey = contactMaterialKey(contact, other);
      if (!otherMaterialKey)
        throw new DomainValidationError(
          "MISSING_CONTACT_MATERIAL_IDENTITY",
          `Tire contact body ${other.userData?.externalBodyId || other.id} (${other.userData?.surface || (other.userData?.partId != null ? `part ${other.userData.partId}` : "unlabeled surface")}) requires an explicit material identity`,
          {
            path: ["contactBody", other.userData?.externalBodyId || other.id],
            details: {
              bodyId: other.id,
              externalBodyId: other.userData?.externalBodyId || null,
              surface: other.userData?.surface || null,
              shapeTypes: other.shapes.map((shape) => shape.type),
            },
          },
        );
      const pair = contactMaterialPair(law.tireMaterialKey, otherMaterialKey);
      supportMaterialLaws.set(
        otherMaterialKey,
        Object.freeze({
          materialKey: otherMaterialKey,
          longitudinalFrictionCoefficient: pair.longitudinalFrictionCoefficient,
          lateralFrictionCoefficient: pair.lateralFrictionCoefficient,
          restitutionCoefficient: pair.restitutionCoefficient,
          foundationStiffnessNPerM: pair.foundationStiffnessNPerM,
          maximumSinkageM: pair.maximumSinkageM,
          rollingResistanceMultiplier: pair.rollingResistanceMultiplier,
        }),
      );
      contact.restitution = pair.restitutionCoefficient;
      disableGenericFriction(this.world, wheel, other);
      trackCurrentNormalImpulse(contact);
      if (longitudinal.lengthSquared() <= EPSILON) {
        // Axle-normal contact has no unique rolling direction. Treat it as an
        // explicit frictionless sidewall contact instead of letting Cannon
        // invent a tangent basis or drive traction.
        const region = this.semanticRegions.get("sidewall");
        contactRoles.add(region.contactRole);
        contactRegionKeys.add(region.semanticKey);
        contactMaterialKeys.add(region.materialKey);
        continue;
      }
      longitudinal.normalize();
      const lateral = normal.cross(longitudinal);
      lateral.normalize();
      tractionContacts.push({
        contact,
        wheelIsA,
        other,
        wheelPoint,
        otherPoint,
        normal,
        longitudinal,
        lateral,
        pair,
      });
    }
    for (const entry of tractionContacts) {
      const {
          contact,
          other,
          wheelPoint,
          otherPoint,
          normal,
          longitudinal,
          lateral,
          pair,
        } = entry,
        manifoldShare = 1 / tractionContacts.length,
        relativeVelocity = pointVelocity(wheel, wheelPoint).vsub(
          pointVelocity(other, otherPoint),
        ),
        normalRateMPerS = relativeVelocity.dot(normal),
        deflectionM = Math.max(0, -contactGap(contact)),
        normalModel = law.normalModel,
        chamber = law.pneumaticChamber || null,
        ambientPressurePa =
          next.ambientPressurePa ||
          standardAtmosphere(Math.max(0, wheel.position.y)).pressure,
        radial = surfaceFoundationResponse({
          normalModel,
          pneumaticChamber: chamber,
          pneumaticState: next.pneumaticGasState,
          ambientPressurePa,
          pair,
          deflectionM,
          normalRateMPerS,
          manifoldShare,
          dt: this.fixedDt,
        }),
        {
          atRim,
          boundedDeflectionM,
          rimLoadN,
          normalLoadN,
          relaxation,
          surfaceSinkageM,
          contactStiffnessNPerM,
        } = radial;
      if (radial.pneumatic) {
        next.absolutePressurePa = radial.pneumatic.absolutePressurePa;
        next.gaugePressurePa = radial.pneumatic.gaugePressurePa;
        next.gasTemperatureK = radial.pneumatic.temperatureK;
        next.chamberVolumeM3 = radial.pneumatic.volumeM3;
      }
      contact.setSpookParams(
        (contactStiffnessNPerM +
          (atRim ? normalModel.rimContactStiffnessNPerM : 0)) *
          manifoldShare,
        relaxation,
        this.fixedDt,
      );
      if (normalLoadN <= EPSILON) continue;
      const slipLongMPerS = relativeVelocity.dot(longitudinal),
        slipLatMPerS = relativeVelocity.dot(lateral),
        creep = interpolateCreep(law, normalLoadN),
        brush = passiveBrushForces({
          slipLongMPerS,
          slipLatMPerS,
          creep,
          pair,
          normalLoadN,
          effectiveLongInverseMass: effectiveInverseMass(
            wheel,
            other,
            wheelPoint,
            otherPoint,
            longitudinal,
          ),
          effectiveLatInverseMass: effectiveInverseMass(
            wheel,
            other,
            wheelPoint,
            otherPoint,
            lateral,
          ),
          dt: this.fixedDt,
        });
      const { longitudinalEquation, lateralEquation } = coupledBrushEquations(
        wheel,
        other,
        wheelPoint,
        otherPoint,
        longitudinal,
        lateral,
        brush.longitudinalForceN,
        brush.lateralForceN,
        pair,
        contact,
        this.fixedDt,
      );
      this.equations.push(longitudinalEquation, lateralEquation);
      this.solvedContactRows.push({
        contact,
        longitudinalEquation,
        lateralEquation,
        pair,
      });
      const axialCoordinateM = Math.abs(worldPointToPart(wheel, wheelPoint).z),
        treadHalfWidthM = descriptor.widthM / 2 - descriptor.shoulderRadiusM,
        contactRole = atRim
          ? "rim"
          : axialCoordinateM <= treadHalfWidthM
            ? "tread"
            : axialCoordinateM <= descriptor.widthM / 2
              ? "shoulder"
              : "sidewall";
      const semanticRegion = this.semanticRegions.get(
        atRim
          ? "rim"
          : contactRole === "sidewall"
            ? "sidewall"
            : "tire-envelope",
      );
      if (contact.simulacrumTireEvidence)
        contact.simulacrumTireEvidence = Object.freeze({
          ...contact.simulacrumTireEvidence,
          contactRole,
          semanticRegionKey: semanticRegion.semanticKey,
        });
      next.normalLoadN += normalLoadN;
      next.longitudinalForceN += brush.longitudinalForceN;
      next.lateralForceN += brush.lateralForceN;
      next.slipLongMPerS += slipLongMPerS;
      next.slipLatMPerS += slipLatMPerS;
      next.carcassDeflectionM = Math.max(
        next.carcassDeflectionM,
        boundedDeflectionM,
      );
      if (Math.abs(normalRateMPerS) > Math.abs(next.carcassDeflectionRateMPerS))
        next.carcassDeflectionRateMPerS = -normalRateMPerS;
      next.rimLoadN += rimLoadN;
      next.surfaceSinkageM = Math.max(next.surfaceSinkageM, surfaceSinkageM);
      next.surfaceRollingResistanceMultiplier = Math.max(
        next.surfaceRollingResistanceMultiplier,
        pair.rollingResistanceMultiplier,
      );
      next.frictionEllipseUtilization = Math.max(
        next.frictionEllipseUtilization,
        brush.frictionEllipseUtilization,
      );
      next.dissipatedEnergyJ += brush.dissipatedPowerW * this.fixedDt;
      contactRoles.add(contactRole);
      contactRegionKeys.add(semanticRegion.semanticKey);
      contactMaterialKeys.add(semanticRegion.materialKey);
    }
    if (tractionContacts.length) {
      next.slipLongMPerS /= tractionContacts.length;
      next.slipLatMPerS /= tractionContacts.length;
    }
    next.contactRoles = Object.freeze([...contactRoles].sort());
    next.contactRegionKeys = Object.freeze([...contactRegionKeys].sort());
    next.contactMaterialKeys = Object.freeze([...contactMaterialKeys].sort());
    next.supportMaterialKeys = Object.freeze(
      [...supportMaterialLaws.keys()].sort(),
    );
    next.supportMaterialLaws = Object.freeze(
      [...supportMaterialLaws.values()].sort((left, right) =>
        left.materialKey.localeCompare(right.materialKey),
      ),
    );
    const rolling = law.rollingResistance;
    if (
      next.normalLoadN > EPSILON &&
      (rolling.kind === "load-radius-moment-v1" ||
        rolling.kind === "deformation-hysteresis-moment-v1")
    ) {
      const angularSpeed = wheel.angularVelocity.dot(axle),
        rollingLoss = pneumaticRollingLoss({
          rollingResistance: rolling,
          normalLoadN: next.normalLoadN,
          deflectionM: next.carcassDeflectionM,
          radiusM: descriptor.radiusM,
          surfaceMultiplier: next.surfaceRollingResistanceMultiplier,
        }),
        momentMagnitudeNm = rollingLoss.momentNm,
        torqueNm =
          -momentMagnitudeNm *
          Math.tanh(
            (angularSpeed * descriptor.radiusM) /
              rolling.regularizationSpeedMPerS,
          );
      wheel.torque.vadd(axle.scale(torqueNm), wheel.torque);
      next.rollingResistanceTorqueNm = torqueNm;
      next.rollingHysteresisEnergyPerCycleJ =
        rollingLoss.hysteresisEnergyPerCycleJ;
      next.effectiveRollingResistanceCoefficient =
        rollingLoss.effectiveCoefficient;
      next.dissipatedEnergyJ +=
        Math.max(0, -torqueNm * angularSpeed) * this.fixedDt;
    }
    const thermal = law.thermalModel,
      dissipatedThisStepJ = Math.max(
        0,
        next.dissipatedEnergyJ - this.state.dissipatedEnergyJ,
      ),
      coolingJ =
        thermal.ambientConductanceWPerK *
        (next.temperatureK - thermal.referenceTemperatureK) *
        this.fixedDt;
    next.temperatureK +=
      (dissipatedThisStepJ - coolingJ) / thermal.thermalMassJPerK;
    if (law.pneumaticChamber && next.pneumaticGasState) {
      const volumeM3 = pneumaticChamberVolume(
        law.pneumaticChamber,
        next.carcassDeflectionM,
      );
      next.pneumaticGasState = {
        ...next.pneumaticGasState,
        volumeM3,
      };
    }
    this.state = next;
  }

  /** Commits the normal reaction produced by the completed shared solve. */
  commitSolvedState() {
    const contacts = (this.world.contacts || []).filter(
      (contact) =>
        contact.bi === this.wheelBody || contact.bj === this.wheelBody,
    );
    if (!contacts.length) return;
    const normalLoadN = contacts.reduce(
        (sum, contact) => sum + Math.abs(contact.multiplier || 0),
        0,
      ),
      longitudinalForceN = this.solvedContactRows.reduce(
        (sum, row) => sum - Number(row.longitudinalEquation.multiplier || 0),
        0,
      ),
      lateralForceN = this.solvedContactRows.reduce(
        (sum, row) => sum - Number(row.lateralEquation.multiplier || 0),
        0,
      ),
      frictionEllipseUtilization = this.solvedContactRows.reduce(
        (maximum, row) => {
          const rowNormalLoadN = Math.abs(row.contact.multiplier || 0),
            longCapacityN = Math.max(
              EPSILON,
              row.pair.longitudinalFrictionCoefficient * rowNormalLoadN,
            ),
            latCapacityN = Math.max(
              EPSILON,
              row.pair.lateralFrictionCoefficient * rowNormalLoadN,
            );
          return Math.max(
            maximum,
            Math.hypot(
              Number(row.longitudinalEquation.multiplier || 0) / longCapacityN,
              Number(row.lateralEquation.multiplier || 0) / latCapacityN,
            ),
          );
        },
        0,
      );
    this.state = {
      ...this.state,
      normalLoadN,
      longitudinalForceN,
      lateralForceN,
      frictionEllipseUtilization,
    };
  }
}

export { interpolateCreep, passiveBrushForces, radialContactResponse };
