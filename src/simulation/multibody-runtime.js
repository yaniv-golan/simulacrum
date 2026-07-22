import * as CANNON from "cannon-es";
import { readActuatorCommand } from "../model/actuator-contracts.js";
import { compileAssembly } from "../model/assembly-compiler.js";
import { DomainValidationError } from "../model/primitives.js";
import { CannonWorldAdapter } from "./cannon-world-adapter.js";
import {
  applyAxialForce,
  AxialLimitConstraint,
  axialState,
  damperResponse,
  forceSpeedCapacity,
  mechanismClamp,
  PrismaticConstraint,
  springResponse,
  stopResponse,
} from "./two-frame-mechanisms.js";
import { TireContactConstraint } from "./tire-contact.js";

class CollisionExclusionConstraint extends CANNON.Constraint {
  update() {}
}

const COORDINATE_KINDS = new Set([
  "revolute",
  "linear-guide",
  "linear-actuator",
]);
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const plainVector = (value) => ({ x: value.x, y: value.y, z: value.z });
const plainQuaternion = (value) => ({
  x: value.x,
  y: value.y,
  z: value.z,
  w: value.w,
});

function cannonVector(value) {
  return new CANNON.Vec3(value[0], value[1], value[2]);
}

function cannonQuaternion(orientation) {
  return new CANNON.Quaternion(...orientation);
}

function quaternionFromPrincipalAxes(axes) {
  const matrix = [
      [axes[0][0], axes[1][0], axes[2][0]],
      [axes[0][1], axes[1][1], axes[2][1]],
      [axes[0][2], axes[1][2], axes[2][2]],
    ],
    trace = matrix[0][0] + matrix[1][1] + matrix[2][2];
  let x, y, z, w;
  if (trace > 0) {
    const scale = Math.sqrt(trace + 1) * 2;
    w = scale / 4;
    x = (matrix[2][1] - matrix[1][2]) / scale;
    y = (matrix[0][2] - matrix[2][0]) / scale;
    z = (matrix[1][0] - matrix[0][1]) / scale;
  } else if (matrix[0][0] > matrix[1][1] && matrix[0][0] > matrix[2][2]) {
    const scale = Math.sqrt(1 + matrix[0][0] - matrix[1][1] - matrix[2][2]) * 2;
    w = (matrix[2][1] - matrix[1][2]) / scale;
    x = scale / 4;
    y = (matrix[0][1] + matrix[1][0]) / scale;
    z = (matrix[0][2] + matrix[2][0]) / scale;
  } else if (matrix[1][1] > matrix[2][2]) {
    const scale = Math.sqrt(1 + matrix[1][1] - matrix[0][0] - matrix[2][2]) * 2;
    w = (matrix[0][2] - matrix[2][0]) / scale;
    x = (matrix[0][1] + matrix[1][0]) / scale;
    y = scale / 4;
    z = (matrix[1][2] + matrix[2][1]) / scale;
  } else {
    const scale = Math.sqrt(1 + matrix[2][2] - matrix[0][0] - matrix[1][1]) * 2;
    w = (matrix[1][0] - matrix[0][1]) / scale;
    x = (matrix[0][2] + matrix[2][0]) / scale;
    y = (matrix[1][2] + matrix[2][1]) / scale;
    z = scale / 4;
  }
  const quaternion = new CANNON.Quaternion(x, y, z, w);
  quaternion.normalize();
  return quaternion;
}

function physicsFrame(descriptor) {
  const partToWorld = cannonQuaternion(descriptor.orientation),
    principalToPart = quaternionFromPrincipalAxes(
      descriptor.massProperties.principalAxesPart,
    ),
    partToPrincipal = principalToPart.conjugate(new CANNON.Quaternion()),
    bodyToWorld = partToWorld.mult(principalToPart, new CANNON.Quaternion()),
    comPart = cannonVector(descriptor.massProperties.comPositionPartM),
    position = partToWorld
      .vmult(comPart)
      .vadd(cannonVector(descriptor.position));
  return {
    partToWorld,
    principalToPart,
    partToPrincipal,
    bodyToWorld,
    comPart,
    position,
  };
}

function partFrame(body) {
  const frame = body.userData.massFrame,
    principalToPartInverse = frame.principalToPart.conjugate(
      new CANNON.Quaternion(),
    ),
    quaternion = body.quaternion.mult(
      principalToPartInverse,
      new CANNON.Quaternion(),
    ),
    comOffsetWorld = quaternion.vmult(frame.comPart),
    position = body.position.vsub(comOffsetWorld),
    originOffset = position.vsub(body.position),
    velocity = body.angularVelocity.cross(originOffset).vadd(body.velocity);
  return { position, quaternion, velocity };
}

function partWorldAxis(body, partLocalAxis) {
  return partFrame(body).quaternion.vmult(partLocalAxis);
}

function uniqueUndirectedAxes(vectors) {
  const unique = [];
  for (const vector of vectors) {
    const candidate = vector.unit(new CANNON.Vec3());
    if (
      unique.some((existing) => Math.abs(existing.dot(candidate)) >= 1 - 1e-7)
    )
      continue;
    unique.push(candidate);
  }
  return unique;
}

function roundedWheelShape({ radiusM, widthM, shoulderRadiusM }) {
  // The production tire law derives radial compliance, friction and semantic
  // tread/shoulder/sidewall regions from the solved manifold. The convex hull
  // supplies that manifold: 32 circumferential tread facets preserve the
  // validated curb/gap/rock response, while two convex shoulder facets per
  // side retain a rounded load path at large terrain height discontinuities.
  // Shoulder rings step down to 16 and then 8 vertices as their radius shrinks;
  // the exact 2:1 triangulation preserves a closed convex surface without
  // spending tread-level resolution on the nearly axial caps. Cannon's generic
  // hull setup retains antiparallel duplicates, although SAT axes are
  // undirected; canonicalizing those exact axes removes work without changing
  // the collision surface. The obstacle, sidewall and platform-edge sweeps
  // guard these behaviors.
  const circumferenceSegments = 32,
    shoulderAngles = [0, Math.PI / 6, Math.PI / 2],
    halfWidth = widthM / 2,
    shoulder = Math.min(shoulderRadiusM, halfWidth * 0.95, radiusM * 0.95),
    straightHalfWidth = halfWidth - shoulder,
    axialRings = [];
  for (let index = shoulderAngles.length - 1; index >= 0; index--) {
    const angle = shoulderAngles[index];
    axialRings.push({
      z: -straightHalfWidth - shoulder * Math.sin(angle),
      radius: radiusM - shoulder + shoulder * Math.cos(angle),
    });
  }
  axialRings.push({ z: straightHalfWidth, radius: radiusM });
  for (let index = 1; index < shoulderAngles.length; index++) {
    const angle = shoulderAngles[index];
    axialRings.push({
      z: straightHalfWidth + shoulder * Math.sin(angle),
      radius: radiusM - shoulder + shoulder * Math.cos(angle),
    });
  }
  const collisionRings = axialRings.map((ring, index) => ({
      ...ring,
      segments:
        index === 0 || index === axialRings.length - 1
          ? circumferenceSegments / 4
          : index === 1 || index === axialRings.length - 2
            ? circumferenceSegments / 2
            : circumferenceSegments,
    })),
    vertices = collisionRings.flatMap((ring) =>
      Array.from({ length: ring.segments }, (_, index) => {
        const angle = (index / ring.segments) * Math.PI * 2;
        return new CANNON.Vec3(
          ring.radius * Math.cos(angle),
          ring.radius * Math.sin(angle),
          ring.z,
        );
      }),
    ),
    faces = [];
  let lowerOffset = 0;
  for (let ring = 0; ring < collisionRings.length - 1; ring++) {
    const lowerSegments = collisionRings[ring].segments,
      upperSegments = collisionRings[ring + 1].segments,
      upperOffset = lowerOffset + lowerSegments;
    if (lowerSegments === upperSegments)
      for (let index = 0; index < lowerSegments; index++) {
        const next = (index + 1) % lowerSegments;
        faces.push([
          lowerOffset + index,
          lowerOffset + next,
          upperOffset + next,
          upperOffset + index,
        ]);
      }
    else if (upperSegments === lowerSegments * 2)
      for (let index = 0; index < lowerSegments; index++) {
        const lower = lowerOffset + index,
          lowerNext = lowerOffset + ((index + 1) % lowerSegments),
          upper = upperOffset + index * 2,
          upperMiddle = upperOffset + ((index * 2 + 1) % upperSegments),
          upperNext = upperOffset + ((index * 2 + 2) % upperSegments);
        faces.push(
          [lower, lowerNext, upperNext],
          [lower, upperNext, upperMiddle],
          [lower, upperMiddle, upper],
        );
      }
    else if (lowerSegments === upperSegments * 2)
      for (let index = 0; index < upperSegments; index++) {
        const lower = lowerOffset + index * 2,
          lowerMiddle = lowerOffset + ((index * 2 + 1) % lowerSegments),
          lowerNext = lowerOffset + ((index * 2 + 2) % lowerSegments),
          upper = upperOffset + index,
          upperNext = upperOffset + ((index + 1) % upperSegments);
        faces.push(
          [upper, lower, lowerMiddle],
          [upper, lowerMiddle, lowerNext],
          [upper, lowerNext, upperNext],
        );
      }
    else
      throw new Error(
        "Rounded wheel collision rings must have equal or 2:1 segment counts",
      );
    lowerOffset = upperOffset;
  }
  const firstRingSegments = collisionRings[0].segments,
    lastRingSegments = collisionRings.at(-1).segments,
    lastRingOffset = vertices.length - lastRingSegments;
  faces.push(
    Array.from(
      { length: firstRingSegments },
      (_, index) => firstRingSegments - 1 - index,
    ),
    Array.from(
      { length: lastRingSegments },
      (_, index) => lastRingOffset + index,
    ),
  );
  const shape = new CANNON.ConvexPolyhedron({ vertices, faces });
  shape.uniqueAxes = uniqueUndirectedAxes(shape.faceNormals);
  shape.uniqueEdges = uniqueUndirectedAxes(shape.uniqueEdges);
  return shape;
}

function primitiveOrientationPart(descriptor) {
  if (descriptor.kind === "cylinder") {
    const axisOrientation = new CANNON.Quaternion();
    // Cannon.Cylinder is authored around local Y. The rounded-wheel hull above
    // is authored around the canonical mechanism +Z axle and therefore must
    // not inherit the cylinder adapter's Y-to-Z correction.
    if (!descriptor.roundedWheel) {
      if (descriptor.axis[0] === 1)
        axisOrientation.setFromEuler(0, 0, Math.PI / 2);
      else if (descriptor.axis[2] === 1)
        axisOrientation.setFromEuler(Math.PI / 2, 0, 0);
    }
    return Array.isArray(descriptor.orientation)
      ? cannonQuaternion(descriptor.orientation).mult(
          axisOrientation,
          new CANNON.Quaternion(),
        )
      : axisOrientation;
  }
  return Array.isArray(descriptor.orientation)
    ? cannonQuaternion(descriptor.orientation)
    : new CANNON.Quaternion();
}

function shapeFrame(descriptor, frame) {
  const orientationPart = primitiveOrientationPart(descriptor),
    offsetPart = cannonVector(descriptor.position || [0, 0, 0]).vsub(
      frame.comPart,
    );
  return {
    orientation: frame.partToPrincipal.mult(
      orientationPart,
      new CANNON.Quaternion(),
    ),
    offset: frame.partToPrincipal.vmult(offsetPart),
  };
}

