import * as CANNON from "cannon-es";
import { flexibleLineMaterial } from "../model/flexible-line-materials.js";
import { flexibleRuntimeBoundsWorldM } from "../model/component-geometry-contract.js";
import {
  DomainValidationError,
  identitySetUsesTypedStrings,
  identityToken,
} from "../model/primitives.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../model/plain-data-contract.js";
import { TensionOnlyDistanceConstraint } from "./tension-only-distance-constraint.js";

const plainVector = ({ x, y, z }) => ({ x, y, z });
const plainQuaternion = ({ x, y, z, w }) => ({ x, y, z, w });
const checkpointKeysMatch = (value, expected) =>
  Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key)),
  );
const finiteVector = (value) =>
  Boolean(
    checkpointKeysMatch(value, ["x", "y", "z"]) &&
    [value.x, value.y, value.z].every(Number.isFinite),
  );
const unitQuaternion = (value) => {
  if (
    !checkpointKeysMatch(value, ["x", "y", "z", "w"]) ||
    ![value.x, value.y, value.z, value.w].every(Number.isFinite)
  )
    return false;
  const normSquared =
    value.x * value.x +
    value.y * value.y +
    value.z * value.z +
    value.w * value.w;
  return Math.abs(normSquared - 1) <= 1e-6;
};
const MAX_CONTACT_SAMPLES_PER_LINE = 16;
const totalLength = (centerline) =>
  centerline.slice(1).reduce((sum, point, index) => {
    const previous = centerline[index];
    return (
      sum +
      Math.hypot(
        point.x - previous.x,
        point.y - previous.y,
        point.z - previous.z,
      )
    );
  }, 0);

function endpointBody(line, attachment, bodies) {
  const index = attachment.endpointIndex === 0 ? 0 : line.entities.length - 1;
  return bodies.get(line.entities[index].id);
}

function bodyMaterialKey(body, shape, contact) {
  return (
    contact.surfaceMaterialKey ||
    shape?.userData?.materialKey ||
    body?.userData?.materialKey ||
    shape?.material?.name ||
    body?.material?.name ||
    null
  );
}

function contactRecord(contact, body) {
  const bodyIsA = contact.bi === body,
    offset = bodyIsA ? contact.ri : contact.rj,
    otherBody = bodyIsA ? contact.bj : contact.bi,
    otherShape = bodyIsA ? contact.sj : contact.si,
    point = body.position.vadd(offset),
    normalScale = bodyIsA ? -1 : 1;
  return {
    point: plainVector(point),
    normal: {
      x: contact.ni.x * normalScale,
      y: contact.ni.y * normalScale,
      z: contact.ni.z * normalScale,
    },
    forceN: Math.abs(Number(contact.multiplier || 0)),
    otherBodyId:
      otherBody.userData?.partId ?? otherBody.userData?.externalBodyId ?? null,
    otherMaterialKey: bodyMaterialKey(otherBody, otherShape, contact),
  };
}

/** Owns distributed flexible entities inside the production shared Cannon world. */
export class FlexibleLineRuntime {
  constructor({
    world,
    material = null,
    materialForKey = null,
    multibodyRuntime,
    fixedDt = 1 / 120,
  }) {
    this.world = world;
    this.material = material;
    this.materialForKey = materialForKey;
    this.multibodyRuntime = multibodyRuntime;
    this.fixedDt = fixedDt;
    this.compiledLines = [];
    this.bodyByEntityId = new Map();
    this.edgeEntries = [];
    this.attachmentEntries = [];
    this.loadByConnection = new Map();
    this.lastTelemetry = { version: 1, lines: [], topologyEvents: [] };
    this.topologyRevision = 0;
    this.lastDissipationTick = -1;
    this.contactDissipationByPart = new Map();
    this.connectionIdsUseTypedStrings = false;
  }

