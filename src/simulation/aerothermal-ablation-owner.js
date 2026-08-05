import { DomainValidationError } from "../model/primitives.js";
import { registerOwnedImmutable } from "../model/owned-immutable-value.js";
import {
  advanceThermalState,
  createThermalState,
  thermalMass,
} from "./thermal-model.js";
import { vectorLength } from "./flight-vector-math.js";

const THERMAL_CHECKPOINT_FIELDS = Object.freeze([
  "temperatureK",
  "heatFlux",
  "heatLoadMJ",
  "health",
  "remainingMass",
  "ablatedMass",
  "consumed",
]);

function checkpointKeysMatch(value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort(),
    expected = [...expectedKeys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

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

  /** Rebuilds the registry's read model from this sole thermal-state owner. */
  synchronizeBodyRegistry(bodyRegistry) {
    for (const part of this.#model.parts) {
      const bodyId = bodyRegistry.bodyForPart(part.id)?.bodyId;
      if (bodyId)
        bodyRegistry.setThermal(
          bodyId,
          ownedThermalSnapshot(part.id, this.#thermalByPart.get(part.id))
            .bodyThermal,
        );
    }
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
      version: 2,
      parts: this.#model.parts.map((part) => ({
        id: part.id,
        thermal: Object.fromEntries(
          THERMAL_CHECKPOINT_FIELDS.map((field) => [
            field,
            this.#thermalByPart.get(part.id)[field],
          ]),
        ),
      })),
    });
  }

  validateState(checkpoint) {
    if (
      checkpoint?.version !== 2 ||
      !checkpointKeysMatch(checkpoint, ["version", "parts"]) ||
      !Array.isArray(checkpoint.parts)
    )
      throw new DomainValidationError(
        "INVALID_AEROTHERMAL_CHECKPOINT",
        "Aerothermal checkpoint must use the version 2 mutable-state projection",
      );
    const parts = new Map();
    for (const record of checkpoint.parts) {
      const part = this.#model.parts.find(
          (candidate) => candidate.id === record?.id,
        ),
        thermal = record?.thermal,
        initialMass = part?.baseStructuralMassKg;
      if (!part) {
        if (record?.id != null) parts.set(record.id, record);
        continue;
      }
      const expectedConsumed = Boolean(
          part.aerothermal.material.ablative &&
          thermal?.remainingMass / initialMass <= 0.01,
        ),
        massTolerance = Math.max(1e-12, initialMass * 1e-9);
      if (
        !checkpointKeysMatch(record, ["id", "thermal"]) ||
        !checkpointKeysMatch(thermal, THERMAL_CHECKPOINT_FIELDS) ||
        ![
          "temperatureK",
          "heatFlux",
          "heatLoadMJ",
          "health",
          "remainingMass",
          "ablatedMass",
        ].every((field) => Number.isFinite(thermal[field])) ||
        thermal.temperatureK <= 0 ||
        thermal.heatLoadMJ < 0 ||
        thermal.health < 0 ||
        thermal.health > 1 ||
        thermal.remainingMass < 0 ||
        thermal.remainingMass > initialMass + massTolerance ||
        thermal.ablatedMass < 0 ||
        thermal.ablatedMass > initialMass + massTolerance ||
        Math.abs(thermal.remainingMass + thermal.ablatedMass - initialMass) >
          massTolerance ||
        typeof thermal.consumed !== "boolean" ||
        thermal.consumed !== expectedConsumed ||
        (!part.aerothermal.material.ablative &&
          (Math.abs(thermal.remainingMass - initialMass) > massTolerance ||
            thermal.ablatedMass !== 0 ||
            thermal.consumed))
      )
        throw new DomainValidationError(
          "INVALID_AEROTHERMAL_CHECKPOINT_STATE",
          `Aerothermal checkpoint contains physically invalid state for ${String(part.id)}`,
        );
      if (parts.has(record.id))
        throw new DomainValidationError(
          "AEROTHERMAL_CHECKPOINT_IDENTITY_MISMATCH",
          "Aerothermal checkpoint contains duplicate part identities",
        );
      parts.set(record.id, structuredClone(thermal));
    }
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
    for (const part of this.#model.parts) {
      const initial = createThermalState(
        part.aerothermal.material,
        part.baseStructuralMassKg,
      );
      this.#thermalByPart.set(
        part.id,
        Object.assign(initial, structuredClone(parts.get(part.id))),
      );
    }
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
