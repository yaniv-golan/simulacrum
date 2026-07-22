import * as CANNON from "cannon-es";
import { standardAtmosphere } from "./environment/atmosphere.js";
import {
  writePartToWorldQuaternion,
  writePartWorldPosition,
} from "./body-part-frame.js";
import {
  addScaled,
  clamp,
  cross,
  dot,
  normalized,
  plainQuaternion,
  plainVector,
  rotateVector,
  setVector,
  vectorLength,
} from "./flight-vector-math.js";

/** Projects completed kinematics and resolved force/material records. */
export class PhysicalFlightTelemetryProjector {
  #model;
  #aerodynamics;
  #aerothermal;
  #windAt;
  #bodyPartQuaternion = new CANNON.Quaternion();
  #inverseMassFrameQuaternion = new CANNON.Quaternion();
  #scratch = {
    relativeVelocity: new CANNON.Vec3(),
    direction: new CANNON.Vec3(),
    bodyAxis: new CANNON.Vec3(),
    relative: new CANNON.Vec3(),
    forceMoment: new CANNON.Vec3(),
    moment: new CANNON.Vec3(),
    localMount: new CANNON.Vec3(),
    rootUp: new CANNON.Vec3(),
  };

  constructor({
    physicalFlightModel,
    aerodynamicForceOwner,
    aerothermalAblationOwner,
    windAt,
  }) {
    this.#model = physicalFlightModel;
    this.#aerodynamics = aerodynamicForceOwner;
    this.#aerothermal = aerothermalAblationOwner;
    this.#windAt = windAt;
  }

  active() {
    return this.#model?.flightCapable() || false;
  }

  initialize(context) {
    if (!this.active()) return null;
    const frame = this.#project(context, 0, false);
    context.initialSystemTelemetry ||= {};
    context.initialSystemTelemetry.flight = frame;
    return frame;
  }

  projectCompleted(context, dt) {
    if (this.active())
      context.telemetry.flight = this.#project(context, dt, true);
  }

  afterCheckpointRestore(context) {
    if (!this.active()) return;
    this.#model.refresh(context);
  }

  #previousFrame(context) {
    return (
      context.telemetry.flight ||
      context.previousTelemetry?.systems?.flight ||
      null
    );
  }

  #project(context, dt, collectImpact = false) {
    const measurement = this.#model.primary(context);
    if (!measurement?.root) return null;
    const prior = this.#previousFrame(context),
      atmosphere = standardAtmosphere(Math.max(0, measurement.com.y)),
      wind = this.#windAt(plainVector(measurement.com), context.time),
      velocity = plainVector(measurement.velocity),
      priorVelocity = prior?.velocity || velocity;
    setVector(
      this.#scratch.relativeVelocity,
      velocity.x - wind.x,
      velocity.y - wind.y,
      velocity.z - wind.z,
    );
    const speed = vectorLength(this.#scratch.relativeVelocity),
      dynamicPressure = 0.5 * atmosphere.density * speed ** 2,
      propulsionRecords = (
        context.telemetry.propulsion?.engines ||
        context.previousTelemetry?.systems?.propulsion?.engines ||
        []
      ).filter((record) => measurement.group.partIdSet.has(record.partId)),
      dragN = measurement.group.parts.reduce(
        (sum, part) =>
          sum +
          vectorLength(
            this.#aerodynamics.dragForceForPart(part.id) || CANNON.Vec3.ZERO,
          ),
        0,
      ),
      referenceArea = Math.max(
        0.01,
        measurement.group.parts.reduce(
          (sum, part) => sum + Math.max(part.size.x * part.size.z, 0.001),
          0,
        ),
      ),
      thermal =
        context.telemetry.aerothermal ||
        this.#aerothermal.telemetry(context) ||
        {},
      connections = context.runGraph.connections();

    rotateVector(this.#scratch.bodyAxis, measurement.root.quaternion, {
      x: 0,
      y: 1,
      z: 0,
    });
    normalized(this.#scratch.direction, this.#scratch.relativeVelocity);
    const angleOfAttack =
      speed > 0.01
        ? Math.acos(
            clamp(dot(this.#scratch.bodyAxis, this.#scratch.direction), -1, 1),
          )
        : 0;
    setVector(this.#scratch.moment, 0, 0, 0);
    for (const part of measurement.group.parts) {
      setVector(
        this.#scratch.relative,
        part.body.position.x - measurement.com.x,
        part.body.position.y - measurement.com.y,
        part.body.position.z - measurement.com.z,
      );
      cross(
        this.#scratch.forceMoment,
        this.#scratch.relative,
        this.#aerodynamics.forceForPart(part.id) || CANNON.Vec3.ZERO,
      );
      addScaled(this.#scratch.moment, this.#scratch.forceMoment, 1);
    }
    rotateVector(this.#scratch.rootUp, measurement.root.quaternion, {
      x: 0,
      y: 1,
      z: 0,
    });
    const rcsForceN = propulsionRecords.reduce((sum, record) => {
        const direction = record.worldDirection || { x: 0, y: 1, z: 0 };
        return (
          sum +
          (Math.abs(dot(direction, this.#scratch.rootUp)) < 0.7
            ? Number(record.thrustN || 0)
            : 0)
        );
      }, 0),
      impact = collectImpact
        ? this.#impactRecord(context, prior)
        : {
            lastImpact: prior?.lastImpact || null,
            peakImpactImpulseNs: Number(prior?.peakImpactImpulseNs || 0),
            peakImpactSpeed: Number(prior?.peakImpactSpeed || 0),
          };
    return Object.freeze({
      active: true,
      pose: Object.freeze({
        position: Object.freeze(plainVector(measurement.com)),
        quaternion: Object.freeze(plainQuaternion(measurement.root.quaternion)),
      }),
      velocity: Object.freeze(velocity),
      angularVelocity: Object.freeze(
        plainVector(measurement.root.angularVelocity),
      ),
      linearAcceleration: Object.freeze(
        dt > 0
          ? {
              x: (velocity.x - priorVelocity.x) / dt,
              y: (velocity.y - priorVelocity.y) / dt,
              z: (velocity.z - priorVelocity.z) / dt,
            }
          : { x: 0, y: 0, z: 0 },
      ),
      windVelocity: Object.freeze({ x: wind.x, y: wind.y, z: wind.z }),
      relativeAirSpeed: speed,
      mass: measurement.mass,
      airDensity: atmosphere.density,
      airPressurePa: atmosphere.pressure,
      dynamicPressure,
      mach: speed / atmosphere.speedOfSound,
      dragN,
      cd: dynamicPressure > 1 ? dragN / (dynamicPressure * referenceArea) : 0,
      angleOfAttack,
      aerodynamicMomentNm: vectorLength(this.#scratch.moment),
      maxThrustN: propulsionRecords.reduce(
        (sum, record) => sum + Math.max(0, Number(record.thrustN || 0)),
        0,
      ),
      propulsionActive: propulsionRecords.some(
        (record) => Number(record.thrustN || 0) > 0,
      ),
      gimbalAngle: propulsionRecords.reduce(
        (maximum, record) =>
          Math.max(
            maximum,
            Math.abs(Number(record.gimbalXRad || 0)),
            Math.abs(Number(record.gimbalZRad || 0)),
          ),
        0,
      ),
      rcsForceN,
      maxAttachmentLoadN: Math.max(
        0,
        ...connections.map((connection) => Number(connection.lastLoadN || 0)),
      ),
      failedAttachments: connections.filter((connection) => connection.failed)
        .length,
      detachedParts: context.runGraph.parts().filter((part) => part.detached)
        .length,
      heatFlux: Number(thermal.heatFlux || 0),
      heatLoadMJ: Number(thermal.heatLoadMJ || 0),
      skinTempC: Number(thermal.skinTempC ?? 15),
      thermalHealth: Number(thermal.thermalHealth ?? 1),
      overheated: Boolean(thermal.overheated),
      ...impact,
      groups: Object.freeze(
        this.#model.groups(context).map((group) =>
          Object.freeze({
            id: group.id,
            partIds: group.partIds,
            flightCapable: group.parts.some(
              (part) => part.propulsion?.kind === "pressure-nozzle-v1",
            ),
          }),
        ),
      ),
      propulsion: context.telemetry.propulsion || null,
      materialResources: context.telemetry.materialResources || null,
      aerodynamics: context.telemetry.aerodynamics || null,
      aerothermal: thermal,
      parts: Object.freeze(this.#partRecords(context, thermal)),
      connections: Object.freeze(
        connections.map((connection) =>
          Object.freeze({
            id: connection.id,
            a: connection.a,
            b: connection.b,
            failed: Boolean(connection.failed),
            failureReason: connection.failureReason,
            stress: Number(connection.stress || 0),
            fatigue: Number(connection.fatigue || 0),
            aeroLoadN: Number(connection.lastLoadN || 0),
            impactLoadN: Number(connection.peakLoadN || 0),
          }),
        ),
      ),
    });
  }

  #impactRecord(context, prior) {
    let tickImpulse = 0,
      tickSpeed = 0;
    for (const part of this.#model.parts) {
      const registered = context.bodyRegistry.bodyForPart(part.id),
        preIntegrationVelocity =
          this.#aerodynamics.preIntegrationVelocityForPart(part.id);
      for (const contact of registered?.contacts || []) {
        if (
          !contact.otherBodyId ||
          String(contact.otherBodyId).startsWith("cannon:part:")
        )
          continue;
        tickImpulse += Number(contact.impulseNs || 0);
        tickSpeed = Math.max(
          tickSpeed,
          Math.abs(dot(contact.relativeVelocity, contact.normal)),
          Math.abs(dot(preIntegrationVelocity, contact.normal)),
        );
      }
    }
    const peakImpactImpulseNs = Math.max(
        Number(prior?.peakImpactImpulseNs || 0),
        tickImpulse > 1 && tickSpeed > 0.25 ? tickImpulse : 0,
      ),
      peakImpactSpeed = Math.max(
        Number(prior?.peakImpactSpeed || 0),
        tickImpulse > 1 && tickSpeed > 0.25 ? tickSpeed : 0,
      );
    return {
      peakImpactImpulseNs,
      peakImpactSpeed,
      lastImpact:
        tickImpulse > 1 && tickSpeed > 0.25
          ? {
              speedMps: tickSpeed,
              impulseNs: tickImpulse,
              peakSpeedMps: peakImpactSpeed,
              peakImpulseNs: peakImpactImpulseNs,
            }
          : prior?.lastImpact || null,
    };
  }

  #partRecords(context, thermal) {
    const thermalByPart = new Map(
      (thermal.parts || []).map((part) => [part.id, part]),
    );
    return this.#model.parts.map((part) => {
      const material = thermalByPart.get(part.id) || {},
        detached = Boolean(context.runGraph.part(part.id)?.detached);
      let detachedPose = null;
      if (detached) {
        const quaternion = writePartToWorldQuaternion(
          part.body,
          this.#bodyPartQuaternion,
          this.#inverseMassFrameQuaternion,
        );
        writePartWorldPosition(
          part.body,
          quaternion,
          this.#scratch.relative,
          this.#scratch.localMount,
        );
        detachedPose = {
          position: plainVector(this.#scratch.relative),
          quaternion: plainQuaternion(quaternion),
        };
      }
      return Object.freeze({
        ...material,
        id: part.id,
        detached,
        detachedPose,
      });
    });
  }

  dispose() {
    this.#model = null;
    this.#aerodynamics = null;
    this.#aerothermal = null;
    this.#windAt = null;
  }
}