  start(compiledAssembly) {
    this.dispose();
    this.compiledLines = compiledAssembly?.flexibleLines || [];
    const sourceConnectionIds = this.compiledLines.flatMap((line) => [
      ...line.internalEdges.flatMap((edge) => edge.sourceConnectionIds || []),
      ...line.attachments
        .filter((attachment) => attachment.kind === "point-attachment-v1")
        .map((attachment) => attachment.sourceConnectionId),
    ]);
    this.connectionIdsUseTypedStrings =
      identitySetUsesTypedStrings(sourceConnectionIds);
    for (const line of this.compiledLines) {
      for (const entity of line.entities) {
        const lineMaterial = this.materialForKey
          ? this.materialForKey(line.materialKey)
          : this.material;
        if (!lineMaterial)
          throw new DomainValidationError(
            "FLEXIBLE_LINE_MATERIAL_MISSING",
            `Flexible line ${line.id} has no Cannon material`,
          );
        const body = new CANNON.Body({
          mass: entity.massKg,
          material: lineMaterial,
          position: new CANNON.Vec3(...entity.positionWorldM),
          shape: new CANNON.Sphere(entity.radiusM),
        });
        body.linearDamping = 0.01;
        body.angularDamping = 0.05;
        body.allowSleep = false;
        body.collisionFilterGroup = 8;
        body.collisionFilterMask = 1 | 8;
        const runtimeBody = /** @type {any} */ (body);
        runtimeBody.userData = {
          ...(runtimeBody.userData || {}),
          partId: line.sourcePartId,
          flexibleEntityId: entity.id,
          materialKey: line.materialKey,
        };
        this.world.addBody(body);
        this.bodyByEntityId.set(entity.id, body);
      }
      for (const edge of line.internalEdges) {
        const bodyA = this.bodyByEntityId.get(edge.entityAId),
          bodyB = this.bodyByEntityId.get(edge.entityBId),
          constraint = new TensionOnlyDistanceConstraint(bodyA, bodyB, {
            restLengthM: edge.restLengthM,
            maximumTensionN: edge.ultimateTensionN * 4,
            stiffnessNPerM: edge.axialStiffnessNPerM,
            relaxation: 3,
            timeStepS: this.fixedDt,
          });
        constraint.collideConnected = false;
        /** @type {any} */ (constraint).simulacrumEvidence = Object.freeze({
          constraintId: String(edge.id),
          sourceConnectionIds: Object.freeze(
            [...new Set(edge.sourceConnectionIds || [])]
              .map((sourceConnectionId) =>
                identityToken(sourceConnectionId, {
                  typedStrings: this.connectionIdsUseTypedStrings,
                }),
              )
              .sort(),
          ),
          source: "constraint",
        });
        this.world.addConstraint(constraint);
        this.edgeEntries.push({
          descriptor: edge,
          constraint,
          active: true,
          dampingWorkJ: 0,
        });
      }
      for (const attachment of line.attachments || []) {
        if (attachment?.kind !== "point-attachment-v1") continue;
        const nodeBody = endpointBody(line, attachment, this.bodyByEntityId),
          targetBody = this.multibodyRuntime?.bodyByPart.get(
            attachment.targetPartId,
          );
        if (!nodeBody || !targetBody)
          throw new DomainValidationError(
            "FLEXIBLE_ATTACHMENT_BODY_MISSING",
            `Flexible attachment ${attachment.sourceConnectionId} has no target body`,
          );
        const pivotTarget = targetBody.pointToLocalFrame(
            new CANNON.Vec3(...attachment.anchorWorldM),
          ),
          constraint = new CANNON.PointToPointConstraint(
            nodeBody,
            new CANNON.Vec3(),
            targetBody,
            pivotTarget,
            attachment.ultimateForceN * 4,
          );
        const sourceConnectionId = identityToken(
          attachment.sourceConnectionId,
          { typedStrings: this.connectionIdsUseTypedStrings },
        );
        /** @type {any} */ (constraint).simulacrumEvidence = Object.freeze({
          constraintId: `flexible-attachment:${sourceConnectionId}`,
          sourceConnectionIds: Object.freeze([sourceConnectionId]),
          source: "constraint",
        });
        this.world.addConstraint(constraint);
        this.attachmentEntries.push({
          descriptor: attachment,
          constraint,
          nodeBody,
          targetBody,
          active: true,
          lastReactionN: 0,
        });
      }
    }
    return this;
  }

