import { geometryDescriptorForPart } from "../model/geometry-descriptors.js";
import { componentDefinition } from "../model/component-contracts.js";
import { isOwnedImmutable } from "../model/owned-immutable-value.js";
import {
  canonicalId,
  deepFreeze,
  DomainValidationError,
  finiteNumber,
  finiteVector3,
} from "../model/primitives.js";

const zeroVector = () => ({ x: 0, y: 0, z: 0 });
const identityQuaternion = () => ({ x: 0, y: 0, z: 0, w: 1 });
const loadTransactions = new WeakMap();

function freezeFreshBodyValue(value, seen = new WeakSet()) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  if (seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freezeFreshBodyValue(child, seen);
  return Object.freeze(value);
}

// Existing body members are already immutable. Freeze only the fresh patch
// before replacing the shallow record; recursively walking unchanged geometry
// and prior samples at 120 Hz is redundant and becomes quadratic.
function updateFrozenBody(body, patch) {
  return Object.freeze({ ...body, ...freezeFreshBodyValue(patch) });
}

/** Internal fixed-step batch boundary; intentionally absent from Core. */
export function recordBodyLoads(registry, id, loads) {
  const record = loadTransactions.get(registry);
  if (!record)
    throw new TypeError("BodyRegistry load transaction is unavailable");
  return record(id, loads);
}

function vector(value, path) {
  const source = Array.isArray(value)
    ? value
    : [value?.x ?? 0, value?.y ?? 0, value?.z ?? 0];
  const [x, y, z] = finiteVector3(source, { path });
  return { x, y, z };
}

function evidenceValidity(value, fallback = "unavailable") {
  return ["measured", "derived", "unavailable", "truncated"].includes(value)
    ? value
    : fallback;
}

function quaternion(value, path) {
  const result = {
    x: finiteNumber(value?.x ?? 0, { path: [...path, "x"] }),
    y: finiteNumber(value?.y ?? 0, { path: [...path, "y"] }),
    z: finiteNumber(value?.z ?? 0, { path: [...path, "z"] }),
    w: finiteNumber(value?.w ?? 1, { path: [...path, "w"] }),
  };
  const length = Math.hypot(result.x, result.y, result.z, result.w);
  if (length < 1e-9)
    throw new DomainValidationError(
      "INVALID_QUATERNION",
      "Body orientation quaternion cannot be zero length",
      { path },
    );
  return {
    x: result.x / length,
    y: result.y / length,
    z: result.z / length,
    w: result.w / length,
  };
}

function initialBody(bodyId, partIds, descriptors) {
  return {
    bodyId,
    partIds: [...partIds],
    descriptors: structuredClone(descriptors),
    pose: { position: zeroVector(), quaternion: identityQuaternion() },
    velocity: zeroVector(),
    angularVelocity: zeroVector(),
    acceleration: zeroVector(),
    contacts: [],
    loads: [],
    thermal: {},
    massProperties: null,
    constraintIds: [],
    detached: false,
    bound: false,
  };
}

/**
 * Engine-neutral registry mapping every physical part ID to exactly one body.
 * Cannon references are private adapter handles and never enter telemetry.
 */
export class BodyRegistry {
  #bodies = new Map();
  #bodyByPart = new Map();
  #engineBodies = new Map();
  #constraints = new Map();
  #constraintByPart = new Map();
  #revision = 0;
  #tick = 0;
  #snapshotRevision = -1;
  #snapshotTick = -1;
  #snapshot = null;

  constructor(snapshot = {}, catalog) {
    for (const part of snapshot.parts || []) {
      const bodyId = `part:${String(part.id)}`,
        descriptor = componentDefinition(part, catalog)?.flexibleLine
          ? { kind: "flexible-line-source-v1", sourcePartId: part.id }
          : geometryDescriptorForPart(part, catalog);
      this.#bodies.set(
        bodyId,
        deepFreeze(initialBody(bodyId, [part.id], [descriptor])),
      );
      this.#bodyByPart.set(part.id, new Set([bodyId]));
    }
    loadTransactions.set(this, (id, loads) => this.#recordLoads(id, loads));
  }

