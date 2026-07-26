import { componentDefinition } from "./component-contracts.js";
import {
  axisFor,
  cloneCompiledValue,
  compiledPortDefinition,
  compiledVector,
  constraintId,
  endpointPort,
  isLinkageEndpoint,
  isPivotEndpoint,
  PHYSICAL_CONNECTION_KINDS,
  worldPortFrame,
} from "./assembly-compiler-shared.js";

function gearEndpoint(context, part) {
  const definition = componentDefinition(part, context.catalog),
    teeth = part.config?.teeth || definition?.teeth || 1,
    pitchRadius = part.config?.radius || definition?.radius || 0.25;
  return {
    definition,
    hasTeeth: Boolean(part.config?.teeth || definition?.teeth),
    teeth,
    pitchRadius,
  };
}

function compileGear(context, connection, a, b) {
  const endpointA = gearEndpoint(context, a),
    endpointB = gearEndpoint(context, b);
  if (!endpointA.hasTeeth)
    context.diagnostics.push({
      severity: "error",
      code: "MESH_REQUIRES_GEAR",
      connectionId: connection.id,
      message: `Mesh endpoint #${a.id} has no tooth geometry.`,
    });
  if (!endpointB.hasTeeth)
    context.diagnostics.push({
      severity: "error",
      code: "MESH_REQUIRES_GEAR",
      connectionId: connection.id,
      message: `Mesh endpoint #${b.id} has no tooth geometry.`,
    });
  const teethA = endpointA.teeth,
    teethB = endpointB.teeth;
  context.constraints.push({
    id: constraintId("gear", connection),
    kind: "gear",
    sourceConnectionIds: [connection.id],
    a: a.id,
    b: b.id,
    axisA: axisFor(a, context.catalog),
    axisB: axisFor(b, context.catalog),
    ratio: teethA / teethB,
    teethA,
    teethB,
    pitchRadiusA: endpointA.pitchRadius,
    pitchRadiusB: endpointB.pitchRadius,
    stiffness: connection.config?.toothStiffness ?? 900,
    damping: connection.config?.meshDamping ?? 24,
    breakForce: connection.capacity.ultimateForceN,
    breakTorque: connection.capacity.ultimateTorqueNm,
  });
}

function compileMeasurement(context, connection, a, b, leftPort) {
  const sensor = leftPort.behavior === "rotary-measurement" ? a : b,
    target = sensor === a ? b : a;
  context.constraints.push({
    id: constraintId("sensor", connection),
    kind: "measurement",
    sourceConnectionIds: [connection.id],
    a: a.id,
    b: b.id,
    sensorId: sensor.id,
    targetId: target.id,
  });
}

function compilePivot(context, connection, a, b, portA) {
  const lever = isPivotEndpoint(a, portA, context.catalog) ? a : b;
  context.constraints.push({
    id: constraintId("lever-pivot", connection),
    kind: "revolute",
    sourcePartId: lever.id,
    sourceConnectionIds: [connection.id],
    a: a.id,
    b: b.id,
    anchor: compiledVector(lever.pos),
    axis: [0, 0, 1],
    limits: [-Math.PI * 0.48, Math.PI * 0.48],
    damping: lever.config?.damping ?? 3,
    maxTorque: lever.config?.torque ?? 80,
  });
}

function compileLinkage(context, connection, a, b) {
  context.constraints.push({
    id: constraintId("linkage", connection),
    kind: "linkage",
    sourceConnectionIds: [connection.id],
    a: a.id,
    b: b.id,
    restLength: Math.hypot(
      ...compiledVector(a.pos).map(
        (value, index) => value - compiledVector(b.pos)[index],
      ),
    ),
    breakForce: connection.capacity.ultimateForceN,
    breakTorque: connection.capacity.ultimateTorqueNm,
  });
}

function rotaryParticipants(a, b, leftPort, rightPort) {
  const rotor = leftPort.behavior === "rotary-coupling" ? a : b,
    velocityActuator =
      leftPort.behavior === "rotary-actuator-output"
        ? a
        : rightPort.behavior === "rotary-actuator-output"
          ? b
          : null,
    positionActuator =
      leftPort.behavior === "rotary-position-actuator-output"
        ? a
        : rightPort.behavior === "rotary-position-actuator-output"
          ? b
          : null,
    support =
      leftPort.behavior === "revolute-support"
        ? a
        : rightPort.behavior === "revolute-support"
          ? b
          : null;
  return { rotor, velocityActuator, positionActuator, support };
}

