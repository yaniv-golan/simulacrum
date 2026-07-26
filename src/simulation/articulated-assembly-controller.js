import * as CANNON from "cannon-es";
import { boundsDimensions } from "../model/component-geometry-contract.js";

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));
const lerp = (left, right, amount) => left + (right - left) * amount;
const SIDES = ["L", "R"];
const LOCOMOTION_BODY_ROLES = Object.freeze([
  "pelvis",
  "torso",
  "thighL",
  "thighR",
  "shinL",
  "shinR",
  "footL",
  "footR",
]);
const LOCOMOTION_JOINT_ROLES = Object.freeze([
  "hipL",
  "hipR",
  "kneeL",
  "kneeR",
  "ankleL",
  "ankleR",
]);

function plainVector(value = {}) {
  return {
    x: Number(value.x || 0),
    y: Number(value.y || 0),
    z: Number(value.z || 0),
  };
}

function rotateVector(quaternion = {}, vector = {}) {
  const qx = Number(quaternion.x || 0),
    qy = Number(quaternion.y || 0),
    qz = Number(quaternion.z || 0),
    qw = Number(quaternion.w ?? 1),
    vx = Number(vector.x || 0),
    vy = Number(vector.y || 0),
    vz = Number(vector.z || 0),
    ix = qw * vx + qy * vz - qz * vy,
    iy = qw * vy + qz * vx - qx * vz,
    iz = qw * vz + qx * vy - qy * vx,
    iw = -qx * vx - qy * vy - qz * vz;
  return {
    x: ix * qw + iw * -qx + iy * -qz - iz * -qy,
    y: iy * qw + iw * -qy + iz * -qx - ix * -qz,
    z: iz * qw + iw * -qz + ix * -qy - iy * -qx,
  };
}

function length(vector) {
  return Math.hypot(vector.x, vector.y, vector.z);
}

function normalized(vector, fallback = { x: 0, y: 1, z: 0 }) {
  const magnitude = length(vector);
  return magnitude > 1e-9
    ? {
        x: vector.x / magnitude,
        y: vector.y / magnitude,
        z: vector.z / magnitude,
      }
    : { ...fallback };
}

function cross(left, right) {
  return {
    x: left.y * right.z - left.z * right.y,
    y: left.z * right.x - left.x * right.z,
    z: left.x * right.y - left.y * right.x,
  };
}

function dot(left, right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

function bodyReadModel(bodies, partId) {
  const binding = bodies?.bodyByPart?.find((entry) => entry.partId === partId);
  return binding
    ? bodies.bodies.find((body) => body.bodyId === binding.bodyId) || null
    : null;
}

function convexHull(points) {
  const unique = [
    ...new Map(
      points.map((point) => [
        `${point.x.toFixed(6)}:${point.z.toFixed(6)}`,
        point,
      ]),
    ).values(),
  ].sort((left, right) => left.x - right.x || left.z - right.z);
  if (unique.length < 3) return unique;
  const turn = (a, b, c) =>
      (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x),
    lower = [],
    upper = [];
  for (const point of unique) {
    while (lower.length >= 2 && turn(lower.at(-2), lower.at(-1), point) <= 0)
      lower.pop();
    lower.push(point);
  }
  for (const point of [...unique].reverse()) {
    while (upper.length >= 2 && turn(upper.at(-2), upper.at(-1), point) <= 0)
      upper.pop();
    upper.push(point);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function pointSegmentDistance(point, start, end) {
  const dx = end.x - start.x,
    dz = end.z - start.z,
    denominator = dx * dx + dz * dz,
    amount = denominator
      ? clamp(
          ((point.x - start.x) * dx + (point.z - start.z) * dz) / denominator,
          0,
          1,
        )
      : 0,
    x = start.x + dx * amount,
    z = start.z + dz * amount;
  return Math.hypot(point.x - x, point.z - z);
}

function pointInPolygon(point, polygon) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length;) {
    const a = polygon[index],
      b = polygon[previous],
      crosses =
        a.z > point.z !== b.z > point.z &&
        point.x < ((b.x - a.x) * (point.z - a.z)) / (b.z - a.z || 1e-9) + a.x;
    if (crosses) inside = !inside;
    previous = index++;
  }
  return inside;
}

function polygonDistance(point, polygon) {
  if (!polygon.length) return Number.POSITIVE_INFINITY;
  if (pointInPolygon(point, polygon)) return 0;
  if (polygon.length === 1)
    return Math.hypot(point.x - polygon[0].x, point.z - polygon[0].z);
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index++)
    distance = Math.min(
      distance,
      pointSegmentDistance(
        point,
        polygon[index],
        polygon[(index + 1) % polygon.length],
      ),
    );
  return distance;
}