function shapeAndOrientation(descriptor, frame) {
  let shape;
  if (descriptor.kind === "cylinder")
    shape = descriptor.roundedWheel
      ? roundedWheelShape(descriptor.roundedWheel)
      : new CANNON.Cylinder(
          descriptor.radius,
          descriptor.radius,
          descriptor.length,
          20,
        );
  else
    shape = new CANNON.Box(
      new CANNON.Vec3(
        descriptor.size[0] * 0.5,
        descriptor.size[1] * 0.5,
        descriptor.size[2] * 0.5,
      ),
    );
  const runtimeShape = /** @type {any} */ (shape);
  runtimeShape.userData = {
    semanticKey: descriptor.semanticKey || null,
    materialKey: descriptor.materialKey || "generic-structure",
    contactRole: descriptor.contactRole || "structure",
    semanticRegions: descriptor.semanticRegions
      ? structuredClone(descriptor.semanticRegions)
      : Object.freeze([]),
    geometryKind: descriptor.roundedWheel
      ? "rounded-wheel-v1"
      : descriptor.kind,
  };
  return { shape, ...shapeFrame(descriptor, frame) };
}

function partPoseForFrame(position, quaternion, massFrame) {
  const inversePrincipal = massFrame.principalToPart.conjugate(
      new CANNON.Quaternion(),
    ),
    partQuaternion = quaternion.mult(inversePrincipal, new CANNON.Quaternion()),
    comWorld = partQuaternion.vmult(massFrame.comPart),
    partPosition = position.vsub(comWorld);
  return { position: partPosition, quaternion: partQuaternion };
}

function writePrincipalPose(partPose, frame, position, quaternion) {
  partPose.quaternion.mult(frame.principalToPart, quaternion);
  const comWorld = partPose.quaternion.vmult(frame.comPart);
  partPose.position.vadd(comWorld, position);
}

function captureFixedConstraintFrame(entry) {
  const constraint = entry.constraint,
    bodyA = constraint.bodyA,
    bodyB = constraint.bodyB,
    point = (body, value) => body.pointToWorldFrame(value, new CANNON.Vec3()),
    vector = (body, value) => body.vectorToWorldFrame(value, new CANNON.Vec3());
  return {
    entry,
    points: {
      pivotA: point(bodyA, constraint.pivotA),
      pivotB: point(bodyB, constraint.pivotB),
    },
    vectors: {
      xA: vector(bodyA, constraint.xA),
      yA: vector(bodyA, constraint.yA),
      zA: vector(bodyA, constraint.zA),
      xB: vector(bodyB, constraint.xB),
      yB: vector(bodyB, constraint.yB),
      zB: vector(bodyB, constraint.zB),
    },
  };
}

function restoreFixedConstraintFrame(snapshot) {
  const constraint = snapshot.entry.constraint,
    bodyA = constraint.bodyA,
    bodyB = constraint.bodyB;
  bodyA.pointToLocalFrame(snapshot.points.pivotA, constraint.pivotA);
  bodyB.pointToLocalFrame(snapshot.points.pivotB, constraint.pivotB);
  for (const field of ["xA", "yA", "zA"])
    bodyA.vectorToLocalFrame(snapshot.vectors[field], constraint[field]);
  for (const field of ["xB", "yB", "zB"])
    bodyB.vectorToLocalFrame(snapshot.vectors[field], constraint[field]);
}

function localAxis(body, worldAxis) {
  return body.quaternion.conjugate(new CANNON.Quaternion()).vmult(worldAxis);
}

function signedAngleVelocity(body, localAxisValue) {
  const axis = partWorldAxis(body, localAxisValue);
  axis.normalize();
  return body.angularVelocity.dot(axis);
}

function perpendicularReference(axis) {
  const seed =
      Math.abs(axis.y) < 0.8
        ? new CANNON.Vec3(0, 1, 0)
        : new CANNON.Vec3(1, 0, 0),
    reference = axis.cross(seed);
  reference.normalize();
  return reference;
}

function updateRevoluteMeasurement(entry, bodyA, bodyB) {
  const axis = bodyA.quaternion.vmult(entry.axisA),
    referenceA = bodyA.quaternion.vmult(entry.referenceA),
    referenceB = bodyB.quaternion.vmult(entry.referenceB),
    crossed = referenceA.cross(referenceB);
  axis.normalize();
  referenceA.normalize();
  referenceB.normalize();
  const raw = Math.atan2(axis.dot(crossed), referenceA.dot(referenceB)),
    previousRaw = entry.rawAngle ?? raw;
  let delta = raw - previousRaw;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  entry.angle = (entry.angle || 0) + delta;
  entry.rawAngle = raw;
  entry.velocity =
    signedAngleVelocity(bodyB, entry.axisB) -
    signedAngleVelocity(bodyA, entry.axisA);
  return entry.angle;
}

function mean(values, fallback = 0) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : fallback;
}

// Cannon's Equation.minForce/maxForce names are misleading: GSSolver clamps
// lambda in impulse units and exposes multiplier=lambda/dt afterward. Keep the
// conversion at this engine boundary so model/runtime contracts remain SI.
function solverImpulseLimit(rate, dt) {
  return Math.abs(rate) * dt;
}

function solvedConstraintReaction(constraint) {
  let forceSquared = 0,
    torqueSquared = 0;
  for (const equation of constraint.equations) {
    if (!equation.enabled) continue;
    const reaction = Number(equation.multiplier || 0),
      rotational =
        equation instanceof CANNON.RotationalEquation ||
        equation instanceof CANNON.RotationalMotorEquation;
    if (rotational) torqueSquared += reaction * reaction;
    else forceSquared += reaction * reaction;
  }
  return {
    forceN: Math.sqrt(forceSquared),
    torqueNm: Math.sqrt(torqueSquared),
  };
}

function activeFixedCluster(constraintEntries, seed) {
  const cluster = new Set([seed]),
    pending = [seed];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of constraintEntries) {
      if (entry.active === false || entry.descriptor.kind !== "fixed") continue;
      const { a, b } = entry.descriptor;
      if (a !== current && b !== current) continue;
      const neighbor = a === current ? b : a;
      if (cluster.has(neighbor)) continue;
      cluster.add(neighbor);
      pending.push(neighbor);
    }
  }
  return cluster;
}

function collisionExclusionRequired(constraintEntries, descriptor) {
  const leftCluster = activeFixedCluster(constraintEntries, descriptor.a);
  if (leftCluster.has(descriptor.b)) return true;
  const rightCluster = activeFixedCluster(constraintEntries, descriptor.b);
  return constraintEntries.some((entry) => {
    if (entry.active === false || !COORDINATE_KINDS.has(entry.descriptor.kind))
      return false;
    const { a, b } = entry.descriptor;
    return (
      (leftCluster.has(a) && rightCluster.has(b)) ||
      (leftCluster.has(b) && rightCluster.has(a))
    );
  });
}

/**
 * Cannon adapter for an engine-neutral compiled assembly. It owns one body
 * registry and one set of constraints for any construction topology.
 */
export class MultibodyRuntime {
  constructor({
    world,
    worldAdapter = new CannonWorldAdapter(world),
    material,
    catalog = {},
    fixedDt = 1 / 120,
    surfaceHeightAt = () => 0,
    terrainHeightAt = surfaceHeightAt,
    pondAt = (_x = 0, _z = 0) => null,
    waterDensity = 1000,
    groundBody = null,
    fieldBody = null,
    materialForPart = null,
  }) {
    this.world = world;
    this.worldAdapter = worldAdapter;
    this.material = material;
    this.catalog = /** @type {any} */ (catalog);
    this.fixedDt = fixedDt;
    this.surfaceHeightAt = surfaceHeightAt;
    this.terrainHeightAt = terrainHeightAt;
    this.pondAt = pondAt;
    this.waterDensity = waterDensity;
    this.groundBody = groundBody;
    this.fieldBody = fieldBody;
    this.materialForPart = materialForPart;
    this.compiled = null;
    this.bodyByPart = new Map();
    this.constraintEntries = [];
    this.collisionExclusionConstraints = [];
    this.phaseByPart = new Map();
    this.loadByConnection = new Map();
    this.torqueByConnection = new Map();
    this.motorElectricalWByPart = new Map();
    this.lastTelemetry = null;
    this.activeLuminairePartIds = [];
    this.fluidState = null;
    this.topologyRevision = 0;
  }

  start(snapshot) {
    this.dispose();
    this.compiled = compileAssembly(snapshot, this.catalog);
    for (const descriptor of this.compiled.bodies) {
      const part = this.part(descriptor.partId),
        frame = physicsFrame(descriptor),
        bodyMaterial =
          this.materialForPart?.(part, descriptor) || this.material;
      const body = new CANNON.Body({
        mass: descriptor.mass,
        material: bodyMaterial,
        position: frame.position,
        quaternion: frame.bodyToWorld,
      });
      for (const primitive of descriptor.geometry.collisionPrimitives) {
        const { shape, offset, orientation } = shapeAndOrientation(
          primitive,
          frame,
        );
        body.addShape(shape, offset, orientation || undefined);
      }
      const [ix, iy, iz] = descriptor.massProperties.principalMomentsKgM2;
      body.inertia.set(ix, iy, iz);
      body.invInertia.set(1 / ix, 1 / iy, 1 / iz);
      body.updateInertiaWorld(true);
      body.linearDamping = descriptor.linearDamping;
      body.angularDamping = descriptor.angularDamping;
      body.allowSleep = false;
      body.collisionFilterGroup = 8;
      // Compiled bodies collide with the environment and with other compiled
      // bodies. Authored constraint topology supplies only the pair-specific
      // exclusions required for rigid clusters and adjacent coordinates.
      body.collisionFilterMask = 1 | 8;
      const runtimeBody = /** @type {any} */ (body);
      runtimeBody.userData = {
        ...(runtimeBody.userData || {}),
        partId: descriptor.partId,
        massFrame: {
          principalToPart: frame.principalToPart,
          comPart: frame.comPart,
        },
        massProperties: structuredClone(descriptor.massProperties),
      };
      this.world.addBody(body);
      this.bodyByPart.set(descriptor.partId, body);
      this.phaseByPart.set(descriptor.partId, 0);
    }
    for (const descriptor of this.compiled.constraints)
      this.createConstraint(descriptor);
    const supportBody =
      this.groundBody ||
      this.fieldBody ||
      this.world.bodies.find((body) => body.type === CANNON.Body.STATIC);
    if (supportBody)
      for (const descriptor of this.compiled.contactRegions || []) {
        if (descriptor.kind !== "rolling-contact-v1") continue;
        const body = this.bodyByPart.get(descriptor.sourcePartId);
        if (!body) continue;
        const constraint = new TireContactConstraint(
          this.world,
          body,
          supportBody,
          descriptor,
          this.fixedDt,
        );
        this.world.addConstraint(constraint);
        this.constraintEntries.push({
          descriptor: {
            ...descriptor,
            kind: "rolling-contact",
            sourceConnectionIds: [],
          },
          kind: "rolling-contact-v1",
          constraint,
        });
      }
    for (const descriptor of this.compiled.collisionExclusions) {
      const bodyA = this.bodyByPart.get(descriptor.a),
        bodyB = this.bodyByPart.get(descriptor.b);
      if (!bodyA || !bodyB) continue;
      const constraint = new CollisionExclusionConstraint(bodyA, bodyB, {
        collideConnected: false,
        wakeUpBodies: false,
      });
      this.world.addConstraint(constraint);
      this.collisionExclusionConstraints.push({
        descriptor,
        constraint,
        active: true,
      });
    }
    this.lastTelemetry = this.telemetry();
    return this.lastTelemetry;
  }