function compileDriveLaw(velocityActuator, velocityDefinition) {
  if (!velocityActuator) return null;
  return {
    kind: "dc-motor-speed-torque-v1",
    noLoadSpeedRadPerS:
      (Number(velocityActuator.config?.rpm ?? velocityDefinition.rpm) *
        Math.PI *
        2) /
      60,
    direction: Number(
      velocityActuator.config?.direction ?? velocityDefinition.direction ?? 1,
    ),
    maximumElectricalPowerW:
      Number(velocityActuator.config?.power ?? velocityDefinition.power) * 1000,
    electricalEfficiency: Math.max(
      0.01,
      Math.min(
        1,
        Number(
          velocityActuator.config?.electricalEfficiency ??
            velocityDefinition.electricalEfficiency ??
            0.92,
        ),
      ),
    ),
  };
}

function rotaryCoordinate(participants, a, leftPort, rightPort) {
  const { velocityActuator, positionActuator, support } = participants,
    coordinateOwner = positionActuator || support || velocityActuator,
    ownerPort = coordinateOwner === a ? leftPort : rightPort,
    mechanismConfig = positionActuator?.mechanism?.config,
    coordinateConfig = mechanismConfig || support?.mechanism?.config || null;
  return {
    coordinateOwner,
    ownerPort,
    mechanismConfig,
    coordinateConfig,
    actuation: mechanismConfig?.actuation,
  };
}

function rotaryLimits(mechanismConfig) {
  if (!mechanismConfig?.angleRangeRad) return null;
  return [
    mechanismConfig.angleRangeRad.lower,
    mechanismConfig.angleRangeRad.upper,
  ];
}

function rotaryDamping(mechanismConfig, support) {
  if (mechanismConfig?.friction?.kind === "coulomb-viscous-v1")
    return mechanismConfig.friction.viscousNms;
  return support?.mechanism?.config.friction?.viscousNms ?? 0.18;
}

function controlledRotorId(positionActuator, rotor, a, b) {
  if (!positionActuator) return rotor.id;
  return positionActuator === a ? b.id : a.id;
}

function rotaryDescriptor(
  context,
  connection,
  a,
  b,
  leftPort,
  rightPort,
  participants,
) {
  const { rotor, velocityActuator, positionActuator, support } = participants,
    coordinate = rotaryCoordinate(participants, a, leftPort, rightPort),
    velocityDefinition = velocityActuator
      ? componentDefinition(velocityActuator, context.catalog) || {}
      : null,
    frame = worldPortFrame(
      coordinate.coordinateOwner || rotor || a,
      coordinate.coordinateConfig?.frameB
        ? { localFramePart: coordinate.coordinateConfig.frameB }
        : coordinate.ownerPort,
      coordinate.coordinateOwner === a
        ? connection.anchorA
        : connection.anchorB,
    );
  return {
    id: constraintId("shaft", connection),
    kind: "revolute",
    sourcePartId: positionActuator?.id,
    sourceConnectionIds: [connection.id],
    a: a.id,
    b: b.id,
    anchor: frame.positionWorld,
    axis: axisFor(rotor || positionActuator || a, context.catalog),
    axisWorld: frame.axisWorld,
    limits: rotaryLimits(coordinate.mechanismConfig),
    damping: rotaryDamping(coordinate.mechanismConfig, support),
    maxTorque:
      coordinate.actuation?.maximumTorqueNm ??
      connection.capacity.ultimateTorqueNm,
    motorId: velocityActuator?.id ?? null,
    driveLaw: compileDriveLaw(velocityActuator, velocityDefinition),
    controlled: Boolean(positionActuator && coordinate.actuation),
    rotorId: controlledRotorId(positionActuator, rotor, a, b),
    mechanism: coordinate.mechanismConfig
      ? cloneCompiledValue(coordinate.mechanismConfig)
      : null,
    breakForce: connection.capacity.ultimateForceN,
    breakTorque: connection.capacity.ultimateTorqueNm,
  };
}

function compileRotary(context, connection, a, b, leftPort, rightPort) {
  const participants = rotaryParticipants(a, b, leftPort, rightPort),
    endpointFrameA = worldPortFrame(a, leftPort, connection.anchorA),
    endpointFrameB = worldPortFrame(b, rightPort, connection.anchorB),
    endpointAxisDot = endpointFrameA.axisWorld.reduce(
      (sum, value, axis) => sum + value * endpointFrameB.axisWorld[axis],
      0,
    ),
    descriptor = rotaryDescriptor(
      context,
      connection,
      a,
      b,
      leftPort,
      rightPort,
      participants,
    );
  if (Math.abs(endpointAxisDot) < 1 - 1e-8) {
    context.diagnostics.push({
      severity: "error",
      code: "ROTARY_PORT_AXES_MISALIGNED",
      connectionId: connection.id,
      message: `Rotary connection ${connection.id} axes must be parallel or antiparallel in world space.`,
      axisWorldA: endpointFrameA.axisWorld,
      axisWorldB: endpointFrameB.axisWorld,
    });
    return;
  }
  context.constraints.push(descriptor);
  const { positionActuator } = participants,
    actuation = positionActuator?.mechanism?.config.actuation;
  if (positionActuator && actuation)
    context.actuators.push({
      id: `actuator:${positionActuator.id}`,
      kind: "rotary-actuator-v1",
      sourcePartId: positionActuator.id,
      constraintId: descriptor.id,
      law: cloneCompiledValue(actuation),
    });
}

