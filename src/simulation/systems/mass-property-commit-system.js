import { deriveDynamicMassProperties } from "../../model/dynamic-mass-properties.js";
import {
  DomainValidationError,
  immutableClone,
} from "../../model/primitives.js";

const stableId = (value) => `${typeof value}:${String(value)}`;
const comparePartId = (left, right) =>
  stableId(left.partId).localeCompare(stableId(right.partId), "en");
const MASS_PROPERTY_ABSOLUTE_TOLERANCE = 1e-12;
const MASS_PROPERTY_RELATIVE_TOLERANCE = 1e-12;

function nearlyEqual(left, right) {
  const difference = Math.abs(Number(left) - Number(right));
  return (
    Number.isFinite(difference) &&
    difference <=
      Math.max(
        MASS_PROPERTY_ABSOLUTE_TOLERANCE,
        Math.max(Math.abs(Number(left)), Math.abs(Number(right))) *
          MASS_PROPERTY_RELATIVE_TOLERANCE,
      )
  );
}

function vectorEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => nearlyEqual(value, right[index]))
  );
}

function massPropertiesEqual(left, right) {
  const leftTensor = left?.inertiaTensorAtComPartKgM2,
    rightTensor = right?.inertiaTensorAtComPartKgM2;
  return Boolean(
    left &&
    right &&
    nearlyEqual(left.massKg, right.massKg) &&
    nearlyEqual(left.volumeM3, right.volumeM3) &&
    vectorEqual(left.comPositionPartM, right.comPositionPartM) &&
    leftTensor &&
    rightTensor &&
    ["xx", "yy", "zz", "xy", "xz", "yz"].every((field) =>
      nearlyEqual(leftTensor[field], rightTensor[field]),
    ),
  );
}

function timingFor(stage, tick) {
  return stage === "initialization"
    ? {
        appliedAfterIntegratedTick: null,
        effectiveTick: tick,
        timingPolicy: "before-first-integration-v1",
      }
    : {
        appliedAfterIntegratedTick: tick,
        effectiveTick: tick + 1,
        timingPolicy: "post-thermal-for-next-tick-v1",
      };
}

/** Owns the only runtime transaction that may change physical body mass. */
export class MassPropertyCommitSystem {
  phase = "thermal";

  initialize(context) {
    context.massPropertyRuntime = {
      version: 1,
      lastTransaction: this.#commit(context, "initialization"),
    };
    context.initialSystemTelemetry ||= {};
    context.initialSystemTelemetry.massProperties = this.telemetry(context);
  }

