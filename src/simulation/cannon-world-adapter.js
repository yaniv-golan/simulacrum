import * as CANNON from "cannon-es";
import {
  DomainValidationError,
  finiteNumber,
  stableStringify,
} from "../model/primitives.js";
import {
  CANNON_SOLVER_TRANSACTION_ID,
  CannonSolverTransaction,
  completedCannonSolverEvidence,
  completedCannonSolverEvidenceCandidates,
  stepCannonSolverTransaction,
} from "./cannon-solver-transaction.js";

const evidenceCapturingAdapters = new WeakSet();
const checkpointVectorIsFinite = (value) =>
  Boolean(
    value &&
    checkpointKeysMatch(value, ["x", "y", "z"]) &&
    [value.x, value.y, value.z].every(
      (component) =>
        typeof component === "number" && Number.isFinite(component),
    ),
  );
const checkpointQuaternionIsUnit = (value) => {
  if (
    !value ||
    !checkpointKeysMatch(value, ["x", "y", "z", "w"]) ||
    ![value.x, value.y, value.z, value.w].every(
      (component) =>
        typeof component === "number" && Number.isFinite(component),
    )
  )
    return false;
  const normSquared =
    value.x * value.x +
    value.y * value.y +
    value.z * value.z +
    value.w * value.w;
  return Math.abs(normSquared - 1) <= 1e-6;
};
const WORLD_KINEMATICS_POLICY = "world-kinematics-v1";
const OWNER_RECONSTRUCTION_POLICY = "reconstruct-from-owner-v1";
const EXTERNAL_BODY_BASE_FIELDS = Object.freeze([
  "externalBodyId",
  "type",
  "checkpointPolicy",
]);
const EXTERNAL_BODY_POSE_FIELDS = Object.freeze([
  "position",
  "previousPosition",
  "interpolatedPosition",
  "quaternion",
  "previousQuaternion",
  "interpolatedQuaternion",
]);
const EXTERNAL_BODY_IDENTITY_FIELDS = Object.freeze(["physicalIdentity"]);
const EXTERNAL_BODY_DYNAMIC_FIELDS = Object.freeze([
  "velocity",
  "angularVelocity",
  "force",
  "torque",
  "sleepState",
  "timeLastSleepy",
]);
const WORLD_ADAPTER_CHECKPOINT_FIELDS = Object.freeze([
  "session",
  "tick",
  "integratedTick",
  "integrationCount",
  "transactionId",
  "externalBodies",
]);

function checkpointPolicy(body) {
  return body?.userData?.checkpointPolicy || body?.checkpointPolicy || null;
}

