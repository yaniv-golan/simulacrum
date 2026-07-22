import * as CANNON from "cannon-es";
import { readActuatorCommand } from "../../model/actuator-contracts.js";
import { pressureNozzlePerformance } from "../../model/pressure-nozzle-contracts.js";
import {
  DomainValidationError,
  immutableClone,
} from "../../model/primitives.js";
import { standardAtmosphere } from "../environment/atmosphere.js";
import {
  writePartToWorldQuaternion,
  writePartWorldPosition,
} from "../body-part-frame.js";

const clamp = (value, minimum, maximum) =>
  Math.max(minimum, Math.min(maximum, value));
const stableId = (value) => `${typeof value}:${String(value)}`;
const comparePartId = (left, right) =>
  stableId(left.partId).localeCompare(stableId(right.partId), "en");

function compiledEngines(context) {
  return (context.services.compiledAssembly?.bodies || [])
    .filter(
      (body) => body.capabilities?.propulsion?.kind === "pressure-nozzle-v1",
    )
    .map((body) => ({
      partId: body.partId,
      bodyId: body.id,
      contract: structuredClone(body.capabilities.propulsion),
    }))
    .sort(comparePartId);
}

function command(context, part, channel) {
  return readActuatorCommand(context.commandBus, part, channel, 0);
}

/** Plans and conservatively debits every local chemical-engine request. */
export class PressureNozzleDemandSystem {
  phase = "actuators";
  checkpointOwner = "chemical-propulsion";

  initialize(context) {
    context.pressureNozzleRuntime = {
      version: 1,
      engines: new Map(
        compiledEngines(context).map((engine) => [
          engine.partId,
          {
            ...engine,
            throttleState: 0,
            gimbalXRad: 0,
            gimbalZRad: 0,
            record: null,
          },
        ]),
      ),
    };
  }

  step(context, dt) {
    if (!context.materialResourceNetwork)
      throw new DomainValidationError(
        "MATERIAL_RESOURCE_NETWORK_UNAVAILABLE",
        "Pressure-nozzle demand requires the material-resource network",
      );
    const requests = [];
    for (const engine of context.pressureNozzleRuntime.engines.values()) {
      const part = context.runGraph.part(engine.partId),
        detached = !part || part.detached,
        throttle = detached
          ? { value: 0, source: "detached" }
          : command(context, part, "throttle"),
        collective = detached
          ? { value: 0, source: "detached" }
          : command(context, part, "collective"),
        target = clamp(Math.max(throttle.value, collective.value), 0, 1),
        response = 1 - Math.exp(-dt / engine.contract.throttleTimeConstantS);
      engine.throttleState += (target - engine.throttleState) * response;
      engine.throttleState = clamp(engine.throttleState, 0, 1);
      engine.gimbalXRad =
        clamp(detached ? 0 : command(context, part, "gimbal_x").value, -1, 1) *
        engine.contract.gimbalRangeRad;
      engine.gimbalZRad =
        clamp(detached ? 0 : command(context, part, "gimbal_z").value, -1, 1) *
        engine.contract.gimbalRangeRad;
      const stableThrottle =
          engine.throttleState + 1e-12 >= engine.contract.minimumStableThrottle
            ? engine.throttleState
            : 0,
        requestedMassFlowKgS =
          stableThrottle * engine.contract.maximumMassFlowKgS;
      engine.record = {
        kind: "pressure-nozzle-state-v1",
        partId: engine.partId,
        mediumId: engine.contract.mediumId,
        commandSource:
          throttle.value >= collective.value
            ? throttle.source
            : collective.source,
        targetThrottle: target,
        throttle: stableThrottle,
        requestedMassFlowKgS,
        requestedMassKg: requestedMassFlowKgS * dt,
        deliveredMassKg: 0,
        availabilityFraction: 0,
        gimbalXRad: engine.gimbalXRad,
        gimbalZRad: engine.gimbalZRad,
        detached,
      };
      requests.push({
        consumerPartId: engine.partId,
        mediumId: engine.contract.mediumId,
        requestedMassKg: engine.record.requestedMassKg,
      });
    }
    const allocations = context.materialResourceNetwork.allocate(requests, {
        tick: context.clock.tick,
        dt,
      }),
      byPart = new Map(
        allocations.map((allocation) => [
          allocation.consumerPartId,
          allocation,
        ]),
      );
    for (const engine of context.pressureNozzleRuntime.engines.values()) {
      const allocation = byPart.get(engine.partId);
      if (!allocation || allocation.tick !== context.clock.tick)
        throw new DomainValidationError(
          "PRESSURE_NOZZLE_ALLOCATION_MISSING",
          `Pressure nozzle ${String(engine.partId)} has no allocation for the current tick`,
        );
      Object.assign(engine.record, {
        allocationId: allocation.allocationId,
        allocationTransactionId: allocation.transactionId,
        allocationTick: allocation.tick,
        allocationGraphRevision: allocation.graphRevision,
        resourceComponentId: allocation.componentId,
        deliveredMassKg: allocation.deliveredMassKg,
        deliveredMassFlowKgS: allocation.deliveredMassKg / dt,
        availabilityFraction: allocation.availabilityFraction,
        specificAvailableEnergyJkg: allocation.specificAvailableEnergyJkg,
        allocatedChemicalEnergyJ: allocation.allocatedChemicalEnergyJ,
        storeDebits: allocation.storeDebits,
        allocationReason: allocation.reason,
      });
    }
    context.telemetry.materialResources =
      context.materialResourceNetwork.telemetry();
    context.telemetry.propulsion = this.telemetry(context);
  }