  /**
   * Atomically replaces compiled mass frames while preserving every authored
   * part pose, point velocity, collision primitive, and fixed-constraint frame.
   */
  commitMassProperties(records) {
    if (!this.compiled || !Array.isArray(records))
      throw new DomainValidationError(
        "INVALID_MASS_PROPERTY_TRANSACTION",
        "Mass-property commit requires a running multibody runtime and records",
      );
    const byPart = new Map();
    for (const [index, record] of records.entries()) {
      if (record?.partId == null || byPart.has(record.partId))
        throw new DomainValidationError(
          "INVALID_MASS_PROPERTY_TRANSACTION",
          "Mass-property commit part IDs must be present and unique",
          { path: ["records", index, "partId"] },
        );
      const body = this.bodyByPart.get(record.partId),
        descriptor = this.compiled.bodies.find(
          (candidate) => candidate.partId === record.partId,
        ),
        properties = record.massProperties;
      if (
        !body ||
        !descriptor ||
        !Number.isFinite(properties?.massKg) ||
        properties.massKg <= 0 ||
        !Array.isArray(properties.comPositionPartM) ||
        properties.comPositionPartM.length !== 3 ||
        properties.comPositionPartM.some((value) => !Number.isFinite(value)) ||
        !Array.isArray(properties.principalMomentsKgM2) ||
        properties.principalMomentsKgM2.length !== 3 ||
        properties.principalMomentsKgM2.some(
          (value) => !Number.isFinite(value) || value <= 0,
        ) ||
        body.shapes.length !== descriptor.geometry.collisionPrimitives.length
      )
        throw new DomainValidationError(
          "INVALID_MASS_PROPERTIES",
          `Part ${String(record.partId)} has invalid dynamic mass properties`,
          { path: ["records", index, "massProperties"] },
        );
      byPart.set(record.partId, { body, descriptor, properties });
    }
    const affectedPartIds = new Set(byPart.keys()),
      affectedEntries = this.constraintEntries.filter(
        (entry) =>
          entry.constraint &&
          (affectedPartIds.has(entry.descriptor.a) ||
            affectedPartIds.has(entry.descriptor.b)),
      );
    for (const entry of affectedEntries)
      if (entry.descriptor.kind !== "fixed")
        throw new DomainValidationError(
          "DYNAMIC_MASS_CONSTRAINT_UNSUPPORTED",
          `Dynamic mass part participates in unsupported ${entry.descriptor.kind} constraint ${String(entry.descriptor.id)}`,
          { details: { descriptor: entry.descriptor } },
        );
    const constraintFrames = affectedEntries.map(captureFixedConstraintFrame),
      committed = [];
    for (const [partId, { body, descriptor, properties }] of byPart) {
      const oldFrame = body.userData.massFrame,
        currentPose = partPoseForFrame(
          body.position,
          body.quaternion,
          oldFrame,
        ),
        previousPose = partPoseForFrame(
          body.previousPosition,
          body.previousQuaternion,
          oldFrame,
        ),
        interpolatedPose = partPoseForFrame(
          body.interpolatedPosition,
          body.interpolatedQuaternion,
          oldFrame,
        ),
        originOffset = currentPose.position.vsub(body.position),
        originVelocity = body.angularVelocity
          .cross(originOffset, new CANNON.Vec3())
          .vadd(body.velocity),
        frame = physicsFrame({ ...descriptor, massProperties: properties }),
        previousMassKg = body.mass,
        oldComPosition = body.position.clone();
      writePrincipalPose(currentPose, frame, body.position, body.quaternion);
      writePrincipalPose(
        previousPose,
        frame,
        body.previousPosition,
        body.previousQuaternion,
      );
      writePrincipalPose(
        interpolatedPose,
        frame,
        body.interpolatedPosition,
        body.interpolatedQuaternion,
      );
      const newComOffset = body.position.vsub(currentPose.position);
      body.angularVelocity
        .cross(newComOffset, body.velocity)
        .vadd(originVelocity, body.velocity);
      const torqueShift = oldComPosition
        .vsub(body.position)
        .cross(body.force, new CANNON.Vec3());
      body.torque.vadd(torqueShift, body.torque);
      body.mass = properties.massKg;
      body.invMass = 1 / properties.massKg;
      body.inertia.set(...properties.principalMomentsKgM2);
      body.invInertia.set(
        ...properties.principalMomentsKgM2.map((value) => 1 / value),
      );
      body.userData.massFrame = {
        principalToPart: frame.principalToPart,
        comPart: frame.comPart,
      };
      body.userData.massProperties = structuredClone(properties);
      for (
        let index = 0;
        index < descriptor.geometry.collisionPrimitives.length;
        index++
      ) {
        const primitiveFrame = shapeFrame(
          descriptor.geometry.collisionPrimitives[index],
          frame,
        );
        body.shapeOffsets[index].copy(primitiveFrame.offset);
        body.shapeOrientations[index].copy(primitiveFrame.orientation);
      }
      body.updateBoundingRadius();
      body.aabbNeedsUpdate = true;
      body.updateAABB();
      body.updateInertiaWorld(true);
      body.updateSolveMassProperties();
      committed.push({
        partId,
        previousMassKg,
        massKg: properties.massKg,
        massDeltaKg: properties.massKg - previousMassKg,
        comPositionPartM: [...properties.comPositionPartM],
        principalMomentsKgM2: [...properties.principalMomentsKgM2],
        sourceKind: properties.sourceKind,
      });
    }
    for (const frame of constraintFrames) restoreFixedConstraintFrame(frame);
    return committed;
  }

  createConstraint(descriptor) {
    const bodyA = this.bodyByPart.get(descriptor.a),
      bodyB = this.bodyByPart.get(descriptor.b);
    if (descriptor.kind === "measurement") {
      this.constraintEntries.push({ descriptor, kind: "measurement" });
      return;
    }
    if (!bodyA || !bodyB) return;
    if (descriptor.kind === "fixed") {
      const constraint = new CANNON.LockConstraint(bodyA, bodyB, {
        // Keep the numerical solver ceiling above the material limit. The
        // structure system must observe the demanded reaction and decide when
        // an attachment fails; clipping at breakForce hides impact overloads.
        maxForce: solverImpulseLimit(
          Math.max(1, descriptor.breakForce || 24000) * 100,
          this.fixedDt,
        ),
      });
      constraint.collideConnected = false;
      this.world.addConstraint(constraint);
      this.constraintEntries.push({ descriptor, constraint });
      return;
    }
    if (descriptor.kind === "revolute") {
      const anchor = cannonVector(descriptor.anchor),
        rotorBody = this.bodyByPart.get(descriptor.rotorId) || bodyB,
        rotorLocalAxis = cannonVector(descriptor.axis),
        worldAxis = descriptor.axisWorld
          ? cannonVector(descriptor.axisWorld)
          : partWorldAxis(rotorBody, rotorLocalAxis);
      worldAxis.normalize();
      const worldReference = perpendicularReference(worldAxis),
        axisA = localAxis(bodyA, worldAxis),
        axisB = localAxis(bodyB, worldAxis),
        referenceA = localAxis(bodyA, worldReference),
        referenceB = localAxis(bodyB, worldReference);
      const constraint = new CANNON.HingeConstraint(bodyA, bodyB, {
        pivotA: bodyA.pointToLocalFrame(anchor),
        pivotB: bodyB.pointToLocalFrame(anchor),
        axisA,
        axisB,
        // The hinge equations keep both bodies attached; their force ceiling
        // is a structural property. Actuator torque is bounded independently
        // on the motor equation below. Conflating the two lets a heavy limb
        // pull its pivot apart merely because its servo is modestly rated.
        maxForce: solverImpulseLimit(
          Math.max(1, descriptor.breakForce || 24000) * 100,
          this.fixedDt,
        ),
        collideConnected: false,
      });
      this.world.addConstraint(constraint);
      this.constraintEntries.push({
        descriptor,
        constraint,
        axisA,
        axisB,
        referenceA,
        referenceB,
        angle: 0,
        rawAngle: 0,
        velocity: 0,
        reactionTorque: 0,
      });
      return;
    }
    if (
      descriptor.kind === "spring" ||
      descriptor.kind === "damper" ||
      descriptor.kind === "linear-actuator"
    ) {
      const localAnchorA = bodyA.pointToLocalFrame(
          cannonVector(descriptor.anchorA),
        ),
        localAnchorB = bodyB.pointToLocalFrame(
          cannonVector(descriptor.anchorB),
        ),
        initialAxis = cannonVector(descriptor.anchorB).vsub(
          cannonVector(descriptor.anchorA),
        ),
        limitConstraint = new AxialLimitConstraint(bodyA, bodyB, {
          localAnchorA,
          localAnchorB,
          axisWorld: initialAxis,
          limits: [
            descriptor.mechanism.lengthRangeM.lower,
            descriptor.mechanism.lengthRangeM.upper,
          ],
          holdingClutch:
            descriptor.mechanism.unpoweredLaw?.kind === "holding-clutch-v1",
          maximumConstraintImpulse: solverImpulseLimit(
            Math.max(1, descriptor.breakForce || 24000) * 100,
            this.fixedDt,
          ),
        });
      this.world.addConstraint(limitConstraint);
      this.constraintEntries.push({
        descriptor,
        kind:
          descriptor.kind === "linear-actuator"
            ? "axial-actuator-v1"
            : "axial-force-v1",
        constraint: limitConstraint,
        localAnchorA,
        localAnchorB,
        force: 0,
        coordinateM: descriptor.restLength || 0,
        rateMPerS: 0,
        elasticPotentialJ: 0,
        dampingWorkJ: 0,
        dampingPowerW: 0,
        reactionForceN: 0,
        appliedForceN: 0,
        frictionWorkJ: 0,
        actuatorMechanicalWorkJ: 0,
        actuatorElectricalEnergyJ: 0,
        actuatorDissipatedEnergyJ: 0,
        temperatureK: 293.15,
        powered: false,
        saturated: false,
        clutchEngaged: false,
        clutchCoordinateM: null,
      });
      return;
    }
    if (descriptor.kind === "linear-guide") {
      const localAnchorA = bodyA.pointToLocalFrame(
          cannonVector(descriptor.anchorA),
        ),
        localAnchorB = bodyB.pointToLocalFrame(
          cannonVector(descriptor.anchorB),
        ),
        constraint = new PrismaticConstraint(bodyA, bodyB, {
          localAnchorA,
          localAnchorB,
          axisWorld: cannonVector(descriptor.axisWorld),
          coordinateOffsetM: descriptor.coordinateOffsetM,
          limits: descriptor.limits,
          guideFrictionLaw:
            descriptor.mechanism.guideFriction?.kind === "coulomb-viscous-v1"
              ? descriptor.mechanism.guideFriction
              : null,
          fixedDt: this.fixedDt,
          maximumConstraintImpulse: solverImpulseLimit(
            Math.max(1, descriptor.breakForce || 24000) * 100,
            this.fixedDt,
          ),
        });
      this.world.addConstraint(constraint);
      this.constraintEntries.push({
        descriptor,
        kind: "prismatic-coordinate-v1",
        constraint,
        localAnchorA,
        localAnchorB,
        coordinateM: descriptor.coordinateOffsetM,
        rateMPerS: 0,
        transverseM: 0,
        reactionForceN: 0,
        appliedForceN: 0,
        frictionWorkJ: 0,
        actuatorMechanicalWorkJ: 0,
        actuatorElectricalEnergyJ: 0,
        actuatorDissipatedEnergyJ: 0,
        temperatureK: 293.15,
        powered: false,
        saturated: false,
        clutchEngaged: false,
        clutchCoordinateM: null,
      });
      return;
    }
    if (descriptor.kind === "linkage") {
      const constraint = new CANNON.DistanceConstraint(
        bodyA,
        bodyB,
        Math.max(0.01, descriptor.restLength),
        solverImpulseLimit(
          Math.max(1, descriptor.breakForce || 24000) * 100,
          this.fixedDt,
        ),
      );
      constraint.collideConnected = false;
      this.world.addConstraint(constraint);
      this.constraintEntries.push({ descriptor, constraint });
      return;
    }
    if (descriptor.kind === "gear") {
      this.constraintEntries.push({
        descriptor,
        kind: "gear",
        phaseA: 0,
        phaseB: 0,
        reactionTorque: 0,
      });
    }
  }

