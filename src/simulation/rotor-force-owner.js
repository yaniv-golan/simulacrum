import * as CANNON from "cannon-es";
import { rotorAerodynamicPerformance } from "../model/rotor-aerodynamics-contracts.js";
import { writePartToWorldQuaternion } from "./body-part-frame.js";
import { standardAtmosphere } from "./environment/atmosphere.js";
import {
  identitySetUsesTypedStrings,
  immutableClone,
  scopedIdentity,
} from "../model/primitives.js";

const ZERO = CANNON.Vec3.ZERO;

function bodyIdForPart(model, part) {
  if (part.bodyId) return part.bodyId;
  return scopedIdentity("body", part.id, {
    typedStrings: identitySetUsesTypedStrings(
      (model?.parts || []).map((candidate) => candidate.id),
    ),
  });
}

/** Applies passive rotor aerodynamics from compiled shaft capability records. */
export class RotorForceOwner {
  #model;
  #windAt;
  #records = Object.freeze([]);
  #partQuaternion = new CANNON.Quaternion();
  #inverseMassQuaternion = new CANNON.Quaternion();
  #axis = new CANNON.Vec3();
  #force = new CANNON.Vec3();
  #torque = new CANNON.Vec3();

  constructor({ physicalFlightModel, windAt }) {
    this.#model = physicalFlightModel;
    this.#windAt = windAt;
  }

  active() {
    return this.#model?.parts.some(
      (part) => part.propulsion?.kind === "shaft-rotor-aerodynamics-v1",
    );
  }

  step(context) {
    if (!this.active()) return;
    const records = [];
    for (const part of this.#model.parts) {
      const contract = part.propulsion;
      if (contract?.kind !== "shaft-rotor-aerodynamics-v1") continue;
      const shaft = this.#model.runtime.rotaryStateForPart(part.id),
        body = part.body;
      if (!shaft.valid || context.runGraph.part(part.id)?.detached) {
        records.push({
          kind: contract.kind,
          partId: part.id,
          bodyId: bodyIdForPart(this.#model, part),
          tick: context.clock.tick,
          active: false,
          valid: false,
          validity: shaft.reason,
          thrustN: 0,
          reactionTorqueNm: 0,
          applicationPointWorldM: {
            x: body.position.x,
            y: body.position.y,
            z: body.position.z,
          },
        });
        continue;
      }
      writePartToWorldQuaternion(
        body,
        this.#partQuaternion,
        this.#inverseMassQuaternion,
      );
      this.#partQuaternion.vmult(
        new CANNON.Vec3(...contract.localAxis),
        this.#axis,
      );
      this.#axis.normalize();
      const wind = this.#windAt(
          { x: body.position.x, y: body.position.y, z: body.position.z },
          context.time,
        ),
        relativeVelocity = {
          x: body.velocity.x - wind.x,
          y: body.velocity.y - wind.y,
          z: body.velocity.z - wind.z,
        },
        axialInflowMps =
          relativeVelocity.x * this.#axis.x +
          relativeVelocity.y * this.#axis.y +
          relativeVelocity.z * this.#axis.z,
        atmosphere = standardAtmosphere(Math.max(0, body.position.y)),
        performance = rotorAerodynamicPerformance(contract, {
          airDensityKgM3: atmosphere.density,
          axialInflowMps,
          angularSpeedRadS: shaft.absoluteAngularSpeedRadS,
        });
      this.#axis.scale(performance.thrustN, this.#force);
      body.applyForce(this.#force, ZERO);
      this.#axis.scale(performance.aerodynamicTorqueNm, this.#torque);
      body.torque.vadd(this.#torque, body.torque);
      const sourceIds =
          shaft.motorId == null
            ? []
            : context.powerNetwork.sourceIdsFor(shaft.motorId),
        allocation =
          shaft.motorId == null
            ? null
            : context.powerNetwork.allocationFor(shaft.motorId),
        command =
          shaft.motorId == null
            ? { source: "none" }
            : context.commandBus.read(shaft.motorId, "throttle", 0);
      records.push({
        kind: contract.kind,
        partId: part.id,
        bodyId: bodyIdForPart(this.#model, part),
        shaftConstraintId: shaft.constraintId,
        motorPartId: shaft.motorId,
        powerSourceIds: sourceIds,
        allocationId: allocation?.allocationId ?? null,
        tick: context.clock.tick,
        active: performance.thrustN !== 0,
        valid: performance.valid,
        validity: performance.reason,
        worldDirection: {
          x: this.#axis.x,
          y: this.#axis.y,
          z: this.#axis.z,
        },
        applicationPointWorldM: {
          x: body.position.x,
          y: body.position.y,
          z: body.position.z,
        },
        absoluteAngularSpeedRadS: shaft.absoluteAngularSpeedRadS,
        relativeAngularSpeedRadS: shaft.relativeAngularSpeedRadS,
        rpm: performance.rpm,
        handedness: contract.handedness,
        densityKgM3: atmosphere.density,
        axialInflowMps,
        inducedVelocityMps: performance.inducedVelocityMps,
        thrustN: performance.thrustN,
        reactionTorqueNm: performance.aerodynamicTorqueNm,
        mechanicalPowerW: performance.aerodynamicPowerW,
        tipMach: performance.tipMach,
        thermalLossW: 0,
        commandSource: command.source,
        throttle: Number(command.value || 0),
        failureInput:
          performance.reason === "overspeed" ||
          performance.reason === "tip-mach"
            ? "rotor-operating-envelope-exceeded"
            : null,
      });
    }
    this.#records = Object.freeze(
      records
        .sort((left, right) =>
          `${typeof left.partId}:${String(left.partId)}`.localeCompare(
            `${typeof right.partId}:${String(right.partId)}`,
            "en",
          ),
        )
        .map((record) => Object.freeze(record)),
    );
    const nozzles = context.telemetry.propulsion?.engines || [];
    context.telemetry.propulsion = immutableClone({
      version: 2,
      policy: "completed-mixed-propulsion-v1",
      tick: context.clock.tick,
      engines: [...nozzles, ...this.#records],
    });
  }

  records() {
    return this.#records;
  }

  dispose() {
    this.#model = null;
    this.#windAt = null;
    this.#records = Object.freeze([]);
  }
}