  registerBodyEntities(registry) {
    for (const line of this.compiledLines)
      registry.registerPhysicalEntities(
        line.sourcePartId,
        line.entities.map((entity) => {
          const engineBody = this.bodyByEntityId.get(entity.id);
          return {
            bodyId: entity.id,
            engineBody,
            descriptor: {
              kind: "flexible-line-node-v1",
              sourcePartId: line.sourcePartId,
              nodeIndex: entity.nodeIndex,
              radiusM: entity.radiusM,
              massKg: entity.massKg,
            },
            pose: {
              position: engineBody.position,
              quaternion: engineBody.quaternion,
            },
          };
        }),
      );
  }

  beforeIntegration(dt) {
    for (const entry of this.edgeEntries) {
      if (!entry.active) continue;
      const { bodyA, bodyB } = entry.constraint,
        delta = bodyB.position.vsub(bodyA.position),
        length = delta.length();
      if (length <= entry.descriptor.restLengthM || length < 1e-9) continue;
      const axis = delta.scale(1 / length),
        relativeSpeed = bodyB.velocity.vsub(bodyA.velocity).dot(axis),
        dampingForceN = Math.max(
          0,
          relativeSpeed * entry.descriptor.axialDampingNsPerM,
        ),
        force = axis.scale(dampingForceN);
      bodyA.applyForce(force);
      bodyB.applyForce(force.negate());
      entry.dampingWorkJ += dampingForceN * relativeSpeed * dt;
    }
  }

