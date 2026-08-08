import {
  CONNECTION_FRAME_TOLERANCES_V1,
  portAxisPart,
} from "./component-geometry-contract.js";
import {
  canonicalQuaternion,
  canonicalizeQuaternion,
  finiteVector3,
  rotateVectorByQuaternion,
} from "./primitives.js";

const AXIS_BEARING_BEHAVIORS = new Set([
  "rotary-coupling",
  "revolute-support",
  "rotary-actuator-output",
  "rotary-position-actuator-output",
  "rotary-measurement",
]);

function finitePartPosition(part) {
  return finiteVector3(part.pos, { path: ["parts", part.id, "pos"] });
}

function composeQuaternion(left, right) {
  const [ax, ay, az, aw] = canonicalQuaternion(left),
    [bx, by, bz, bw] = canonicalQuaternion(right);
  return canonicalizeQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

export function worldPortFrame(
  part,
  geometryDescriptor,
  portId,
  structuralAnchor = null,
) {
  const portFrame = geometryDescriptor.portFrames[portId];
  if (!portFrame)
    throw new Error(
      `Missing canonical spatial frame for ${part.type}.${portId}`,
    );
  if (structuralAnchor && portFrame.anchorPolicy !== "surface-point-v1")
    throw new Error(
      `Connection anchor is not allowed for ${part.type}.${portId}`,
    );
  const orientation = canonicalQuaternion(part.orientation, {
      path: ["parts", part.id, "orientation"],
    }),
    orientationPart = canonicalQuaternion(portFrame.framePart.orientation),
    positionPartM = structuralAnchor
      ? finiteVector3(structuralAnchor)
      : portFrame.framePart.positionM,
    positionOffset = rotateVectorByQuaternion(positionPartM, orientation),
    positionWorld = finitePartPosition(part).map(
      (value, axis) => value + positionOffset[axis],
    ),
    axisWorld = rotateVectorByQuaternion(portAxisPart(portFrame), orientation),
    orientationWorld = composeQuaternion(orientation, orientationPart);
  return {
    positionWorld,
    axisWorld,
    orientationPart,
    orientationWorld,
    portFrame,
  };
}

function diagnosticBase(connection, partA, partB, portA, portB, rule) {
  return {
    severity: "error",
    connectionId: connection.id,
    partIdA: partA.id,
    portIdA: portA.id,
    partIdB: partB.id,
    portIdB: portB.id,
    expectedRule: rule,
  };
}

function invariantRule(connection, portA, portB) {
  if (connection.kind === "mesh") return "gear-pitch-distance-v1";
  const behaviors = new Set([portA.behavior, portB.behavior]);
  if (behaviors.has("flexible-termination"))
    return "flexible-attachment-coincidence-v1";
  if (
    behaviors.has("linear-guide-output") ||
    behaviors.has("linear-position-actuator-output")
  )
    return "linear-anchor-coincidence-v1";
  if (
    AXIS_BEARING_BEHAVIORS.has(portA.behavior) &&
    AXIS_BEARING_BEHAVIORS.has(portB.behavior)
  )
    return "rotary-frame-coincidence-v1";
  return "fixed-anchor-coincidence-v1";
}

function codeForPositionRule(rule) {
  if (rule === "rotary-frame-coincidence-v1")
    return "ROTARY_PORT_POSITIONS_MISALIGNED";
  if (rule === "linear-anchor-coincidence-v1")
    return "LINEAR_PORT_POSITIONS_MISALIGNED";
  if (rule === "flexible-attachment-coincidence-v1")
    return "FLEXIBLE_PORT_POSITIONS_MISALIGNED";
  return "FIXED_PORT_POSITIONS_MISALIGNED";
}

/**
 * Validates one authored physical relationship against canonical descriptor
 * frames. It never repairs or normalizes authored geometry.
 */
export function validateConnectionFrameInvariant({
  connection,
  partA,
  partB,
  portA,
  portB,
  geometryA,
  geometryB,
}) {
  const rule = invariantRule(connection, portA, portB),
    base = diagnosticBase(connection, partA, partB, portA, portB, rule);
  let frameA, frameB;
  try {
    frameA = worldPortFrame(partA, geometryA, portA.id, connection.anchorA);
    frameB = worldPortFrame(partB, geometryB, portB.id, connection.anchorB);
  } catch (error) {
    return {
      ok: false,
      rule,
      frameA: null,
      frameB: null,
      diagnostic: {
        ...base,
        code: "MISSING_SPATIAL_PORT_FRAME",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (rule === "gear-pitch-distance-v1") {
    const originDistanceM = Math.hypot(
        ...finitePartPosition(partA).map(
          (value, axis) => value - finitePartPosition(partB)[axis],
        ),
      ),
      radialOffsetA = Math.hypot(...frameA.portFrame.framePart.positionM),
      radialOffsetB = Math.hypot(...frameB.portFrame.framePart.positionM),
      expectedDistanceM =
        radialOffsetA +
        radialOffsetB +
        frameA.portFrame.clearanceM +
        frameB.portFrame.clearanceM,
      residualM = Math.abs(originDistanceM - expectedDistanceM);
    if (residualM > CONNECTION_FRAME_TOLERANCES_V1.positionM)
      return {
        ok: false,
        rule,
        frameA,
        frameB,
        diagnostic: {
          ...base,
          code: "GEAR_PITCH_DISTANCE_MISALIGNED",
          message: `Gear connection ${connection.id} does not satisfy its canonical pitch distance.`,
          expectedDistanceM,
          actualDistanceM: originDistanceM,
          residualM,
          toleranceM: CONNECTION_FRAME_TOLERANCES_V1.positionM,
          positionWorldA: frameA.positionWorld,
          positionWorldB: frameB.positionWorld,
          axisWorldA: frameA.axisWorld,
          axisWorldB: frameB.axisWorld,
        },
      };
    return { ok: true, rule, frameA, frameB, diagnostic: null };
  }

  const distanceM = Math.hypot(
    ...frameA.positionWorld.map(
      (value, axis) => value - frameB.positionWorld[axis],
    ),
  );
  if (distanceM > CONNECTION_FRAME_TOLERANCES_V1.positionM)
    return {
      ok: false,
      rule,
      frameA,
      frameB,
      diagnostic: {
        ...base,
        code: codeForPositionRule(rule),
        message: `Connection ${connection.id} canonical port positions must coincide.`,
        positionWorldA: frameA.positionWorld,
        positionWorldB: frameB.positionWorld,
        axisWorldA: frameA.axisWorld,
        axisWorldB: frameB.axisWorld,
        distanceM,
        toleranceM: CONNECTION_FRAME_TOLERANCES_V1.positionM,
      },
    };

  if (rule === "rotary-frame-coincidence-v1") {
    const axisDot = frameA.axisWorld.reduce(
      (sum, value, axis) => sum + value * frameB.axisWorld[axis],
      0,
    );
    if (1 - Math.abs(axisDot) > CONNECTION_FRAME_TOLERANCES_V1.axisDot)
      return {
        ok: false,
        rule,
        frameA,
        frameB,
        diagnostic: {
          ...base,
          code: "ROTARY_PORT_AXES_MISALIGNED",
          message: `Rotary connection ${connection.id} axes must be parallel or antiparallel.`,
          positionWorldA: frameA.positionWorld,
          positionWorldB: frameB.positionWorld,
          axisWorldA: frameA.axisWorld,
          axisWorldB: frameB.axisWorld,
          axisDot,
          tolerance: CONNECTION_FRAME_TOLERANCES_V1.axisDot,
        },
      };
  }
  return { ok: true, rule, frameA, frameB, diagnostic: null };
}

export { AXIS_BEARING_BEHAVIORS };