function commandForAssembly(context, partIds, channel, fallback) {
  const values = [];
  for (const part of context.runGraph.parts()) {
    if (!partIds.has(part.id)) continue;
    const result = context.commandBus.read(part.id, channel, fallback);
    if (result.source !== "default" && !result.conflict)
      values.push(result.value);
  }
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
}

/**
 * Plans articulated motion for compiled component bodies. It never creates a
 * body, constraint, contact, or world step: role metadata only opts a generic
 * hinge graph into the reusable gait policy.
 */
export class ArticulatedAssemblyController {
  constructor(runtime) {
    this.runtime = runtime;
    this.groups = [];
    this.stateByGroup = new Map();
    this.topologyKey = "";
    this.lastTelemetry = null;
  }

  active() {
    return this.runtime?.hasArticulation?.() || false;
  }

  exportState() {
    return structuredClone({
      version: 1,
      topologyKey: this.topologyKey,
      stateByGroup: [...this.stateByGroup],
      lastTelemetry: this.lastTelemetry,
    });
  }

  importState(state) {
    if (state?.version !== 1)
      throw new TypeError("articulated checkpoint must use version 1");
    this.topologyKey = String(state.topologyKey || "");
    this.stateByGroup = new Map(structuredClone(state.stateByGroup || []));
    this.lastTelemetry = structuredClone(state.lastTelemetry || null);
    for (const group of this.groups)
      if (this.stateByGroup.has(group.id))
        group.state = this.stateByGroup.get(group.id);
  }

  rebuild(context) {
    const activeEntries = this.runtime.constraintEntries.filter(
        (entry) => entry.active !== false,
      ),
      key = `${context.runGraph.graphRevision}:${this.runtime.topologyRevision}:${activeEntries.length}`;
    if (key === this.topologyKey) return;
    this.topologyKey = key;
    const parts = this.runtime.compiled?.parts || [],
      partById = new Map(parts.map((part) => [part.id, part])),
      adjacency = new Map(
        this.runtime.compiled?.bodies.map((body) => [body.partId, new Set()]) ||
          [],
      ),
      rigidAdjacency = new Map(
        this.runtime.compiled?.bodies.map((body) => [body.partId, new Set()]) ||
          [],
      );
    for (const entry of activeEntries) {
      const { descriptor } = entry;
      if (descriptor.kind === "measurement") continue;
      adjacency.get(descriptor.a)?.add(descriptor.b);
      adjacency.get(descriptor.b)?.add(descriptor.a);
      if (descriptor.kind === "fixed") {
        rigidAdjacency.get(descriptor.a)?.add(descriptor.b);
        rigidAdjacency.get(descriptor.b)?.add(descriptor.a);
      }
    }
    const rigidClusterCache = new Map(),
      rigidCluster = (root) => {
        if (rigidClusterCache.has(root)) return rigidClusterCache.get(root);
        const cluster = new Set(),
          queue = [root];
        while (queue.length) {
          const id = queue.shift();
          if (cluster.has(id)) continue;
          cluster.add(id);
          for (const neighbor of rigidAdjacency.get(id) || [])
            queue.push(neighbor);
        }
        for (const id of cluster) rigidClusterCache.set(id, cluster);
        return cluster;
      };
    const candidates = activeEntries.filter(
        (entry) =>
          entry.descriptor.kind === "revolute" &&
          entry.descriptor.controlled &&
          entry.descriptor.sourcePartId != null,
      ),
      visitedRoots = new Set(),
      groups = [];
    for (const candidate of candidates) {
      if (visitedRoots.has(candidate.descriptor.a)) continue;
      const bodyIds = new Set(),
        queue = [candidate.descriptor.a];
      while (queue.length) {
        const id = queue.shift();
        if (bodyIds.has(id)) continue;
        bodyIds.add(id);
        for (const neighbor of adjacency.get(id) || []) queue.push(neighbor);
      }
      for (const id of bodyIds) visitedRoots.add(id);
      const joints = candidates.filter(
          (entry) =>
            bodyIds.has(entry.descriptor.a) && bodyIds.has(entry.descriptor.b),
        ),
        connectorIds = joints.map((entry) => entry.descriptor.sourcePartId),
        partIds = new Set([...bodyIds, ...connectorIds]),
        roleMembers = new Map(),
        roles = new Map();
      for (const id of partIds) {
        const role = partById.get(id)?.rigRole;
        if (!role) continue;
        if (!roleMembers.has(role)) roleMembers.set(role, []);
        roleMembers.get(role).push(id);
      }
      for (const [role, ids] of roleMembers)
        if (ids.length === 1) roles.set(role, ids[0]);
      const requiredRoles = [
          ...LOCOMOTION_BODY_ROLES,
          ...LOCOMOTION_JOINT_ROLES,
        ],
        duplicateRoles = [...roleMembers]
          .filter(([, ids]) => ids.length !== 1)
          .map(([role]) => role),
        jointPairs = {
          hipL: ["pelvis", "thighL"],
          hipR: ["pelvis", "thighR"],
          kneeL: ["thighL", "shinL"],
          kneeR: ["thighR", "shinR"],
          ankleL: ["shinL", "footL"],
          ankleR: ["shinR", "footR"],
        },
        invalidJoints = Object.entries(jointPairs)
          .filter(([jointRole, bodyRoles]) => {
            const jointId = roles.get(jointRole),
              entry = joints.find(
                (candidate) => candidate.descriptor.sourcePartId === jointId,
              ),
              expected = bodyRoles.map((role) => roles.get(role)),
              sideA = entry ? rigidCluster(entry.descriptor.a) : new Set(),
              sideB = entry ? rigidCluster(entry.descriptor.b) : new Set(),
              endpointsMatch =
                (sideA.has(expected[0]) && sideB.has(expected[1])) ||
                (sideA.has(expected[1]) && sideB.has(expected[0]));
            return !entry || new Set(expected).size !== 2 || !endpointsMatch;
          })
          .map(([role]) => role),
        locomotionAvailable =
          requiredRoles.every((role) => roles.has(role)) &&
          duplicateRoles.length === 0 &&
          invalidJoints.length === 0,
        locomotionExpected = [...roleMembers.keys()].some((role) =>
          [...LOCOMOTION_BODY_ROLES, ...LOCOMOTION_JOINT_ROLES].includes(role),
        ),
        id = [...bodyIds].map(String).sort().join("|");
      const previous = this.stateByGroup.get(id) || {
        airborneTime: 0,
        fallen: false,
        gaitPhase: "JOINT CONTROL",
        swingSide: null,
        gyroMomentum: { x: 0, z: 0 },
        initialRootPosition: null,
        nominalRootClearance: 1,
        gaitCycle: 0,
        committedSwingSide: null,
      };
      this.stateByGroup.set(id, previous);
      groups.push({
        id,
        bodyIds,
        partIds,
        joints,
        roles,
        validationErrors: [
          ...duplicateRoles.map((role) => `duplicate role ${role}`),
          ...invalidJoints.map((role) => `invalid topology for ${role}`),
        ],
        locomotionAvailable,
        locomotionExpected,
        state: previous,
      });
    }
    this.groups = groups;
    for (const entry of this.runtime.constraintEntries)
      entry.articulatedTarget = null;
  }

