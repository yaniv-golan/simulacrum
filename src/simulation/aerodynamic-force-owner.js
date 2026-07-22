import * as CANNON from "cannon-es";
import {
  projectedBoxArea,
  standardAtmosphere,
} from "./environment/atmosphere.js";
import { writePartToWorldQuaternion } from "./body-part-frame.js";
import {
  EARTH_RADIUS_M,
  G0,
  addScaled,
  dot,
  inverseRotateVector,
  normalized,
  plainVector,
  rotateVector,
  setVector,
  vectorLength,
} from "./flight-vector-math.js";

const ZERO = CANNON.Vec3.ZERO;

/** Applies atmosphere, wind, gravity correction, drag and authored lift. */
export class AerodynamicForceOwner {
  #model;
  #windAt;
  #terrainCollisionStream;
  #stateByPart = new Map();
  #heatRecords = Object.freeze([]);
  #tick = 0;
  #bodyPartQuaternion = new CANNON.Quaternion();
  #inverseMassFrameQuaternion = new CANNON.Quaternion();
  #scratch = {
    wind: new CANNON.Vec3(),
    relativeVelocity: new CANNON.Vec3(),
    direction: new CANNON.Vec3(),
    localDirection: new CANNON.Vec3(),
    bodyAxis: new CANNON.Vec3(),
    axial: new CANNON.Vec3(),
    lateral: new CANNON.Vec3(),
    gravityCorrection: new CANNON.Vec3(),
  };

  constructor({ physicalFlightModel, windAt, terrainCollisionStream = null }) {
    this.#model = physicalFlightModel;
    this.#windAt = windAt;
    this.#terrainCollisionStream = terrainCollisionStream;
    for (const part of physicalFlightModel.parts)
      this.#stateByPart.set(part.id, {
        aeroForce: new CANNON.Vec3(),
        dragForce: new CANNON.Vec3(),
        liftForce: new CANNON.Vec3(),
        preIntegrationVelocity: new CANNON.Vec3(),
      });
  }

  active() {
    return this.#model?.active() || false;
  }

  step(context) {
    if (!this.active()) return;
    this.#tick = context.clock.tick;
    const groups = this.#model.refresh(context);
    if (this.#terrainCollisionStream)
      context.telemetry.terrainCollision = this.#terrainCollisionStream.update(
        this.#model.bodyPositions,
      );
    const heatByPart = new Map();
    for (const part of this.#model.parts)
      heatByPart.set(part.id, this.#applyPart(context, part));

    for (const group of groups) {
      const measurement = this.#model.measure(group),
        wind = this.#windAt(plainVector(measurement.com), context.time);
      setVector(
        this.#scratch.relativeVelocity,
        measurement.velocity.x - wind.x,
        measurement.velocity.y - wind.y,
        measurement.velocity.z - wind.z,
      );
      if (vectorLength(this.#scratch.relativeVelocity) < 0.01) continue;
      normalized(this.#scratch.direction, this.#scratch.relativeVelocity);
      let leading = -Infinity,
        trailing = Infinity;
      for (const part of group.parts) {
        const projection = dot(part.body.position, this.#scratch.direction);
        leading = Math.max(leading, projection);
        trailing = Math.min(trailing, projection);
      }
      const length = Math.max(0.4, leading - trailing);
      for (const part of group.parts) {
        const heat = heatByPart.get(part.id),
          depth = leading - dot(part.body.position, this.#scratch.direction),
          exposure = 0.18 + 0.82 * Math.exp(-depth / (length * 0.22));
        heat.incidentHeatFluxWPerM2 =
          heat.stagnationHeatFluxWPerM2 * exposure +
          heat.frictionHeatFluxWPerM2;
      }
    }

    for (const propulsion of context.telemetry.propulsion?.engines || []) {
      const heat = heatByPart.get(propulsion.partId);
      if (heat)
        heat.directHeatPowerW = Math.max(
          0,
          Number(propulsion.thermalLossW || 0),
        );
    }
    this.#heatRecords = Object.freeze(
      [...heatByPart.values()].map((record) => Object.freeze({ ...record })),
    );
    context.telemetry.aerodynamics = this.telemetry();
  }

  #applyPart(context, part) {
    const state = this.#stateByPart.get(part.id),
      body = part.body,
      scratch = this.#scratch,
      partQuaternion = writePartToWorldQuaternion(
        body,
        this.#bodyPartQuaternion,
        this.#inverseMassFrameQuaternion,
      ),
      altitude = Math.max(0, body.position.y),
      atmosphere = standardAtmosphere(altitude),
      wind = this.#windAt(plainVector(body.position), context.time);
    state.preIntegrationVelocity.copy(body.velocity);
    setVector(scratch.wind, wind.x, wind.y, wind.z);
    setVector(
      scratch.relativeVelocity,
      body.velocity.x - wind.x,
      body.velocity.y - wind.y,
      body.velocity.z - wind.z,
    );
    const speed = vectorLength(scratch.relativeVelocity),
      surfaceAreaM2 =
        2 *
        (part.size.x * part.size.y +
          part.size.x * part.size.z +
          part.size.y * part.size.z),
      heat = {
        tick: context.clock.tick,
        partId: part.id,
        atmosphereTemperatureK: atmosphere.temperature,
        surfaceAreaM2,
        stagnationHeatFluxWPerM2: 0,
        frictionHeatFluxWPerM2: 0,
        incidentHeatFluxWPerM2: 0,
        directHeatPowerW: 0,
      };
    state.aeroForce.set(0, 0, 0);
    state.dragForce.set(0, 0, 0);
    state.liftForce.set(0, 0, 0);
    if (speed > 0.01) {
      normalized(scratch.direction, scratch.relativeVelocity);
      inverseRotateVector(
        scratch.localDirection,
        partQuaternion,
        scratch.direction,
      );
      const area = Math.max(
          0.001,
          projectedBoxArea(part.size, scratch.localDirection),
        ),
        material = part.aerothermal.material,
        mach = speed / atmosphere.speedOfSound,
        coefficient =
          material.cd * (1 + 0.55 * Math.exp(-Math.pow((mach - 1) / 0.28, 2))),
        dynamicPressure = 0.5 * atmosphere.density * speed ** 2,
        dragMagnitude = dynamicPressure * coefficient * area;
      setVector(
        state.dragForce,
        -scratch.direction.x * dragMagnitude,
        -scratch.direction.y * dragMagnitude,
        -scratch.direction.z * dragMagnitude,
      );
      state.aeroForce.copy(state.dragForce);
      const liftSlope = Math.max(
        0,
        ...part.aerodynamics.surfaces.map((surface) =>
          Number(surface.liftSlope || 0),
        ),
      );
      if (liftSlope > 0) {
        rotateVector(scratch.bodyAxis, partQuaternion, { x: 0, y: 1, z: 0 });
        const axialMagnitude = dot(scratch.relativeVelocity, scratch.bodyAxis);
        setVector(
          scratch.axial,
          scratch.bodyAxis.x * axialMagnitude,
          scratch.bodyAxis.y * axialMagnitude,
          scratch.bodyAxis.z * axialMagnitude,
        );
        setVector(
          scratch.lateral,
          scratch.relativeVelocity.x - scratch.axial.x,
          scratch.relativeVelocity.y - scratch.axial.y,
          scratch.relativeVelocity.z - scratch.axial.z,
        );
        const lateralSpeed = vectorLength(scratch.lateral),
          planformArea = Math.max(
            part.size.x * part.size.y,
            part.size.y * part.size.z,
          ),
          lift = Math.min(
            dynamicPressure * planformArea * 1.4,
            (dynamicPressure * planformArea * liftSlope * lateralSpeed) / speed,
          );
        if (lateralSpeed > 1e-6) {
          setVector(
            state.liftForce,
            (-scratch.lateral.x * lift) / lateralSpeed,
            (-scratch.lateral.y * lift) / lateralSpeed,
            (-scratch.lateral.z * lift) / lateralSpeed,
          );
          addScaled(state.aeroForce, state.liftForce, 1);
        }
      }
      body.applyForce(state.aeroForce, ZERO);
      const radius = Math.max(0.025, Number(part.aerothermal.noseRadiusM));
      heat.stagnationHeatFluxWPerM2 =
        1.83e-4 * Math.sqrt(atmosphere.density / radius) * speed ** 3;
      heat.frictionHeatFluxWPerM2 =
        (dragMagnitude * speed * 0.18) / Math.max(0.02, surfaceAreaM2);
      heat.incidentHeatFluxWPerM2 =
        heat.stagnationHeatFluxWPerM2 + heat.frictionHeatFluxWPerM2;
    }
    const gravity = G0 * (EARTH_RADIUS_M / (EARTH_RADIUS_M + altitude)) ** 2,
      worldGravity = Math.abs(
        Number(this.#model.runtime.world.gravity?.y || -G0),
      ),
      correction = Math.max(0, worldGravity - gravity) * body.mass;
    if (correction > 1e-9) {
      setVector(scratch.gravityCorrection, 0, correction, 0);
      body.applyForce(scratch.gravityCorrection, ZERO);
    }
    return heat;
  }

  heatRecords() {
    return this.#heatRecords;
  }

  forceForPart(partId) {
    return this.#stateByPart.get(partId)?.aeroForce || null;
  }

  dragForceForPart(partId) {
    return this.#stateByPart.get(partId)?.dragForce || null;
  }

  preIntegrationVelocityForPart(partId) {
    return this.#stateByPart.get(partId)?.preIntegrationVelocity || null;
  }

  telemetry() {
    return Object.freeze({
      active: this.active(),
      records: Object.freeze(
        this.#model.parts.map((part) => {
          const state = this.#stateByPart.get(part.id);
          return Object.freeze({
            tick: this.#tick,
            partId: part.id,
            applicationPointWorldM: Object.freeze(
              plainVector(part.body.position),
            ),
            forceN: Object.freeze(plainVector(state.aeroForce)),
            dragForceN: Object.freeze(plainVector(state.dragForce)),
            liftForceN: Object.freeze(plainVector(state.liftForce)),
            magnitudeN: vectorLength(state.aeroForce),
            dragMagnitudeN: vectorLength(state.dragForce),
            liftMagnitudeN: vectorLength(state.liftForce),
          });
        }),
      ),
    });
  }

  dispose() {
    this.#model = null;
    this.#windAt = null;
    this.#terrainCollisionStream = null;
    this.#stateByPart.clear();
    this.#heatRecords = Object.freeze([]);
    this.#tick = 0;
  }
}
