/** Integrates all rigid bodies and contacts through the session's world. */
export class RigidBodySystem {
  phase = "integration";

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
        register(
          `cannon:part:${String(partId)}`,
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
          descriptor?.massProperties || null,
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
      hasCannonBodies = Boolean(services.multibodyRuntime?.compiled);
    if (hasCannonBodies && !adapter)
      throw new Error("RigidBodySystem requires the shared worldAdapter");
    if (hasCannonBodies) {
      adapter.integrate(dt, { tick: context.clock.tick });
      context.telemetry.integration = adapter.telemetry();
      this.#syncBodyRegistry(context, dt);
    }
    if (services.multibodyRuntime?.compiled) {
      context.telemetry.mechanisms =
        services.multibodyRuntime.afterIntegration(dt);
    }
    if (services.articulatedController?.active())
      context.telemetry.articulated =
        services.articulatedController.afterIntegration(context, dt);
  }

  #syncBodyRegistry(context, dt) {
    const registry = context.bodyRegistry,
      world = context.services.worldAdapter.world;
    const multibody = context.services.multibodyRuntime;
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
    for (const contact of world.contacts || []) {
      for (const [body, offset, normalScale] of [
        [contact.bi, contact.ri, -1],
        [contact.bj, contact.rj, 1],
      ]) {
        const bodyId = registry.bodyIdForEngineBody(body);
        if (!bodyId) continue;
        const otherBody = body === contact.bi ? contact.bj : contact.bi,
          otherShape = body === contact.bi ? contact.sj : contact.si,
          point = body.position.vadd(offset),
          otherOffset = body === contact.bi ? contact.rj : contact.ri,
          otherPoint = otherBody.position.vadd(otherOffset),
          velocity = body.velocity.clone(),
          otherVelocity = otherBody.velocity.clone();
        velocity.set(0, 0, 0);
        otherVelocity.set(0, 0, 0);
        body.getVelocityAtWorldPoint(point, velocity);
        otherBody.getVelocityAtWorldPoint(otherPoint, otherVelocity);
        registry.recordContact(bodyId, {
          point,
          normal: {
            x: contact.ni.x * normalScale,
            y: contact.ni.y * normalScale,
            z: contact.ni.z * normalScale,
          },
          forceN: Math.abs(contact.multiplier || 0),
          impulseNs: Math.abs(contact.multiplier || 0) * dt,
          relativeVelocity: velocity.vsub(otherVelocity),
          otherBodyId:
            registry.bodyIdForEngineBody(otherBody) ||
            otherBody.userData?.externalBodyId ||
            null,
          otherMaterialKey:
            (typeof otherBody.userData?.contactMaterialAt === "function"
              ? contact.surfaceMaterialKey
              : null) ||
            otherShape?.userData?.materialKey ||
            otherBody.userData?.materialKey ||
            otherShape?.material?.name ||
            null,
          otherShapeId:
            (typeof otherBody.userData?.contactMaterialAt === "function"
              ? contact.surfaceShapeId
              : null) ||
            otherShape?.userData?.shapeId ||
            null,
          surface:
            body === contact.bi
              ? contact.bj.userData?.surface
              : contact.bi.userData?.surface,
        });
      }
    }
  }
}