function checkpointKeysMatch(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(),
    expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function physicalVector(value) {
  return { x: value.x, y: value.y, z: value.z };
}

function physicalQuaternion(value) {
  return { x: value.x, y: value.y, z: value.z, w: value.w };
}

function materialIdentity(material) {
  return material
    ? {
        name: material.name || null,
        friction: material.friction,
        restitution: material.restitution,
      }
    : null;
}

function contactMaterialIdentity(contactMaterial) {
  return {
    friction: contactMaterial.friction,
    restitution: contactMaterial.restitution,
    contactEquationStiffness: contactMaterial.contactEquationStiffness,
    contactEquationRelaxation: contactMaterial.contactEquationRelaxation,
    frictionEquationStiffness: contactMaterial.frictionEquationStiffness,
    frictionEquationRelaxation: contactMaterial.frictionEquationRelaxation,
  };
}

function materialContactIdentity(world, material) {
  if (!material) return null;
  const contacts = world.contactmaterials
    .filter((contactMaterial) => contactMaterial.materials.includes(material))
    .map((contactMaterial) => {
      const counterpart =
        contactMaterial.materials[0] === material
          ? contactMaterial.materials[1]
          : contactMaterial.materials[0];
      return {
        counterpart: materialIdentity(counterpart),
        contact: contactMaterialIdentity(contactMaterial),
      };
    })
    .sort((left, right) =>
      stableStringify(left).localeCompare(stableStringify(right), "en"),
    );
  return { ...materialIdentity(material), contacts };
}

function worldContactIdentity(world) {
  return {
    defaultContactMaterial: contactMaterialIdentity(
      world.defaultContactMaterial,
    ),
    frictionGravity: world.frictionGravity
      ? physicalVector(world.frictionGravity)
      : null,
  };
}

function shapePhysicalIdentity(shape, world) {
  const common = {
    type: shape.type,
    collisionResponse: shape.collisionResponse,
    collisionFilterGroup: shape.collisionFilterGroup,
    collisionFilterMask: shape.collisionFilterMask,
    material: materialContactIdentity(world, shape.material),
  };
  switch (shape.type) {
    case CANNON.Shape.types.SPHERE:
      return { ...common, radius: shape.radius };
    case CANNON.Shape.types.PLANE:
    case CANNON.Shape.types.PARTICLE:
      return common;
    case CANNON.Shape.types.BOX:
      return { ...common, halfExtents: physicalVector(shape.halfExtents) };
    case CANNON.Shape.types.CYLINDER:
      return {
        ...common,
        radiusTop: shape.radiusTop,
        radiusBottom: shape.radiusBottom,
        height: shape.height,
        numSegments: shape.numSegments,
      };
    case CANNON.Shape.types.CONVEXPOLYHEDRON:
      return {
        ...common,
        vertices: shape.vertices.map(physicalVector),
        faces: shape.faces.map((face) => [...face]),
        uniqueAxes: shape.uniqueAxes?.map(physicalVector) ?? null,
      };
    case CANNON.Shape.types.HEIGHTFIELD:
      return {
        ...common,
        data: shape.data.map((row) => [...row]),
        minValue: shape.minValue,
        maxValue: shape.maxValue,
        elementSize: shape.elementSize,
      };
    case CANNON.Shape.types.TRIMESH:
      return {
        ...common,
        vertices: Array.from(shape.vertices),
        indices: Array.from(shape.indices),
        scale: physicalVector(shape.scale),
      };
    default:
      throw new DomainValidationError(
        "UNSUPPORTED_EXTERNAL_BODY_CHECKPOINT_SHAPE",
        `External Cannon body shape type ${String(shape.type)} has no physical identity projection`,
      );
  }
}

function externalBodyPhysicalIdentity(body, world) {
  return {
    mass: body.mass,
    inertia: physicalVector(body.inertia),
    fixedRotation: body.fixedRotation,
    linearDamping: body.linearDamping,
    angularDamping: body.angularDamping,
    allowSleep: body.allowSleep,
    sleepSpeedLimit: body.sleepSpeedLimit,
    sleepTimeLimit: body.sleepTimeLimit,
    collisionResponse: body.collisionResponse,
    collisionFilterGroup: body.collisionFilterGroup,
    collisionFilterMask: body.collisionFilterMask,
    linearFactor: physicalVector(body.linearFactor),
    angularFactor: physicalVector(body.angularFactor),
    material: materialContactIdentity(world, body.material),
    contactWorld: worldContactIdentity(world),
    shapes: body.shapes.map((shape, index) => ({
      shape: shapePhysicalIdentity(shape, world),
      offset: physicalVector(body.shapeOffsets[index]),
      orientation: physicalQuaternion(body.shapeOrientations[index]),
    })),
  };
}

function invalidWorldCounter(field) {
  throw new DomainValidationError(
    "INVALID_CANNON_WORLD_CHECKPOINT_COUNTER",
    `Cannon checkpoint ${field} must be a nonnegative safe integer`,
  );
}

/** Internal completed-row view without extending the Core-exported class. */
export function completedWorldEvidenceContributions(adapter) {
  return completedCannonSolverEvidence(adapter.transaction);
}

/** Lightweight completed-row descriptors for bounded evidence selection. */
export function completedWorldEvidenceCandidates(adapter) {
  return completedCannonSolverEvidenceCandidates(adapter.transaction);
}

/** Marks exactly the next owned integration for provenance capture. */
export function requestWorldEvidenceCapture(adapter) {
  evidenceCapturingAdapters.add(adapter);
}

/**
 * The sole Cannon integration boundary. A simulation tick may integrate the
 * shared world exactly once, regardless of how many body-owning systems are
 * active in the assembly.
 */
export class CannonWorldAdapter {
  #tick = 0;
  #integratedTick = -1;
  #integrationCount = 0;
  #session = 0;

  constructor(world, transaction = new CannonSolverTransaction(world)) {
    if (!world)
      throw new DomainValidationError(
        "INVALID_CANNON_WORLD",
        "CannonWorldAdapter requires a world",
      );
    this.world = world;
    this.transaction = transaction;
  }

  beginSession() {
    this.transaction.beginSession?.();
    this.#session++;
    this.#tick = 0;
    this.#integratedTick = -1;
    this.#integrationCount = 0;
    return this.telemetry();
  }

  dispose() {
    evidenceCapturingAdapters.delete(this);
    this.transaction.dispose?.();
  }

  beginTick(tick = this.#tick + 1) {
    const next = finiteNumber(tick, { min: 0, path: ["tick"] });
    if (next < this.#tick)
      throw new DomainValidationError(
        "CANNON_TICK_REGRESSION",
        "Cannon integration tick cannot move backwards",
      );
    this.#tick = next;
    this.transaction.beginTick?.(next);
  }

  integrate(fixedDt, { tick = null } = {}) {
    if (tick != null) this.beginTick(tick);
    else if (this.#integratedTick === this.#tick) this.#tick++;
    if (this.#integratedTick === this.#tick)
      throw new DomainValidationError(
        "DUPLICATE_CANNON_INTEGRATION",
        `Cannon world already integrated for tick ${this.#tick}`,
      );
    const dt = finiteNumber(fixedDt, {
      min: Number.EPSILON,
      path: ["fixedDt"],
    });
    const captureEvidence = evidenceCapturingAdapters.has(this);
    try {
      stepCannonSolverTransaction(this.transaction, dt, this.#tick, {
        captureEvidence,
      });
    } finally {
      evidenceCapturingAdapters.delete(this);
    }
    this.#integratedTick = this.#tick;
    this.#integrationCount++;
    return this.telemetry();
  }

  telemetry() {
    return Object.freeze({
      session: this.#session,
      tick: this.#tick,
      integratedTick: this.#integratedTick,
      integrationCount: this.#integrationCount,
      transactionId: CANNON_SOLVER_TRANSACTION_ID,
    });
  }

  exportState() {
    this.transaction.assertMotorEnergySettled?.();
    const vector = (value) => ({ x: value.x, y: value.y, z: value.z }),
      quaternion = (value) => ({
        x: value.x,
        y: value.y,
        z: value.z,
        w: value.w,
      }),
      externalBodies = this.world.bodies
        .filter((body) => body.userData?.partId == null)
        .map((body) => {
          const externalBodyId = body.userData?.externalBodyId,
            policy = checkpointPolicy(body);
          if (!externalBodyId)
            throw new DomainValidationError(
              "UNOWNED_CANNON_CHECKPOINT_BODY",
              "Every non-component Cannon body must have a stable externalBodyId",
            );
          if (
            ![WORLD_KINEMATICS_POLICY, OWNER_RECONSTRUCTION_POLICY].includes(
              policy,
            )
          )
            throw new DomainValidationError(
              "INVALID_EXTERNAL_BODY_CHECKPOINT_POLICY",
              `External Cannon body ${externalBodyId} has an unknown checkpoint policy`,
            );
          if (policy === OWNER_RECONSTRUCTION_POLICY)
            return {
              externalBodyId,
              type: body.type,
              checkpointPolicy: policy,
            };
          return {
            externalBodyId,
            type: body.type,
            checkpointPolicy: policy,
            physicalIdentity: externalBodyPhysicalIdentity(body, this.world),
            position: vector(body.position),
            previousPosition: vector(body.previousPosition),
            interpolatedPosition: vector(body.interpolatedPosition),
            quaternion: quaternion(body.quaternion),
            previousQuaternion: quaternion(body.previousQuaternion),
            interpolatedQuaternion: quaternion(body.interpolatedQuaternion),
            ...(body.type === CANNON.Body.DYNAMIC
              ? {
                  velocity: vector(body.velocity),
                  angularVelocity: vector(body.angularVelocity),
                  force: vector(body.force),
                  torque: vector(body.torque),
                  sleepState: body.sleepState,
                  timeLastSleepy: body.timeLastSleepy,
                }
              : {}),
          };
        })
        .sort((left, right) =>
          left.externalBodyId.localeCompare(right.externalBodyId, "en"),
        );
    if (
      new Set(externalBodies.map((body) => body.externalBodyId)).size !==
      externalBodies.length
    )
      throw new DomainValidationError(
        "DUPLICATE_EXTERNAL_CANNON_BODY_ID",
        "External Cannon body IDs must be unique for checkpointing",
      );
    return structuredClone({ ...this.telemetry(), externalBodies });
  }

  validateState(state, { externalBodyPlans = [] } = {}) {
    if (
      !checkpointKeysMatch(state, WORLD_ADAPTER_CHECKPOINT_FIELDS) ||
      state.transactionId !== CANNON_SOLVER_TRANSACTION_ID ||
      !Array.isArray(state.externalBodies)
    )
      throw new DomainValidationError(
        "CANNON_TRANSACTION_CHECKPOINT_MISMATCH",
        "Cannon checkpoint must be an exact solver transaction projection",
      );
    const bodies = new Map(
        this.world.bodies
          .filter((body) => body.userData?.partId == null)
          .map((body) => [body.userData?.externalBodyId, body]),
      ),
      records = new Map(
        (state.externalBodies || []).map((record) => [
          record.externalBodyId,
          record,
        ]),
      );
    if (records.size !== (state.externalBodies || []).length)
      throw new DomainValidationError(
        "CANNON_EXTERNAL_BODY_CHECKPOINT_MISMATCH",
        "Checkpoint external body IDs must be unique",
      );
    for (const plan of externalBodyPlans) {
      for (const id of plan.currentExternalBodyIds || []) bodies.delete(id);
      for (const descriptor of plan.targetExternalBodies || [])
        bodies.set(descriptor.externalBodyId, descriptor);
    }
    if (
      bodies.has(undefined) ||
      bodies.size !== records.size ||
      [...bodies.keys()].some((id) => !records.has(id))
    )
      throw new DomainValidationError(
        "CANNON_EXTERNAL_BODY_CHECKPOINT_MISMATCH",
        "Checkpoint external bodies do not match the running world",
      );
    for (const [id, body] of bodies) {
      const record = records.get(id);
      if (record.type !== body.type)
        throw new DomainValidationError(
          "CANNON_EXTERNAL_BODY_TYPE_MISMATCH",
          `External Cannon body ${id} changed type`,
        );
      const policy = checkpointPolicy(body);
      if (
        ![WORLD_KINEMATICS_POLICY, OWNER_RECONSTRUCTION_POLICY].includes(policy)
      )
        throw new DomainValidationError(
          "INVALID_EXTERNAL_BODY_CHECKPOINT_POLICY",
          `External Cannon body ${id} must declare its checkpoint ownership policy`,
        );
      if (record.checkpointPolicy !== policy)
        throw new DomainValidationError(
          "CANNON_EXTERNAL_BODY_POLICY_MISMATCH",
          `External Cannon body ${id} changed checkpoint ownership policy`,
        );
      if (policy === OWNER_RECONSTRUCTION_POLICY) {
        if (!checkpointKeysMatch(record, EXTERNAL_BODY_BASE_FIELDS))
          throw new DomainValidationError(
            "CANNON_EXTERNAL_BODY_AUTHORITY_MISMATCH",
            `Owner-reconstructed external body ${id} cannot restore world state`,
          );
        continue;
      }
      const expectedFields = [
        ...EXTERNAL_BODY_BASE_FIELDS,
        ...EXTERNAL_BODY_IDENTITY_FIELDS,
        ...EXTERNAL_BODY_POSE_FIELDS,
        ...(body.type === CANNON.Body.DYNAMIC
          ? EXTERNAL_BODY_DYNAMIC_FIELDS
          : []),
      ];
      if (!checkpointKeysMatch(record, expectedFields))
        throw new DomainValidationError(
          "CANNON_EXTERNAL_BODY_AUTHORITY_MISMATCH",
          `External Cannon body ${id} checkpoint fields exceed world kinematic authority`,
        );
      if (
        stableStringify(record.physicalIdentity) !==
        stableStringify(externalBodyPhysicalIdentity(body, this.world))
      )
        throw new DomainValidationError(
          "CANNON_EXTERNAL_BODY_PHYSICAL_IDENTITY_MISMATCH",
          `External Cannon body ${id} changed mass, inertia, collision shape, or material identity`,
        );
      if (
        !["position", "previousPosition", "interpolatedPosition"].every(
          (field) => checkpointVectorIsFinite(record[field]),
        ) ||
        !["quaternion", "previousQuaternion", "interpolatedQuaternion"].every(
          (field) => checkpointQuaternionIsUnit(record[field]),
        )
      )
        throw new DomainValidationError(
          "INVALID_CANNON_EXTERNAL_BODY_CHECKPOINT",
          `External Cannon body ${id} contains invalid pose state`,
        );
      if (
        body.type === CANNON.Body.DYNAMIC &&
        (!["velocity", "angularVelocity", "force", "torque"].every((field) =>
          checkpointVectorIsFinite(record[field]),
        ) ||
          ![
            CANNON.Body.AWAKE,
            CANNON.Body.SLEEPY,
            CANNON.Body.SLEEPING,
          ].includes(record.sleepState) ||
          !Number.isFinite(record.timeLastSleepy) ||
          record.timeLastSleepy < 0)
      )
        throw new DomainValidationError(
          "INVALID_CANNON_EXTERNAL_BODY_CHECKPOINT",
          `External Cannon body ${id} contains invalid dynamic state`,
        );
    }
    for (const [field, minimum] of [
      ["session", 0],
      ["tick", 0],
      ["integratedTick", -1],
      ["integrationCount", 0],
    ])
      if (!Number.isSafeInteger(state[field]) || state[field] < minimum)
        invalidWorldCounter(field);
    return {
      bodies,
      records,
      session: finiteNumber(state.session, { min: 0 }),
      tick: finiteNumber(state.tick, { min: 0 }),
      integratedTick: finiteNumber(state.integratedTick, { min: -1 }),
      integrationCount: finiteNumber(state.integrationCount, { min: 0 }),
    };
  }

  importState(state) {
    const validated = this.validateState(state),
      { bodies, records } = validated;
    const copyVector = (target, value) => target.set(value.x, value.y, value.z),
      copyQuaternion = (target, value) =>
        target.set(value.x, value.y, value.z, value.w);
    for (const [id, body] of bodies) {
      const record = records.get(id);
      if (record.checkpointPolicy === OWNER_RECONSTRUCTION_POLICY) continue;
      copyVector(body.position, record.position);
      copyVector(body.previousPosition, record.previousPosition);
      copyVector(body.interpolatedPosition, record.interpolatedPosition);
      copyQuaternion(body.quaternion, record.quaternion);
      copyQuaternion(body.previousQuaternion, record.previousQuaternion);
      copyQuaternion(
        body.interpolatedQuaternion,
        record.interpolatedQuaternion,
      );
      if (body.type === CANNON.Body.DYNAMIC) {
        copyVector(body.velocity, record.velocity);
        copyVector(body.angularVelocity, record.angularVelocity);
        copyVector(body.force, record.force);
        copyVector(body.torque, record.torque);
        body.sleepState = record.sleepState;
        body.timeLastSleepy = record.timeLastSleepy;
      }
      body.aabbNeedsUpdate = true;
      body.updateInertiaWorld(true);
    }
    this.world.broadphase.dirty = true;
    this.#session = validated.session;
    this.#tick = validated.tick;
    this.#integratedTick = validated.integratedTick;
    this.#integrationCount = validated.integrationCount;
  }
}