  telemetry(context) {
    return immutableClone({
      version: 1,
      policy: "local-demand-conserved-pressure-nozzle-v1",
      tick: context.clock.tick,
      engines: [...context.pressureNozzleRuntime.engines.values()]
        .sort(comparePartId)
        .map((engine) => engine.record),
    });
  }

  exportState(context) {
    return immutableClone({
      version: 1,
      engines: [...context.pressureNozzleRuntime.engines.values()]
        .sort(comparePartId)
        .map((engine) => ({
          partId: engine.partId,
          throttleState: engine.throttleState,
          gimbalXRad: engine.gimbalXRad,
          gimbalZRad: engine.gimbalZRad,
        })),
    });
  }

  importState(context, state) {
    if (state?.version !== 1 || !Array.isArray(state.engines))
      throw new DomainValidationError(
        "INVALID_PRESSURE_NOZZLE_CHECKPOINT",
        "Pressure-nozzle checkpoint must use version 1",
      );
    const records = new Map(
        state.engines.map((record) => [record.partId, record]),
      ),
      engines = context.pressureNozzleRuntime.engines;
    if (
      records.size !== engines.size ||
      [...engines.keys()].some((partId) => !records.has(partId))
    )
      throw new DomainValidationError(
        "PRESSURE_NOZZLE_CHECKPOINT_IDENTITY_MISMATCH",
        "Pressure-nozzle checkpoint engine set changed",
      );
    for (const engine of engines.values()) {
      const record = records.get(engine.partId);
      for (const field of ["throttleState", "gimbalXRad", "gimbalZRad"])
        if (!Number.isFinite(record[field]))
          throw new DomainValidationError(
            "INVALID_PRESSURE_NOZZLE_CHECKPOINT",
            `Pressure-nozzle checkpoint ${field} must be finite`,
          );
      engine.throttleState = clamp(record.throttleState, 0, 1);
      engine.gimbalXRad = record.gimbalXRad;
      engine.gimbalZRad = record.gimbalZRad;
      engine.record = null;
    }
  }

  dispose(context) {
    delete context.pressureNozzleRuntime;
  }
}

/** Applies only force backed by material already delivered in this tick. */
export class PressureNozzleForceSystem {
  phase = "environment";

  #partToWorld = new CANNON.Quaternion();
  #inverseMassFrame = new CANNON.Quaternion();
  #localDirection = new CANNON.Vec3();
  #worldDirection = new CANNON.Vec3();
  #worldForce = new CANNON.Vec3();
  #partOrigin = new CANNON.Vec3();
  #applicationOffset = new CANNON.Vec3();
  #applicationPoint = new CANNON.Vec3();
  #relativePoint = new CANNON.Vec3();
  #compiledVectors = new Map();

