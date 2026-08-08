import {
  deriveDynamicMassProperties,
  dynamicMassContributorIdentity,
  minimumDynamicStructuralMass,
} from "../../model/dynamic-mass-properties.js";
import {
  compareCanonicalIds,
  detachPlainData,
  DomainValidationError,
  immutableClone,
  stableStringify,
} from "../../model/primitives.js";
import { commitBodyRegistryMassProperties } from "../body-registry.js";
import { commitOwnedMultibodyMassProperties } from "../multibody-runtime.js";

const stableId = (value) => `${typeof value}:${String(value)}`;
const comparePartId = (left, right) =>
  compareCanonicalIds(left.partId, right.partId);

// Runtime mass authority is discrete: either the complete derived projection
// is exactly the installed projection or the owner must commit it. Numerical
// tolerances belong to measurement assertions, never to ownership decisions.
function massPropertiesEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function timingFor(stage, tick) {
  if (stage === "checkpoint-restore")
    return {
      appliedAfterIntegratedTick: tick,
      effectiveTick: tick,
      timingPolicy: "owner-first-checkpoint-reconstruction-v1",
    };
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

function sortedPartIds(values) {
  return [...values].sort((left, right) =>
    comparePartId({ partId: left }, { partId: right }),
  );
}

function exactOwnerRecords(records, expected, ownerId, fields, validate) {
  records = detachPlainData(records, {
    code: "MASS_PROPERTY_OWNER_COVERAGE_MISMATCH",
    finiteNumbers: true,
    message: `Mutable-mass owner ${ownerId} must expose accessor-free, acyclic, finite plain records`,
    path: [ownerId],
  });
  if (!Array.isArray(records))
    throw new DomainValidationError(
      "MASS_PROPERTY_OWNER_COVERAGE_MISMATCH",
      `Mutable-mass owner ${ownerId} must expose an exact record sequence`,
    );
  const expectedPartIds = expected.map((record) => record.partId),
    actualPartIds = records.map((record) => record?.partId),
    actualIdentity = actualPartIds.map(stableId),
    expectedIdentity = expectedPartIds.map(stableId);
  if (
    actualPartIds.some((partId) => partId == null) ||
    new Set(actualIdentity).size !== actualIdentity.length ||
    stableStringify(actualIdentity) !== stableStringify(expectedIdentity)
  )
    throw new DomainValidationError(
      "MASS_PROPERTY_OWNER_COVERAGE_MISMATCH",
      `Mutable-mass owner ${ownerId} records must exactly match compiled canonical part authority`,
      { details: { actualPartIds, expectedPartIds } },
    );
  for (const [index, record] of records.entries()) {
    const actualFields = Object.keys(record).sort(),
      expectedFields = [...fields].sort(),
      expectedRecord = expected[index];
    if (
      stableStringify(actualFields) !== stableStringify(expectedFields) ||
      record.kind !== expectedRecord.kind
    )
      throw new DomainValidationError(
        "MASS_PROPERTY_OWNER_COVERAGE_MISMATCH",
        `Mutable-mass owner ${ownerId} record fields or kind changed`,
        { details: { actual: record, expected: expectedRecord } },
      );
    validate(record, expectedRecord);
  }
  return new Map(records.map((record) => [record.partId, record]));
}

function compiledMutableMassAuthority(compiled) {
  const kindsByPart = new Map(
      compiled.rigidClusters.flatMap((cluster) =>
        cluster.members.map((member) => [
          member.partId,
          member.runtimeMassContributorKinds,
        ]),
      ),
    ),
    bodyByPart = new Map(compiled.bodies.map((body) => [body.partId, body])),
    partsFor = (kind) =>
      sortedPartIds(
        [...kindsByPart]
          .filter(([, kinds]) => kinds.includes(kind))
          .map(([partId]) => partId),
      ),
    entriesFor = (kind) =>
      partsFor(kind).map((partId) => ({
        partId,
        kind,
        body: bodyByPart.get(partId),
      }));
  return {
    kindsByPart,
    material: entriesFor("material-store-v1"),
    aerothermal: entriesFor("ablative-material-v1"),
    pneumatic: sortedPartIds(
      [...kindsByPart]
        .filter(([, kinds]) =>
          kinds.some(
            (kind) =>
              kind === "tire-chamber-v1" ||
              kind === "ideal-gas-control-volume-v1",
          ),
        )
        .map(([partId]) => partId),
    ).map((partId) => ({
      partId,
      kind: kindsByPart
        .get(partId)
        .find(
          (kind) =>
            kind === "tire-chamber-v1" ||
            kind === "ideal-gas-control-volume-v1",
        ),
    })),
  };
}

function mutableMassOwnerRecords(context, compiled, projection = null) {
  const authority = compiledMutableMassAuthority(compiled),
    materialRecords =
      projection?.materialRecords ??
      (context.materialResourceNetwork
        ? context.materialResourceNetwork.massContributions?.()
        : []),
    aerothermalRecords =
      projection?.aerothermalRecords ??
      (context.services.aerothermalAblationOwner
        ? context.services.aerothermalAblationOwner.massContributions?.()
        : []),
    pneumaticRecords =
      projection?.pneumaticRecords ??
      (context.pneumaticNetwork
        ? context.pneumaticNetwork.massContributions?.()
        : []),
    stores = exactOwnerRecords(
      materialRecords,
      authority.material,
      "material-store-v1",
      [
        "kind",
        "partId",
        "bodyId",
        "mediumId",
        "capacityKg",
        "remainingMassKg",
        "densityKgM3",
        "specificAvailableEnergyJkg",
        "outletPortId",
        "fillLaw",
        "storageSolid",
        "storageAxisPart",
      ],
      (record, expected) => {
        const contract = expected.body.capabilities.materialStore,
          expectedStatic = {
            kind: expected.kind,
            partId: expected.partId,
            bodyId: expected.body.id,
            mediumId: contract.mediumId,
            capacityKg: contract.capacityKg,
            densityKgM3: contract.densityKgM3,
            specificAvailableEnergyJkg: contract.specificAvailableEnergyJkg,
            outletPortId: contract.outletPortId,
            fillLaw: contract.fillLaw.kind,
            storageSolid: contract.storageSolid,
            storageAxisPart: contract.storageAxisPart,
          },
          { remainingMassKg, ...actualStatic } = record;
        if (
          stableStringify(actualStatic) !== stableStringify(expectedStatic) ||
          remainingMassKg < 0 ||
          remainingMassKg > contract.capacityKg
        )
          throw new DomainValidationError(
            "MASS_PROPERTY_OWNER_COVERAGE_MISMATCH",
            `Material-store owner authority changed for part ${String(record.partId)}`,
          );
      },
    ),
    contributions = exactOwnerRecords(
      aerothermalRecords,
      authority.aerothermal,
      "ablative-material-v1",
      [
        "kind",
        "partId",
        "initialStructuralMassKg",
        "structuralMassKg",
        "ablatedMassKg",
      ],
      (record, expected) => {
        const initial = expected.body.massProperties.massKg,
          minimumStructuralMass = minimumDynamicStructuralMass(initial);
        if (
          record.initialStructuralMassKg !== initial ||
          record.structuralMassKg < minimumStructuralMass ||
          record.structuralMassKg > initial ||
          record.ablatedMassKg < 0 ||
          record.ablatedMassKg > initial - minimumStructuralMass ||
          record.ablatedMassKg !== initial - record.structuralMassKg
        )
          throw new DomainValidationError(
            "MASS_PROPERTY_OWNER_COVERAGE_MISMATCH",
            `Ablative owner authority changed for part ${String(record.partId)}`,
          );
      },
    ),
    pneumatic = exactOwnerRecords(
      pneumaticRecords,
      authority.pneumatic,
      "pneumatic-gas-v1",
      ["partId", "kind", "massKg", "internalEnergyJ", "volumeM3"],
      (record) => {
        if (
          !(record.massKg > 0) ||
          !(record.internalEnergyJ > 0) ||
          !(record.volumeM3 > 0)
        )
          throw new DomainValidationError(
            "MASS_PROPERTY_OWNER_COVERAGE_MISMATCH",
            `Pneumatic owner state is nonphysical for part ${String(record.partId)}`,
          );
      },
    ),
    projectedPneumaticContributions = projection
      ? new Map(
          projection.pneumaticContributions.map(({ partId, contribution }) => [
            partId,
            contribution,
          ]),
        )
      : null,
    pneumaticMassContributions = new Map(
      [...pneumatic].map(([partId, record]) => {
        const massContribution = projectedPneumaticContributions
          ? projectedPneumaticContributions.get(partId)
          : context.pneumaticNetwork.gasMassContributionForPart(partId);
        if (
          !massContribution ||
          massContribution.massKg !== record.massKg ||
          massContribution.id !==
            dynamicMassContributorIdentity("pneumatic-gas", partId)
        )
          throw new DomainValidationError(
            "MASS_PROPERTY_OWNER_COVERAGE_MISMATCH",
            `Pneumatic mass projection disagrees for part ${String(partId)}`,
          );
        return [partId, massContribution];
      }),
    );
  if (
    projectedPneumaticContributions &&
    projectedPneumaticContributions.size !== pneumatic.size
  )
    throw new DomainValidationError(
      "MASS_PROPERTY_OWNER_COVERAGE_MISMATCH",
      "Pneumatic mass projection must exactly cover canonical chamber authority",
    );
  return {
    authority,
    contributions,
    pneumatic,
    pneumaticMassContributions,
    stores,
  };
}

/** Pure package-internal projection of target checkpoint mass authority. */
export function planCheckpointMassProperties(
  context,
  { materialResources, pneumatics, aerothermal },
) {
  const pneumaticProjection = context.pneumaticNetwork
      ? context.pneumaticNetwork.massProjectionForState(pneumatics)
      : { records: [], contributions: [] },
    projection = {
      materialRecords: context.materialResourceNetwork
        ? context.materialResourceNetwork.massContributionsForState(
            materialResources.network,
          )
        : [],
      aerothermalRecords: context.services.aerothermalAblationOwner
        ? context.services.aerothermalAblationOwner.massContributionsForState(
            aerothermal,
          )
        : [],
      pneumaticRecords: pneumaticProjection.records,
      pneumaticContributions: pneumaticProjection.contributions,
    },
    plan = planMassProperties(context, "checkpoint-restore", projection);
  return new Map(
    [...plan.expectedMassPropertiesByPart].map(([partId, massProperties]) => [
      partId,
      immutableClone(massProperties),
    ]),
  );
}

/** Owns the only runtime transaction that may change physical body mass. */
export class MassPropertyCommitSystem {
  phase = "thermal";
  checkpointOwner = "mass-properties";

  initialize(context) {
    context.massPropertyRuntime = {
      version: 1,
      lastTransaction: commitMassProperties(context, "initialization"),
    };
    context.initialSystemTelemetry ||= {};
    context.initialSystemTelemetry.massProperties = this.telemetry(context);
  }

  step(context) {
    context.massPropertyRuntime.lastTransaction = commitMassProperties(
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
    if (!context.massPropertyRuntime?.lastTransaction)
      throw new DomainValidationError(
        "MASS_PROPERTY_CHECKPOINT_RECONSTRUCTION_MISSING",
        "Checkpoint restore requires an owner-reconstructed mass-property transaction",
      );
    context.telemetry.massProperties = this.telemetry(context);
  }

  dispose(context) {
    delete context.massPropertyRuntime;
  }
}

function planMassProperties(context, stage, ownerProjection = null) {
  const runtime = context.services.multibodyRuntime;
  const timing = timingFor(stage, context.clock.tick);
  if (!runtime?.compiled)
    return {
      runtime,
      timing,
      evaluated: [],
      records: [],
      unchangedPartIds: [],
      expectedMassPropertiesByPart: new Map(),
    };
  const { contributions, pneumatic, pneumaticMassContributions, stores } =
      mutableMassOwnerRecords(context, runtime.compiled, ownerProjection),
    evaluated = runtime.compiled.bodies
      .map((descriptor) => {
        const contribution = contributions.get(descriptor.partId),
          structuralMassKg =
            contribution?.structuralMassKg ?? descriptor.massProperties.massKg,
          materialStore = stores.get(descriptor.partId) ?? null,
          pneumaticRecord = pneumatic.get(descriptor.partId) ?? null,
          pneumaticGasMassKg = pneumaticRecord ? pneumaticRecord.massKg : 0,
          body = runtime.bodyByPart.get(descriptor.partId);
        if (
          !materialStore &&
          pneumaticGasMassKg <= 0 &&
          structuralMassKg === descriptor.massProperties.massKg
        )
          return null;
        const pneumaticMassContribution = pneumaticRecord
          ? pneumaticMassContributions.get(descriptor.partId)
          : null;
        const record = {
          partId: descriptor.partId,
          massProperties: deriveDynamicMassProperties(descriptor, {
            structuralMassKg,
            materialStore,
            additionalMassContributions: pneumaticMassContribution
              ? [pneumaticMassContribution]
              : [],
          }),
          structuralMassKg,
          ablatedMassKg: contribution?.ablatedMassKg ?? 0,
          materialMassKg: materialStore?.remainingMassKg ?? 0,
          pneumaticGasMassKg,
        };
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
      .map((record) => record.partId),
    expectedMassPropertiesByPart = new Map(
      runtime.compiled.bodies.map((descriptor) => [
        descriptor.partId,
        evaluated.find((record) => record.partId === descriptor.partId)
          ?.massProperties ?? descriptor.massProperties,
      ]),
    );
  return {
    runtime,
    timing,
    evaluated,
    records,
    unchangedPartIds,
    expectedMassPropertiesByPart,
  };
}

function commitMassProperties(context, stage) {
  const { runtime, timing, evaluated, records, unchangedPartIds } =
    planMassProperties(context, stage);
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
  if (!records.length)
    return {
      transactionId: `mass-properties:${context.clock.tick}:${stage}`,
      committedAtTick: context.clock.tick,
      ...timing,
      stage,
      evaluatedPartCount: evaluated.length,
      committedPartCount: 0,
      unchangedPartIds,
      records: [],
    };
  const previous = records.map((record) => {
    const body = runtime.bodyByPart.get(record.partId),
      registered = context.bodyRegistry.bodyForPart(record.partId);
    if (!body?.userData?.massProperties || !registered)
      throw new DomainValidationError(
        "MASS_PROPERTY_TARGET_UNAVAILABLE",
        `Part ${String(record.partId)} is missing its runtime or registry mass target`,
      );
    if (
      stableStringify(body.userData.massProperties) !==
      stableStringify(registered.massProperties)
    )
      throw new DomainValidationError(
        "MASS_PROPERTY_TARGET_AUTHORITY_MISMATCH",
        `Part ${String(record.partId)} runtime and registry mass projections disagree before commit`,
      );
    return {
      partId: record.partId,
      bodyId: registered.bodyId,
      massProperties: structuredClone(body.userData.massProperties),
      kinematics: {
        position: registered.pose.position,
        quaternion: registered.pose.quaternion,
        velocity: registered.velocity,
        angularVelocity: registered.angularVelocity,
      },
    };
  });
  let committed,
    runtimeCommitted = false,
    registryCommitted = false;
  try {
    committed = commitOwnedMultibodyMassProperties(
      runtime,
      records.map(({ partId, massProperties }) => ({
        partId,
        massProperties,
      })),
    );
    runtimeCommitted = true;
    commitBodyRegistryMassProperties(
      context.bodyRegistry,
      records.map((record) => ({
        bodyId: context.bodyRegistry.bodyForPart(record.partId)?.bodyId,
        massProperties: record.massProperties,
      })),
    );
    registryCommitted = true;
    for (const record of committed) {
      const registered = context.bodyRegistry.bodyForPart(record.partId),
        pose = runtime.bodyPose(record.partId);
      if (!registered || !pose)
        throw new DomainValidationError(
          "MASS_PROPERTY_KINEMATIC_TARGET_UNAVAILABLE",
          `Part ${String(record.partId)} is missing its post-commit kinematic projection`,
        );
      context.bodyRegistry.updateKinematics(registered.bodyId, pose, 0);
    }
  } catch (commitError) {
    if (!runtimeCommitted) throw commitError;
    try {
      commitOwnedMultibodyMassProperties(
        runtime,
        previous.map(({ partId, massProperties }) => ({
          partId,
          massProperties,
        })),
      );
      if (registryCommitted) {
        commitBodyRegistryMassProperties(
          context.bodyRegistry,
          previous.map(({ bodyId, massProperties }) => ({
            bodyId,
            massProperties,
          })),
        );
        for (const record of previous)
          context.bodyRegistry.updateKinematics(
            record.bodyId,
            record.kinematics,
            0,
          );
      }
    } catch (rollbackError) {
      throw new AggregateError(
        [commitError, rollbackError],
        `Mass-property commit failed and rollback could not restore the previous authority: ${String(commitError)}; rollback: ${String(rollbackError)}`,
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
      structuralMassKg: contributionByPart.get(record.partId).structuralMassKg,
      ablatedMassKg: contributionByPart.get(record.partId).ablatedMassKg,
      materialMassKg: contributionByPart.get(record.partId).materialMassKg,
      pneumaticGasMassKg: contributionByPart.get(record.partId)
        .pneumaticGasMassKg,
    })),
  };
}

export function isMassPropertyCommitSystem(value) {
  return value instanceof MassPropertyCommitSystem;
}

export function reconstructMassPropertiesAfterCheckpointOwners(
  system,
  context,
) {
  if (!isMassPropertyCommitSystem(system))
    throw new DomainValidationError(
      "MASS_PROPERTY_CHECKPOINT_OWNER_MISSING",
      "Checkpoint mass reconstruction requires the mass-property commit owner",
    );
  const transaction = commitMassProperties(context, "checkpoint-restore");
  context.massPropertyRuntime.lastTransaction = transaction;
  return transaction;
}