  part(id) {
    return this.compiled?.parts.find((candidate) => candidate.id === id);
  }

  hasWheels() {
    return (this.compiled?.contactRegions || []).some(
      (region) => region.kind === "rolling-contact-v1",
    );
  }

  hasArticulation() {
    return this.constraintEntries.some(
      (entry) =>
        entry.active !== false &&
        entry.descriptor.kind === "revolute" &&
        entry.descriptor.controlled &&
        entry.descriptor.sourcePartId != null,
    );
  }

  wheelContactSamples(body, up) {
    const samples = [];
    for (const contact of this.world.contacts || []) {
      if (contact.bi !== body && contact.bj !== body) continue;
      const bodyIsA = contact.bi === body,
        normal = contact.ni.scale(bodyIsA ? -1 : 1),
        otherBody = bodyIsA ? contact.bj : contact.bi,
        normalAlignment = normal.dot(up);
      if (normalAlignment <= 0.05) continue;
      const contactMaterial =
        this.world.getContactMaterial?.(body.material, otherBody.material) ||
        this.world.defaultContactMaterial;
      samples.push({
        otherBody,
        normal,
        normalAlignment,
        forceN:
          Math.abs(contact.multiplier || 0) * Math.max(0, normalAlignment),
        friction: Math.max(0, Number(contactMaterial?.friction ?? 0.3)),
      });
    }
    return samples;
  }

  mobilityTelemetryFor(component, context = null, dt = 0) {
    if (!component?.id)
      throw new DomainValidationError(
        "MOBILITY_COMPONENT_REQUIRED",
        "Mobility telemetry requires a canonical physical component",
      );
    const memberPartIds = new Set(component.supportPartIds),
      regions = (this.compiled?.contactRegions || []).filter((region) =>
        memberPartIds.has(region.sourcePartId),
      );
    if (!regions.length) return null;
    const wheelStates = regions
        .map((region) => {
          const body = this.bodyByPart.get(region.sourcePartId);
          if (!body) return null;
          const tireState = this.constraintEntries.find(
              (entry) =>
                entry.kind === "rolling-contact-v1" &&
                entry.descriptor.sourcePartId === region.sourcePartId,
            )?.constraint.state,
            tireTouching = Boolean(tireState?.touching);
          const up = new CANNON.Vec3(0, 1, 0),
            contacts = this.wheelContactSamples(body, up),
            axle = partWorldAxis(body, cannonVector(region.localAxleAxis)),
            angularSpeed = body.angularVelocity.dot(axle),
            normalLoadN = tireState?.normalLoadN || 0;
          return {
            partId: region.sourcePartId,
            axleWorld: plainVector(axle),
            headingWorld: { x: 0, y: 0, z: 0 },
            steeringAngleRad: 0,
            touching: tireTouching,
            normalLoadN,
            longitudinalForceN: tireState?.longitudinalForceN || 0,
            lateralForceN: tireState?.lateralForceN || 0,
            carcassDeflectionM: tireState?.carcassDeflectionM || 0,
            carcassDeflectionRateMPerS:
              tireState?.carcassDeflectionRateMPerS || 0,
            longitudinalSlipMPerS: tireState?.slipLongMPerS || 0,
            lateralSlipMPerS: tireState?.slipLatMPerS || 0,
            frictionEllipseUtilization:
              tireState?.frictionEllipseUtilization || 0,
            rollingResistanceTorqueNm:
              tireState?.rollingResistanceTorqueNm || 0,
            rimLoadN: tireState?.rimLoadN || 0,
            dissipatedEnergyJ: tireState?.dissipatedEnergyJ || 0,
            temperatureK: tireState?.temperatureK || 293.15,
            contactRoles: tireState?.contactRoles || [],
            contactRegionKeys: tireState?.contactRegionKeys || [],
            contactMaterialKeys: tireState?.contactMaterialKeys || [],
            manifoldPointCount: tireState?.manifoldPointCount || 0,
            angularSpeed,
            spinDelta: angularSpeed * dt,
            groundY: this.surfaceHeightAt(body.position.x, body.position.z),
            inPond: Boolean(this.pondAt(body.position.x, body.position.z)),
            onPlatform: contacts.some(
              (contact) => contact.otherBody === this.groundBody,
            ),
            onField: contacts.some(
              (contact) => contact.otherBody === this.fieldBody,
            ),
          };
        })
        .filter(Boolean),
      bodies = [...this.bodyByPart.entries()]
        .filter(([partId]) => component.bodyPartIds.includes(partId))
        .map(([, body]) => body),
      mass = bodies.reduce((sum, body) => sum + body.mass, 0),
      position = new CANNON.Vec3(),
      velocity = new CANNON.Vec3();
    for (const body of bodies) {
      position.x += body.position.x * body.mass;
      position.y += body.position.y * body.mass;
      position.z += body.position.z * body.mass;
      velocity.x += body.velocity.x * body.mass;
      velocity.y += body.velocity.y * body.mass;
      velocity.z += body.velocity.z * body.mass;
    }
    position.scale(1 / Math.max(0.001, mass), position);
    velocity.scale(1 / Math.max(0.001, mass), velocity);
    const carrier = this.bodyByPart.get(component.framePartId) || bodies[0],
      carrierFrame = partFrame(carrier),
      carrierUp = carrierFrame.quaternion.vmult(new CANNON.Vec3(0, 1, 0)),
      forward = carrierFrame.quaternion.vmult(new CANNON.Vec3(0, 0, -1)),
      grounded = wheelStates.some((wheel) => wheel.touching),
      inWater = wheelStates.some((wheel) => wheel.inPond),
      platformShape = this.groundBody?.shapes?.find(
        (shape) => shape.halfExtents,
      ),
      edgeDistance = platformShape
        ? Math.min(
            platformShape.halfExtents.x -
              Math.abs(position.x - this.groundBody.position.x),
            platformShape.halfExtents.z -
              Math.abs(position.z - this.groundBody.position.z),
          )
        : 0,
      motorIds = [
        ...new Set(
          this.constraintEntries
            .filter(
              (entry) =>
                entry.active !== false &&
                entry.descriptor.motorId != null &&
                memberPartIds.has(entry.descriptor.motorId),
            )
            .map((entry) => entry.descriptor.motorId),
        ),
      ],
      requestedThrottle = context
        ? mean(
            motorIds.map(
              (id) =>
                readActuatorCommand(
                  context.commandBus,
                  this.part(id),
                  "throttle",
                  0,
                ).value,
            ),
          )
        : 0,
      brake = context
        ? Math.max(
            0,
            ...motorIds.map(
              (id) =>
                readActuatorCommand(
                  context.commandBus,
                  this.part(id),
                  "brake",
                  0,
                ).value,
            ),
          )
        : 0,
      fluidParts = [...memberPartIds]
        .map((partId) => this.fluidState?.byPart?.[String(partId)])
        .filter(Boolean),
      displacedVolumeM3 = fluidParts.reduce(
        (sum, state) => sum + state.volumeM3,
        0,
      ),
      submergedVolumeM3 = fluidParts.reduce(
        (sum, state) => sum + state.submergedVolumeM3,
        0,
      ),
      buoyancyN = fluidParts.reduce((sum, state) => sum + state.buoyancyN, 0),
      hydrodynamicDragN = fluidParts.reduce(
        (sum, state) => sum + state.dragN,
        0,
      ),
      waterDepth = Math.max(0, ...fluidParts.map((state) => state.waterDepth));
    carrierUp.normalize();
    forward.vsub(carrierUp.scale(forward.dot(carrierUp)), forward);
    forward.normalize();
    for (const wheel of wheelStates) {
      const axle = new CANNON.Vec3(
          wheel.axleWorld.x,
          wheel.axleWorld.y,
          wheel.axleWorld.z,
        ),
        projectedAxle = axle.vsub(carrierUp.scale(axle.dot(carrierUp)));
      if (projectedAxle.lengthSquared() <= 1e-12) {
        wheel.headingWorld = plainVector(forward);
        wheel.steeringAngleRad = 0;
        continue;
      }
      projectedAxle.normalize();
      const heading = carrierUp.cross(projectedAxle);
      heading.normalize();
      if (heading.dot(forward) < 0) heading.negate(heading);
      wheel.headingWorld = plainVector(heading);
      wheel.steeringAngleRad = Math.atan2(
        forward.cross(heading).dot(carrierUp),
        clamp(forward.dot(heading), -1, 1),
      );
    }
    return {
      active: true,
      poseMode: "per-part",
      pose: {
        position: plainVector(position),
        quaternion: plainQuaternion(carrierFrame.quaternion),
        visualOffsetY: 0,
      },
      velocity: plainVector(velocity),
      angularVelocity: plainVector(carrier.angularVelocity),
      signedSpeed: velocity.dot(forward),
      assemblyId: component.id,
      framePartId: carrier.userData?.partId ?? null,
      memberPartIds: component.supportPartIds,
      bodyPartIds: component.bodyPartIds,
      lineage: component.lineage,
      steering: {
        angleRad: mean(wheelStates.map((wheel) => wheel.steeringAngleRad)),
        wheelPartIds: wheelStates.map((wheel) => wheel.partId),
      },
      brake,
      lights: this.activeLuminairePartIds.some((id) => memberPartIds.has(id)),
      activeLuminairePartIds: this.activeLuminairePartIds.filter((id) =>
        memberPartIds.has(id),
      ),
      driveForce: {
        requestedThrottle,
        availableMotorPowerW: motorIds.reduce(
          (sum, id) =>
            sum + (context?.powerNetwork?.allocationFor(id)?.allocatedW || 0),
          0,
        ),
        deliveredMotorPowerW: motorIds.reduce(
          (sum, id) => sum + (this.motorElectricalWByPart.get(id) || 0),
          0,
        ),
        tractionLimitN: wheelStates.reduce(
          (sum, wheel) => sum + wheel.normalLoadN,
          0,
        ),
        longitudinalForceN: wheelStates.reduce(
          (sum, wheel) => sum + wheel.longitudinalForceN,
          0,
        ),
        lateralForceN: wheelStates.reduce(
          (sum, wheel) => sum + wheel.lateralForceN,
          0,
        ),
      },
      motorPartIds: motorIds,
      edgeDistance,
      grounded,
      onPlatform: wheelStates.some((wheel) => wheel.onPlatform),
      onField: wheelStates.some((wheel) => wheel.onField),
      inWater,
      bottomContact: inWater && grounded,
      wheelContacts: wheelStates.filter((wheel) => wheel.touching).length,
      submergedFraction:
        submergedVolumeM3 / Math.max(Number.EPSILON, displacedVolumeM3),
      displacedVolumeM3,
      buoyancyN,
      weightN: mass * 9.80665,
      mass,
      hydrodynamicDragN,
      waterDepth,
      surface: inWater
        ? "water"
        : wheelStates.some((wheel) => wheel.onPlatform)
          ? "platform"
          : wheelStates.some((wheel) => wheel.onField)
            ? "field"
            : "air",
      fallen: position.y < this.terrainHeightAt(position.x, position.z) - 6,
      wheelStates,
      validity: {
        valid: Boolean(carrier && wheelStates.length),
        reason:
          carrier && wheelStates.length
            ? null
            : "incomplete physical mobility component",
      },
    };
  }