function compileLinearGuide(context, connection, a, b, leftPort, rightPort) {
  const coordinateOwner = [a, b].find(
      (part, index) =>
        (index === 0 ? leftPort : rightPort).behavior === "linear-guide-output",
    ),
    ownerPort = coordinateOwner === a ? leftPort : rightPort,
    movingBody = coordinateOwner === a ? b : a,
    frameA = worldPortFrame(
      coordinateOwner,
      ownerPort,
      coordinateOwner === a ? connection.anchorA : connection.anchorB,
    ),
    movingPort = coordinateOwner === a ? rightPort : leftPort,
    frameB = worldPortFrame(
      movingBody,
      movingPort,
      coordinateOwner === a ? connection.anchorB : connection.anchorA,
    ),
    mechanismConfig = coordinateOwner.mechanism.config,
    range = mechanismConfig.travelRangeM;
  context.constraints.push({
    id: constraintId("linear-guide", connection),
    kind: "linear-guide",
    sourcePartId: coordinateOwner.id,
    sourceConnectionIds: [connection.id],
    a: coordinateOwner.id,
    b: movingBody.id,
    anchorA: frameA.positionWorld,
    anchorB: frameB.positionWorld,
    axis: [0, 0, 1],
    axisWorld: frameA.axisWorld,
    coordinateOffsetM: mechanismConfig.referenceCoordinateM,
    limits: [range.lower, range.upper],
    mechanism: cloneCompiledValue(mechanismConfig),
    breakForce: connection.capacity.ultimateForceN,
    breakTorque: connection.capacity.ultimateTorqueNm,
  });
}

function compileFixed(context, connection, a, b) {
  context.constraints.push({
    id: constraintId("fixed", connection),
    kind: "fixed",
    sourceConnectionIds: [connection.id],
    a: a.id,
    b: b.id,
    breakForce: connection.capacity.ultimateForceN,
    breakTorque: connection.capacity.ultimateTorqueNm,
  });
}

const PHYSICAL_CONSTRAINT_COMPILERS = new Map([
  ["gear", compileGear],
  ["measurement", compileMeasurement],
  ["lever-pivot", compilePivot],
  ["linkage", compileLinkage],
  ["revolute", compileRotary],
  ["linear-guide", compileLinearGuide],
  ["fixed", compileFixed],
]);

function constraintFamily(context, connection, a, b, leftPort, rightPort) {
  if (connection.kind === "mesh") return "gear";
  const behaviors = new Set([leftPort.behavior, rightPort.behavior]);
  if (behaviors.has("rotary-measurement")) return "measurement";
  if (
    isPivotEndpoint(a, connection.portA, context.catalog) ||
    isPivotEndpoint(b, connection.portB, context.catalog)
  )
    return "lever-pivot";
  if (
    isLinkageEndpoint(a, connection.portA, context.catalog) ||
    isLinkageEndpoint(b, connection.portB, context.catalog)
  )
    return "linkage";
  if (
    behaviors.has("revolute-support") ||
    behaviors.has("rotary-actuator-output") ||
    behaviors.has("rotary-position-actuator-output")
  )
    return "revolute";
  if (behaviors.has("linear-guide-output")) return "linear-guide";
  return "fixed";
}

function compileConnectionConstraint(context, connection) {
  if (
    context.consumedConnections.has(connection.id) ||
    connection.failed ||
    !PHYSICAL_CONNECTION_KINDS.has(connection.kind)
  )
    return;
  const a = context.partById.get(connection.a),
    b = context.partById.get(connection.b);
  if (
    !a ||
    !b ||
    context.forceElementParts.has(a.id) ||
    context.forceElementParts.has(b.id)
  )
    return;
  const leftPort =
      connection.kind === "mesh"
        ? null
        : compiledPortDefinition(
            a,
            endpointPort(connection, "a"),
            context.catalog,
          ),
    rightPort =
      connection.kind === "mesh"
        ? null
        : compiledPortDefinition(
            b,
            endpointPort(connection, "b"),
            context.catalog,
          ),
    family = constraintFamily(context, connection, a, b, leftPort, rightPort);
  PHYSICAL_CONSTRAINT_COMPILERS.get(family)(
    context,
    connection,
    a,
    b,
    leftPort,
    rightPort,
  );
}

export function compilePhysicalConstraints(context) {
  for (const connection of context.connections)
    compileConnectionConstraint(context, connection);
}
