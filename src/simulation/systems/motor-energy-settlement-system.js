import {
  canonicalId,
  compareCanonicalIds,
  DomainValidationError,
  immutableClone,
  stableStringify,
} from "../../model/primitives.js";
import {
  issueInertPlainData,
  requireInertPlainData,
} from "../../model/plain-data-contract.js";
import {
  multibodyMotorEnergyOwnerIds,
  settleOwnedMultibodyMotorEnergy,
} from "../multibody-runtime.js";

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
const zeroTotals = () => ({
  electricalEnergyJ: 0,
  positiveMechanicalWorkJ: 0,
  absorbedMechanicalWorkJ: 0,
  rejectedHeatJ: 0,
});

function canonicalOwnerIds(ownerIds) {
  if (!Array.isArray(ownerIds))
    throw new DomainValidationError(
      "MOTOR_ENERGY_OWNER_AUTHORITY_REQUIRED",
      "Motor-energy state requires the live canonical motor-owner identities",
    );
  let ids;
  try {
    ids = ownerIds.map((partId, index) =>
      canonicalId(partId, { path: ["ownerIds", index] }),
    );
    ids.sort(compareCanonicalIds);
  } catch (cause) {
    throw new DomainValidationError(
      "INVALID_MOTOR_ENERGY_OWNER_IDENTITIES",
      "Motor-energy owner identities must be canonical",
      { cause },
    );
  }
  if (
    ids.some(
      (partId, index) =>
        index > 0 && compareCanonicalIds(ids[index - 1], partId) === 0,
    )
  )
    throw new DomainValidationError(
      "INVALID_MOTOR_ENERGY_OWNER_IDENTITIES",
      "Motor-energy owner identities must be unique",
    );
  return ids;
}

/** Settles solver-metered motor-row work against the current power allocation. */
export class MotorEnergySettlementSystem {
  phase = "integration";
  checkpointOwner = "motor-energy-settlement";

  constructor({ ownerIds = null } = {}) {
    this.totals = new Map();
    this.lastSettledTick = 0;
    this.ownerIds = null;
    if (ownerIds) this.bindOwnerIds(ownerIds);
  }

  bindOwnerIds(ownerIds) {
    const canonical = canonicalOwnerIds(ownerIds);
    if (
      this.ownerIds &&
      stableStringify(this.ownerIds) !== stableStringify(canonical)
    )
      throw new DomainValidationError(
        "MOTOR_ENERGY_OWNER_IDENTITY_CHANGED",
        "Motor-energy owner identities cannot change during a run",
      );
    this.ownerIds = Object.freeze(canonical);
    for (const partId of canonical)
      if (!this.totals.has(partId)) this.totals.set(partId, zeroTotals());
    for (const partId of this.totals.keys())
      if (!canonical.includes(partId))
        throw new DomainValidationError(
          "MOTOR_ENERGY_OWNER_IDENTITY_MISMATCH",
          "Motor-energy totals contain a non-owner identity",
        );
    return this.ownerIds;
  }

