import { contactMaterialPair } from "../model/contact-material-pairs.js";

const ZERO = Object.freeze({ x: 0, y: 0, z: 0 });
const UNIT_TOLERANCE = 2 ** -20;
const CONSISTENCY_TOLERANCE = 2 ** -30;

function finiteVector(value) {
  if (!value || ["x", "y", "z"].some((axis) => !Number.isFinite(value[axis])))
    return null;
  return { x: value.x, y: value.y, z: value.z };
}

function unitQuaternion(value) {
  if (
    !value ||
    ["x", "y", "z", "w"].some((axis) => !Number.isFinite(value[axis]))
  )
    return null;
  const norm = Math.hypot(value.x, value.y, value.z, value.w);
  if (Math.abs(norm - 1) > UNIT_TOLERANCE) return null;
  return {
    x: value.x / norm,
    y: value.y / norm,
    z: value.z / norm,
    w: value.w / norm,
  };
}

function inverseRotate(value, quaternion) {
  const q = {
      x: -quaternion.x,
      y: -quaternion.y,
      z: -quaternion.z,
      w: quaternion.w,
    },
    tx = 2 * (q.y * value.z - q.z * value.y),
    ty = 2 * (q.z * value.x - q.x * value.z),
    tz = 2 * (q.x * value.y - q.y * value.x);
  return {
    x: value.x + q.w * tx + (q.y * tz - q.z * ty),
    y: value.y + q.w * ty + (q.z * tx - q.x * tz),
    z: value.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

function rotate(value, quaternion) {
  const tx = 2 * (quaternion.y * value.z - quaternion.z * value.y),
    ty = 2 * (quaternion.z * value.x - quaternion.x * value.z),
    tz = 2 * (quaternion.x * value.y - quaternion.y * value.x);
  return {
    x: value.x + quaternion.w * tx + (quaternion.y * tz - quaternion.z * ty),
    y: value.y + quaternion.w * ty + (quaternion.z * tx - quaternion.x * tz),
    z: value.z + quaternion.w * tz + (quaternion.x * ty - quaternion.y * tx),
  };
}

const cross = (left, right) => ({
  x: left.y * right.z - left.z * right.y,
  y: left.z * right.x - left.x * right.z,
  z: left.x * right.y - left.y * right.x,
});

function consistentForce(normal, forceN, forceWorldN) {
  if (Math.abs(Math.hypot(normal.x, normal.y, normal.z) - 1) > UNIT_TOLERANCE)
    return false;
  return ["x", "y", "z"].every((axis) => {
    const expected = normal[axis] * forceN;
    const difference = forceWorldN[axis] - expected,
      scale = Math.max(1, Math.abs(expected), Math.abs(forceWorldN[axis]));
    return (
      Number.isFinite(difference) &&
      Math.abs(difference) <= CONSISTENCY_TOLERANCE * scale
    );
  });
}

const contactOrderValues = (contact) => [
  contact.forceWorldN.x,
  contact.forceWorldN.y,
  contact.forceWorldN.z,
  contact.point.x,
  contact.point.y,
  contact.point.z,
  contact.normal.x,
  contact.normal.y,
  contact.normal.z,
  contact.forceN,
];

function contactOrder(left, right) {
  const leftMagnitude = Math.hypot(
      left.forceWorldN.x,
      left.forceWorldN.y,
      left.forceWorldN.z,
    ),
    rightMagnitude = Math.hypot(
      right.forceWorldN.x,
      right.forceWorldN.y,
      right.forceWorldN.z,
    );
  if (leftMagnitude !== rightMagnitude)
    return leftMagnitude > rightMagnitude ? -1 : 1;
  const leftValues = contactOrderValues(left),
    rightValues = contactOrderValues(right);
  for (let index = 0; index < leftValues.length; index++) {
    if (leftValues[index] !== rightValues[index])
      return leftValues[index] > rightValues[index] ? -1 : 1;
  }
  return 0;
}

function observationFrame(value) {
  const position = finiteVector(value?.position),
    quaternion = unitQuaternion(value?.quaternion);
  return position && quaternion ? { position, quaternion } : null;
}

function sameObservationFrame(left, right) {
  if (
    ["x", "y", "z"].some((axis) => left.position[axis] !== right.position[axis])
  )
    return false;
  const same = ["x", "y", "z", "w"].every(
      (axis) => left.quaternion[axis] === right.quaternion[axis],
    ),
    opposite = ["x", "y", "z", "w"].every(
      (axis) => left.quaternion[axis] === -right.quaternion[axis],
    );
  return same || opposite;
}

function invalidObservation() {
  return {
    wrenchValid: false,
    frictionValid: false,
    pointContactValid: false,
    normalForceSumN: 0,
    forcePartN: ZERO,
    momentPartNm: ZERO,
    pointWorldM: ZERO,
    normalWorld: ZERO,
    minimumFrictionCoefficient: 0,
    activeContactCount: 0,
  };
}

/**
 * Reduces solved normal-contact rows into a wrench about the authored part
 * origin, expressed in that part's local frame. Tangential friction forces and
 * patch free moments are intentionally excluded because the contact registry
 * does not currently attribute those solver rows to this observation.
 *
 * @param {{
 *   contacts?: Array<Record<string, any>>,
 *   pose?: {position?: Record<string, any>, quaternion?: Record<string, any>},
 *   expectedTick?: number
 * }} [input]
 */
export function observeContactNormalWrench({
  contacts = [],
  pose = {},
  expectedTick,
} = {}) {
  if (!Array.isArray(contacts)) return invalidObservation();
  if (!contacts.length) {
    if (!finiteVector(pose.position) || !unitQuaternion(pose.quaternion))
      return invalidObservation();
    return {
      wrenchValid: true,
      frictionValid: false,
      pointContactValid: false,
      normalForceSumN: 0,
      forcePartN: { ...ZERO },
      momentPartNm: { ...ZERO },
      pointWorldM: { ...ZERO },
      normalWorld: { ...ZERO },
      minimumFrictionCoefficient: 0,
      activeContactCount: 0,
    };
  }
  const tickAuthorityRequired = expectedTick !== undefined;
  if (
    tickAuthorityRequired &&
    (!Number.isSafeInteger(expectedTick) || expectedTick < 0)
  )
    return invalidObservation();
  const validated = [];
  let frame = null;
  for (const contact of contacts) {
    const pointWorld = finiteVector(contact?.point),
      normalWorld = finiteVector(contact?.normal),
      forceWorldN = finiteVector(contact?.forceWorldN),
      contactFrame = observationFrame(contact?.observationFrame);
    if (
      contact?.normalForceValid !== true ||
      !Number.isFinite(contact.forceN) ||
      contact.forceN < 0 ||
      !pointWorld ||
      !normalWorld ||
      !forceWorldN ||
      !contactFrame ||
      (tickAuthorityRequired && contact.tick !== expectedTick) ||
      !consistentForce(normalWorld, contact.forceN, forceWorldN)
    )
      return invalidObservation();
    if (frame && !sameObservationFrame(frame, contactFrame))
      return invalidObservation();
    frame ||= contactFrame;
    validated.push({ contact, pointWorld, normalWorld, forceWorldN });
  }
  const active = validated.filter(({ contact }) => contact.forceN > 0);

  const forcePartN = { x: 0, y: 0, z: 0 },
    resultantForceWorldN = { x: 0, y: 0, z: 0 },
    momentPartNm = { x: 0, y: 0, z: 0 },
    forceWeightedPointPartM = { x: 0, y: 0, z: 0 };
  let minimumFrictionCoefficient = Infinity,
    frictionValid = true,
    normalForceSumN = 0;
  for (const { contact, pointWorld, forceWorldN } of [...active].sort(
    (left, right) => contactOrder(left.contact, right.contact),
  )) {
    const pointPartM = inverseRotate(
        {
          x: pointWorld.x - frame.position.x,
          y: pointWorld.y - frame.position.y,
          z: pointWorld.z - frame.position.z,
        },
        frame.quaternion,
      ),
      forcePart = inverseRotate(forceWorldN, frame.quaternion),
      momentPart = cross(pointPartM, forcePart);
    for (const axis of ["x", "y", "z"]) {
      forcePartN[axis] += forcePart[axis];
      resultantForceWorldN[axis] += forceWorldN[axis];
      momentPartNm[axis] += momentPart[axis];
      forceWeightedPointPartM[axis] += pointPartM[axis] * contact.forceN;
    }
    normalForceSumN += contact.forceN;

    const frictionAuthorityValid =
      contact.frictionCoefficientValid === true &&
      Number.isFinite(contact.frictionCoefficient) &&
      contact.frictionCoefficient >= 0 &&
      [
        contact.materialKey,
        contact.shapeId,
        contact.otherMaterialKey,
        contact.otherShapeId,
      ].every((value) => typeof value === "string" && value.length > 0);
    if (!frictionAuthorityValid) {
      frictionValid = false;
      minimumFrictionCoefficient = 0;
      continue;
    }
    try {
      const law = contactMaterialPair(
        contact.materialKey,
        contact.otherMaterialKey,
      );
      minimumFrictionCoefficient = Math.min(
        minimumFrictionCoefficient,
        contact.frictionCoefficient,
        law.longitudinalFrictionCoefficient,
        law.lateralFrictionCoefficient,
      );
    } catch {
      frictionValid = false;
      minimumFrictionCoefficient = 0;
    }
  }

  if (
    !Number.isFinite(normalForceSumN) ||
    ![
      ...Object.values(forcePartN),
      ...Object.values(resultantForceWorldN),
      ...Object.values(momentPartNm),
      ...Object.values(forceWeightedPointPartM),
    ].every(Number.isFinite)
  )
    return invalidObservation();

  let pointContactValid = false;
  /** @type {{x: number, y: number, z: number}} */
  let pointWorldM = { ...ZERO };
  /** @type {{x: number, y: number, z: number}} */
  let normalWorld = { ...ZERO };
  if (normalForceSumN > 0) {
    const forceMagnitudeN = Math.hypot(...Object.values(resultantForceWorldN)),
      forceScaleN = Math.max(1, forceMagnitudeN, normalForceSumN),
      magnitudeCoherent =
        Number.isFinite(forceMagnitudeN) &&
        Math.abs(forceMagnitudeN - normalForceSumN) <=
          CONSISTENCY_TOLERANCE * forceScaleN;
    if (magnitudeCoherent) {
      const pointPartM = {
          x: forceWeightedPointPartM.x / normalForceSumN,
          y: forceWeightedPointPartM.y / normalForceSumN,
          z: forceWeightedPointPartM.z / normalForceSumN,
        },
        pointOffsetWorldM = rotate(pointPartM, frame.quaternion);
      pointWorldM = {
        x: frame.position.x + pointOffsetWorldM.x,
        y: frame.position.y + pointOffsetWorldM.y,
        z: frame.position.z + pointOffsetWorldM.z,
      };
      normalWorld = {
        x: resultantForceWorldN.x / forceMagnitudeN,
        y: resultantForceWorldN.y / forceMagnitudeN,
        z: resultantForceWorldN.z / forceMagnitudeN,
      };
      const normalPart = inverseRotate(normalWorld, frame.quaternion),
        equivalentMomentPartNm = cross(pointPartM, {
          x: normalPart.x * normalForceSumN,
          y: normalPart.y * normalForceSumN,
          z: normalPart.z * normalForceSumN,
        });
      pointContactValid = ["x", "y", "z"].every((axis) => {
        const difference = equivalentMomentPartNm[axis] - momentPartNm[axis],
          scale = Math.max(
            1,
            Math.abs(equivalentMomentPartNm[axis]),
            Math.abs(momentPartNm[axis]),
          );
        return (
          Number.isFinite(difference) &&
          Math.abs(difference) <= CONSISTENCY_TOLERANCE * scale
        );
      });
    }
  }
  if (!pointContactValid) {
    pointWorldM = { ...ZERO };
    normalWorld = { ...ZERO };
  }

  return {
    wrenchValid: true,
    frictionValid: frictionValid && Number.isFinite(minimumFrictionCoefficient),
    pointContactValid,
    normalForceSumN,
    forcePartN,
    momentPartNm,
    pointWorldM,
    normalWorld,
    minimumFrictionCoefficient: Number.isFinite(minimumFrictionCoefficient)
      ? minimumFrictionCoefficient
      : 0,
    activeContactCount: active.length,
  };
}