  initialize(context) {
    this.#compiledVectors = new Map(
      [...(context.pressureNozzleRuntime?.engines.values() || [])].map(
        (engine) => [
          engine.partId,
          {
            localAxis: new CANNON.Vec3(...engine.contract.localAxis),
            gimbalAxisX: new CANNON.Vec3(...engine.contract.gimbalAxisX),
            gimbalAxisZ: new CANNON.Vec3(...engine.contract.gimbalAxisZ),
            applicationPoint: new CANNON.Vec3(
              ...engine.contract.applicationPointPartM,
            ),
          },
        ],
      ),
    );
  }

  step(context) {
    const runtime = context.pressureNozzleRuntime;
    if (!runtime) return;
    for (const engine of runtime.engines.values()) {
      const record = engine.record,
        registered = context.bodyRegistry.bodyForPart(engine.partId),
        body = registered
          ? context.bodyRegistry.engineBody(registered.bodyId)
          : null;
      if (!record || !body || record.detached) continue;
      const atmosphere = standardAtmosphere(Math.max(0, body.position.y)),
        performance = pressureNozzlePerformance(
          engine.contract,
          record.deliveredMassFlowKgS,
          atmosphere.pressure,
        ),
        cosX = Math.cos(record.gimbalXRad),
        cosZ = Math.cos(record.gimbalZRad),
        sinX = Math.sin(record.gimbalXRad),
        sinZ = Math.sin(record.gimbalZRad),
        vectors = this.#compiledVectors.get(engine.partId);
      if (
        record.allocationTick !== context.clock.tick ||
        !record.allocationId ||
        !vectors
      )
        throw new DomainValidationError(
          "PRESSURE_NOZZLE_FORCE_WITHOUT_ALLOCATION",
          `Pressure nozzle ${String(engine.partId)} cannot apply force without its current allocation`,
        );
      const expectedChemicalEnergyJ =
          performance.chemicalInputW * context.clock.fixedDt,
        energyToleranceJ = Math.max(1e-8, expectedChemicalEnergyJ * 1e-10);
      if (
        Math.abs(expectedChemicalEnergyJ - record.allocatedChemicalEnergyJ) >
        energyToleranceJ
      )
        throw new DomainValidationError(
          "PRESSURE_NOZZLE_ENERGY_ALLOCATION_MISMATCH",
          `Pressure nozzle ${String(engine.partId)} energy does not match its material allocation`,
          {
            details: {
              allocationId: record.allocationId,
              expectedChemicalEnergyJ,
              allocatedChemicalEnergyJ: record.allocatedChemicalEnergyJ,
            },
          },
        );
      this.#localDirection.set(0, 0, 0);
      this.#localDirection.addScaledVector(
        cosX * cosZ,
        vectors.localAxis,
        this.#localDirection,
      );
      this.#localDirection.addScaledVector(
        sinX * cosZ,
        vectors.gimbalAxisX,
        this.#localDirection,
      );
      this.#localDirection.addScaledVector(
        sinZ,
        vectors.gimbalAxisZ,
        this.#localDirection,
      );
      this.#localDirection.normalize();
      writePartToWorldQuaternion(
        body,
        this.#partToWorld,
        this.#inverseMassFrame,
      );
      this.#partToWorld.vmult(this.#localDirection, this.#worldDirection);
      this.#worldDirection.scale(performance.thrustN, this.#worldForce);
      writePartWorldPosition(
        body,
        this.#partToWorld,
        this.#partOrigin,
        this.#applicationOffset,
      );
      this.#partToWorld.vmult(
        vectors.applicationPoint,
        this.#applicationOffset,
      );
      this.#partOrigin.vadd(this.#applicationOffset, this.#applicationPoint);
      this.#applicationPoint.vsub(body.position, this.#relativePoint);
      body.applyForce(this.#worldForce, this.#relativePoint);
      Object.assign(record, {
        forceApplicationTick: context.clock.tick,
        ambientPressurePa: atmosphere.pressure,
        ...performance,
        worldDirection: {
          x: this.#worldDirection.x,
          y: this.#worldDirection.y,
          z: this.#worldDirection.z,
        },
        applicationPointWorldM: {
          x: this.#applicationPoint.x,
          y: this.#applicationPoint.y,
          z: this.#applicationPoint.z,
        },
      });
    }
    const demandSystem = context.services.pressureNozzleDemandSystem;
    context.telemetry.propulsion = demandSystem
      ? demandSystem.telemetry(context)
      : immutableClone({
          version: 1,
          policy: "local-demand-conserved-pressure-nozzle-v1",
          tick: context.clock.tick,
          engines: [...runtime.engines.values()].map((engine) => engine.record),
        });
  }

  dispose() {
    this.#compiledVectors.clear();
  }
}