  measure(group, bodies) {
    const samples = [];
    let totalMass = 0,
      com = { x: 0, y: 0, z: 0 },
      velocity = { x: 0, y: 0, z: 0 };
    for (const partId of group.bodyIds) {
      const body = bodyReadModel(bodies, partId),
        engineBody = this.runtime.bodyByPart.get(partId),
        mass = engineBody?.mass || 0;
      if (!body || !mass) continue;
      totalMass += mass;
      com.x += body.pose.position.x * mass;
      com.y += body.pose.position.y * mass;
      com.z += body.pose.position.z * mass;
      velocity.x += body.velocity.x * mass;
      velocity.y += body.velocity.y * mass;
      velocity.z += body.velocity.z * mass;
    }
    if (totalMass) {
      com = {
        x: com.x / totalMass,
        y: com.y / totalMass,
        z: com.z / totalMass,
      };
      velocity = {
        x: velocity.x / totalMass,
        y: velocity.y / totalMass,
        z: velocity.z / totalMass,
      };
    }
    const footContacts = { left: false, right: false },
      internalBodyIds = new Set(
        [...group.bodyIds]
          .map(
            (partId) =>
              bodies?.bodyByPart?.find((entry) => entry.partId === partId)
                ?.bodyId,
          )
          .filter(Boolean),
      );
    for (const [label, role] of [
      ["left", "footL"],
      ["right", "footR"],
    ]) {
      const partId = group.roles.get(role),
        body = bodyReadModel(bodies, partId);
      for (const contact of body?.contacts || []) {
        const normal = normalized(contact.normal);
        if (
          normal.y < 0.2 ||
          (contact.forceN < 0.5 && contact.impulseNs < 1e-5) ||
          internalBodyIds.has(contact.otherBodyId) ||
          (!contact.surface && !contact.otherBodyId)
        )
          continue;
        footContacts[label] = true;
        samples.push({
          ...plainVector(contact.point),
          normal,
          forceN: Math.max(0, Number(contact.forceN || 0)),
          impulseNs: Math.max(0, Number(contact.impulseNs || 0)),
          partId,
          side: label,
          surface: contact.surface || null,
        });
      }
    }
    const forceTotal = samples.reduce(
        (sum, sample) => sum + Math.max(1, sample.forceN),
        0,
      ),
      support = samples.length
        ? samples.reduce(
            (result, sample) => {
              const weight = Math.max(1, sample.forceN) / forceTotal;
              result.x += sample.x * weight;
              result.y += sample.y * weight;
              result.z += sample.z * weight;
              return result;
            },
            { x: 0, y: 0, z: 0 },
          )
        : { ...com },
      supportNormal = normalized(
        samples.reduce(
          (result, sample) => {
            const weight = Math.max(1, sample.forceN) / forceTotal;
            result.x += sample.normal.x * weight;
            result.y += sample.normal.y * weight;
            result.z += sample.normal.z * weight;
            return result;
          },
          { x: 0, y: 0, z: 0 },
        ),
      ),
      tangentSeed =
        Math.abs(supportNormal.x) < 0.8
          ? { x: 1, y: 0, z: 0 }
          : { x: 0, y: 0, z: 1 },
      tangentX = normalized({
        x: tangentSeed.x - supportNormal.x * dot(tangentSeed, supportNormal),
        y: tangentSeed.y - supportNormal.y * dot(tangentSeed, supportNormal),
        z: tangentSeed.z - supportNormal.z * dot(tangentSeed, supportNormal),
      }),
      tangentZ = normalized(cross(supportNormal, tangentX), {
        x: 0,
        y: 0,
        z: 1,
      }),
      project = (point) => ({
        x: dot(point, tangentX),
        z: dot(point, tangentZ),
        world: point,
      }),
      projectedPolygon = convexHull(samples.map(project)),
      supportPolygon = projectedPolygon.map((point) => point.world),
      balanceError = polygonDistance(project(com), projectedPolygon),
      pendulumHeight = Math.max(0.25, com.y - support.y),
      naturalFrequency = Math.sqrt(9.80665 / pendulumHeight),
      capturePoint = {
        x: com.x + velocity.x / naturalFrequency,
        y: com.y,
        z: com.z + velocity.z / naturalFrequency,
      },
      captureError = polygonDistance(project(capturePoint), projectedPolygon),
      contactForces = samples.reduce(
        (forces, sample) => {
          forces[sample.side] += sample.forceN;
          return forces;
        },
        { left: 0, right: 0 },
      );
    return {
      totalMass,
      com,
      velocity,
      contacts: footContacts,
      contactForces,
      contactSamples: samples,
      support,
      supportNormal,
      supportPolygon,
      balanceError: Number.isFinite(balanceError) ? balanceError : 0,
      capturePoint,
      captureError: Number.isFinite(captureError) ? captureError : 0,
    };
  }