  afterIntegration(tick, environment = {}) {
    const topologyEvents = [];
    this.loadByConnection.clear();
    const governingFailures = new Map();
    for (const entry of this.edgeEntries) {
      if (!entry.active) continue;
      const tensionN = entry.constraint.tensionN();
      if (tensionN <= entry.descriptor.ultimateTensionN) continue;
      const utilization = tensionN / entry.descriptor.ultimateTensionN,
        current = governingFailures.get(entry.descriptor.sourcePartId);
      if (
        !current ||
        utilization > current.utilization ||
        (utilization === current.utilization &&
          entry.descriptor.id.localeCompare(current.entry.descriptor.id) < 0)
      )
        governingFailures.set(entry.descriptor.sourcePartId, {
          entry,
          tensionN,
          utilization,
        });
    }
    for (const { entry, tensionN } of [...governingFailures.values()].sort(
      (left, right) =>
        String(left.entry.descriptor.sourcePartId).localeCompare(
          String(right.entry.descriptor.sourcePartId),
        ),
    )) {
      const line = this.compiledLines.find(
          (candidate) =>
            candidate.sourcePartId === entry.descriptor.sourcePartId,
        ),
        material = flexibleLineMaterial(line.materialKey),
        edgeIndex = entry.descriptor.edgeIndex;
      entry.active = false;
      this.world.removeConstraint(entry.constraint);
      this.topologyRevision++;
      topologyEvents.push({
        id: `flexible-break:${entry.descriptor.id}:${tick}`,
        kind: "flexible-internal-break-v1",
        sourcePartId: entry.descriptor.sourcePartId,
        internalEdgeId: entry.descriptor.id,
        tick,
        tensionN,
        strain: entry.constraint.extensionM() / entry.descriptor.restLengthM,
        impulseNs: tensionN * this.fixedDt,
        ratingN: entry.descriptor.ultimateTensionN,
        materialKey: line.materialKey,
        failureLaw: material.failureLaw,
        predecessorIds: (line.attachments || [])
          .filter((attachment) => attachment.kind === "point-attachment-v1")
          .map((attachment) => attachment.sourceConnectionId)
          .sort(),
        activeElementIds: this.edgeEntries
          .filter(
            (candidate) =>
              candidate.active &&
              candidate.descriptor.sourcePartId === line.sourcePartId,
          )
          .map((candidate) => candidate.descriptor.id),
        survivingFragments: [
          line.entities.slice(0, edgeIndex + 1).map((entity) => entity.id),
          line.entities.slice(edgeIndex + 1).map((entity) => entity.id),
        ],
        worldPosition: plainVector(
          entry.constraint.bodyA.position
            .vadd(entry.constraint.bodyB.position)
            .scale(0.5),
        ),
      });
    }
    for (const entry of this.attachmentEntries) {
      if (!entry.active) continue;
      entry.lastReactionN = Math.hypot(
        ...entry.constraint.equations.map((equation) => equation.multiplier),
      );
      this.loadByConnection.set(
        entry.descriptor.sourceConnectionId,
        entry.lastReactionN,
      );
    }
    if (tick !== this.lastDissipationTick) {
      for (const equation of this.world.frictionEquations || []) {
        const partIds = new Set(
          [equation.bi, equation.bj]
            .map((body) =>
              body.userData?.flexibleEntityId ? body.userData.partId : null,
            )
            .filter((partId) => partId != null),
        );
        if (!partIds.size) continue;
        const dissipatedJ = Math.max(
          0,
          Math.abs(
            Number(equation.multiplier || 0) *
              Number(equation.computeGW?.() || 0) *
              this.fixedDt,
          ),
        );
        for (const partId of partIds)
          this.contactDissipationByPart.set(
            partId,
            (this.contactDissipationByPart.get(partId) || 0) + dissipatedJ,
          );
      }
      this.lastDissipationTick = tick;
    }
    this.lastTelemetry = {
      version: 1,
      topologyRevision: this.topologyRevision,
      lines: this.compiledLines.map((line) => {
        const edges = this.edgeEntries.filter(
            (entry) => entry.descriptor.sourcePartId === line.sourcePartId,
          ),
          tensions = edges.map((entry) =>
            entry.active ? entry.constraint.tensionN() : 0,
          ),
          attachments = this.attachmentEntries.filter(
            (entry) => entry.descriptor.sourcePartId === line.sourcePartId,
          ),
          centerline = line.entities.map((entity) =>
            plainVector(this.bodyByEntityId.get(entity.id).position),
          ),
          endToEndDistanceM = Math.hypot(
            centerline.at(-1).x - centerline[0].x,
            centerline.at(-1).y - centerline[0].y,
            centerline.at(-1).z - centerline[0].z,
          ),
          maximumTensionN = Math.max(0, ...tensions),
          maximumStrain = Math.max(
            0,
            ...edges.map((entry) =>
              entry.active
                ? entry.constraint.extensionM() / entry.descriptor.restLengthM
                : 0,
            ),
          ),
          elasticEnergyJ = edges.reduce((sum, entry) => {
            if (!entry.active) return sum;
            const extensionM = entry.constraint.extensionM();
            return (
              sum + 0.5 * entry.descriptor.axialStiffnessNPerM * extensionM ** 2
            );
          }, 0),
          dampingDissipationJ = edges.reduce(
            (sum, entry) => sum + entry.dampingWorkJ,
            0,
          ),
          boundaries = line.attachments.map((descriptor) => {
            const runtimeAttachment = attachments.find(
              (entry) =>
                entry.descriptor.endpointPortId === descriptor.endpointPortId,
            );
            return descriptor.kind === "free-v1" || !runtimeAttachment?.active
              ? {
                  endpointPortId: descriptor.endpointPortId,
                  state: "free",
                  tensionN: runtimeAttachment?.lastReactionN || 0,
                }
              : {
                  endpointPortId: descriptor.endpointPortId,
                  state: "attached",
                  targetPartId: descriptor.targetPartId,
                  targetPortId: descriptor.targetPortId,
                  sourceConnectionId: descriptor.sourceConnectionId,
                  tensionN: runtimeAttachment.lastReactionN,
                  ratingN: descriptor.ultimateForceN,
                };
          }),
          lineBodies = new Set(
            line.entities.map((entity) => this.bodyByEntityId.get(entity.id)),
          ),
          contacts = (this.world.contacts || []).filter(
            (contact) =>
              lineBodies.has(contact.bi) || lineBodies.has(contact.bj),
          ),
          contactSamples = contacts
            .slice(0, MAX_CONTACT_SAMPLES_PER_LINE)
            .map((contact) =>
              contactRecord(
                contact,
                lineBodies.has(contact.bi) ? contact.bi : contact.bj,
              ),
            ),
          internalMargins = edges.map((entry) => ({
            id: entry.descriptor.id,
            margin:
              1 -
              (entry.active
                ? entry.constraint.tensionN()
                : entry.descriptor.ultimateTensionN) /
                entry.descriptor.ultimateTensionN,
          })),
          boundaryMargins = boundaries
            .filter((boundary) => boundary.state === "attached")
            .map((boundary) => ({
              id: boundary.sourceConnectionId,
              margin: 1 - boundary.tensionN / boundary.ratingN,
            })),
          governing = [...internalMargins, ...boundaryMargins].sort(
            (left, right) =>
              left.margin - right.margin ||
              String(left.id).localeCompare(String(right.id)),
          )[0] || { id: null, margin: 1 },
          inWater = line.entities.some((entity) => {
            if (typeof environment.pondAt !== "function") return false;
            const point = this.bodyByEntityId.get(entity.id).position,
              pond = environment.pondAt(point.x, point.z);
            return Boolean(pond) && Number(pond.waterY) > point.y;
          }),
          unsupportedEffects = [
            environment.windEnabled ? "aerodynamic-drag" : null,
            inWater ? "fluid-drag-and-buoyancy" : null,
          ].filter(Boolean);
        return {
          id: line.id,
          sourcePartId: line.sourcePartId,
          centerline,
          runtimeBoundsWorldM: flexibleRuntimeBoundsWorldM(
            centerline,
            line.diameterM / 2,
          ),
          totalLengthM: totalLength(centerline),
          unstretchedLengthM: line.lengthM,
          endToEndDistanceM,
          slackM: Math.max(0, line.lengthM - endToEndDistanceM),
          extensionM: Math.max(0, totalLength(centerline) - line.lengthM),
          maximumTensionN,
          endpointTensionsN: Object.fromEntries(
            boundaries.map((boundary) => [
              boundary.endpointPortId,
              boundary.tensionN,
            ]),
          ),
          edgeTensionsN: tensions,
          maximumStrain,
          elasticEnergyJ,
          dampingDissipationJ,
          contactDissipationJ:
            this.contactDissipationByPart.get(line.sourcePartId) || 0,
          boundaries,
          activeEdgeIds: edges
            .filter((entry) => entry.active)
            .map((entry) => entry.descriptor.id),
          contactCount: contacts.length,
          contactSamples,
          contactSamplesTruncated:
            contacts.length > MAX_CONTACT_SAMPLES_PER_LINE,
          governingElementId: governing.id,
          failureMargin: governing.margin,
          validity: unsupportedEffects.length
            ? "unsupported-envelope"
            : "valid",
          unsupportedEffects,
          state: edges.some((entry) => !entry.active)
            ? "failed"
            : contacts.length
              ? "contacting"
              : maximumTensionN > 1e-6
                ? "taut"
                : "slack",
        };
      }),
      topologyEvents,
    };
    return structuredClone(this.lastTelemetry);
  }

