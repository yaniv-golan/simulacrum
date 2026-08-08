import {
  DomainValidationError,
  immutableClone,
} from "../../model/primitives.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../../model/plain-data-contract.js";
import { settleOwnedMultibodyMotorEnergy } from "../multibody-runtime.js";

const checkpointKeysMatch = (value, expected) =>
  Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key)),
  );
const totalFields = Object.freeze([
  "electricalEnergyJ",
  "positiveMechanicalWorkJ",
  "absorbedMechanicalWorkJ",
  "rejectedHeatJ",
]);

/** Settles solver-metered motor-row work against the current power allocation. */
export class MotorEnergySettlementSystem {
  phase = "integration";
  checkpointOwner = "motor-energy-settlement";

  constructor() {
    this.totals = new Map();
    this.lastSettledTick = 0;
  }

  step(context, dt) {
    const runtime = context.services.multibodyRuntime,
      transaction = context.services.worldAdapter?.transaction,
      tick = context.clock.tick,
      pending = transaction?.motorEnergyRecordsForTick?.(tick);
    if (!pending) {
      context.telemetry.motorEnergy = this.telemetry();
      return;
    }
    const settled = [];
    for (const record of pending.records) {
      const requestedElectricalW =
          record.positiveMechanicalWorkJ > 0
            ? record.positiveMechanicalWorkJ / record.electricalEfficiency / dt
            : 0,
        deliveredElectricalW = context.powerNetwork.drawPower(
          record.partId,
          requestedElectricalW,
          dt,
        ),
        deliveredMechanicalCapacityJ =
          deliveredElectricalW * dt * record.electricalEfficiency;
      if (
        deliveredMechanicalCapacityJ +
          Math.max(1e-9, record.mechanicalBudgetJ * 1e-10) <
        record.positiveMechanicalWorkJ
      )
        throw new DomainValidationError(
          "MOTOR_ENERGY_SETTLEMENT_SHORTFALL",
          `Reserved electrical energy for motor ${String(record.partId)} did not cover solved work`,
        );
      const conversionLossJ = Math.max(
          0,
          deliveredElectricalW * dt - record.positiveMechanicalWorkJ,
        ),
        rejectedHeatJ = conversionLossJ + record.absorbedMechanicalWorkJ,
        previous = this.totals.get(record.partId) || {
          electricalEnergyJ: 0,
          positiveMechanicalWorkJ: 0,
          absorbedMechanicalWorkJ: 0,
          rejectedHeatJ: 0,
        },
        next = {
          electricalEnergyJ:
            previous.electricalEnergyJ + deliveredElectricalW * dt,
          positiveMechanicalWorkJ:
            previous.positiveMechanicalWorkJ + record.positiveMechanicalWorkJ,
          absorbedMechanicalWorkJ:
            previous.absorbedMechanicalWorkJ + record.absorbedMechanicalWorkJ,
          rejectedHeatJ: previous.rejectedHeatJ + rejectedHeatJ,
        };
      this.totals.set(record.partId, next);
      context.telemetry.mechanisms = settleOwnedMultibodyMotorEnergy(
        runtime,
        record.partId,
        deliveredElectricalW,
        {
          dt,
          positiveMechanicalWorkJ: record.positiveMechanicalWorkJ,
          absorbedMechanicalWorkJ: record.absorbedMechanicalWorkJ,
          rejectedHeatJ,
          saturated: record.saturated,
        },
      );
      settled.push({
        ...record,
        requestedElectricalW,
        deliveredElectricalW,
        conversionLossJ,
        rejectedHeatJ,
      });
      // Position-impedance actuators own an authored winding thermal state in
      // MultibodyRuntime; recordSettledMotorElectricalPower deposits this heat
      // there. Drive motors have no internal thermal owner, so their rejected
      // heat belongs to the assembly heat collector instead. Never deposit the
      // same joules in both thermal masses.
      if (rejectedHeatJ > 0 && record.mode !== "position-impedance")
        context.services.heatInputCollector?.submit({
          tick,
          partId: record.partId,
          source: "motor-energy-settlement",
          directHeatPowerW: rejectedHeatJ / dt,
        });
    }
    transaction.acknowledgeMotorEnergySettlement({
      tick,
      recordDigest: pending.recordDigest,
    });
    this.lastSettledTick = tick;
    if (!context.services.deferPowerTelemetryUntilCompletion)
      context.telemetry.power = context.powerNetwork.telemetry();
    context.telemetry.motorEnergy = this.#telemetry(
      settled,
      pending.recordDigest,
    );
  }

  telemetry() {
    return this.#telemetry();
  }

  #telemetry(records = [], recordDigest = null) {
    return immutableClone({
      version: 1,
      lastSettledTick: this.lastSettledTick,
      totals: [...this.totals]
        .sort(([left], [right]) =>
          `${typeof left}:${String(left)}`.localeCompare(
            `${typeof right}:${String(right)}`,
            "en",
          ),
        )
        .map(([partId, totals]) => ({ partId, ...totals })),
      records,
      recordDigest,
    });
  }

  exportState() {
    return issueInertPlainData({
      version: 1,
      lastSettledTick: this.lastSettledTick,
      totals: [...this.totals],
    });
  }

  validateState(state) {
    state = requireInertPlainData(state, {
      code: "INVALID_MOTOR_ENERGY_CHECKPOINT_INPUT",
      message:
        "Motor-energy checkpoint must be serialized JSON or an exported immutable state",
    });
    if (
      !checkpointKeysMatch(state, ["version", "lastSettledTick", "totals"]) ||
      state.version !== 1 ||
      !Number.isSafeInteger(state.lastSettledTick) ||
      state.lastSettledTick < 0 ||
      !Array.isArray(state.totals)
    )
      throw new DomainValidationError(
        "INVALID_MOTOR_ENERGY_SETTLEMENT_CHECKPOINT",
        "Motor energy settlement checkpoint must use version 1",
      );
    const totals = new Map();
    for (const entry of state.totals) {
      const partId = entry?.[0],
        values = entry?.[1],
        validPartId =
          (typeof partId === "string" && partId.length > 0) ||
          Number.isSafeInteger(partId);
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        !validPartId ||
        totals.has(partId) ||
        !checkpointKeysMatch(values, totalFields) ||
        !totalFields.every(
          (field) => Number.isFinite(values[field]) && values[field] >= 0,
        )
      )
        throw new DomainValidationError(
          "INVALID_MOTOR_ENERGY_SETTLEMENT_CHECKPOINT",
          "Motor energy settlement totals must be unique finite non-negative part records",
        );
      const expectedRejectedHeatJ =
          values.electricalEnergyJ -
          values.positiveMechanicalWorkJ +
          values.absorbedMechanicalWorkJ,
        scaleJ = Math.max(
          1,
          Math.abs(values.rejectedHeatJ),
          Math.abs(expectedRejectedHeatJ),
        ),
        toleranceJ = Math.max(1e-9, scaleJ * 1e-10);
      if (
        expectedRejectedHeatJ < -toleranceJ ||
        Math.abs(values.rejectedHeatJ - expectedRejectedHeatJ) > toleranceJ
      )
        throw new DomainValidationError(
          "INVALID_MOTOR_ENERGY_SETTLEMENT_CHECKPOINT",
          "Motor energy settlement totals must conserve electrical input as positive work plus rejected heat minus absorbed work",
        );
      totals.set(partId, structuredClone(values));
    }
    return { lastSettledTick: state.lastSettledTick, totals };
  }

  importState(state) {
    const validated = this.validateState(state);
    this.lastSettledTick = validated.lastSettledTick;
    this.totals = validated.totals;
  }

  dispose() {
    this.totals.clear();
    this.lastSettledTick = 0;
  }
}
