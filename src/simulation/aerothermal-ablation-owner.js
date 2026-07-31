import { DomainValidationError } from "../model/primitives.js";
import { registerOwnedImmutable } from "../model/owned-immutable-value.js";
import {
  advanceThermalState,
  createThermalState,
  thermalMass,
} from "./thermal-model.js";
import { vectorLength } from "./flight-vector-math.js";

function physicalConnection(connection) {
  return ["mechanical", "mesh"].includes(connection.kind) && !connection.failed;
}

function ownedThermalSnapshot(partId, state) {
  const thermal = Object.freeze({ ...state }),
    parts = Object.freeze({ [partId]: thermal });
  return {
    thermal,
    bodyThermal: registerOwnedImmutable(Object.freeze({ parts })),
  };
}

/** Owns only mutable material temperature, ablation and thermal failure state. */
export class AerothermalAblationOwner {
  #model;
  #aerodynamics;
  #heatInputCollector;
  #thermalByPart = new Map();
  #telemetry = null;

  constructor({
    physicalFlightModel,
    aerodynamicForceOwner,
    heatInputCollector = null,
  }) {
    this.#model = physicalFlightModel;
    this.#aerodynamics = aerodynamicForceOwner;
    this.#heatInputCollector = heatInputCollector;
    for (const part of physicalFlightModel.parts)
      this.#thermalByPart.set(
        part.id,
        createThermalState(
          part.aerothermal.material,
          part.baseStructuralMassKg,
        ),
      );
  }

  active() {
    return this.#model?.active() || false;
  }

  step(context, dt) {
    if (!this.active()) return;
    const heatInputs = this.#heatInputCollector?.recordsForTick(
        context.clock.tick,
      ),
      heatByPart = new Map();
    for (const input of heatInputs || []) {
      const merged = heatByPart.get(input.partId) || {
        incidentHeatFluxWPerM2: 0,
        surfaceAreaM2: 0,
        atmosphereTemperatureK: 0,
        directHeatPowerW: 0,
      };
      merged.incidentHeatFluxWPerM2 += input.incidentHeatFluxWPerM2;
      merged.surfaceAreaM2 = Math.max(
        merged.surfaceAreaM2,
        input.surfaceAreaM2,
      );
      merged.atmosphereTemperatureK = Math.max(
        merged.atmosphereTemperatureK,
        input.atmosphereTemperatureK,
      );
      merged.directHeatPowerW += input.directHeatPowerW;
      heatByPart.set(input.partId, merged);
    }
    if (!heatInputs)
      for (const record of this.#aerodynamics.heatRecords())
        heatByPart.set(record.partId, record);
    const thermalFailures = new Set(),
      consumedParts = new Set(),
      snapshots = new Map();
    for (const part of this.#model.parts) {
      const thermal = this.#thermalByPart.get(part.id),
        heat = heatByPart.get(part.id);
      if (heat) {
        const response = advanceThermalState(thermal, {
          dt,
          incidentHeatFlux: heat.incidentHeatFluxWPerM2,
          surfaceArea: heat.surfaceAreaM2,
          atmosphereTemperatureK: heat.atmosphereTemperatureK,
          directHeatPowerW: heat.directHeatPowerW,
        });
        if (response.consumed) consumedParts.add(part.id);
        if (response.exceededLimit) thermalFailures.add(part.id);
      }
      const snapshot = ownedThermalSnapshot(part.id, thermal);
      snapshots.set(part.id, snapshot.thermal);
      const bodyId = context.bodyRegistry.bodyForPart(part.id)?.bodyId;
      if (bodyId) context.bodyRegistry.setThermal(bodyId, snapshot.bodyThermal);
    }
    const failurePartIds = new Set([...thermalFailures, ...consumedParts]),
      failedConnectionIds = context.runGraph
        .connections()
        .filter(
          (connection) =>
            physicalConnection(connection) &&
            (failurePartIds.has(connection.a) ||
              failurePartIds.has(connection.b)),
        )
        .map((connection) => connection.id);
    if (failedConnectionIds.length || consumedParts.size)
      context.runGraph.applyStructuralEvent({
        failedConnectionIds,
        detachedPartIds: [...consumedParts],
        reason: consumedParts.size
          ? "ablative material exhausted"
          : "material temperature exceeded its rated limit",
        mode: consumedParts.size ? "ablation" : "thermal",
        time: context.time,
      });
    this.#telemetry = this.#projectTelemetry(context, snapshots);
    context.telemetry.aerothermal = this.#telemetry;
  }

  initializeTelemetry(context) {
    this.#telemetry = this.#projectTelemetry(context);
    return this.#telemetry;
  }

  massContributions() {
    return this.#model.parts.map((part) => {
      const thermal = this.#thermalByPart.get(part.id);
      return {
        partId: part.id,
        initialStructuralMassKg: part.baseStructuralMassKg,
        structuralMassKg: Math.max(0.001, thermalMass(thermal)),
        ablatedMassKg: Math.max(0, Number(thermal.ablatedMass || 0)),
      };
    });
  }

  telemetry(context = null) {
    return this.#telemetry || this.#projectTelemetry(context);
  }

  #projectTelemetry(context, snapshots = null) {
    const parts = this.#model.parts.map((part) => {
        const thermal = this.#thermalByPart.get(part.id),
          force = this.#aerodynamics.forceForPart(part.id);
        return {
          id: part.id,
          thermal:
            snapshots?.get(part.id) ||
            ownedThermalSnapshot(part.id, thermal).thermal,
          scaleY: Math.max(0.035, thermal.remainingMass / thermal.initialMass),
          visible: !thermal.consumed,
          aerodynamicForceN: force ? vectorLength(force) : 0,
          detached: Boolean(context?.runGraph?.part(part.id)?.detached),
        };
      }),
      temperaturesC = parts.map((part) => part.thermal.temperatureK - 273.15),
      fluxes = parts.map((part) => part.thermal.heatFlux),
      health = parts.map((part) => part.thermal.health);
    return Object.freeze({
      active: this.active(),
      mass: this.#model.parts.reduce((sum, part) => sum + part.body.mass, 0),
      heatFlux: Math.max(0, ...fluxes),
      heatLoadMJ: parts.reduce((sum, part) => sum + part.thermal.heatLoadMJ, 0),
      skinTempC: temperaturesC.length ? Math.max(...temperaturesC) : 15,
      thermalHealth: health.length ? Math.min(...health) : 1,
      overheated: parts.some(
        (part) =>
          !part.thermal.ablative &&
          part.thermal.temperatureK - 273.15 >= part.thermal.heatLimit,
      ),
      parts: Object.freeze(parts),
    });
  }

  exportState() {
    return structuredClone({
      version: 1,
      parts: this.#model.parts.map((part) => ({
        id: part.id,
        thermal: this.#thermalByPart.get(part.id),
      })),
    });
  }

  validateState(checkpoint) {
    if (checkpoint?.version !== 1 || !Array.isArray(checkpoint.parts))
      throw new DomainValidationError(
        "INVALID_AEROTHERMAL_CHECKPOINT",
        "Aerothermal checkpoint must use version 1",
      );
    const parts = new Map(
      checkpoint.parts.map((record) => [record.id, record]),
    );
    if (
      parts.size !== this.#model.parts.length ||
      this.#model.parts.some((part) => !parts.has(part.id))
    )
      throw new DomainValidationError(
        "AEROTHERMAL_CHECKPOINT_IDENTITY_MISMATCH",
        "Aerothermal checkpoint part identity does not match the running simulation",
      );
    return parts;
  }

  importState(checkpoint) {
    const parts = this.validateState(checkpoint);
    for (const part of this.#model.parts)
      this.#thermalByPart.set(
        part.id,
        structuredClone(parts.get(part.id).thermal),
      );
    this.#telemetry = null;
  }

  dispose() {
    this.#model = null;
    this.#aerodynamics = null;
    this.#heatInputCollector = null;
    this.#thermalByPart.clear();
    this.#telemetry = null;
  }
}