  prepare(context, dt) {
    this.rebuild(context);
    for (const entry of this.runtime.constraintEntries)
      entry.articulatedTarget = null;
    const bodies = context.previousTelemetry?.bodies;
    for (const group of this.groups) {
      const state = group.state,
        measurement = this.measure(group, bodies);
      state.measurement = measurement;
      state.inputTick = Number(bodies?.tick ?? -1);
      if (!group.locomotionAvailable) {
        state.gaitPhase = group.locomotionExpected
          ? "INCOMPLETE ARTICULATION"
          : "JOINT CONTROL";
        state.fallen = group.locomotionExpected;
        continue;
      }
      const command = (channel, fallback = 0) =>
          commandForAssembly(context, group.partIds, channel, fallback),
        speed =
          command("brake", 0) > 0 ? 0 : clamp(command("gait_speed", 0), 0, 1),
        footReads = Object.fromEntries(
          SIDES.map((side) => [
            side,
            bodyReadModel(bodies, group.roles.get(`foot${side}`)),
          ]),
        ),
        contactingFootPositions = [
          ["left", "L"],
          ["right", "R"],
        ]
          .filter(([side]) => measurement.contacts[side])
          .map(([, side]) => footReads[side]?.pose?.position)
          .filter(Boolean),
        balanceReference =
          speed <= 0.02 && contactingFootPositions.length
            ? contactingFootPositions.reduce(
                (result, point) => {
                  result.x += point.x / contactingFootPositions.length;
                  result.y += point.y / contactingFootPositions.length;
                  result.z += point.z / contactingFootPositions.length;
                  return result;
                },
                { x: 0, y: 0, z: 0 },
              )
            : measurement.support,
        gravity = this.runtime.world?.gravity || { x: 0, y: -1, z: 0 },
        gravityUp = normalized(
          { x: -gravity.x, y: -gravity.y, z: -gravity.z },
          { x: 0, y: 1, z: 0 },
        ),
        balanceUp = speed <= 0.02 ? gravityUp : measurement.supportNormal,
        footElevations = Object.fromEntries(
          SIDES.map((side) => [
            side,
            dot(footReads[side]?.pose?.position || balanceReference, gravityUp),
          ]),
        ),
        minimumFootElevation = Math.min(footElevations.L, footElevations.R),
        terrainKneeFlex = Object.fromEntries(
          SIDES.map((side) => {
            const kneePosition = this.runtime.part(
                group.roles.get(`knee${side}`),
              )?.pos,
              anklePosition = this.runtime.part(
                group.roles.get(`ankle${side}`),
              )?.pos,
              kneeCoordinate = group.joints.find(
                (entry) =>
                  entry.descriptor.sourcePartId ===
                  group.roles.get(`knee${side}`),
              ),
              maximumFlex = Math.max(
                0,
                Number(kneeCoordinate?.descriptor.limits?.[1] || 0) - 0.06,
              );
            if (!kneePosition || !anklePosition) return [side, 0];
            const lowerLegLength = Math.max(
                0.1,
                Math.hypot(
                  ...kneePosition.map(
                    (value, index) => value - anklePosition[index],
                  ),
                ),
              ),
              requiredShortening = Math.max(
                0,
                footElevations[side] - minimumFootElevation,
              );
            // For a small knee angle q, the lower link's vertical shortening
            // is L*q^2/2. Invert that geometry and clamp it to the authored
            // coordinate range; no terrain class or demo identity is needed.
            return [
              side,
              speed <= 0.02
                ? clamp(
                    Math.sqrt((2 * requiredShortening) / lowerLegLength),
                    0,
                    maximumFlex,
                  )
                : 0,
            ];
          }),
        ),
        stride = clamp(command("stride", 0.5), 0, 1),
        // Remote stride is a normalized intent, not a joint angle. Keeping
        // that conversion here makes the same controller work across limb
        // dimensions without exposing a dangerously literal radian command.
        stepAmplitude = 0.08 + stride * 0.28,
        crouch = clamp(command("crouch", 0), 0, 1),
        balance = command("balance", 1) > 0,
        cycle = speed > 0.02 ? state.gaitCycle || 0 : 0,
        phase = { L: cycle, R: (cycle + 0.5) % 1 },
        plannedSwing =
          phase.L >= 0.08 && phase.L < 0.5
            ? "L"
            : phase.R >= 0.08 && phase.R < 0.5
              ? "R"
              : null,
        stanceSide =
          plannedSwing === "L" ? "R" : plannedSwing === "R" ? "L" : null,
        stanceContact = stanceSide
          ? measurement.contacts[stanceSide === "L" ? "left" : "right"]
          : measurement.contacts.left || measurement.contacts.right,
        swingContactForce = plannedSwing
          ? measurement.contactForces[plannedSwing === "L" ? "left" : "right"]
          : 0,
        totalContactForce =
          measurement.contactForces.left + measurement.contactForces.right,
        swingUnloaded =
          Boolean(plannedSwing) &&
          swingContactForce <= Math.max(5, totalContactForce * 0.35),
        swingMotionStarted =
          Boolean(plannedSwing) && phase[plannedSwing] >= 0.16,
        rootRead = bodyReadModel(bodies, group.roles.get("pelvis")),
        rootUp = normalized(
          rotateVector(rootRead?.pose.quaternion, { x: 0, y: 1, z: 0 }),
        ),
        rootForward = normalized(
          rotateVector(rootRead?.pose.quaternion, { x: 0, y: 0, z: 1 }),
          { x: 0, y: 0, z: 1 },
        ),
        rootRight = normalized(cross(rootUp, rootForward), {
          x: 1,
          y: 0,
          z: 0,
        }),
        jointCoordinateSign = (joint) => {
          const descriptor = joint.descriptor,
            axis = descriptor.axisWorld || descriptor.axis || [1, 0, 0],
            axisDirection = normalized(
              { x: axis[0], y: axis[1], z: axis[2] },
              rootRight,
            ),
            frameSign = dot(axisDirection, rootRight) < 0 ? -1 : 1,
            bodyOrderSign = descriptor.rotorId === descriptor.a ? -1 : 1;
          return frameSign * bodyOrderSign;
        },
        tiltAxis = cross(rootUp, balanceUp),
        tilt = Math.acos(clamp(dot(rootUp, balanceUp), -1, 1)),
        unstable =
          !measurement.contactSamples.length ||
          tilt > 0.62 ||
          measurement.balanceError > 0.38 ||
          measurement.captureError > 0.28,
        committedSwingSide =
          state.committedSwingSide === plannedSwing
            ? plannedSwing
            : swingMotionStarted && swingUnloaded
              ? plannedSwing
              : null,
        swingSide = !unstable && stanceContact ? committedSwingSide : null,
        supportToCom = dot(
          {
            x: measurement.com.x - balanceReference.x,
            y: measurement.com.y - balanceReference.y,
            z: measurement.com.z - balanceReference.z,
          },
          rootForward,
        ),
        forwardVelocity = dot(measurement.velocity, rootForward),
        desiredForwardVelocity = speed * (0.12 + stepAmplitude * 0.65),
        velocityError = desiredForwardVelocity - forwardVelocity,
        recoveryHip = clamp(
          -supportToCom * 0.48 + velocityError * 0.14,
          -0.28,
          0.28,
        ),
        ankleCorrection = balance
          ? clamp(
              // An ankle target rotates the foot relative to the shin; the
              // equal reaction on the supported body is opposite the root
              // correction torque. Keep that sign conversion at the policy
              // boundary instead of hiding it in the generic hinge runtime.
              -tiltAxis.x * 0.9 +
                (measurement.com.z - balanceReference.z) * 0.7 -
                speed * stepAmplitude * 0.08,
              -0.24,
              0.24,
            )
          : 0;
      state.gaitPhase =
        speed <= 0.02
          ? "BALANCE HOLD"
          : unstable
            ? "RECOVERY"
            : plannedSwing && !swingSide
              ? "WEIGHT SHIFT"
              : swingSide
                ? `${swingSide} SWING`
                : "DOUBLE SUPPORT";
      state.swingSide = swingSide;
      state.balanceReference = balanceReference;
      state.balanceUp = balanceUp;
      state.committedSwingSide = committedSwingSide;
      state.stanceSide = stanceContact ? stanceSide : null;
      state.plannedStanceSide = stanceContact ? stanceSide : null;
      for (const side of SIDES) {
        const localPhase = phase[side],
          isSwing = side === swingSide;
        let hip = 0,
          knee = 0.06;
        if (unstable && measurement.contactSamples.length) {
          // With a planted foot, hip torque moves the body over its support
          // polygon and exchanges angular momentum with the ground. This is
          // the physically available recovery path after the reaction wheel
          // approaches saturation; no pose lock or artificial support force
          // is involved.
          hip = recoveryHip;
          knee = 0.1;
        } else if (plannedSwing && !swingSide) {
          // Hold both legs near their load-bearing posture while the measured
          // normal force is transferred to the planned stance foot.
          hip = recoveryHip;
          knee = 0.06;
        } else if (speed > 0.02) {
          if (isSwing) {
            const amount = clamp((localPhase - 0.16) / 0.34, 0, 1),
              smooth = amount * amount * (3 - 2 * amount);
            hip = lerp(-0.08, 0.24, smooth) * stepAmplitude;
            hip += clamp(velocityError * 0.18, -0.08, 0.08);
            knee =
              Math.sin(Math.PI * amount) * (0.38 + stepAmplitude * 0.55) + 0.05;
          } else {
            const progress =
              localPhase >= 0.44
                ? (localPhase - 0.44) / 0.72
                : (localPhase + 0.56) / 0.72;
            hip = lerp(0.17, -0.08, progress) * stepAmplitude;
            hip -= clamp(velocityError * 0.16, -0.07, 0.07);
            knee = 0.05;
          }
        }
        hip -= terrainKneeFlex[side] * 0.5;
        knee += terrainKneeFlex[side];
        const targets = {
          [`hip${side}`]: hip - crouch * 0.16,
          [`knee${side}`]: knee + crouch * 0.5,
          [`ankle${side}`]: clamp(
            -(hip + knee) * 0.72 + ankleCorrection - crouch * 0.18,
            -0.5,
            0.42,
          ),
          [`shoulder${side}`]: -hip * 0.48,
          [`elbow${side}`]: -(0.12 + Math.max(0, -knee - 0.05) * 0.2),
        };
        for (const [role, target] of Object.entries(targets)) {
          const joint = group.joints.find(
            (entry) =>
              this.runtime.part(entry.descriptor.sourcePartId)?.rigRole ===
              role,
          );
          if (joint)
            joint.articulatedTarget = target * jointCoordinateSign(joint);
        }
      }
      const waitingForToeOff =
        plannedSwing && swingMotionStarted && !committedSwingSide;
      state.gaitCycle =
        speed <= 0.02
          ? 0
          : waitingForToeOff
            ? cycle
            : (cycle + dt * (0.67 + speed * 0.42)) % 1;
      if (balance) this.applyGyro(context, group, measurement, rootRead, dt);
    }
    return this.telemetry(context.previousTelemetry?.bodies);
  }

