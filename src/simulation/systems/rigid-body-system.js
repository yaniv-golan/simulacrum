import * as CANNON from "cannon-es";
import { bodyRegistryBodyRecords } from "../body-registry.js";
import { requestWorldEvidenceCapture } from "../cannon-world-adapter.js";
import {
  boundedMultibodyFailureEvidence,
  requestMultibodyFailureEvidenceCapture,
} from "../multibody-runtime.js";

function heightfieldFeature(body, shape, worldPoint, solverFrame) {
  if (
    shape?.userData?.featureIdentityKind !== "heightfield-cell-triangle-v1" ||
    typeof shape.getIndexOfPosition !== "function" ||
    typeof shape.getTriangleAt !== "function"
  )
    return { featureId: null, featureValidity: "unavailable" };
  const shapeIndex = body.shapes.indexOf(shape);
  if (shapeIndex < 0)
    return { featureId: null, featureValidity: "unavailable" };
  if (!solverFrame) return { featureId: null, featureValidity: "unavailable" };
  const inverseBody = solverFrame.quaternion.conjugate(new CANNON.Quaternion()),
    bodyPoint = inverseBody.vmult(worldPoint.vsub(solverFrame.position)),
    offset = body.shapeOffsets[shapeIndex] || new CANNON.Vec3(),
    orientation = body.shapeOrientations[shapeIndex] || new CANNON.Quaternion(),
    localPoint = bodyPoint.vsub(offset),
    inverse = orientation.conjugate(new CANNON.Quaternion());
  inverse.vmult(localPoint, localPoint);
  const index = [];
  if (!shape.getIndexOfPosition(localPoint.x, localPoint.y, index, false))
    return { featureId: null, featureValidity: "unavailable" };
  const a = new CANNON.Vec3(),
    b = new CANNON.Vec3(),
    c = new CANNON.Vec3(),
    upper = shape.getTriangleAt(localPoint.x, localPoint.y, false, a, b, c);
  return {
    featureId: {
      cellX: index[0],
      cellZ: index[1],
      triangle: upper ? "upper" : "lower",
    },
    featureValidity: "derived",
  };
}

function velocityAtSolverPoint(body, solverPosition, worldPoint) {
  const offset = worldPoint.vsub(solverPosition),
    rotational = new CANNON.Vec3();
  body.angularVelocity.cross(offset, rotational);
  return body.velocity.vadd(rotational);
}

function plainSolverPose(pose) {
  return {
    position: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
    quaternion: {
      x: pose.quaternion.x,
      y: pose.quaternion.y,
      z: pose.quaternion.z,
      w: pose.quaternion.w,
    },
  };
}

function attachedParticipantIdentity(body, shape) {
  const shapeIndex = body.shapes.indexOf(shape);
  if (shapeIndex < 0) return { materialKey: null, shapeId: null };
  const physical = shape?.material?.name || body?.material?.name || null,
    declared =
      shape?.userData?.materialKey || body?.userData?.materialKey || null,
    shapeId = shape?.userData?.shapeId ?? `body-shape:${String(shapeIndex)}`;
  return {
    materialKey:
      physical && (!declared || declared === physical) ? physical : null,
    shapeId,
  };
}

function participantIdentity(body, shape, contact, participant) {
  const attached = attachedParticipantIdentity(body, shape);
  if (
    attached.shapeId === null ||
    contact.surfaceLawParticipant !== participant
  )
    return attached;
  return {
    materialKey: contact.surfaceMaterialKey ?? null,
    shapeId: contact.surfaceShapeId ?? null,
  };
}

/** Integrates all rigid bodies and contacts through the session's world. */
export class RigidBodySystem {
  phase = "integration";
  checkpointOwner = "body-registry-projection";