  applyFluidForces() {
    if (!this.compiled) return null;
    let displacedVolumeM3 = 0,
      submergedVolumeM3 = 0,
      buoyancyN = 0,
      hydrodynamicDragN = 0,
      wetBodies = 0,
      waterDepth = 0;
    const byPart = {};
    for (const part of this.compiled.parts) {
      const body = this.bodyByPart.get(part.id);
      if (!body) continue;
      const descriptor = this.compiled.bodies.find(
          (candidate) => candidate.partId === part.id,
        )?.geometry,
        frame = partFrame(body),
        buoyancyCenter = frame.quaternion
          .vmult(cannonVector(descriptor.renderDetailAnchors.center))
          .vadd(frame.position),
        pond = this.pondAt(buoyancyCenter.x, buoyancyCenter.z),
        volume = descriptor.displacementM3,
        halfHeight = Math.max(0.03, (descriptor?.dimensions?.[1] || 0.2) / 2);
      displacedVolumeM3 += volume;
      byPart[String(part.id)] = {
        volumeM3: volume,
        submerged: 0,
        submergedVolumeM3: 0,
        buoyancyN: 0,
        dragN: 0,
        waterDepth: 0,
      };
      if (!pond) continue;
      const submerged = clamp(
        (pond.waterY - (buoyancyCenter.y - halfHeight)) / (halfHeight * 2),
        0,
        1,
      );
      if (submerged <= 0) continue;
      wetBodies++;
      const lift = this.waterDensity * 9.80665 * volume * submerged,
        speed = body.velocity.length(),
        area = Math.max(0.001, Math.pow(volume, 2 / 3) * 0.85),
        dragMagnitude = Math.min(
          0.5 * this.waterDensity * 1.05 * area * submerged * speed * speed,
          body.mass * 9.80665 * 2.2,
        );
      body.applyForce(
        new CANNON.Vec3(0, lift, 0),
        buoyancyCenter.vsub(body.position),
      );
      if (speed > 0.015)
        body.applyForce(
          body.velocity.scale(-dragMagnitude / speed),
          new CANNON.Vec3(),
        );
      submergedVolumeM3 += volume * submerged;
      buoyancyN += lift;
      hydrodynamicDragN += dragMagnitude;
      const localWaterDepth = Math.max(
        0,
        pond.waterY - this.terrainHeightAt(buoyancyCenter.x, buoyancyCenter.z),
      );
      waterDepth = Math.max(waterDepth, localWaterDepth);
      byPart[String(part.id)] = {
        volumeM3: volume,
        submerged,
        submergedVolumeM3: volume * submerged,
        buoyancyN: lift,
        dragN: dragMagnitude,
        waterDepth: localWaterDepth,
      };
    }
    this.fluidState = {
      active: true,
      inWater: wetBodies > 0,
      wetBodies,
      submergedFraction: clamp(
        submergedVolumeM3 / Math.max(1e-9, displacedVolumeM3),
        0,
        1,
      ),
      displacedVolumeM3,
      buoyancyN,
      hydrodynamicDragN,
      waterDepth,
      byPart,
    };
    return { ...this.fluidState };
  }

  applyExternalForce(force, worldPoint, partId = null) {
    if (!this.compiled) return false;
    let body = partId == null ? null : this.bodyByPart.get(partId);
    if (!body) {
      const point = new CANNON.Vec3(
        Number(worldPoint?.x || 0),
        Number(worldPoint?.y || 0),
        Number(worldPoint?.z || 0),
      );
      body = [...this.bodyByPart.values()].reduce(
        (nearest, candidate) =>
          !nearest ||
          candidate.position.distanceSquared(point) <
            nearest.position.distanceSquared(point)
            ? candidate
            : nearest,
        null,
      );
    }
    if (!body) return false;
    const point = new CANNON.Vec3(
        Number(worldPoint?.x ?? body.position.x),
        Number(worldPoint?.y ?? body.position.y),
        Number(worldPoint?.z ?? body.position.z),
      ),
      relative = point.vsub(body.position);
    body.applyForce(
      new CANNON.Vec3(
        Number(force?.x || 0),
        Number(force?.y || 0),
        Number(force?.z || 0),
      ),
      relative,
    );
    return true;
  }

  applyBodyTorque(partId, torque, { local = false } = {}) {
    const body = this.bodyByPart.get(partId);
    if (!body) return false;
    let applied = new CANNON.Vec3(
      Number(torque?.x || 0),
      Number(torque?.y || 0),
      Number(torque?.z || 0),
    );
    if (local) applied = partWorldAxis(body, applied);
    body.torque.vadd(applied, body.torque);
    return true;
  }

  constraintPoseForPart(partId) {
    const entry = this.constraintEntries.find(
      (candidate) =>
        candidate.active !== false &&
        candidate.descriptor.sourcePartId === partId &&
        candidate.constraint?.pivotA,
    );
    if (!entry) return null;
    const bodyA = this.bodyByPart.get(entry.descriptor.a),
      position = bodyA.pointToWorldFrame(entry.constraint.pivotA);
    return {
      position: plainVector(position),
      quaternion: plainQuaternion(partFrame(bodyA).quaternion),
      angle: entry.angle || 0,
      angularVelocity: entry.velocity || 0,
      reactionTorque: entry.reactionTorque || 0,
      constraintId: entry.descriptor.id,
    };
  }

  bodyPose(partId) {
    const body = this.bodyByPart.get(partId);
    if (!body) return null;
    const frame = partFrame(body);
    return {
      position: frame.position,
      quaternion: frame.quaternion,
      velocity: frame.velocity,
      angularVelocity: body.angularVelocity,
    };
  }

  primaryBodyPose() {
    const body = [...this.bodyByPart.values()].sort(
      (left, right) => right.mass - left.mass,
    )[0];
    if (!body) return null;
    const pose = this.bodyPose(body.userData.partId);
    return {
      position: plainVector(pose.position),
      quaternion: plainQuaternion(pose.quaternion),
      velocity: plainVector(pose.velocity),
      angularVelocity: plainVector(pose.angularVelocity),
    };
  }