  applyGyro(context, group, measurement, rootRead, dt) {
    if (!measurement.contactSamples.length || !rootRead) return;
    const gyro = this.runtime.part(group.roles.get("reactionWheel")),
      rootId = group.roles.get("pelvis"),
      allocation = gyro && context.powerNetwork?.allocationFor(gyro.id);
    if (!gyro || rootId == null || !allocation?.operational) return;
    const rootUp = normalized(
        rotateVector(rootRead.pose.quaternion, { x: 0, y: 1, z: 0 }),
      ),
      tiltAxis = cross(
        rootUp,
        group.state.balanceUp || measurement.supportNormal,
      ),
      balanceReference = group.state.balanceReference || measurement.support,
      comX = measurement.com.x - balanceReference.x,
      comZ = measurement.com.z - balanceReference.z,
      maxTorque = Math.max(1, Number(gyro.config?.maxTorqueNm || 180)),
      stanceSide = group.state.plannedStanceSide,
      totalContactForce =
        measurement.contactForces.left + measurement.contactForces.right,
      actualLoadDifference =
        measurement.contactForces.right - measurement.contactForces.left,
      targetLoadDifference = stanceSide
        ? (stanceSide === "R" ? 1 : -1) * totalContactForce * 0.76
        : 0,
      leftContactX = measurement.contactSamples
        .filter((sample) => sample.side === "left")
        .reduce(
          (sum, sample, _, entries) => sum + sample.x / entries.length,
          0,
        ),
      rightContactX = measurement.contactSamples
        .filter((sample) => sample.side === "right")
        .reduce(
          (sum, sample, _, entries) => sum + sample.x / entries.length,
          0,
        ),
      supportHalfSpan = Math.max(
        0.08,
        Math.abs(rightContactX - leftContactX) / 2,
      ),
      loadTransferTorque = stanceSide
        ? -(targetLoadDifference - actualLoadDifference) * supportHalfSpan
        : 0,
      desired = {
        x: clamp(
          tiltAxis.x * 520 - rootRead.angularVelocity.x * 72 - comZ * 150,
          -maxTorque,
          maxTorque,
        ),
        z: clamp(
          tiltAxis.z * 520 -
            rootRead.angularVelocity.z * 72 +
            comX * 150 +
            loadTransferTorque,
          -maxTorque,
          maxTorque,
        ),
      },
      requestedW = Math.min(
        allocation.requestedW,
        Math.max(
          5,
          (Math.abs(desired.x * rootRead.angularVelocity.x) +
            Math.abs(desired.z * rootRead.angularVelocity.z)) /
            0.82 +
            (Math.abs(desired.x) + Math.abs(desired.z)) * 0.8,
        ),
      ),
      deliveredW = context.powerNetwork.drawPower(gyro.id, requestedW, dt),
      delivery = requestedW > 0 ? deliveredW / requestedW : 0,
      momentumCapacity = Math.max(
        5,
        Number(gyro.config?.momentumCapacityNms || 90),
      );
    group.state.gyroMomentumCapacityNms = momentumCapacity;
    for (const axis of ["x", "z"]) {
      let torque = desired[axis] * delivery,
        nextMomentum = group.state.gyroMomentum[axis] - torque * dt;
      if (Math.abs(nextMomentum) > momentumCapacity) {
        const available =
          momentumCapacity - Math.abs(group.state.gyroMomentum[axis]);
        torque =
          (Math.sign(torque) * Math.max(0, available)) / Math.max(dt, 1e-9);
        nextMomentum = clamp(nextMomentum, -momentumCapacity, momentumCapacity);
      }
      this.runtime.applyBodyTorque(gyro.id, {
        x: axis === "x" ? torque : 0,
        y: 0,
        z: axis === "z" ? torque : 0,
      });
      group.state.gyroMomentum[axis] = nextMomentum;
    }
  }