  initialize(context) {
    const registry = context.bodyRegistry,
      services = context.services,
      registeredParts = new Set(),
      register = (
        bodyId,
        partIds,
        engineBody,
        constraintIds = [],
        authoredPose = null,
        massProperties = null,
      ) => {
        const ids = [...new Set(partIds)].filter(
          (id) => id != null && !registeredParts.has(id),
        );
        if (!ids.length || !engineBody) return;
        registry.registerBody(bodyId, ids, {
          engineBody,
          constraintIds,
          pose: authoredPose || {
            position: engineBody.position,
            quaternion: engineBody.quaternion,
          },
          massProperties,
        });
        for (const id of ids) registeredParts.add(id);
      };

    const multibody = services.multibodyRuntime;
    if (multibody?.compiled)
      for (const [partId, body] of multibody.bodyByPart) {
        const pose = multibody.bodyPose(partId),
          descriptor = multibody.compiled.bodies.find(
            (candidate) => candidate.partId === partId,
          );
        if (!descriptor)
          throw new TypeError(
            `Multibody part ${String(partId)} has no compiled body descriptor`,
          );
        if (typeof descriptor.id !== "string" || !descriptor.id.length)
          throw new TypeError(
            `Multibody part ${String(partId)} has no compiled body identity`,
          );
        const compiledBodyToken = descriptor.id.startsWith("body:")
          ? descriptor.id.slice("body:".length)
          : descriptor.id;
        register(
          `cannon:part:${compiledBodyToken}`,
          [partId],
          body,
          (multibody.constraintEntries || [])
            .filter(
              (entry) =>
                entry.active !== false &&
                (entry.descriptor.a === partId ||
                  entry.descriptor.b === partId ||
                  entry.descriptor.sourcePartId === partId),
            )
            .flatMap((entry) => entry.descriptor.sourceConnectionIds || []),
          pose,
          descriptor.massProperties,
        );
      }
    if (multibody?.compiled)
      for (const entry of multibody.constraintEntries) {
        const partId = entry.descriptor.sourcePartId,
          pose = multibody.constraintPoseForPart(partId);
        if (partId == null || !pose || multibody.bodyByPart.has(partId))
          continue;
        registry.registerConstraint(entry.descriptor.id, partId, {
          sourceConnectionIds: entry.descriptor.sourceConnectionIds || [],
          pose,
          angle: pose.angle,
          angularVelocity: pose.angularVelocity,
          reactionTorque: pose.reactionTorque,
        });
      }
  }

  step(context, dt) {
    const services = context.services,
      adapter = services.worldAdapter,
      hasCannonBodies = Boolean(services.multibodyRuntime?.compiled),
      captureEvidence = Boolean(
        services.failureEvidenceRecorder?.acceptingEvidence?.(),
      );
    if (hasCannonBodies && !adapter)
      throw new Error("RigidBodySystem requires the shared worldAdapter");
    const solverFrames = hasCannonBodies
      ? this.#captureSolverFrames(context)
      : null;
    if (hasCannonBodies) {
      if (captureEvidence) {
        requestWorldEvidenceCapture(adapter);
        requestMultibodyFailureEvidenceCapture(services.multibodyRuntime);
      }
      adapter.integrate(dt, { tick: context.clock.tick });
      context.telemetry.integration = adapter.telemetry();
    }
    if (services.multibodyRuntime?.compiled) {
      context.telemetry.mechanisms =
        services.multibodyRuntime.afterIntegration(dt);
    }
    if (hasCannonBodies) this.#syncBodyRegistry(context, dt, solverFrames);
    if (captureEvidence && services.multibodyRuntime?.compiled) {
      const contacts = bodyRegistryBodyRecords(context.bodyRegistry).flatMap(
          (body) =>
            body.contacts.map((contact) => ({
              bodyId: body.bodyId,
              partIds: body.partIds,
              ...contact,
            })),
        ),
        forceByConnection =
          services.multibodyRuntime.loadByConnection || new Map(),
        torqueByConnection =
          services.multibodyRuntime.torqueByConnection || new Map(),
        connectionIds = [
          ...new Set([
            ...forceByConnection.keys(),
            ...torqueByConnection.keys(),
          ]),
        ].sort((left, right) =>
          String(left).localeCompare(String(right), "en"),
        );
      services.failureEvidenceRecorder.recordPhysicsStage({
        tick: context.clock.tick,
        timeS: context.time,
        contacts,
        solverContributions: (options) =>
          boundedMultibodyFailureEvidence(services.multibodyRuntime, options),
        connectionLoads: connectionIds.map((connectionId) => ({
          connectionId,
          forceN: Number(forceByConnection.get(connectionId) || 0),
          torqueNm: Number(torqueByConnection.get(connectionId) || 0),
        })),
      });
    }
  }