  exportState() {
    return issueInertPlainData({
      version: 1,
      entities: [...this.bodyByEntityId].map(([entityId, body]) => ({
        entityId,
        position: plainVector(body.position),
        quaternion: plainQuaternion(body.quaternion),
        velocity: plainVector(body.velocity),
        angularVelocity: plainVector(body.angularVelocity),
      })),
      edges: this.edgeEntries.map((entry) => ({
        id: entry.descriptor.id,
        active: entry.active,
        dampingWorkJ: entry.dampingWorkJ,
      })),
      attachments: this.attachmentEntries.map((entry) => ({
        id: entry.descriptor.sourceConnectionId,
        active: entry.active,
        lastReactionN: entry.lastReactionN,
      })),
      topologyRevision: this.topologyRevision,
      lastDissipationTick: this.lastDissipationTick,
      contactDissipationByPart: [...this.contactDissipationByPart],
    });
  }

  applyConnectionFailures(connections) {
    const failed = new Set(
        (connections || [])
          .filter((connection) => connection.failed)
          .map((connection) => connection.id),
      ),
      removed = [];
    for (const entry of this.attachmentEntries) {
      if (!entry.active || !failed.has(entry.descriptor.sourceConnectionId))
        continue;
      entry.active = false;
      this.world.removeConstraint(entry.constraint);
      this.topologyRevision++;
      removed.push(entry.descriptor.id);
    }
    return removed;
  }

