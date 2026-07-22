import * as CANNON from "cannon-es";
import { DomainValidationError, finiteNumber } from "../model/primitives.js";
import {
  CANNON_SOLVER_TRANSACTION_ID,
  CannonSolverTransaction,
} from "./cannon-solver-transaction.js";

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
    this.#session++;
    this.#tick = 0;
    this.#integratedTick = -1;
    this.#integrationCount = 0;
    return this.telemetry();
  }

  beginTick(tick = this.#tick + 1) {
    const next = finiteNumber(tick, { min: 0, path: ["tick"] });
    if (next < this.#tick)
      throw new DomainValidationError(
        "CANNON_TICK_REGRESSION",
        "Cannon integration tick cannot move backwards",
      );
    this.#tick = next;
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
    this.transaction.step(dt);
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
          const externalBodyId = body.userData?.externalBodyId;
          if (!externalBodyId)
            throw new DomainValidationError(
              "UNOWNED_CANNON_CHECKPOINT_BODY",
              "Every non-component Cannon body must have a stable externalBodyId",
            );
          return {
            externalBodyId,
            type: body.type,
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
                  mass: body.mass,
                  invMass: body.invMass,
                  inertia: vector(body.inertia),
                  invInertia: vector(body.invInertia),
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

  importState(state) {
    if (state?.transactionId !== CANNON_SOLVER_TRANSACTION_ID)
      throw new DomainValidationError(
        "CANNON_TRANSACTION_CHECKPOINT_MISMATCH",
        "Cannon checkpoint transaction identity changed",
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
    if (
      bodies.has(undefined) ||
      bodies.size !== records.size ||
      [...bodies.keys()].some((id) => !records.has(id))
    )
      throw new DomainValidationError(
        "CANNON_EXTERNAL_BODY_CHECKPOINT_MISMATCH",
        "Checkpoint external bodies do not match the running world",
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
    for (const [id, body] of bodies) {
      const record = records.get(id);
      if (record.type !== body.type)
        throw new DomainValidationError(
          "CANNON_EXTERNAL_BODY_TYPE_MISMATCH",
          `External Cannon body ${id} changed type`,
        );
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
        body.mass = record.mass;
        body.invMass = record.invMass;
        copyVector(body.inertia, record.inertia);
        copyVector(body.invInertia, record.invInertia);
        body.sleepState = record.sleepState;
        body.timeLastSleepy = record.timeLastSleepy;
      }
      body.aabbNeedsUpdate = true;
      body.updateInertiaWorld(true);
    }
    this.world.broadphase.dirty = true;
    this.#session = finiteNumber(state.session, { min: 0 });
    this.#tick = finiteNumber(state.tick, { min: 0 });
    this.#integratedTick = finiteNumber(state.integratedTick, { min: -1 });
    this.#integrationCount = finiteNumber(state.integrationCount, { min: 0 });
  }
}