  stepTwoFrameMechanisms(context, dt) {
    let activeActuators = 0;
    for (const entry of this.constraintEntries) {
      if (entry.active === false) continue;
      const { descriptor } = entry,
        bodyA = this.bodyByPart.get(descriptor.a),
        bodyB = this.bodyByPart.get(descriptor.b);
      if (!bodyA || !bodyB) continue;
      if (entry.kind === "axial-force-v1") {
        const state = axialState(
            bodyA,
            bodyB,
            entry.localAnchorA,
            entry.localAnchorB,
          ),
          mechanism = descriptor.mechanism,
          response =
            descriptor.kind === "spring"
              ? springResponse(mechanism, state.coordinateM, state.rateMPerS)
              : damperResponse(mechanism, state.rateMPerS),
          lowerStop = stopResponse(
            mechanism.lowerStop,
            "lower",
            state.coordinateM,
            state.rateMPerS,
          ),
          upperStop = stopResponse(
            mechanism.upperStop,
            "upper",
            state.coordinateM,
            state.rateMPerS,
          ),
          signedTensionN =
            response.forceN +
            (lowerStop?.forceN || 0) +
            (upperStop?.forceN || 0),
          dampingPowerW =
            response.dampingPowerW +
            (lowerStop?.dampingPowerW || 0) +
            (upperStop?.dampingPowerW || 0);
        applyAxialForce(bodyA, bodyB, state, signedTensionN);
        entry.force = Math.abs(signedTensionN);
        entry.coordinateM = state.coordinateM;
        entry.rateMPerS = state.rateMPerS;
        entry.elasticPotentialJ =
          response.elasticPotentialJ +
          (lowerStop?.elasticPotentialJ || 0) +
          (upperStop?.elasticPotentialJ || 0);
        entry.dampingPowerW = Math.min(0, dampingPowerW);
        entry.dampingWorkJ += entry.dampingPowerW * dt;
        for (const id of descriptor.sourceConnectionIds)
          this.loadByConnection.set(id, entry.force);
        continue;
      }
      if (
        entry.kind !== "prismatic-coordinate-v1" &&
        entry.kind !== "axial-actuator-v1"
      )
        continue;

      const axialActuator = entry.kind === "axial-actuator-v1",
        axis = axialActuator ? null : entry.constraint.axisWorld(),
        state = axialState(
          bodyA,
          bodyB,
          entry.localAnchorA,
          entry.localAnchorB,
          axis,
          axialActuator ? 0 : descriptor.coordinateOffsetM,
        ),
        mechanism = descriptor.mechanism;
      entry.coordinateM = state.coordinateM;
      entry.rateMPerS = state.rateMPerS;
      entry.transverseM = state.transverseM;
      if (entry.constraint.holdEquation)
        entry.constraint.holdEquation.enabled = false;
      let signedTensionN = 0,
        coordinateForceN = 0,
        frictionPowerW = 0,
        electricalPowerW = 0,
        powered = false,
        saturated = false;

      if (descriptor.kind === "linear-guide") {
        signedTensionN = 0;
      } else {
        const actuator = this.part(descriptor.sourcePartId),
          allocation = context.powerNetwork?.allocationFor(actuator.id),
          law = mechanism.commandLaw;
        const thermal = mechanism.thermalLimits,
          thermalAvailability = thermal
            ? mechanismClamp(
                (thermal.shutdownTemperatureK - entry.temperatureK) /
                  Math.max(
                    Number.EPSILON,
                    thermal.shutdownTemperatureK - thermal.derateTemperatureK,
                  ),
                0,
                1,
              )
            : 1;
        entry.thermalDerate = thermalAvailability;
        entry.thermalShutdown = thermalAvailability <= 0;
        if (allocation?.operational && thermalAvailability > 0) {
          entry.clutchEngaged = false;
          entry.clutchCoordinateM = null;
          const normalizedPosition = mechanismClamp(
              (state.coordinateM - mechanism.lengthRangeM.lower) /
                (mechanism.lengthRangeM.upper - mechanism.lengthRangeM.lower),
              0,
              1,
            ),
            command = context.commandBus
              ? law.kind === "position-impedance-v1"
                ? readActuatorCommand(
                    context.commandBus,
                    actuator,
                    "linear_target",
                    normalizedPosition,
                  ).value
                : law.kind === "velocity-servo-v1"
                  ? readActuatorCommand(
                      context.commandBus,
                      actuator,
                      "linear_velocity",
                      0,
                    ).value
                  : readActuatorCommand(
                      context.commandBus,
                      actuator,
                      "linear_force",
                      0,
                    ).value
              : law.kind === "position-impedance-v1"
                ? normalizedPosition
                : 0,
            unconstrainedCapacity = forceSpeedCapacity(
              mechanism.forceSpeedEnvelope,
              state.rateMPerS,
            ),
            capacity = {
              extendN: unconstrainedCapacity.extendN * thermalAvailability,
              retractN: unconstrainedCapacity.retractN * thermalAvailability,
            };
          if (law.kind === "position-impedance-v1") {
            const targetM =
              mechanism.lengthRangeM.lower +
              mechanismClamp(command, 0, 1) *
                (mechanism.lengthRangeM.upper - mechanism.lengthRangeM.lower);
            coordinateForceN =
              law.stiffnessNPerM * (targetM - state.coordinateM) -
              law.dampingNsPerM * state.rateMPerS;
          } else if (law.kind === "velocity-servo-v1") {
            const maximumSpeedMPerS =
              mechanism.forceSpeedEnvelope.points.at(-1).absSpeedMPerS;
            coordinateForceN =
              law.velocityGainNsPerM *
              (mechanismClamp(command, -1, 1) * maximumSpeedMPerS -
                state.rateMPerS);
          } else
            coordinateForceN =
              mechanismClamp(command, -1, 1) *
              (command >= 0 ? capacity.extendN : capacity.retractN);
          const unclampedForceN = coordinateForceN;
          coordinateForceN = mechanismClamp(
            coordinateForceN,
            -capacity.retractN,
            capacity.extendN,
          );
          saturated =
            thermalAvailability < 1 ||
            Math.abs(coordinateForceN - unclampedForceN) > 1e-9;
          const mechanicalPowerW = coordinateForceN * state.rateMPerS,
            requestedElectricalW =
              mechanism.powerLaw.idlePowerW +
              Math.max(0, mechanicalPowerW) /
                mechanism.powerLaw.electricalMotoringEfficiency,
            deliveredElectricalW = context.powerNetwork.drawPower(
              actuator.id,
              requestedElectricalW,
              dt,
            ),
            deliveryRatio = requestedElectricalW
              ? Math.min(1, deliveredElectricalW / requestedElectricalW)
              : 1;
          coordinateForceN *= deliveryRatio;
          electricalPowerW = deliveredElectricalW;
          powered = deliveryRatio > 0;
          signedTensionN = -coordinateForceN;
          entry.actuatorMechanicalWorkJ +=
            coordinateForceN * state.rateMPerS * dt;
          entry.actuatorElectricalEnergyJ += deliveredElectricalW * dt;
          entry.actuatorDissipatedEnergyJ +=
            Math.max(
              0,
              deliveredElectricalW -
                Math.max(0, coordinateForceN * state.rateMPerS),
            ) * dt;
          activeActuators += powered ? 1 : 0;
        } else {
          const unpowered = mechanism.unpoweredLaw;
          if (unpowered.kind === "viscous-drag-v1")
            signedTensionN = unpowered.dampingNsPerM * state.rateMPerS;
          else if (unpowered.kind === "holding-clutch-v1") {
            entry.clutchEngaged =
              entry.clutchEngaged ||
              Math.abs(state.rateMPerS) <= unpowered.reengageSpeedMPerS;
            if (entry.clutchEngaged && entry.clutchCoordinateM == null)
              entry.clutchCoordinateM = state.coordinateM;
            const capacityN = entry.clutchEngaged
              ? unpowered.staticForceCapacityN
              : unpowered.dynamicForceCapacityN;
            const capacityImpulseNs = solverImpulseLimit(capacityN, dt);
            entry.constraint.holdEquation.minForce = -capacityImpulseNs;
            entry.constraint.holdEquation.maxForce = capacityImpulseNs;
            entry.constraint.holdEquation.enabled = true;
          }
          frictionPowerW = -signedTensionN * state.rateMPerS;
        }
      }
      if (signedTensionN) applyAxialForce(bodyA, bodyB, state, signedTensionN);
      entry.appliedForceN = coordinateForceN || -signedTensionN;
      entry.powered = powered;
      entry.saturated = saturated;
      entry.frictionWorkJ += Math.min(0, frictionPowerW) * dt;
      const thermal = mechanism.thermalLimits;
      if (thermal) {
        const heatInputW = Math.max(
            0,
            electricalPowerW - Math.max(0, coordinateForceN * state.rateMPerS),
          ),
          coolingW =
            thermal.ambientConductanceWPerK * (entry.temperatureK - 293.15);
        entry.temperatureK +=
          ((heatInputW - coolingW) * dt) / thermal.thermalMassJPerK;
      }
      const transmittedForceN = Math.max(
        Math.abs(entry.appliedForceN),
        entry.reactionForceN,
      );
      for (const id of descriptor.sourceConnectionIds)
        this.loadByConnection.set(id, transmittedForceN);
    }
    return activeActuators;
  }

  stepActuators(context, dt) {
    if (!this.compiled) return null;
    this.loadByConnection.clear();
    this.torqueByConnection.clear();
    this.motorElectricalWByPart.clear();
    const commandFor = (part, channel, fallback = 0) =>
      readActuatorCommand(context.commandBus, part, channel, fallback).value;
    let activeMotors = this.stepTwoFrameMechanisms(context, dt);
    for (const entry of this.constraintEntries) {
      if (entry.active === false) continue;
      if (entry.descriptor.kind !== "revolute") continue;
      const { descriptor, constraint } = entry,
        bodyA = this.bodyByPart.get(descriptor.a),
        bodyB = this.bodyByPart.get(descriptor.b);
      updateRevoluteMeasurement(entry, bodyA, bodyB);
      const passiveTorque = clamp(
        -entry.velocity * (descriptor.damping || 0),
        -(descriptor.maxTorque || 120),
        descriptor.maxTorque || 120,
      );
      let targetTorque = passiveTorque;
      if (passiveTorque) {
        const axis = bodyB.quaternion.vmult(entry.axisB);
        bodyB.torque.vadd(axis.scale(passiveTorque), bodyB.torque);
        bodyA.torque.vsub(axis.scale(passiveTorque), bodyA.torque);
      }
      if (descriptor.motorId) {
        const motor = this.part(descriptor.motorId),
          allocation = context.powerNetwork?.allocationFor(motor.id);
        if (allocation?.operational) {
          const brake = commandFor(motor, "brake", 0),
            throttle = brake
              ? 0
              : clamp(commandFor(motor, "throttle", 0), -1, 1);
          if (!brake && Math.abs(throttle) <= 1e-6) {
            constraint.disableMotor();
            this.motorElectricalWByPart.set(motor.id, 0);
          } else {
            const targetSpeed =
                descriptor.driveLaw.noLoadSpeedRadPerS *
                descriptor.driveLaw.direction *
                throttle,
              powerW = Math.max(1, descriptor.driveLaw.maximumElectricalPowerW),
              allocationRatio = Math.min(
                1,
                allocation.allocatedW / Math.max(1, powerW),
              ),
              stallTorque = Math.max(
                1,
                (powerW / Math.max(1, Math.abs(targetSpeed))) * 2.2,
              ),
              speedError = targetSpeed - entry.velocity;
            targetTorque = clamp(
              speedError * stallTorque * 0.32 * allocationRatio,
              -stallTorque * allocationRatio,
              stallTorque * allocationRatio,
            );
            const electricalDemandW = brake
                ? 0
                : Math.min(
                    powerW,
                    Math.max(
                      powerW * 0.03 * Math.abs(throttle),
                      Math.abs(targetTorque * entry.velocity) / 0.85,
                    ),
                  ),
              deliveredW = context.powerNetwork.drawPower(
                motor.id,
                electricalDemandW,
                dt,
              ),
              deliveryRatio = electricalDemandW
                ? deliveredW / electricalDemandW
                : 1;
            this.motorElectricalWByPart.set(motor.id, deliveredW);
            targetTorque *= deliveryRatio;
            constraint.enableMotor();
            constraint.setMotorSpeed(targetSpeed);
            const torqueImpulseNms = solverImpulseLimit(targetTorque, dt);
            constraint.motorEquation.maxForce = torqueImpulseNms;
            constraint.motorEquation.minForce = -torqueImpulseNms;
            activeMotors++;
          }
        } else constraint.disableMotor();
      } else if (descriptor.controlled && descriptor.sourcePartId) {
        const actuator = this.part(descriptor.sourcePartId),
          allocation = context.powerNetwork?.allocationFor(actuator.id);
        if (allocation?.operational) {
          const controlledTarget = Number(entry.articulatedTarget),
            hasControlledTarget =
              entry.articulatedTarget != null &&
              Number.isFinite(controlledTarget),
            control = hasControlledTarget
              ? 0
              : clamp(commandFor(actuator, "joint_target", 0), -1, 1),
            [low, high] = descriptor.limits || [-Math.PI, Math.PI],
            center = ((actuator.config?.angle || 0) * Math.PI) / 180,
            target = hasControlledTarget
              ? clamp(controlledTarget, low, high)
              : clamp(
                  center + control * Math.min(high - center, center - low),
                  low,
                  high,
                ),
            error = target - entry.angle,
            servoTorque = clamp(
              error * descriptor.maxTorque * 4 -
                entry.velocity * descriptor.damping,
              -descriptor.maxTorque,
              descriptor.maxTorque,
            ),
            requestedW = Math.min(
              allocation.requestedW,
              Math.max(
                allocation.requestedW *
                  0.02 *
                  (hasControlledTarget
                    ? clamp(Math.abs(error) / Math.max(0.05, high - low), 0, 1)
                    : Math.abs(control)),
                Math.abs(servoTorque * entry.velocity) / 0.82,
              ),
            ),
            deliveredW = context.powerNetwork.drawPower(
              actuator.id,
              requestedW,
              dt,
            ),
            poweredTorque =
              requestedW > 0
                ? servoTorque * (deliveredW / requestedW)
                : servoTorque;
          constraint.enableMotor();
          // Cannon's hinge motor speed is expressed in A-relative-to-B
          // convention, while our measured joint angle is B-relative-to-A.
          // Negate once at this engine boundary so authored/controller target
          // signs stay consistent with telemetry and joint limits.
          constraint.setMotorSpeed(clamp(-error * 8, -8, 8));
          const torqueImpulseNms = solverImpulseLimit(poweredTorque, dt);
          constraint.motorEquation.maxForce = torqueImpulseNms;
          constraint.motorEquation.minForce = -torqueImpulseNms;
          targetTorque += poweredTorque;
        } else constraint.disableMotor();
      }
      if (descriptor.limits) {
        const [low, high] = descriptor.limits,
          penetration =
            entry.angle < low
              ? low - entry.angle
              : entry.angle > high
                ? high - entry.angle
                : 0;
        if (penetration) {
          const limitTorque = clamp(
            penetration * descriptor.maxTorque * 20 -
              entry.velocity * descriptor.damping,
            -descriptor.maxTorque,
            descriptor.maxTorque,
          );
          const axis = bodyB.quaternion.vmult(entry.axisB);
          bodyB.torque.vadd(axis.scale(limitTorque), bodyB.torque);
          bodyA.torque.vsub(axis.scale(limitTorque), bodyA.torque);
          targetTorque += limitTorque;
        }
      }
      entry.reactionTorque = Math.abs(targetTorque);
      for (const id of descriptor.sourceConnectionIds || [])
        this.torqueByConnection.set(
          id,
          Math.max(entry.reactionTorque, this.torqueByConnection.get(id) || 0),
        );
    }

    for (const entry of this.constraintEntries) {
      if (entry.active === false) continue;
      if (entry.kind !== "gear") continue;
      const { descriptor } = entry,
        bodyA = this.bodyByPart.get(descriptor.a),
        bodyB = this.bodyByPart.get(descriptor.b),
        localAxisA = cannonVector(descriptor.axisA),
        localAxisB = cannonVector(descriptor.axisB),
        velocityA = signedAngleVelocity(bodyA, localAxisA),
        velocityB = signedAngleVelocity(bodyB, localAxisB);
      entry.phaseA += velocityA * dt;
      entry.phaseB += velocityB * dt;
      const error = entry.phaseB + descriptor.ratio * entry.phaseA,
        relativeVelocity = velocityB + descriptor.ratio * velocityA,
        toothTorque = clamp(
          -descriptor.stiffness * error - descriptor.damping * relativeVelocity,
          -descriptor.breakTorque,
          descriptor.breakTorque,
        ),
        axisA = partWorldAxis(bodyA, localAxisA),
        axisB = partWorldAxis(bodyB, localAxisB),
        torqueA = axisA.scale(toothTorque * descriptor.ratio),
        torqueB = axisB.scale(toothTorque);
      bodyA.torque.vadd(torqueA, bodyA.torque);
      bodyB.torque.vadd(torqueB, bodyB.torque);
      entry.reactionTorque = Math.abs(toothTorque);
      for (const id of descriptor.sourceConnectionIds)
        this.torqueByConnection.set(id, Math.abs(toothTorque));
      for (const id of descriptor.sourceConnectionIds)
        this.loadByConnection.set(
          id,
          Math.abs(toothTorque) /
            Math.max(
              0.01,
              Math.min(descriptor.pitchRadiusA, descriptor.pitchRadiusB),
            ),
        );
    }

    this.lastTelemetry = this.telemetry(activeMotors);
    return this.lastTelemetry;
  }