  get revision() {
    return this.#revision;
  }

  get tick() {
    return this.#tick;
  }

  beginTick(tick = this.#tick + 1) {
    this.#tick = finiteNumber(tick, { min: 0, path: ["tick"] });
    for (const [id, body] of this.#bodies)
      this.#bodies.set(id, updateFrozenBody(body, { contacts: [], loads: [] }));
  }

  registerBody(bodyId, partIds, options = {}) {
    const {
      engineBody = null,
      constraintIds = [],
      pose = null,
      massProperties = null,
    } = /** @type {any} */ (options);
    const id = canonicalId(bodyId),
      ids = [...new Set(partIds || [])];
    if (!ids.length)
      throw new DomainValidationError(
        "EMPTY_BODY_MEMBERSHIP",
        "A body must own at least one component",
      );
    const descriptors = [];
    for (const partId of ids) {
      canonicalId(partId);
      const previousBodyId = this.#singleBodyIdForPart(partId);
      if (!previousBodyId)
        throw new DomainValidationError(
          "UNKNOWN_BODY_PART",
          `Part ${String(partId)} is not registered`,
        );
      const previousBody = this.#bodies.get(previousBodyId),
        index = previousBody.partIds.indexOf(partId);
      descriptors.push(previousBody.descriptors[index]);
    }
    for (const partId of ids) {
      const previousBodyId = this.#singleBodyIdForPart(partId),
        previousBody = this.#bodies.get(previousBodyId),
        index = previousBody.partIds.indexOf(partId),
        nextPartIds = previousBody.partIds.filter(
          (candidate) => candidate !== partId,
        ),
        nextDescriptors = previousBody.descriptors.filter(
          (_, descriptorIndex) => descriptorIndex !== index,
        );
      if (nextPartIds.length)
        this.#bodies.set(
          previousBodyId,
          deepFreeze({
            ...previousBody,
            partIds: nextPartIds,
            descriptors: nextDescriptors,
          }),
        );
      else {
        this.#bodies.delete(previousBodyId);
        this.#engineBodies.delete(previousBodyId);
      }
    }
    const body = initialBody(id, ids, descriptors);
    body.bound = true;
    body.constraintIds = [...new Set(constraintIds)];
    body.massProperties = massProperties
      ? structuredClone(massProperties)
      : null;
    if (pose)
      body.pose = {
        position: vector(pose.position, ["body", id, "position"]),
        quaternion: quaternion(pose.quaternion, ["body", id, "quaternion"]),
      };
    this.#bodies.set(id, deepFreeze(body));
    for (const partId of ids) this.#bodyByPart.set(partId, new Set([id]));
    if (engineBody) this.#engineBodies.set(id, engineBody);
    this.#revision++;
    return this.body(id);
  }