  validateState(state) {
    state = requireInertPlainData(state, {
      code: "INVALID_FLEXIBLE_LINE_CHECKPOINT_INPUT",
      message:
        "Flexible-line checkpoint must be serialized JSON or an exported immutable state",
    });
    if (
      !checkpointKeysMatch(state, [
        "version",
        "entities",
        "edges",
        "attachments",
        "topologyRevision",
        "lastDissipationTick",
        "contactDissipationByPart",
      ]) ||
      state.version !== 1 ||
      !Array.isArray(state.entities) ||
      !Array.isArray(state.edges) ||
      !Array.isArray(state.attachments) ||
      !Array.isArray(state.contactDissipationByPart)
    )
      throw new DomainValidationError(
        "INVALID_FLEXIBLE_LINE_CHECKPOINT",
        "Flexible-line checkpoint must be an exact version 1 mutable projection",
      );
    const entities = new Map(
        state.entities.map((entity) => [entity.entityId, entity]),
      ),
      edges = new Map(state.edges.map((edge) => [edge.id, edge])),
      attachments = new Map(
        state.attachments.map((entry) => [entry.id, entry]),
      );
    if (
      entities.size !== state.entities.length ||
      edges.size !== state.edges.length ||
      attachments.size !== state.attachments.length ||
      entities.size !== this.bodyByEntityId.size ||
      edges.size !== this.edgeEntries.length ||
      attachments.size !== this.attachmentEntries.length
    )
      throw new DomainValidationError(
        "FLEXIBLE_LINE_CHECKPOINT_IDENTITY_MISMATCH",
        "Flexible-line checkpoint does not match compiled topology",
      );
    for (const [entityId] of this.bodyByEntityId) {
      const source = entities.get(entityId);
      if (
        !source ||
        !checkpointKeysMatch(source, [
          "entityId",
          "position",
          "quaternion",
          "velocity",
          "angularVelocity",
        ]) ||
        !finiteVector(source.position) ||
        !unitQuaternion(source.quaternion) ||
        !finiteVector(source.velocity) ||
        !finiteVector(source.angularVelocity)
      )
        throw new DomainValidationError(
          "FLEXIBLE_LINE_CHECKPOINT_IDENTITY_MISMATCH",
          `Flexible entity ${entityId} is missing or invalid in checkpoint`,
        );
    }
    for (const entry of this.edgeEntries) {
      const source = edges.get(entry.descriptor.id);
      if (
        !source ||
        !checkpointKeysMatch(source, ["id", "active", "dampingWorkJ"]) ||
        typeof source.active !== "boolean" ||
        !Number.isFinite(source.dampingWorkJ) ||
        source.dampingWorkJ < 0
      )
        throw new DomainValidationError(
          "FLEXIBLE_LINE_CHECKPOINT_IDENTITY_MISMATCH",
          `Flexible edge ${entry.descriptor.id} is missing or invalid in checkpoint`,
        );
    }
    for (const entry of this.attachmentEntries) {
      const source = attachments.get(entry.descriptor.sourceConnectionId);
      if (
        !source ||
        !checkpointKeysMatch(source, ["id", "active", "lastReactionN"]) ||
        typeof source.active !== "boolean" ||
        !Number.isFinite(source.lastReactionN) ||
        source.lastReactionN < 0
      )
        throw new DomainValidationError(
          "FLEXIBLE_LINE_CHECKPOINT_IDENTITY_MISMATCH",
          `Flexible attachment ${entry.descriptor.sourceConnectionId} is missing or invalid in checkpoint`,
        );
    }
    if (
      !Number.isSafeInteger(state.topologyRevision) ||
      state.topologyRevision < 0 ||
      !Number.isSafeInteger(state.lastDissipationTick) ||
      state.lastDissipationTick < -1
    )
      throw new DomainValidationError(
        "INVALID_FLEXIBLE_LINE_CHECKPOINT",
        "Flexible-line checkpoint contains invalid runtime counters",
      );
    const contactDissipationByPart = new Map();
    for (const entry of state.contactDissipationByPart) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        contactDissipationByPart.has(entry[0]) ||
        !Number.isFinite(entry[1]) ||
        entry[1] < 0
      )
        throw new DomainValidationError(
          "INVALID_FLEXIBLE_LINE_CHECKPOINT",
          "Flexible-line contact dissipation must contain unique finite part totals",
        );
      contactDissipationByPart.set(entry[0], entry[1]);
    }
    return { entities, edges, attachments, contactDissipationByPart };
  }

  importState(state) {
    const { entities, edges, attachments, contactDissipationByPart } =
      this.validateState(state);
    for (const [entityId, body] of this.bodyByEntityId) {
      const source = entities.get(entityId);
      body.position.set(
        source.position.x,
        source.position.y,
        source.position.z,
      );
      body.quaternion.set(
        source.quaternion.x,
        source.quaternion.y,
        source.quaternion.z,
        source.quaternion.w,
      );
      body.velocity.set(
        source.velocity.x,
        source.velocity.y,
        source.velocity.z,
      );
      body.angularVelocity.set(
        source.angularVelocity.x,
        source.angularVelocity.y,
        source.angularVelocity.z,
      );
    }
    for (const entry of this.edgeEntries) {
      const source = edges.get(entry.descriptor.id);
      if (entry.active !== Boolean(source.active)) {
        if (source.active) this.world.addConstraint(entry.constraint);
        else this.world.removeConstraint(entry.constraint);
      }
      entry.active = Boolean(source.active);
      entry.dampingWorkJ = source.dampingWorkJ;
    }
    for (const entry of this.attachmentEntries) {
      const source = attachments.get(entry.descriptor.sourceConnectionId);
      if (entry.active !== Boolean(source.active)) {
        if (source.active) this.world.addConstraint(entry.constraint);
        else this.world.removeConstraint(entry.constraint);
      }
      entry.active = Boolean(source.active);
      entry.lastReactionN = source.lastReactionN;
    }
    this.topologyRevision = state.topologyRevision;
    this.lastDissipationTick = state.lastDissipationTick;
    this.contactDissipationByPart = contactDissipationByPart;
  }

  dispose() {
    for (const entry of [...this.edgeEntries, ...this.attachmentEntries])
      if (entry.constraint) this.world.removeConstraint(entry.constraint);
    for (const body of this.bodyByEntityId.values())
      this.world.removeBody(body);
    this.compiledLines = [];
    this.bodyByEntityId.clear();
    this.edgeEntries = [];
    this.attachmentEntries = [];
    this.loadByConnection.clear();
    this.lastTelemetry = { version: 1, lines: [], topologyEvents: [] };
    this.topologyRevision = 0;
    this.lastDissipationTick = -1;
    this.contactDissipationByPart.clear();
    this.connectionIdsUseTypedStrings = false;
  }
}