  afterIntegration(dt) {
    if (!this.compiled) return null;
    for (const entry of this.constraintEntries)
      if (entry.active !== false && entry.kind === "rolling-contact-v1")
        entry.constraint.commitSolvedState();
    for (const entry of this.constraintEntries)
      if (
        entry.active !== false &&
        ["prismatic-coordinate-v1", "axial-actuator-v1"].includes(entry.kind)
      ) {
        if (entry.kind === "prismatic-coordinate-v1")
          entry.constraint.project();
        if (entry.clutchEngaged) {
          const equation = entry.constraint.holdEquation,
            saturated =
              Math.abs(equation.multiplier || 0) * dt >=
              Math.abs(equation.maxForce) * (1 - 1e-6);
          if (saturated) {
            entry.clutchEngaged = false;
            entry.clutchCoordinateM = null;
          } else entry.constraint.projectCoordinate(entry.clutchCoordinateM);
        }
      }
    for (const entry of this.constraintEntries) {
      if (
        entry.active === false ||
        entry.descriptor.kind !== "revolute" ||
        !entry.referenceA
      )
        continue;
      updateRevoluteMeasurement(
        entry,
        this.bodyByPart.get(entry.descriptor.a),
        this.bodyByPart.get(entry.descriptor.b),
      );
    }
    for (const entry of this.constraintEntries) {
      if (
        entry.active === false ||
        !["prismatic-coordinate-v1", "axial-actuator-v1"].includes(entry.kind)
      )
        continue;
      const bodyA = this.bodyByPart.get(entry.descriptor.a),
        bodyB = this.bodyByPart.get(entry.descriptor.b),
        state = axialState(
          bodyA,
          bodyB,
          entry.localAnchorA,
          entry.localAnchorB,
          entry.kind === "axial-actuator-v1"
            ? null
            : entry.constraint.axisWorld(),
          entry.kind === "axial-actuator-v1"
            ? 0
            : entry.descriptor.coordinateOffsetM,
        );
      entry.coordinateM = state.coordinateM;
      entry.rateMPerS = state.rateMPerS;
      entry.transverseM = state.transverseM;
      entry.reactionForceN =
        entry.kind === "axial-actuator-v1"
          ? solvedConstraintReaction(entry.constraint).forceN
          : Math.hypot(
              ...entry.constraint.transverseEquations.map(
                (equation) => equation.multiplier || 0,
              ),
            );
      if (
        entry.kind === "prismatic-coordinate-v1" &&
        entry.constraint.guideFrictionEquation
      ) {
        entry.appliedForceN = Number(
          entry.constraint.guideFrictionEquation.multiplier || 0,
        );
        entry.frictionWorkJ -=
          Math.abs(entry.appliedForceN * entry.rateMPerS) * dt;
      }
    }
    for (const entry of this.constraintEntries) {
      if (entry.active === false || !entry.constraint) continue;
      const reaction = solvedConstraintReaction(entry.constraint);
      if (entry.descriptor.kind === "revolute")
        entry.reactionTorque = reaction.torqueNm;
      for (const id of entry.descriptor.sourceConnectionIds || []) {
        this.loadByConnection.set(
          id,
          Math.max(reaction.forceN, this.loadByConnection.get(id) || 0),
        );
        this.torqueByConnection.set(
          id,
          Math.max(reaction.torqueNm, this.torqueByConnection.get(id) || 0),
        );
      }
    }
    for (const [partId, body] of this.bodyByPart) {
      const descriptor = this.compiled.bodies.find(
          (candidate) => candidate.partId === partId,
        ),
        axis = cannonVector(descriptor.geometry.renderDetailAnchors.axis);
      this.phaseByPart.set(
        partId,
        (this.phaseByPart.get(partId) || 0) +
          signedAngleVelocity(body, axis) * dt,
      );
    }
    this.lastTelemetry = this.telemetry(this.lastTelemetry?.activeMotors || 0);
    return this.lastTelemetry;
  }

  applyConnectionFailures(connections) {
    const failed = new Set(
        connections
          .filter((connection) => connection.failed)
          .map((connection) => connection.id),
      ),
      detached = [];
    for (const entry of this.constraintEntries) {
      if (
        entry.active === false ||
        !(entry.descriptor.sourceConnectionIds || []).some((id) =>
          failed.has(id),
        )
      )
        continue;
      entry.active = false;
      if (entry.constraint) this.world.removeConstraint(entry.constraint);
      detached.push(entry.descriptor.id);
    }
    for (const entry of this.collisionExclusionConstraints) {
      if (
        entry.active === false ||
        collisionExclusionRequired(this.constraintEntries, entry.descriptor)
      )
        continue;
      entry.active = false;
      this.world.removeConstraint(entry.constraint);
    }
    if (detached.length) this.topologyRevision++;
    return detached;
  }

  telemetry(activeMotors = 0) {
    if (!this.compiled) return null;
    const poses = [];
    for (const [partId, body] of this.bodyByPart) {
      const descriptor = this.compiled.bodies.find(
          (candidate) => candidate.partId === partId,
        ),
        frame = partFrame(body),
        axis = cannonVector(descriptor.geometry.renderDetailAnchors.axis),
        speed = signedAngleVelocity(body, axis),
        phase = this.phaseByPart.get(partId) || 0,
        contacts = (this.world.contacts || []).filter(
          (contact) => contact.bi === body || contact.bj === body,
        );
      poses.push({
        id: partId,
        position: plainVector(frame.position),
        quaternion: plainQuaternion(frame.quaternion),
        velocity: plainVector(frame.velocity),
        angularVelocity: plainVector(body.angularVelocity),
        contact: contacts.length > 0,
        contactForceN: contacts.reduce(
          (sum, contact) => sum + Math.abs(contact.multiplier || 0),
          0,
        ),
        phase,
        angularSpeed: speed,
      });
    }
    for (const entry of this.constraintEntries) {
      const motorId = entry.descriptor.motorId;
      if (!motorId) continue;
      const pose = poses.find((candidate) => candidate.id === motorId);
      if (pose) pose.phase = entry.angle;
    }
    const joints = this.constraintEntries
      .filter((entry) => entry.descriptor.kind === "revolute")
      .map((entry) => ({
        id: entry.descriptor.id,
        sourcePartId: entry.descriptor.sourcePartId || null,
        angle: entry.angle,
        angularVelocity: entry.velocity,
        reactionTorque: entry.reactionTorque,
      }));
    for (const entry of this.constraintEntries.filter(
      (candidate) =>
        candidate.active !== false &&
        candidate.descriptor.kind === "revolute" &&
        candidate.descriptor.sourcePartId != null &&
        !this.bodyByPart.has(candidate.descriptor.sourcePartId),
    )) {
      const bodyA = this.bodyByPart.get(entry.descriptor.a),
        position = bodyA.pointToWorldFrame(entry.constraint.pivotA);
      poses.push({
        id: entry.descriptor.sourcePartId,
        position: plainVector(position),
        quaternion: plainQuaternion(bodyA.quaternion),
        jointAngle: entry.angle,
        reactionTorque: entry.reactionTorque,
      });
    }
    for (const entry of this.constraintEntries.filter(
      (candidate) =>
        candidate.active !== false &&
        ["axial-force-v1", "axial-actuator-v1"].includes(candidate.kind),
    )) {
      const bodyA = this.bodyByPart.get(entry.descriptor.a),
        bodyB = this.bodyByPart.get(entry.descriptor.b),
        state = axialState(
          bodyA,
          bodyB,
          entry.localAnchorA,
          entry.localAnchorB,
        ),
        referenceLengthM =
          entry.descriptor.mechanism.referenceLaw?.freeLengthM ||
          entry.descriptor.mechanism.referenceLaw?.referenceLengthM ||
          state.coordinateM;
      poses.push({
        id: entry.descriptor.sourcePartId,
        position: plainVector(state.pointA.vadd(state.pointB).scale(0.5)),
        axialScale: state.coordinateM / Math.max(0.01, referenceLengthM),
      });
    }
    const twoFrameMechanisms = this.constraintEntries
      .filter((entry) =>
        [
          "axial-force-v1",
          "axial-actuator-v1",
          "prismatic-coordinate-v1",
        ].includes(entry.kind),
      )
      .map((entry) => ({
        id: entry.descriptor.id,
        sourcePartId: entry.descriptor.sourcePartId,
        kind: entry.descriptor.kind,
        active: entry.active !== false,
        coordinateM: entry.coordinateM,
        rateMPerS: entry.rateMPerS,
        forceN:
          entry.kind === "axial-force-v1" ? entry.force : entry.appliedForceN,
        reactionForceN: entry.reactionForceN || 0,
        transverseM: entry.transverseM || 0,
        elasticPotentialJ: entry.elasticPotentialJ || 0,
        dampingWorkJ: entry.dampingWorkJ || 0,
        frictionWorkJ: entry.frictionWorkJ || 0,
        mechanicalWorkJ: entry.actuatorMechanicalWorkJ || 0,
        electricalEnergyJ: entry.actuatorElectricalEnergyJ || 0,
        dissipatedEnergyJ: entry.actuatorDissipatedEnergyJ || 0,
        temperatureK: entry.temperatureK || null,
        powered: Boolean(entry.powered),
        saturated: Boolean(entry.saturated),
        thermalDerate: entry.thermalDerate ?? 1,
        thermalShutdown: Boolean(entry.thermalShutdown),
      }));
    return {
      active: true,
      activeMotors,
      compiled: this.compiled.stats,
      diagnostics: this.compiled.diagnostics,
      poses,
      joints,
      twoFrameMechanisms,
      connectionLoads: Object.fromEntries(this.loadByConnection),
      connectionTorques: Object.fromEntries(this.torqueByConnection),
    };
  }