  afterIntegration(context, dt) {
    this.rebuild(context);
    const bodies = context.bodyRegistry.snapshot();
    for (const group of this.groups) {
      const measurement = this.measure(group, bodies),
        state = group.state,
        rootId = group.roles.get("pelvis") || [...group.bodyIds][0],
        root = bodyReadModel(bodies, rootId),
        rootUp = normalized(
          rotateVector(root?.pose.quaternion, { x: 0, y: 1, z: 0 }),
        );
      state.measurement = measurement;
      if (!state.initialRootPosition && root) {
        state.initialRootPosition = { ...root.pose.position };
        const lowest = Math.min(
          ...[...group.bodyIds].map((id) => {
            const body = bodyReadModel(bodies, id),
              descriptor = this.runtime.compiled.bodies.find(
                (candidate) => candidate.partId === id,
              ),
              height =
                boundsDimensions(descriptor?.geometry?.bodyBoundsPartM)[1] || 0;
            return (body?.pose.position.y || 0) - height / 2;
          }),
        );
        state.nominalRootClearance = Math.max(
          0.2,
          root.pose.position.y - lowest,
        );
      }
      state.airborneTime = measurement.contactSamples.length
        ? 0
        : state.airborneTime + dt;
      const supportHeight = measurement.contactSamples.length
          ? measurement.support.y
          : state.initialRootPosition?.y - state.nominalRootClearance,
        rootClearance = (root?.pose.position.y || 0) - supportHeight,
        tipped = dot(rootUp, measurement.supportNormal) < Math.cos(1.05),
        collapsed = rootClearance < state.nominalRootClearance * 0.48;
      state.fallen =
        !group.locomotionAvailable ||
        tipped ||
        collapsed ||
        state.airborneTime > 0.7;
    }
    this.lastTelemetry = this.telemetry(bodies);
    return this.lastTelemetry;
  }