  step(context) {
    context.massPropertyRuntime.lastTransaction = this.#commit(
      context,
      "post-thermal",
    );
    context.telemetry.massProperties = this.telemetry(context);
  }

  telemetry(context) {
    return immutableClone({
      version: 1,
      policy: "single-post-thermal-transaction-v1",
      ...context.massPropertyRuntime.lastTransaction,
    });
  }

  afterCheckpointRestore(context) {
    const restored = context.telemetry?.systems?.massProperties;
    if (!restored || restored.version !== 1)
      throw new DomainValidationError(
        "MASS_PROPERTY_CHECKPOINT_TELEMETRY_MISSING",
        "Checkpoint restore requires the completed mass-property transaction telemetry",
      );
    context.massPropertyRuntime.lastTransaction = immutableClone({
      transactionId: restored.transactionId,
      committedAtTick: restored.committedAtTick,
      effectiveTick: restored.effectiveTick,
      appliedAfterIntegratedTick: restored.appliedAfterIntegratedTick,
      timingPolicy: restored.timingPolicy,
      stage: restored.stage,
      evaluatedPartCount: restored.evaluatedPartCount,
      committedPartCount: restored.committedPartCount,
      unchangedPartIds: restored.unchangedPartIds,
      records: restored.records,
    });
  }

  dispose(context) {
    delete context.massPropertyRuntime;
  }

  #commit(context, stage) {
    const runtime = context.services.multibodyRuntime;
    const timing = timingFor(stage, context.clock.tick);
    if (!runtime?.compiled)
      return {
        transactionId: `mass-properties:${context.clock.tick}:${stage}`,
        committedAtTick: context.clock.tick,
        ...timing,
        stage,
        evaluatedPartCount: 0,
        committedPartCount: 0,
        unchangedPartIds: [],
        records: [],
      };
    const contributions = new Map(
        (
          context.services.aerothermalAblationOwner?.massContributions?.() || []
        ).map((entry) => [entry.partId, entry]),
      ),
      stores = new Map(
        (context.materialResourceNetwork?.stores?.() || []).map((store) => [
          store.partId,
          store,
        ]),
      ),
      evaluated = runtime.compiled.bodies
        .map((descriptor) => {
          const contribution = contributions.get(descriptor.partId),
            structuralMassKg =
              contribution?.structuralMassKg ??
              descriptor.massProperties.massKg,
            materialStore = stores.get(descriptor.partId) || null;
          if (
            !materialStore &&
            Math.abs(structuralMassKg - descriptor.massProperties.massKg) <=
              1e-12
          )
            return null;
          const record = {
            partId: descriptor.partId,
            massProperties: deriveDynamicMassProperties(descriptor, {
              structuralMassKg,
              materialStore,
            }),
            structuralMassKg,
            ablatedMassKg: contribution?.ablatedMassKg || 0,
            materialMassKg: materialStore?.remainingMassKg || 0,
          };
          const body = runtime.bodyByPart.get(descriptor.partId);
          return {
            ...record,
            changed: !massPropertiesEqual(
              body?.userData?.massProperties,
              record.massProperties,
            ),
          };
        })
        .filter(Boolean)
        .sort(comparePartId),
      records = evaluated
        .filter((record) => record.changed)
        .map(({ changed: _changed, ...record }) => record),
      unchangedPartIds = evaluated
        .filter((record) => !record.changed)
        .map((record) => record.partId);
    const previous = records.map((record) => {
      const body = runtime.bodyByPart.get(record.partId),
        registered = context.bodyRegistry.bodyForPart(record.partId);
      if (!body?.userData?.massProperties || !registered)
        throw new DomainValidationError(
          "MASS_PROPERTY_TARGET_UNAVAILABLE",
          `Part ${String(record.partId)} is missing its runtime or registry mass target`,
        );
      return {
        partId: record.partId,
        massProperties: structuredClone(body.userData.massProperties),
        registryBodyId: registered.bodyId,
      };
    });
    let committed;
    try {
      committed = runtime.commitMassProperties(records);
      for (const record of records) {
        const bodyId = context.bodyRegistry.bodyForPart(record.partId)?.bodyId;
        context.bodyRegistry.setMassProperties(bodyId, record.massProperties);
      }
    } catch (commitError) {
      try {
        runtime.commitMassProperties(previous);
        for (const record of previous)
          context.bodyRegistry.setMassProperties(
            record.registryBodyId,
            record.massProperties,
          );
      } catch (rollbackError) {
        throw new AggregateError(
          [commitError, rollbackError],
          "Mass-property commit failed and rollback could not restore the previous authority",
          { cause: rollbackError },
        );
      }
      throw commitError;
    }
    const contributionByPart = new Map(
      records.map((record) => [record.partId, record]),
    );
    return {
      transactionId: `mass-properties:${context.clock.tick}:${stage}`,
      committedAtTick: context.clock.tick,
      ...timing,
      stage,
      evaluatedPartCount: evaluated.length,
      committedPartCount: committed.length,
      unchangedPartIds,
      records: committed.map((record) => ({
        ...record,
        structuralMassKg: contributionByPart.get(record.partId)
          .structuralMassKg,
        ablatedMassKg: contributionByPart.get(record.partId).ablatedMassKg,
        materialMassKg: contributionByPart.get(record.partId).materialMassKg,
      })),
    };
  }
}