  exportState() {
    if (!this.compiled)
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_NOT_RUNNING",
        "Cannot checkpoint a multibody runtime before it starts",
      );
    const bodyState = (partId, body) => ({
        partId,
        position: plainVector(body.position),
        previousPosition: plainVector(body.previousPosition),
        interpolatedPosition: plainVector(body.interpolatedPosition),
        quaternion: plainQuaternion(body.quaternion),
        previousQuaternion: plainQuaternion(body.previousQuaternion),
        interpolatedQuaternion: plainQuaternion(body.interpolatedQuaternion),
        velocity: plainVector(body.velocity),
        angularVelocity: plainVector(body.angularVelocity),
        force: plainVector(body.force),
        torque: plainVector(body.torque),
        mass: body.mass,
        invMass: body.invMass,
        inertia: plainVector(body.inertia),
        invInertia: plainVector(body.invInertia),
        massFrame: {
          principalToPart: plainQuaternion(
            body.userData.massFrame.principalToPart,
          ),
          comPart: plainVector(body.userData.massFrame.comPart),
        },
        massProperties: structuredClone(body.userData.massProperties),
        shapeOffsets: body.shapeOffsets.map(plainVector),
        shapeOrientations: body.shapeOrientations.map(plainQuaternion),
        sleepState: body.sleepState,
        timeLastSleepy: body.timeLastSleepy,
      }),
      scalarEntryKeys = [
        "active",
        "angle",
        "rawAngle",
        "velocity",
        "reactionTorque",
        "force",
        "coordinateM",
        "rateMPerS",
        "transverseM",
        "reactionForceN",
        "appliedForceN",
        "elasticPotentialJ",
        "dampingWorkJ",
        "dampingPowerW",
        "frictionWorkJ",
        "actuatorMechanicalWorkJ",
        "actuatorElectricalEnergyJ",
        "actuatorDissipatedEnergyJ",
        "temperatureK",
        "powered",
        "saturated",
        "thermalDerate",
        "thermalShutdown",
        "clutchEngaged",
        "clutchCoordinateM",
        "phaseA",
        "phaseB",
      ],
      entries = this.constraintEntries.map((entry) => ({
        id: entry.descriptor.id,
        kind: entry.kind || null,
        values: {
          active: entry.active !== false,
          ...Object.fromEntries(
            scalarEntryKeys
              .filter((key) => key !== "active" && Object.hasOwn(entry, key))
              .map((key) => [key, entry[key]]),
          ),
        },
        tireState:
          entry.kind === "rolling-contact-v1"
            ? structuredClone(entry.constraint.state)
            : null,
        fixedFrame:
          entry.descriptor.kind === "fixed" && entry.constraint
            ? {
                pivotA: plainVector(entry.constraint.pivotA),
                pivotB: plainVector(entry.constraint.pivotB),
                xA: plainVector(entry.constraint.xA),
                yA: plainVector(entry.constraint.yA),
                zA: plainVector(entry.constraint.zA),
                xB: plainVector(entry.constraint.xB),
                yB: plainVector(entry.constraint.yB),
                zB: plainVector(entry.constraint.zB),
              }
            : null,
      }));
    return structuredClone({
      version: 1,
      fixedDt: this.fixedDt,
      sourceRevision: this.compiled.sourceRevision,
      world: {
        time: this.world.time,
        stepnumber: this.world.stepnumber,
      },
      bodies: [...this.bodyByPart]
        .sort(([left], [right]) =>
          String(left).localeCompare(String(right), "en"),
        )
        .map(([partId, body]) => bodyState(partId, body)),
      entries,
      exclusionStates: this.collisionExclusionConstraints.map((entry) => ({
        id: entry.descriptor.id,
        active: entry.active !== false,
      })),
      phaseByPart: [...this.phaseByPart],
      loadByConnection: [...this.loadByConnection],
      torqueByConnection: [...this.torqueByConnection],
      motorElectricalWByPart: [...this.motorElectricalWByPart],
      activeLuminairePartIds: this.activeLuminairePartIds,
      fluidState: this.fluidState,
      topologyRevision: this.topologyRevision,
      solverStatePolicy: "deterministic-cold-start-v1",
    });
  }

  importState(state) {
    if (!this.compiled || state?.version !== 1)
      throw new DomainValidationError(
        "INVALID_MULTIBODY_CHECKPOINT",
        "Multibody checkpoint does not match the running runtime",
      );
    if (
      state.fixedDt !== this.fixedDt ||
      state.sourceRevision !== this.compiled.sourceRevision ||
      state.solverStatePolicy !== "deterministic-cold-start-v1"
    )
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_IDENTITY_MISMATCH",
        "Multibody checkpoint identities do not match the running runtime",
      );
    const bodies = new Map(
      state.bodies.map((record) => [record.partId, record]),
    );
    if (
      bodies.size !== this.bodyByPart.size ||
      [...this.bodyByPart.keys()].some((partId) => !bodies.has(partId))
    )
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_BODY_MISMATCH",
        "Multibody checkpoint body set does not match compiled topology",
      );
    const copyVector = (target, value) =>
        target.set(Number(value.x), Number(value.y), Number(value.z)),
      copyQuaternion = (target, value) =>
        target.set(
          Number(value.x),
          Number(value.y),
          Number(value.z),
          Number(value.w),
        );
    for (const [partId, body] of this.bodyByPart) {
      const record = bodies.get(partId);
      copyVector(body.position, record.position);
      copyVector(body.previousPosition, record.previousPosition);
      copyVector(body.interpolatedPosition, record.interpolatedPosition);
      copyQuaternion(body.quaternion, record.quaternion);
      copyQuaternion(body.previousQuaternion, record.previousQuaternion);
      copyQuaternion(
        body.interpolatedQuaternion,
        record.interpolatedQuaternion,
      );
      copyVector(body.velocity, record.velocity);
      copyVector(body.angularVelocity, record.angularVelocity);
      copyVector(body.force, record.force);
      copyVector(body.torque, record.torque);
      body.mass = record.mass;
      body.invMass = record.invMass;
      copyVector(body.inertia, record.inertia);
      copyVector(body.invInertia, record.invInertia);
      copyQuaternion(
        body.userData.massFrame.principalToPart,
        record.massFrame.principalToPart,
      );
      copyVector(body.userData.massFrame.comPart, record.massFrame.comPart);
      body.userData.massProperties = structuredClone(record.massProperties);
      if (
        record.shapeOffsets.length !== body.shapeOffsets.length ||
        record.shapeOrientations.length !== body.shapeOrientations.length
      )
        throw new DomainValidationError(
          "MULTIBODY_CHECKPOINT_SHAPE_MISMATCH",
          `Multibody checkpoint shape frame set changed for ${String(partId)}`,
        );
      for (let index = 0; index < body.shapeOffsets.length; index++) {
        copyVector(body.shapeOffsets[index], record.shapeOffsets[index]);
        copyQuaternion(
          body.shapeOrientations[index],
          record.shapeOrientations[index],
        );
      }
      body.sleepState = record.sleepState;
      body.timeLastSleepy = record.timeLastSleepy;
      body.aabbNeedsUpdate = true;
      body.updateInertiaWorld(true);
    }
    const entries = new Map(state.entries.map((record) => [record.id, record]));
    if (
      entries.size !== this.constraintEntries.length ||
      this.constraintEntries.some((entry) => !entries.has(entry.descriptor.id))
    )
      throw new DomainValidationError(
        "MULTIBODY_CHECKPOINT_CONSTRAINT_MISMATCH",
        "Multibody checkpoint constraint set does not match compiled topology",
      );
    for (const entry of this.constraintEntries) {
      const record = entries.get(entry.descriptor.id);
      if ((entry.kind || null) !== record.kind)
        throw new DomainValidationError(
          "MULTIBODY_CHECKPOINT_CONSTRAINT_KIND_MISMATCH",
          `Constraint ${entry.descriptor.id} changed kind`,
        );
      Object.assign(entry, structuredClone(record.values));
      if (entry.descriptor.kind === "fixed") {
        if (!record.fixedFrame)
          throw new DomainValidationError(
            "MULTIBODY_CHECKPOINT_FIXED_FRAME_MISMATCH",
            `Constraint ${entry.descriptor.id} is missing its fixed frame`,
          );
        for (const field of [
          "pivotA",
          "pivotB",
          "xA",
          "yA",
          "zA",
          "xB",
          "yB",
          "zB",
        ])
          copyVector(entry.constraint[field], record.fixedFrame[field]);
      }
      if (entry.kind === "rolling-contact-v1") {
        entry.constraint.state = structuredClone(record.tireState);
        entry.constraint.solvedContactRows = [];
      }
      if (entry.constraint)
        if (entry.active === false)
          this.world.removeConstraint(entry.constraint);
        else if (!this.world.constraints.includes(entry.constraint))
          this.world.addConstraint(entry.constraint);
    }
    const exclusionStates = new Map(
      state.exclusionStates.map((record) => [record.id, record.active]),
    );
    for (const entry of this.collisionExclusionConstraints) {
      entry.active = exclusionStates.get(entry.descriptor.id) !== false;
      if (!entry.active) this.world.removeConstraint(entry.constraint);
      else if (!this.world.constraints.includes(entry.constraint))
        this.world.addConstraint(entry.constraint);
    }
    this.world.time = state.world.time;
    this.world.stepnumber = state.world.stepnumber;
    this.world.contacts.length = 0;
    this.world.frictionEquations.length = 0;
    // Cannon body/shape IDs are process-local allocation handles. The declared
    // cold-start policy deliberately rebuilds broadphase, overlap, narrowphase,
    // friction, and solver rows from restored canonical bodies at the next
    // fixed tick instead of serializing those unstable handles.
    this.world.collisionMatrix.reset();
    this.world.collisionMatrixPrevious.reset();
    this.world.bodyOverlapKeeper.current.length = 0;
    this.world.bodyOverlapKeeper.previous.length = 0;
    this.world.shapeOverlapKeeper.current.length = 0;
    this.world.shapeOverlapKeeper.previous.length = 0;
    this.world.broadphase.dirty = true;
    this.phaseByPart = new Map(state.phaseByPart);
    this.loadByConnection = new Map(state.loadByConnection);
    this.torqueByConnection = new Map(state.torqueByConnection);
    this.motorElectricalWByPart = new Map(state.motorElectricalWByPart);
    this.activeLuminairePartIds = [...state.activeLuminairePartIds];
    this.fluidState = structuredClone(state.fluidState);
    this.topologyRevision = state.topologyRevision;
    this.lastTelemetry = this.telemetry(this.lastTelemetry?.activeMotors || 0);
  }

  dispose() {
    for (const entry of this.constraintEntries)
      if (entry.constraint) this.world.removeConstraint(entry.constraint);
    for (const entry of this.collisionExclusionConstraints)
      this.world.removeConstraint(entry.constraint);
    for (const body of this.bodyByPart.values()) this.world.removeBody(body);
    this.constraintEntries.length = 0;
    this.collisionExclusionConstraints.length = 0;
    this.bodyByPart.clear();
    this.phaseByPart.clear();
    this.loadByConnection.clear();
    this.torqueByConnection.clear();
    this.compiled = null;
    this.lastTelemetry = null;
    this.motorElectricalWByPart.clear();
    this.activeLuminairePartIds = [];
    this.fluidState = null;
    this.topologyRevision = 0;
  }
}

export function startMultibodyRuntime(snapshot, options) {
  const runtime = new MultibodyRuntime(options);
  runtime.start(snapshot);
  return runtime;
}