  step(context, dt) {
    const runtime = context.services.multibodyRuntime,
      transaction = context.services.worldAdapter?.transaction,
      tick = context.clock.tick,
      pending = transaction?.motorEnergyRecordsForTick?.(tick);
    this.bindOwnerIds(
      context.services.motorEnergyOwnerIds ??
        multibodyMotorEnergyOwnerIds(runtime),
    );
    if (!pending) {
      this.lastSettledTick = tick;
      context.telemetry.motorEnergy = this.telemetry();
      return;
    }
    const settled = [];
    for (const record of pending.records) {
      const idleElectricalW = record.idleElectricalW || 0,
        requestedElectricalW =
          idleElectricalW +
          record.positiveMechanicalWorkJ / record.electricalEfficiency / dt,
        deliveredElectricalW = context.powerNetwork.drawPower(
          record.partId,
          requestedElectricalW,
          dt,
        ),
        deliveredMechanicalCapacityJ =
          Math.max(0, deliveredElectricalW * dt - idleElectricalW * dt) *
          record.electricalEfficiency;
      if (
        deliveredMechanicalCapacityJ +
          Math.max(1e-9, record.mechanicalBudgetJ * 1e-10) <
        record.positiveMechanicalWorkJ
      )
        throw new DomainValidationError(
          "MOTOR_ENERGY_SETTLEMENT_SHORTFALL",
          `Reserved electrical energy for motor ${String(record.partId)} did not cover solved work`,
          {
            details: {
              tick,
              record,
              requestedElectricalW,
              deliveredElectricalW,
              deliveredMechanicalCapacityJ,
              shortfallJ:
                record.positiveMechanicalWorkJ - deliveredMechanicalCapacityJ,
            },
          },
        );
      const conversionLossJ = Math.max(
          0,
          deliveredElectricalW * dt - record.positiveMechanicalWorkJ,
        ),
        rejectedHeatJ = conversionLossJ + record.absorbedMechanicalWorkJ,
        previous = this.totals.get(record.partId);
      if (!previous)
        throw new DomainValidationError(
          "MOTOR_ENERGY_RECORD_OWNER_MISMATCH",
          `Solved motor record identifies non-owner part ${String(record.partId)}`,
        );
      const next = {
        electricalEnergyJ:
          previous.electricalEnergyJ + deliveredElectricalW * dt,
        positiveMechanicalWorkJ:
          previous.positiveMechanicalWorkJ + record.positiveMechanicalWorkJ,
        absorbedMechanicalWorkJ:
          previous.absorbedMechanicalWorkJ + record.absorbedMechanicalWorkJ,
        rejectedHeatJ: previous.rejectedHeatJ + rejectedHeatJ,
      };
      this.totals.set(record.partId, next);
      const settlementReceipt = settleOwnedMultibodyMotorEnergy(
        runtime,
        record.partId,
        deliveredElectricalW,
        {
          dt,
          positiveMechanicalWorkJ: record.positiveMechanicalWorkJ,
          absorbedMechanicalWorkJ: record.absorbedMechanicalWorkJ,
          rejectedHeatJ,
          saturated: record.saturated,
          record,
        },
      );
      context.telemetry.mechanisms = settlementReceipt.telemetry;
      settled.push({
        ...record,
        requestedElectricalW,
        deliveredElectricalW,
        conversionLossJ,
        rejectedHeatJ,
      });
      // The mechanism settlement receipt, rather than a command-mode name,
      // identifies whether an authored actuator thermal mass consumed these
      // joules. Only unclaimed heat belongs to the assembly collector.
      if (rejectedHeatJ > 0 && !settlementReceipt.rejectedHeatClaimed)
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
    if (!this.ownerIds)
      throw new DomainValidationError(
        "MOTOR_ENERGY_OWNER_AUTHORITY_REQUIRED",
        "Motor-energy export requires bound live owner identities",
      );
    return issueInertPlainData({
      version: 2,
      lastSettledTick: this.lastSettledTick,
      ownerIds: this.ownerIds,
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
      !checkpointKeysMatch(state, [
        "version",
        "lastSettledTick",
        "ownerIds",
        "totals",
      ]) ||
      state.version !== 2 ||
      !Number.isSafeInteger(state.lastSettledTick) ||
      state.lastSettledTick < 0 ||
      !Array.isArray(state.totals)
    )
      throw new DomainValidationError(
        "INVALID_MOTOR_ENERGY_SETTLEMENT_CHECKPOINT",
        "Motor energy settlement checkpoint must use version 2",
      );
    const ownerIds = canonicalOwnerIds(state.ownerIds),
      expectedOwnerIds = this.ownerIds;
    if (
      stableStringify(ownerIds) !== stableStringify(state.ownerIds) ||
      !expectedOwnerIds ||
      stableStringify(ownerIds) !== stableStringify(expectedOwnerIds)
    )
      throw new DomainValidationError(
        "MOTOR_ENERGY_OWNER_IDENTITY_MISMATCH",
        "Motor-energy checkpoint identities must exactly match the live owner set",
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
      if (Math.abs(values.rejectedHeatJ - expectedRejectedHeatJ) > toleranceJ)
        throw new DomainValidationError(
          "INVALID_MOTOR_ENERGY_SETTLEMENT_CHECKPOINT",
          "Motor energy settlement totals must conserve electrical input as positive work plus rejected heat minus absorbed work",
        );
      totals.set(partId, structuredClone(values));
    }
    if (
      stableStringify([...totals.keys()]) !== stableStringify(expectedOwnerIds)
    )
      throw new DomainValidationError(
        "MOTOR_ENERGY_OWNER_IDENTITY_MISMATCH",
        "Motor-energy checkpoint requires exactly one total for every live owner",
      );
    return { lastSettledTick: state.lastSettledTick, ownerIds, totals };
  }

  importState(state) {
    const validated = this.validateState(state);
    this.lastSettledTick = validated.lastSettledTick;
    this.ownerIds = Object.freeze(validated.ownerIds);
    this.totals = validated.totals;
  }

  dispose() {
    this.totals.clear();
    this.lastSettledTick = 0;
    this.ownerIds = null;
  }
}