  registerPhysicalEntities(partId, entities) {
    const canonicalPartId = canonicalId(partId),
      currentIds = this.#bodyByPart.get(canonicalPartId);
    if (!currentIds)
      throw new DomainValidationError(
        "UNKNOWN_BODY_PART",
        `Part ${String(canonicalPartId)} is not registered`,
      );
    if (!Array.isArray(entities) || !entities.length)
      throw new DomainValidationError(
        "EMPTY_PHYSICAL_ENTITY_SET",
        `Part ${String(canonicalPartId)} requires at least one physical entity`,
      );
    for (const bodyId of currentIds) {
      const previous = this.#bodies.get(bodyId);
      if (
        previous &&
        (previous.partIds.length !== 1 ||
          previous.partIds[0] !== canonicalPartId)
      )
        throw new DomainValidationError(
          "PHYSICAL_ENTITY_PART_ALREADY_GROUPED",
          `Part ${String(canonicalPartId)} is already grouped with another part`,
        );
      this.#bodies.delete(bodyId);
      this.#engineBodies.delete(bodyId);
    }
    const nextIds = new Set();
    for (const [index, entity] of entities.entries()) {
      const id = canonicalId(entity?.bodyId);
      if (this.#bodies.has(id) || nextIds.has(id))
        throw new DomainValidationError(
          "DUPLICATE_PHYSICAL_ENTITY",
          `Physical entity ${String(id)} is already registered`,
        );
      const record = initialBody(
        id,
        [canonicalPartId],
        [
          structuredClone(
            entity.descriptor || {
              kind: "physical-entity-v1",
              sourcePartId: canonicalPartId,
              entityIndex: index,
            },
          ),
        ],
      );
      record.bound = true;
      record.constraintIds = [...new Set(entity.constraintIds || [])];
      record.massProperties = entity.massProperties
        ? structuredClone(entity.massProperties)
        : null;
      if (entity.pose)
        record.pose = {
          position: vector(entity.pose.position, ["body", id, "position"]),
          quaternion: quaternion(entity.pose.quaternion, [
            "body",
            id,
            "quaternion",
          ]),
        };
      this.#bodies.set(id, deepFreeze(record));
      if (entity.engineBody) this.#engineBodies.set(id, entity.engineBody);
      nextIds.add(id);
    }
    this.#bodyByPart.set(canonicalPartId, nextIds);
    this.#revision++;
    return this.bodiesForPart(canonicalPartId);
  }

  registerConstraint(constraintId, partId, options = {}) {
    const id = canonicalId(constraintId),
      canonicalPartId = canonicalId(partId),
      previousBodyId = this.#singleBodyIdForPart(canonicalPartId);
    if (!previousBodyId)
      throw new DomainValidationError(
        "UNKNOWN_CONSTRAINT_PART",
        `Part ${String(canonicalPartId)} is not available for constraint binding`,
      );
    const previousBody = this.#bodies.get(previousBodyId),
      index = previousBody.partIds.indexOf(canonicalPartId),
      nextPartIds = previousBody.partIds.filter(
        (candidate) => candidate !== canonicalPartId,
      ),
      nextDescriptors = previousBody.descriptors.filter(
        (_, descriptorIndex) => descriptorIndex !== index,
      );
    if (nextPartIds.length)
      this.#bodies.set(
        previousBodyId,
        deepFreeze({
          ...previousBody,
          partIds: nextPartIds,
          descriptors: nextDescriptors,
        }),
      );
    else {
      this.#bodies.delete(previousBodyId);
      this.#engineBodies.delete(previousBodyId);
    }
    this.#bodyByPart.delete(canonicalPartId);
    const constraint = {
      constraintId: id,
      partId: canonicalPartId,
      sourceConnectionIds: [...new Set(options.sourceConnectionIds || [])],
      pose: {
        position: vector(options.pose?.position, [
          "constraint",
          id,
          "position",
        ]),
        quaternion: quaternion(options.pose?.quaternion, [
          "constraint",
          id,
          "quaternion",
        ]),
      },
      angle: finiteNumber(options.angle || 0, {
        path: ["constraint", id, "angle"],
      }),
      angularVelocity: finiteNumber(options.angularVelocity || 0, {
        path: ["constraint", id, "angularVelocity"],
      }),
      reactionTorque: finiteNumber(options.reactionTorque || 0, {
        min: 0,
        path: ["constraint", id, "reactionTorque"],
      }),
      detached: false,
      bound: true,
    };
    this.#constraints.set(id, deepFreeze(constraint));
    this.#constraintByPart.set(canonicalPartId, id);
    this.#revision++;
    return this.constraint(id);
  }

  body(id) {
    return this.#bodies.get(id) || null;
  }

  bodyForPart(partId) {
    const bodyIds = this.#bodyByPart.get(partId);
    if (!bodyIds || bodyIds.size !== 1) return null;
    return this.body(bodyIds.values().next().value);
  }

  bodiesForPart(partId) {
    return Object.freeze(
      [...(this.#bodyByPart.get(partId) || [])]
        .map((bodyId) => this.body(bodyId))
        .filter(Boolean),
    );
  }

  constraint(id) {
    return this.#constraints.get(id) || null;
  }

  constraintForPart(partId) {
    const constraintId = this.#constraintByPart.get(partId);
    return constraintId ? this.constraint(constraintId) : null;
  }

  /** Stable adapter bindings without cloning the complete per-tick registry. */
  constraintBindings() {
    return [...this.#constraints.values()].map(({ constraintId, partId }) => ({
      constraintId,
      partId,
    }));
  }