  telemetry(bodies) {
    const mechanism = this.runtime.telemetry(),
      groups = this.groups.map((group) => {
        const state = group.state,
          measurement = state.measurement || this.measure(group, bodies),
          rootId = group.roles.get("pelvis") || [...group.bodyIds][0],
          root = bodyReadModel(bodies, rootId),
          initial = state.initialRootPosition ||
            root?.pose.position || {
              z: 0,
            };
        return {
          id: group.id,
          partIds: [...group.partIds],
          mode: group.locomotionAvailable
            ? "role-assisted-locomotion"
            : group.locomotionExpected
              ? "incomplete-locomotion"
              : "joint-control",
          locomotionAvailable: group.locomotionAvailable,
          validationErrors: [...group.validationErrors],
          gaitPhase: state.gaitPhase,
          inputTick: state.inputTick,
          swingSide: state.swingSide || null,
          stanceSide: state.stanceSide || null,
          forwardDistance: (root?.pose.position.z || 0) - (initial.z || 0),
          airborneTime: state.airborneTime || 0,
          com: measurement.com,
          pelvis: root?.pose.position || measurement.com,
          contacts: measurement.contacts,
          supportPolygon: measurement.supportPolygon.map(plainVector),
          supportNormal: measurement.supportNormal,
          balanceError: measurement.balanceError,
          capturePoint: measurement.capturePoint,
          captureError: measurement.captureError,
          fallen: Boolean(state.fallen),
          gyroMomentum: { ...state.gyroMomentum },
          gyroMomentumCapacityNms:
            state.gyroMomentumCapacityNms == null
              ? null
              : state.gyroMomentumCapacityNms,
          roles: Object.fromEntries(group.roles),
          joints: group.joints.map((entry) => ({
            name:
              this.runtime.part(entry.descriptor.sourcePartId)?.rigRole ||
              `joint-${String(entry.descriptor.sourcePartId)}`,
            partId: entry.descriptor.sourcePartId,
            angle: entry.angle,
            target: entry.articulatedTarget ?? 0,
            torque: entry.reactionTorque,
          })),
        };
      }),
      primary =
        groups.find((group) => group.locomotionAvailable) || groups[0] || null,
      poses = mechanism?.poses || [];
    if (!primary)
      return {
        active: false,
        groups: [],
        articulations: [],
        poses,
        joints: [],
      };
    const leftBody = bodyReadModel(bodies, primary.roles.footL),
      rightBody = bodyReadModel(bodies, primary.roles.footR),
      footRecord = (body, partId) => {
        if (!body) return { y: 0, z: 0, toeZ: 0 };
        const descriptor = this.runtime.compiled.bodies.find(
            (candidate) => candidate.partId === partId,
          ),
          halfLength =
            (boundsDimensions(descriptor?.geometry?.bodyBoundsPartM)[2] || 0) /
            2,
          orientation = new CANNON.Quaternion(
            body.pose.quaternion.x,
            body.pose.quaternion.y,
            body.pose.quaternion.z,
            body.pose.quaternion.w,
          ),
          toe = orientation.vmult(new CANNON.Vec3(0, 0, halfLength));
        return {
          y: body.pose.position.y,
          z: body.pose.position.z,
          toeZ: body.pose.position.z + toe.z,
        };
      };
    return {
      active: true,
      groups,
      articulations: groups,
      gaitPhase: primary.gaitPhase,
      swingSide: primary.swingSide,
      stanceSide: primary.stanceSide,
      forwardDistance: primary.forwardDistance,
      airborneTime: primary.airborneTime,
      com: primary.com,
      pelvis: primary.pelvis,
      feet: {
        left: footRecord(leftBody, primary.roles.footL),
        right: footRecord(rightBody, primary.roles.footR),
      },
      contacts: primary.contacts,
      supportPolygon: primary.supportPolygon,
      supportNormal: primary.supportNormal,
      balanceError: primary.balanceError,
      capturePoint: primary.capturePoint,
      captureError: primary.captureError,
      fallen: primary.fallen,
      joints: primary.joints,
      poses,
    };
  }

  dispose() {
    for (const entry of this.runtime?.constraintEntries || [])
      entry.articulatedTarget = null;
    this.groups = [];
    this.stateByGroup.clear();
    this.topologyKey = "";
    this.lastTelemetry = null;
  }
}
