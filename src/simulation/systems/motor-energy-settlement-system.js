import {
  DomainValidationError,
  immutableClone,
} from "../../model/primitives.js";

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
      context.telemetry.mechanisms = runtime.recordSettledMotorElectricalPower(
        record.partId,
        deliveredElectricalW,
      );
      settled.push({
        ...record,
        requestedElectricalW,
        deliveredElectricalW,
        conversionLossJ,
        rejectedHeatJ,
      });
      if (rejectedHeatJ > 0)
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
    return immutableClone({
      version: 1,
      lastSettledTick: this.lastSettledTick,
      totals: [...this.totals],
    });
  }

  importState(state) {
    if (
      state?.version !== 1 ||
      !Number.isSafeInteger(state.lastSettledTick) ||
      !Array.isArray(state.totals)
    )
      throw new DomainValidationError(
        "INVALID_MOTOR_ENERGY_SETTLEMENT_CHECKPOINT",
        "Motor energy settlement checkpoint must use version 1",
      );
    this.lastSettledTick = state.lastSettledTick;
    this.totals = new Map(structuredClone(state.totals));
  }

  dispose() {
    this.totals.clear();
    this.lastSettledTick = 0;
  }
}
