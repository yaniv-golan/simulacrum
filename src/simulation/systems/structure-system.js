import { recordBodyLoads } from "../body-registry.js";
import { applyRunGraphLoads } from "../run-assembly-graph.js";

const PHYSICAL_KINDS = new Set(["mechanical", "mesh"]);

function structuralTopology(context) {
  return {
    graphRevision: context.runGraph.graphRevision,
    connections: context.runGraph
      .connections()
      .filter((connection) => PHYSICAL_KINDS.has(connection.kind))
      .map((connection) => ({
        id: connection.id,
        a: connection.a,
        b: connection.b,
        kind: connection.kind,
        failed: Boolean(connection.failed),
      })),
    detachedPartIds: context.runGraph
      .parts()
      .filter((part) => part.detached)
      .map((part) => part.id)
      .sort((left, right) => String(left).localeCompare(String(right), "en")),
  };
}

function runtimeBodyComponents(runtime, allowed = null) {
  if (!runtime?.compiled) return [];
  const ids = [...runtime.bodyByPart.keys()].filter(
      (id) => !allowed || allowed.has(id),
    ),
    adjacency = new Map(ids.map((id) => [id, new Set()]));
  for (const entry of runtime.constraintEntries || []) {
    const { descriptor } = entry;
    if (
      entry.active === false ||
      descriptor.kind === "measurement" ||
      !adjacency.has(descriptor.a) ||
      !adjacency.has(descriptor.b)
    )
      continue;
    adjacency.get(descriptor.a).add(descriptor.b);
    adjacency.get(descriptor.b).add(descriptor.a);
  }
  const components = [],
    unvisited = new Set(ids);
  while (unvisited.size) {
    const seed = unvisited.values().next().value,
      component = [],
      queue = [seed];
    unvisited.delete(seed);
    while (queue.length) {
      const id = queue.shift();
      component.push(id);
      for (const neighbor of adjacency.get(id) || []) {
        if (!unvisited.has(neighbor)) continue;
        unvisited.delete(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component);
  }
  return components;
}

/**
 * Converts measured constraint reactions into stress, fatigue, failure, and
 * topology separation for every compiled assembly. No vehicle/demo identity or
 * mirrored flight connection state participates in this decision.
 */
export class StructureSystem {
  #appliedGraphRevision = -1;
  phase = "structures";
  checkpointOwner = "structure-failure";

  initialize(context) {
    this.initialBodyComponents = runtimeBodyComponents(
      context.services.multibodyRuntime,
    );
    this.overloadSeconds = new Map();
    this.#appliedGraphRevision = context.runGraph.graphRevision;
  }

  step(context, dt) {
    const runtime = context.services.multibodyRuntime,
      connections = context.runGraph.connections(),
      compiledLoads = runtime?.loadByConnection || new Map(),
      flexibleLoads =
        context.services.flexibleLineRuntime?.loadByConnection || new Map(),
      compiledTorques = runtime?.torqueByConnection || new Map(),
      failures = [],
      evaluations = [],
      bodyLoads = new Map(),
      propulsion = context.telemetry.propulsion,
      failureInputs =
        propulsion?.tick === context.clock.tick
          ? (propulsion.engines || [])
              .filter((record) => record.failureInput)
              .flatMap((record) => {
                const constraint = (runtime?.constraintEntries || []).find(
                  (entry) =>
                    entry.active !== false &&
                    entry.descriptor.id === record.shaftConstraintId,
                );
                return (constraint?.descriptor.sourceConnectionIds || []).map(
                  (connectionId) => ({
                    connectionId,
                    partId: record.partId,
                    input: record.failureInput,
                    validity: record.validity,
                  }),
                );
              })
          : [];
    let worstFatigue = 0;

    for (const connection of connections) {
      if (!PHYSICAL_KINDS.has(connection.kind) || connection.failed) continue;
      const load = Math.max(
          0,
          Number(compiledLoads.get(connection.id) || 0),
          Number(flexibleLoads.get(connection.id) || 0),
        ),
        torque = Math.max(0, Number(compiledTorques.get(connection.id) || 0)),
        forceUtilization =
          load / Math.max(1, Number(connection.capacity.ultimateForceN)),
        torqueUtilization =
          torque / Math.max(1, Number(connection.capacity.ultimateTorqueNm)),
        stress = Math.max(forceUtilization, torqueUtilization),
        overload = stress > 1,
        overloadSeconds = overload
          ? (this.overloadSeconds.get(connection.id) || 0) + dt
          : Math.max(
              0,
              (this.overloadSeconds.get(connection.id) || 0) - dt * 2,
            ),
        fatigueDelta =
          stress > 0.42
            ? Math.pow(stress - 0.42, 2) * dt * 0.012
            : -dt * 0.0003;
      evaluations.push({
        connection,
        load,
        stress,
        overloadSeconds,
        record: {
          connectionId: connection.id,
          loadN: load,
          torqueNm: torque,
          forceUtilization,
          torqueUtilization,
          stress,
          fatigueDelta,
          time: context.time,
        },
      });
      this.overloadSeconds.set(connection.id, overloadSeconds);
      this.#appendBodyLoads(bodyLoads, context, connection, load);
    }

    const updatedConnections = applyRunGraphLoads(
      context.runGraph,
      evaluations.map(({ record }) => record),
    );
    for (const [index, evaluation] of evaluations.entries()) {
      const { connection, stress, overloadSeconds } = evaluation,
        updated = updatedConnections[index];
      // Ultimate strength is an instantaneous material limit. The short
      // persistence interval only filters reactions hovering around that limit;
      // a clearly super-ultimate impact must fail during the measured tick.
      if (stress >= 1.05 || overloadSeconds > 0.06 || updated.fatigue >= 1)
        failures.push(connection.id);
      worstFatigue = Math.max(worstFatigue, updated.fatigue || 0);
    }
    for (const input of failureInputs) {
      const connection = context.runGraph.connection(input.connectionId);
      if (
        connection &&
        !connection.failed &&
        PHYSICAL_KINDS.has(connection.kind)
      )
        failures.push(connection.id);
    }
    for (const [bodyId, loads] of bodyLoads)
      recordBodyLoads(context.bodyRegistry, bodyId, loads);

    const newlyFailed = [...new Set(failures)],
      newlyFailedSet = new Set(newlyFailed),
      topologyDirty =
        this.#appliedGraphRevision !== context.runGraph.graphRevision,
      pendingConnections =
        newlyFailed.length || topologyDirty
          ? connections.map((connection) =>
              newlyFailedSet.has(connection.id)
                ? { ...connection, failed: true }
                : connection,
            )
          : null;
    const failureEvidenceRecorder = context.services.failureEvidenceRecorder,
      captureEvidence = Boolean(failureEvidenceRecorder?.acceptingEvidence?.());
    if (captureEvidence)
      failureEvidenceRecorder.recordStructurePreMutation({
        tick: context.clock.tick,
        timeS: context.time,
        evaluations: evaluations.map((evaluation, index) => ({
          ...evaluation.record,
          fatigue: Number(updatedConnections[index]?.fatigue || 0),
          ultimateForceN: Number(evaluation.connection.capacity.ultimateForceN),
          ultimateTorqueNm: Number(
            evaluation.connection.capacity.ultimateTorqueNm,
          ),
        })),
        topology: structuralTopology(context),
      });
    if (newlyFailed.length)
      failureEvidenceRecorder?.trigger({
        kind: "structural-failure",
        tick: context.clock.tick,
        timeS: context.time,
        subjectId: newlyFailed[0],
        validity: "measured",
      });
    let detachedConstraints = pendingConnections
      ? runtime?.applyConnectionFailures(pendingConnections) || []
      : [];
    if (pendingConnections)
      detachedConstraints.push(
        ...(context.services.flexibleLineRuntime?.applyConnectionFailures(
          pendingConnections,
        ) || []),
      );
    const separatedPartIds = detachedConstraints.length
      ? this.#separatedParts(context, runtime)
      : [];
    let structuralEvent = null;
    if (newlyFailed.length || separatedPartIds.length) {
      const operatingEnvelopeFailure = failureInputs.some((input) =>
        newlyFailedSet.has(input.connectionId),
      );
      structuralEvent = context.runGraph.applyStructuralEvent({
        failedConnectionIds: newlyFailed,
        detachedPartIds: separatedPartIds,
        reason: operatingEnvelopeFailure
          ? "rotor operating envelope exceeded structural limits"
          : separatedPartIds.length
            ? "measured attachment overload separated a physical component"
            : "measured attachment load exceeded structural capacity",
        mode: operatingEnvelopeFailure
          ? "operating-envelope"
          : newlyFailed.length
            ? "stress"
            : "detachment",
        time: context.time,
      });
    }
    if (separatedPartIds.length) {
      detachedConstraints = [
        ...new Set([
          ...detachedConstraints,
          ...(runtime?.applyConnectionFailures(
            context.runGraph.connections(),
          ) || []),
        ]),
      ];
    }

    for (const connectionId of structuralEvent?.failedConnectionIds || [])
      context.bodyRegistry.removeConstraint(connectionId);
    if (structuralEvent || topologyDirty)
      for (const part of context.runGraph
        .parts()
        .filter((item) => item.detached)) {
        const body = context.bodyRegistry.bodyForPart(part.id);
        if (body) context.bodyRegistry.setDetached(body.bodyId, true);
      }
    this.#appliedGraphRevision = context.runGraph.graphRevision;
    if (captureEvidence)
      failureEvidenceRecorder.recordStructurePostMutation({
        tick: context.clock.tick,
        timeS: context.time,
        event: structuralEvent,
        topology: structuralTopology(context),
      });

    const runtimeConnections = context.runGraph.connections();
    context.telemetry.structures = {
      health: Math.round((1 - worstFatigue) * 100),
      worstFatigue,
      newlyFailed,
      detachedPartIds: separatedPartIds,
      failedCount: runtimeConnections.filter((connection) => connection.failed)
        .length,
      detachedConstraints,
      failureInputs,
    };
  }

  #separatedParts(context, runtime) {
    if (!runtime?.compiled) return [];
    const detached = new Set();
    for (const initial of this.initialBodyComponents || []) {
      const allowed = new Set(initial),
        current = runtimeBodyComponents(runtime, allowed);
      if (current.length <= 1) continue;
      current.sort(
        (left, right) =>
          right.reduce(
            (sum, id) => sum + (runtime.bodyByPart.get(id)?.mass || 0),
            0,
          ) -
          left.reduce(
            (sum, id) => sum + (runtime.bodyByPart.get(id)?.mass || 0),
            0,
          ),
      );
      for (const component of current.slice(1))
        for (const id of component)
          if (!context.runGraph.part(id)?.detached) detached.add(id);
    }
    for (const entry of runtime.constraintEntries || []) {
      const connectorId = entry.descriptor.sourcePartId;
      if (
        connectorId == null ||
        entry.active !== false ||
        context.runGraph.part(connectorId)?.detached
      )
        continue;
      if (detached.has(entry.descriptor.a) || detached.has(entry.descriptor.b))
        detached.add(connectorId);
    }
    return [...detached];
  }

  #appendBodyLoads(records, context, connection, forceN) {
    const bodyIds = new Set(
      [connection.a, connection.b]
        .map((partId) => context.bodyRegistry.bodyForPart(partId)?.bodyId)
        .filter(Boolean),
    );
    for (const bodyId of bodyIds) {
      const loads = records.get(bodyId) || [];
      loads.push({
        connectionId: connection.id,
        forceN,
      });
      records.set(bodyId, loads);
    }
  }

  dispose() {
    this.initialBodyComponents = [];
    this.overloadSeconds?.clear();
    this.#appliedGraphRevision = -1;
  }

  exportState() {
    return structuredClone({
      version: 1,
      initialBodyComponents: this.initialBodyComponents || [],
      overloadSeconds: [...(this.overloadSeconds || new Map())],
    });
  }

  importState(state) {
    if (state?.version !== 1)
      throw new TypeError("structure checkpoint must use version 1");
    this.initialBodyComponents = structuredClone(
      state.initialBodyComponents || [],
    );
    this.overloadSeconds = new Map(
      structuredClone(state.overloadSeconds || []),
    );
    // The imported runtime owns the exact constraint state. Force one
    // idempotent graph-to-runtime reconciliation on the next step so this
    // derived cache cannot suppress externally committed topology changes.
    this.#appliedGraphRevision = -1;
  }
}