  #captureSolverFrames(context) {
    const registry = context.bodyRegistry,
      multibody = context.services.multibodyRuntime,
      world = context.services.worldAdapter.world,
      bodies = new Map(
        world.bodies.map((body) => [
          body,
          {
            position: body.position.clone(),
            quaternion: body.quaternion.clone(),
          },
        ]),
      ),
      parts = new Map();
    for (const { engineBody } of registry.engineEntries()) {
      const partId = engineBody.userData?.partId,
        pose = multibody?.bodyPose(partId) || engineBody;
      parts.set(engineBody, plainSolverPose(pose));
    }
    return { bodies, parts };
  }

  #syncBodyRegistry(context, dt, solverFrames) {
    this.reconstructAfterPhysicsRestore(context, dt);
    const registry = context.bodyRegistry,
      world = context.services.worldAdapter.world;
    const multibody = context.services.multibodyRuntime;
    const tireRowsByContactId = new Map();
    for (const entry of multibody?.constraintEntries || []) {
      if (entry.kind !== "rolling-contact-v1") continue;
      for (const row of entry.constraint.solvedContactRows || []) {
        const contactId = row.contact.simulacrumEvidence?.contactId;
        if (!contactId) continue;
        const ids = tireRowsByContactId.get(contactId) || [];
        for (const equation of [
          row.longitudinalEquation,
          row.lateralEquation,
        ]) {
          const rowId = equation.simulacrumEvidenceRow?.rowId;
          if (rowId) ids.push(rowId);
        }
        tireRowsByContactId.set(contactId, [...new Set(ids)].sort());
      }
    }
    for (const contact of world.contacts || []) {
      if (
        contact.enabled !== true ||
        contact.bi?.isTrigger === true ||
        contact.bj?.isTrigger === true
      )
        continue;
      for (const [body, offset, normalScale] of [
        [contact.bi, contact.ri, -1],
        [contact.bj, contact.rj, 1],
      ]) {
        const bodyId = registry.bodyIdForEngineBody(body);
        if (!bodyId) continue;
        const otherBody = body === contact.bi ? contact.bj : contact.bi,
          bodyShape = body === contact.bi ? contact.si : contact.sj,
          otherShape = body === contact.bi ? contact.sj : contact.si,
          bodyParticipant = body === contact.bi ? "bi" : "bj",
          otherParticipant = body === contact.bi ? "bj" : "bi",
          bodyIdentity = participantIdentity(
            body,
            bodyShape,
            contact,
            bodyParticipant,
          ),
          otherIdentity = participantIdentity(
            otherBody,
            otherShape,
            contact,
            otherParticipant,
          ),
          bodySolverFrame = solverFrames.bodies.get(body),
          otherSolverFrame = solverFrames.bodies.get(otherBody),
          observationFrame = solverFrames.parts.get(body),
          frictionCoefficientValid =
            contact.simulacrumFrictionCoefficientValid === true &&
            Number.isFinite(contact.simulacrumFrictionCoefficient) &&
            contact.simulacrumFrictionCoefficient >= 0,
          point = bodySolverFrame?.position.vadd(offset),
          otherOffset = body === contact.bi ? contact.rj : contact.ri,
          otherPoint = otherSolverFrame?.position.vadd(otherOffset),
          evidence = contact.simulacrumEvidence || {},
          solvedNormalForceN = contact.multiplier,
          normalForceValid =
            Number.isFinite(solvedNormalForceN) && solvedNormalForceN >= 0,
          forceN = normalForceValid ? solvedNormalForceN : 0,
          normal = {
            x: contact.ni.x * normalScale,
            y: contact.ni.y * normalScale,
            z: contact.ni.z * normalScale,
          },
          supportShapeId = otherIdentity.shapeId,
          feature = heightfieldFeature(
            otherBody,
            otherShape,
            otherPoint,
            otherSolverFrame,
          ),
          tireEvidence = contact.simulacrumTireEvidence
            ? {
                ...contact.simulacrumTireEvidence,
                tireForceRowIds:
                  tireRowsByContactId.get(evidence.contactId) || [],
              }
            : null;
        if (!bodySolverFrame || !otherSolverFrame || !observationFrame)
          throw new Error("RigidBodySystem lost the solver-time contact frame");
        const velocity = velocityAtSolverPoint(
            body,
            bodySolverFrame.position,
            point,
          ),
          otherVelocity = velocityAtSolverPoint(
            otherBody,
            otherSolverFrame.position,
            otherPoint,
          );
        registry.recordContact(bodyId, {
          observationFrame,
          point,
          normal,
          tick: evidence.tick ?? context.clock.tick,
          contactId: evidence.contactId ?? null,
          normalForceValid,
          forceN,
          forceWorldN: {
            x: normal.x * forceN,
            y: normal.y * forceN,
            z: normal.z * forceN,
          },
          impulseNs: forceN * dt,
          relativeVelocity: velocity.vsub(otherVelocity),
          frictionCoefficientValid,
          frictionCoefficient: frictionCoefficientValid
            ? contact.simulacrumFrictionCoefficient
            : 0,
          materialKey: bodyIdentity.materialKey,
          shapeId: bodyIdentity.shapeId,
          otherBodyId:
            registry.bodyIdForEngineBody(otherBody) ||
            otherBody.userData?.externalBodyId ||
            null,
          otherMaterialKey: otherIdentity.materialKey,
          otherShapeId: otherIdentity.shapeId,
          supportShapeId,
          surfaceRegionId:
            contact.surfaceLawParticipant === bodyParticipant
              ? bodyIdentity.shapeId === contact.surfaceShapeId
                ? contact.surfaceShapeId || null
                : null
              : contact.surfaceLawParticipant === otherParticipant &&
                  otherIdentity.shapeId === contact.surfaceShapeId
                ? contact.surfaceShapeId || null
                : null,
          ...feature,
          tireEvidence,
          validity: evidence.validity || "unavailable",
          surface:
            body === contact.bi
              ? contact.bj.userData?.surface
              : contact.bi.userData?.surface,
        });
      }
    }
  }

  /** Rebuilds the registry kinematic read model from the physics owner. */
  reconstructAfterPhysicsRestore(context, dt = 0) {
    const registry = context.bodyRegistry,
      multibody = context.services.multibodyRuntime;
    for (const { bodyId, engineBody } of registry.engineEntries()) {
      const partId = engineBody.userData?.partId,
        pose = multibody?.bodyPose(partId) || {
          position: engineBody.position,
          quaternion: engineBody.quaternion,
          velocity: engineBody.velocity,
          angularVelocity: engineBody.angularVelocity,
        };
      registry.updateKinematics(bodyId, pose, dt);
    }
    for (const binding of registry.constraintBindings()) {
      const pose = multibody?.constraintPoseForPart(binding.partId);
      if (!pose) {
        registry.updateConstraint(binding.constraintId, { detached: true });
        continue;
      }
      registry.updateConstraint(binding.constraintId, {
        pose,
        angle: pose.angle,
        angularVelocity: pose.angularVelocity,
        reactionTorque: pose.reactionTorque,
        detached: false,
      });
    }
  }
}