  updateConstraint(id, options = {}) {
    const canonical = canonicalId(id),
      current = this.#constraints.get(canonical);
    if (!current)
      throw new DomainValidationError(
        "UNKNOWN_CONSTRAINT_BINDING",
        `Constraint ${String(canonical)} is not registered`,
      );
    this.#constraints.set(
      canonical,
      deepFreeze({
        ...current,
        pose: {
          position: vector(options.pose?.position ?? current.pose.position, [
            "constraint",
            canonical,
            "position",
          ]),
          quaternion: quaternion(
            options.pose?.quaternion ?? current.pose.quaternion,
            ["constraint", canonical, "quaternion"],
          ),
        },
        angle: finiteNumber(options.angle ?? current.angle, {
          path: ["constraint", canonical, "angle"],
        }),
        angularVelocity: finiteNumber(
          options.angularVelocity ?? current.angularVelocity,
          { path: ["constraint", canonical, "angularVelocity"] },
        ),
        reactionTorque: finiteNumber(
          options.reactionTorque ?? current.reactionTorque,
          { min: 0, path: ["constraint", canonical, "reactionTorque"] },
        ),
        detached: Boolean(options.detached ?? current.detached),
      }),
    );
    this.#revision++;
    return this.constraint(canonical);
  }

  engineBody(id) {
    return this.#engineBodies.get(id) || null;
  }

  bodyIdForEngineBody(engineBody) {
    for (const [id, candidate] of this.#engineBodies)
      if (candidate === engineBody) return id;
    return null;
  }

  engineEntries() {
    return [...this.#engineBodies].map(([bodyId, engineBody]) => ({
      bodyId,
      engineBody,
    }));
  }

  updateKinematics(id, options = {}, dt = 0) {
    const {
      position,
      quaternion: orientation,
      velocity,
      angularVelocity,
    } = /** @type {any} */ (options);
    const body = this.#requireBody(id),
      nextPosition = vector(position ?? body.pose.position, [
        "body",
        id,
        "position",
      ]),
      nextVelocity = vector(velocity ?? body.velocity, [
        "body",
        id,
        "velocity",
      ]),
      seconds = finiteNumber(dt, { min: 0, path: ["body", id, "dt"] }),
      acceleration = seconds
        ? {
            x: (nextVelocity.x - body.velocity.x) / seconds,
            y: (nextVelocity.y - body.velocity.y) / seconds,
            z: (nextVelocity.z - body.velocity.z) / seconds,
          }
        : body.acceleration;
    this.#bodies.set(
      id,
      updateFrozenBody(body, {
        pose: {
          position: nextPosition,
          quaternion: quaternion(orientation ?? body.pose.quaternion, [
            "body",
            id,
            "quaternion",
          ]),
        },
        velocity: nextVelocity,
        angularVelocity: vector(angularVelocity ?? body.angularVelocity, [
          "body",
          id,
          "angularVelocity",
        ]),
        acceleration,
      }),
    );
    this.#revision++;
    return this.body(id);
  }

  recordContact(id, contact) {
    const body = this.#requireBody(id),
      sample = freezeFreshBodyValue({
        tick: finiteNumber(contact?.tick ?? this.#tick, {
          min: 0,
          path: ["body", id, "contact", "tick"],
        }),
        contactId:
          typeof contact?.contactId === "string" && contact.contactId
            ? contact.contactId
            : null,
        point: vector(contact?.point, ["body", id, "contact", "point"]),
        normal: vector(contact?.normal, ["body", id, "contact", "normal"]),
        forceN: finiteNumber(contact?.forceN ?? contact?.force ?? 0, {
          min: 0,
          path: ["body", id, "contact", "forceN"],
        }),
        impulseNs: finiteNumber(contact?.impulseNs ?? 0, {
          min: 0,
          path: ["body", id, "contact", "impulseNs"],
        }),
        relativeVelocity: vector(contact?.relativeVelocity, [
          "body",
          id,
          "contact",
          "relativeVelocity",
        ]),
        forceWorldN: vector(contact?.forceWorldN, [
          "body",
          id,
          "contact",
          "forceWorldN",
        ]),
        otherBodyId: contact?.otherBodyId ?? null,
        otherMaterialKey: contact?.otherMaterialKey ?? null,
        otherShapeId: contact?.otherShapeId ?? null,
        supportShapeId: contact?.supportShapeId ?? null,
        surfaceRegionId: contact?.surfaceRegionId ?? null,
        featureId: contact?.featureId
          ? structuredClone(contact.featureId)
          : null,
        featureValidity: evidenceValidity(contact?.featureValidity),
        tireEvidence: contact?.tireEvidence
          ? structuredClone(contact.tireEvidence)
          : null,
        validity: evidenceValidity(contact?.validity),
        surface: contact?.surface ?? null,
      });
    this.#bodies.set(
      id,
      updateFrozenBody(body, { contacts: [...body.contacts, sample] }),
    );
    this.#revision++;
    return sample;
  }

  recordLoad(id, load) {
    return this.#recordLoads(id, [load])[0];
  }

  #recordLoads(id, loads) {
    const body = this.#requireBody(id);
    if (!Array.isArray(loads))
      throw new DomainValidationError(
        "INVALID_BODY_LOAD_TRANSACTION",
        `Body ${String(id)} loads must be an array`,
      );
    const samples = loads.map((load, index) =>
      deepFreeze({
        connectionId: load?.connectionId ?? null,
        forceN: finiteNumber(load?.forceN ?? 0, {
          min: 0,
          path: ["body", id, "loads", index, "forceN"],
        }),
        torqueNm: finiteNumber(load?.torqueNm ?? 0, {
          min: 0,
          path: ["body", id, "loads", index, "torqueNm"],
        }),
      }),
    );
    this.#bodies.set(
      id,
      updateFrozenBody(body, { loads: [...body.loads, ...samples] }),
    );
    if (samples.length) this.#revision++;
    return Object.freeze(samples);
  }

  setThermal(id, thermal) {
    const body = this.#requireBody(id);
    this.#bodies.set(
      id,
      updateFrozenBody(body, {
        thermal: isOwnedImmutable(thermal)
          ? thermal
          : structuredClone(thermal || {}),
      }),
    );
    this.#revision++;
    return this.body(id);
  }

  setMassProperties(id, massProperties) {
    const body = this.#requireBody(id),
      massKg = Number(massProperties?.massKg),
      center = massProperties?.comPositionPartM,
      moments = massProperties?.principalMomentsKgM2;
    if (
      !Number.isFinite(massKg) ||
      massKg <= 0 ||
      !Array.isArray(center) ||
      center.length !== 3 ||
      center.some((value) => !Number.isFinite(value)) ||
      !Array.isArray(moments) ||
      moments.length !== 3 ||
      moments.some((value) => !Number.isFinite(value) || value <= 0)
    )
      throw new DomainValidationError(
        "INVALID_BODY_MASS_PROPERTIES",
        `Body ${String(id)} requires finite positive mass properties`,
      );
    this.#bodies.set(
      id,
      updateFrozenBody(body, {
        massProperties: structuredClone(massProperties),
      }),
    );
    this.#revision++;
    return this.body(id);
  }

  setDetached(id, detached = true) {
    const body = this.#requireBody(id);
    if (body.detached === Boolean(detached)) return this.body(id);
    this.#bodies.set(
      id,
      updateFrozenBody(body, { detached: Boolean(detached) }),
    );
    this.#revision++;
    return this.body(id);
  }

  removeConstraint(constraintId) {
    let changed = false;
    for (const [id, body] of this.#bodies) {
      const next = body.constraintIds.filter(
        (candidate) => candidate !== constraintId,
      );
      if (next.length === body.constraintIds.length) continue;
      this.#bodies.set(id, updateFrozenBody(body, { constraintIds: next }));
      changed = true;
    }
    if (changed) this.#revision++;
    return changed;
  }

  snapshot() {
    if (
      this.#snapshotRevision === this.#revision &&
      this.#snapshotTick === this.#tick
    )
      return this.#snapshot;
    this.#snapshot = Object.freeze({
      schemaVersion: 1,
      revision: this.#revision,
      tick: this.#tick,
      bodies: Object.freeze([...this.#bodies.values()]),
      bodyByPart: Object.freeze(
        [...this.#bodyByPart].flatMap(([partId, bodyIds]) =>
          [...bodyIds].map((bodyId) => Object.freeze({ partId, bodyId })),
        ),
      ),
      constraints: Object.freeze([...this.#constraints.values()]),
      constraintByPart: Object.freeze(
        [...this.#constraintByPart].map(([partId, constraintId]) =>
          Object.freeze({ partId, constraintId }),
        ),
      ),
    });
    this.#snapshotRevision = this.#revision;
    this.#snapshotTick = this.#tick;
    return this.#snapshot;
  }

  exportState() {
    return structuredClone(this.snapshot());
  }

  importState(state) {
    if (state?.schemaVersion !== 1)
      throw new DomainValidationError(
        "INVALID_BODY_REGISTRY_CHECKPOINT",
        "Body registry checkpoint must use schema version 1",
      );
    const bodies = new Map(
        (state.bodies || []).map((body) => [body.bodyId, body]),
      ),
      bodyByPart = new Map(),
      constraints = new Map(
        (state.constraints || []).map((constraint) => [
          constraint.constraintId,
          constraint,
        ]),
      ),
      constraintByPart = new Map(
        (state.constraintByPart || []).map(({ partId, constraintId }) => [
          partId,
          constraintId,
        ]),
      );
    for (const { partId, bodyId } of state.bodyByPart || []) {
      const ids = bodyByPart.get(partId) || new Set();
      ids.add(bodyId);
      bodyByPart.set(partId, ids);
    }
    const samePartBindings =
      bodyByPart.size === this.#bodyByPart.size &&
      [...this.#bodyByPart].every(([partId, expected]) => {
        const actual = bodyByPart.get(partId);
        return (
          actual?.size === expected.size &&
          [...expected].every((bodyId) => actual.has(bodyId))
        );
      });
    if (
      bodies.size !== this.#bodies.size ||
      [...this.#bodies.keys()].some((bodyId) => !bodies.has(bodyId)) ||
      constraints.size !== this.#constraints.size ||
      [...this.#constraints.keys()].some(
        (constraintId) => !constraints.has(constraintId),
      ) ||
      !samePartBindings ||
      constraintByPart.size !== this.#constraintByPart.size ||
      [...this.#constraintByPart.keys()].some(
        (partId) => !constraintByPart.has(partId),
      )
    )
      throw new DomainValidationError(
        "BODY_REGISTRY_CHECKPOINT_IDENTITY_MISMATCH",
        "Body registry checkpoint does not match the running topology",
      );
    this.#bodies = new Map(
      [...bodies].map(([id, body]) => [id, deepFreeze(structuredClone(body))]),
    );
    this.#bodyByPart = bodyByPart;
    this.#constraints = new Map(
      [...constraints].map(([id, constraint]) => [
        id,
        deepFreeze(structuredClone(constraint)),
      ]),
    );
    this.#constraintByPart = constraintByPart;
    this.#revision = finiteNumber(state.revision, {
      min: 0,
      path: ["checkpoint", "revision"],
    });
    this.#tick = finiteNumber(state.tick, {
      min: 0,
      path: ["checkpoint", "tick"],
    });
    this.#snapshotRevision = -1;
    this.#snapshotTick = -1;
    this.#snapshot = null;
  }

  #singleBodyIdForPart(partId) {
    const bodyIds = this.#bodyByPart.get(partId);
    return bodyIds?.size === 1 ? bodyIds.values().next().value : null;
  }

  #requireBody(id) {
    const canonical = canonicalId(id),
      body = this.#bodies.get(canonical);
    if (!body)
      throw new DomainValidationError(
        "UNKNOWN_BODY",
        `Body ${String(id)} is not registered`,
      );
    return body;
  }
}
